import OpenAI from "openai";
import { z } from "zod";
import type { AiAnalysis, AiCampaignContext, AiCampaignReview, AiSingleCampaignContext, AiStatus } from "./contracts";

const MODELS_TTL_MS = 10 * 60_000;

const ANALYST_INSTRUCTIONS = [
  "Eres el analista senior de Pulso, un SaaS de Meta Ads para dueños de negocio mexicanos. Analiza exclusivamente los datos proporcionados. No inventes métricas, políticas de Meta ni resultados.",
  "Entrega máximo tres recomendaciones prácticas en español de México y, solo si los datos lo justifican, hasta tres acciones concretas.",
  "Las acciones usan exactamente los id de campanas y anuncios_7d. Tipos: increase_budget y decrease_budget con changePct entre -20 y 20; pause_campaign; pause_ad con adId. No repitas objetivos que ya estén en cambios_ya_planeados.",
  "Un motor de guardrails validará cada acción: nunca exceder el límite mensual, variación máxima de 20% en 24 h y no pausar el último anuncio activo de un conjunto.",
  "Devuelve JSON estricto sin Markdown: {headline,summary,recommendations:[{agent,title,detail,impact,urgency}],actions:[{type,campaignId,adId?,changePct?,reason,impact}]}. agent es Supervisor, Presupuesto, Audiencias, Creativos, Analista o Estratega. urgency es info, warning o action.",
].join(" ");

const ADVISOR_INSTRUCTIONS = "Eres Pulso, un asistente de Meta Ads para dueños de negocio mexicanos. Responde en español claro, breve y accionable. Usa únicamente los datos de contexto entregados. No prometas rendimientos ni indiques acciones que rompan el límite mensual o aumenten un presupuesto más de 20% en un día.";

const analysisSchema = z.object({
  headline: z.string().min(3).max(140),
  summary: z.string().min(12).max(600),
  recommendations: z.array(z.object({
    agent: z.enum(["Supervisor", "Presupuesto", "Audiencias", "Creativos", "Analista", "Estratega"]),
    title: z.string().min(3).max(120),
    detail: z.string().min(8).max(420),
    impact: z.string().min(2).max(120),
    urgency: z.enum(["info", "warning", "action"]),
  })).min(1).max(3),
  actions: z.array(z.object({
    type: z.enum(["increase_budget", "decrease_budget", "pause_campaign", "pause_ad"]),
    campaignId: z.string().min(1),
    adId: z.string().min(1).optional(),
    changePct: z.number().min(-20).max(20).optional(),
    reason: z.string().min(8).max(420),
    impact: z.string().min(2).max(120),
  })).max(3).default([]),
});

// Low effort is supported by every allowed model and keeps answers fast and cheap. Reasoning tokens still count
// against max_output_tokens, so the budgets below leave room for them.
const REASONING = { effort: "low" } as const;
const MAX_CAMPAIGNS_IN_CONTEXT = 50;
const MAX_ADS_IN_CONTEXT = 40;

interface ModelResponse {
  status?: string | null;
  incomplete_details?: { reason?: string } | null;
  output_text: string;
}

/** Text of a finished response, or an explicit error when the model stopped before writing an answer. */
export function readOutputText(response: ModelResponse): string {
  const text = response.output_text?.trim() ?? "";
  if (text && response.status !== "incomplete") return text;
  const reason = response.incomplete_details?.reason;
  if (reason === "max_output_tokens") {
    throw new Error(text ? "OpenAI cortó la respuesta por el límite de tokens." : "OpenAI usó todos los tokens razonando y no alcanzó a responder.");
  }
  if (reason === "content_filter") throw new Error("OpenAI bloqueó la respuesta con su filtro de contenido.");
  throw new Error("OpenAI no devolvió texto.");
}

const readJsonOutput = (response: ModelResponse): unknown =>
  JSON.parse(readOutputText(response).replace(/^```json\s*/i, "").replace(/```$/, "").trim());

let client: OpenAI | undefined;
let modelsCache: { at: number; models: string[] } | undefined;

function openai(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Falta OPENAI_API_KEY en el servidor.");
  client ??= new OpenAI({ apiKey });
  return client;
}

// Temporary: every workspace uses the same low-cost model. Add ids here to reopen the per-workspace choice.
export const DEFAULT_AI_MODEL = "gpt-5-nano";
const ALLOWED_AI_MODELS: readonly string[] = [DEFAULT_AI_MODEL];

/** The workspace's stored model while it is still allowed, otherwise the default. */
export function resolveAiModel(model: string | undefined): string {
  return model && ALLOWED_AI_MODELS.includes(model) ? model : DEFAULT_AI_MODEL;
}

export function aiStatus(model: string | undefined): AiStatus {
  const effective = resolveAiModel(model);
  if (!process.env.OPENAI_API_KEY) return { configured: false, model: effective, reason: "Falta OPENAI_API_KEY en el servidor." };
  return { configured: true, model: effective };
}

