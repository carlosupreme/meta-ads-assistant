import OpenAI from "openai";
import { z } from "zod";
import type { AiAnalysis, AiCampaignContext, AiStatus } from "./contracts";

const MODELS_TTL_MS = 10 * 60_000;
// Families that cannot answer plain text prompts through the Responses API, or are unrelated to this use.
const NON_TEXT_MODEL = /(audio|realtime|transcribe|tts|image|dall-e|embedding|moderation|search|whisper|instruct|codex|computer-use)/i;

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

let client: OpenAI | undefined;
let modelsCache: { at: number; models: string[] } | undefined;

function openai(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Falta OPENAI_API_KEY en el servidor.");
  client ??= new OpenAI({ apiKey });
  return client;
}

export function aiStatus(model: string | undefined): AiStatus {
  if (!process.env.OPENAI_API_KEY) return { configured: false, model: model ?? null, reason: "Falta OPENAI_API_KEY en el servidor." };
  if (!model) return { configured: false, model: null, reason: "Elige un modelo de OpenAI en Configuración." };
  return { configured: true, model };
}

/** Text models this API key can call, newest first. Cached briefly to avoid a request per page load. */
export async function listChatModels(): Promise<string[]> {
  if (modelsCache && Date.now() - modelsCache.at < MODELS_TTL_MS) return modelsCache.models;
  const found: Array<{ id: string; created: number }> = [];
  for await (const model of openai().models.list()) {
    if (/^(gpt-|o\d)/.test(model.id) && !NON_TEXT_MODEL.test(model.id)) found.push({ id: model.id, created: model.created });
  }
  const models = found.sort((a, b) => b.created - a.created).map((model) => model.id);
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
    campanas: context.campaigns.map((campaign) => ({ id: campaign.id, nombre: campaign.name, estado: campaign.status, gasto_mes_mxn: campaign.spend, resultados: campaign.results, costo_resultado_mxn: campaign.costPerResult, ingresos_mxn: campaign.revenue, roas: campaign.roas, tendencia_pct: campaign.trend, presupuesto_diario_mxn: campaign.dailyBudget, nivel_presupuesto: campaign.budgetLevel ?? "campaign" })),
    anuncios_7d: context.ads.map((ad) => ({ id: ad.id, campana_id: ad.campaignId, nombre: ad.name, estado: ad.status, gasto_mxn: ad.spend, impresiones: ad.impressions, ctr_pct: ad.ctr, frecuencia: ad.frequency, resultados: ad.results })),
    cambios_ya_planeados: context.plannedActions,
  });
}

// Reasoning models spend part of max_output_tokens thinking, so the budgets leave room for it.
export async function analyzeCampaigns(model: string, context: AiCampaignContext): Promise<AiAnalysis> {
  const response = await openai().responses.create({
    model,
    store: false,
    max_output_tokens: 4000,
    instructions: ANALYST_INSTRUCTIONS,
    input: compactContext(context),
  });
  const raw = response.output_text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  return analysisSchema.parse(JSON.parse(raw));
}

export async function askPulso(model: string, context: AiCampaignContext, question: string): Promise<string> {
  const response = await openai().responses.create({
    model,
    store: false,
    max_output_tokens: 2000,
    instructions: ADVISOR_INSTRUCTIONS,
    input: `Contexto de la cuenta: ${compactContext(context)}\n\nPregunta del usuario: ${question}`,
  });
  return response.output_text.trim();
}