/** Allowed models this API key can call. Cached briefly to avoid a request per page load. */
export async function listChatModels(): Promise<string[]> {
  if (modelsCache && Date.now() - modelsCache.at < MODELS_TTL_MS) return modelsCache.models;
  const models: string[] = [];
  for await (const model of openai().models.list()) {
    if (ALLOWED_AI_MODELS.includes(model.id)) models.push(model.id);
  }
  modelsCache = { at: Date.now(), models };
  return models;
}

export function buildAiContext(
  organization: AiCampaignContext["organization"],
  campaigns: AiCampaignContext["campaigns"],
  ads: AiCampaignContext["ads"] = [],
  plannedActions: AiCampaignContext["plannedActions"] = [],
): AiCampaignContext {
  return { organization, campaigns, ads, plannedActions };
}

function compactContext(context: AiCampaignContext): string {
  return JSON.stringify({
    negocio: context.organization.name,
    objetivo: context.organization.objective,
    modo: context.organization.mode,
    limite_mensual_mxn: context.organization.monthlyLimit,
    roas_meta: context.organization.targetRoas ?? 3,
    gasto_mes_mxn: context.organization.spentThisMonth,
    ingresos_atribuidos_mxn: context.organization.revenueThisMonth,
    valor_estimado_resultado_mxn: context.organization.resultValue,
    // The biggest spenders carry the signal; capping keeps prompts short for large accounts.
    campanas: [...context.campaigns].sort((a, b) => b.spend - a.spend).slice(0, MAX_CAMPAIGNS_IN_CONTEXT).map((campaign) => ({ id: campaign.id, nombre: campaign.name, estado: campaign.status, gasto_mes_mxn: campaign.spend, resultados: campaign.results, costo_resultado_mxn: campaign.costPerResult, ingresos_mxn: campaign.revenue, roas: campaign.roas, tendencia_pct: campaign.trend, presupuesto_diario_mxn: campaign.dailyBudget, nivel_presupuesto: campaign.budgetLevel ?? "campaign" })),
    anuncios_7d: [...context.ads].sort((a, b) => b.spend - a.spend).slice(0, MAX_ADS_IN_CONTEXT).map((ad) => ({ id: ad.id, campana_id: ad.campaignId, nombre: ad.name, estado: ad.status, gasto_mxn: ad.spend, impresiones: ad.impressions, ctr_pct: ad.ctr, frecuencia: ad.frequency, resultados: ad.results })),
    cambios_ya_planeados: context.plannedActions,
  });
}

export async function analyzeCampaigns(model: string, context: AiCampaignContext): Promise<AiAnalysis> {
  const response = await openai().responses.create({
    model,
    store: false,
    reasoning: REASONING,
    max_output_tokens: 6000,
    instructions: ANALYST_INSTRUCTIONS,
    input: compactContext(context),
  });
  return analysisSchema.parse(readJsonOutput(response));
}

const CAMPAIGN_REVIEWER_INSTRUCTIONS = [
  "Eres el analista senior de Pulso, un SaaS de Meta Ads para dueños de negocio mexicanos. Revisa UNA sola campaña con los datos proporcionados; no inventes métricas, políticas de Meta ni resultados.",
  "Siempre entrega un veredicto y un resumen de 2 a 4 frases en español de México: cómo va frente a la meta y al promedio de la cuenta, qué señal de sus anuncios importa y qué conviene hacer, aunque vaya bien.",
  "verdict: attention (bajo la meta o gasta sin resultados), watch (ligeramente bajo o con señales de riesgo), learning (gastó menos de dos días de presupuesto), no_data (sin gasto), good (en meta), excellent (claramente sobre la meta), paused (pausada).",
  "action es null salvo que los datos justifiquen un cambio concreto y la campaña esté ACTIVE. Tipos: increase_budget (changePct de 1 a 20) o decrease_budget (changePct de -20 a -1); pause_campaign; pause_ad con adId de anuncios. Si acciones_recientes no está vacío, action es null.",
  "Un motor de guardrails validará la acción: nunca exceder el límite mensual, variación máxima de 20% en 24 h y no pausar el último anuncio activo de un conjunto.",
  "Devuelve JSON estricto sin Markdown: {verdict,title,summary,action:{type,adId?,changePct?,reason,impact}|null}. title de máximo 90 caracteres.",
].join(" ");

const campaignReviewSchema = z.object({
  verdict: z.enum(["attention", "watch", "learning", "no_data", "good", "excellent", "paused"]),
  title: z.string().trim().min(3).max(120),
  summary: z.string().trim().min(12).max(700),
  action: z.object({
    type: z.enum(["increase_budget", "decrease_budget", "pause_campaign", "pause_ad"]),
    adId: z.string().min(1).nullish(),
    changePct: z.number().min(-20).max(20).nullish(),
    reason: z.string().min(8).max(420),
    impact: z.string().min(2).max(120),
  }).nullable().default(null),
});

const MAX_ADS_PER_CAMPAIGN = 30;

/** A verdict and summary for one campaign, plus at most one change that the guardrails still validate. */
export async function reviewCampaignWithAi(model: string, context: AiSingleCampaignContext): Promise<AiCampaignReview> {
  const { organization, campaign, account } = context;
  const response = await openai().responses.create({
    model,
    store: false,
    reasoning: REASONING,
    text: { verbosity: "low" },
    max_output_tokens: 4000,
    instructions: CAMPAIGN_REVIEWER_INSTRUCTIONS,
    input: JSON.stringify({
      negocio: organization.name,
      objetivo: organization.objective,
      modo: organization.mode,
      limite_mensual_mxn: organization.monthlyLimit,
      gasto_mes_mxn: organization.spentThisMonth,
      proyeccion_mes_mxn: account.projectedMonthSpend,
      roas_meta: organization.targetRoas ?? 3,
      valor_estimado_resultado_mxn: organization.resultValue,
      promedio_cuenta: { campanas_activas: account.activeCampaigns, roas: account.averageRoas, costo_resultado_mxn: account.averageCostPerResult },
      campana: { id: campaign.id, nombre: campaign.name, paginas: campaign.pageNames ?? [], estado: campaign.status, objetivo: campaign.objective, gasto_mes_mxn: campaign.spend, resultados: campaign.results, costo_resultado_mxn: campaign.costPerResult, ingresos_mxn: campaign.revenue, roas: campaign.roas, tendencia_pct: campaign.trend, presupuesto_diario_mxn: campaign.dailyBudget, nivel_presupuesto: campaign.budgetLevel ?? "campaign" },
      anuncios: [...context.ads].sort((a, b) => b.spend - a.spend).slice(0, MAX_ADS_PER_CAMPAIGN).map((ad) => ({ id: ad.id, nombre: ad.name, estado: ad.status, gasto_mxn: ad.spend, impresiones: ad.impressions, ctr_pct: ad.ctr, frecuencia: ad.frequency, resultados: ad.results })),
      acciones_recientes: context.recentActions,
    }),
  });
  return campaignReviewSchema.parse(readJsonOutput(response));
}

export async function askPulso(model: string, context: AiCampaignContext, question: string): Promise<string> {
  const response = await openai().responses.create({
    model,
    store: false,
    reasoning: REASONING,
    text: { verbosity: "low" },
    max_output_tokens: 4000,
    instructions: ADVISOR_INSTRUCTIONS,
    input: `Contexto de la cuenta: ${compactContext(context)}\n\nPregunta del usuario: ${question}`,
  });
  return readOutputText(response);
}

const COPYWRITER_INSTRUCTIONS = [
  "Eres copywriter senior de anuncios de Facebook e Instagram para negocios mexicanos.",
  "Escribe tres variantes del anuncio base con ángulos distintos (por ejemplo beneficio principal, prueba social y oportunidad del momento) que mantengan el mismo producto, oferta y promesa.",
  "No inventes precios, descuentos, fechas, garantías, testimonios ni cifras que no estén en el anuncio base.",
  "Español de México, claro y directo. headline de 3 a 60 caracteres; primaryText de 10 a 500 caracteres; angle es el nombre corto del ángulo.",
  "Devuelve JSON estricto sin Markdown: {variants:[{headline,primaryText,angle}]}.",
].join(" ");

const variantsSchema = z.object({
  variants: z.array(z.object({
    headline: z.string().trim().min(3).max(60),
    primaryText: z.string().trim().min(10).max(500),
    angle: z.string().trim().min(2).max(80),
  })).min(1).max(3),
});

export interface AdVariantBrief {
  business: string;
  objective: string;
  campaign: string;
  headline?: string;
  primaryText?: string;
  ctr: number;
  frequency: number;
  results: number;
}

export interface AdVariantCopy {
  headline: string;
  primaryText: string;
  angle: string;
}

/** Fresh copy for a fatigued ad that keeps its offer; guardrails still validate lengths before publishing. */
export async function writeAdVariants(model: string, brief: AdVariantBrief): Promise<AdVariantCopy[]> {
  const response = await openai().responses.create({
    model,
    store: false,
    reasoning: REASONING,
    max_output_tokens: 4000,
    instructions: COPYWRITER_INSTRUCTIONS,
    input: JSON.stringify({
      negocio: brief.business,
      objetivo: brief.objective,
      campana: brief.campaign,
      anuncio_base: { titulo: brief.headline ?? "", texto: brief.primaryText ?? "" },
      rendimiento_7d: { ctr_pct: brief.ctr, frecuencia: brief.frequency, resultados: brief.results },
    }),
  });
  return variantsSchema.parse(readJsonOutput(response)).variants;
}
