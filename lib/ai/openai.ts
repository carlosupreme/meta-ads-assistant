import OpenAI from "openai";
import type { Response as OpenAIResponse, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { z } from "zod";
import type { AiAnalysis, AiCampaignContext, AiCampaignReview, AiSingleCampaignContext, AiStatus } from "./contracts";
import type { AiFeature, AiTrace } from "./usage";
import { recordAiCall } from "./usage-log.ts";

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

/** Every model call goes through here, so each one is logged with who asked, from where, the exact response and its cost. */
async function callModel<T>(feature: AiFeature, trace: AiTrace, params: ResponseCreateParamsNonStreaming, read: (response: OpenAIResponse) => T): Promise<T> {
  const at = new Date();
  let response: OpenAIResponse | undefined;
  try {
    response = await openai().responses.create(params);
    const result = read(response);
    await recordAiCall({ feature, trace, request: params, response, result, durationMs: Date.now() - at.getTime(), at });
    return result;
  } catch (error) {
    await recordAiCall({ feature, trace, request: params, response, error, durationMs: Date.now() - at.getTime(), at });
    throw error;
  }
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

export async function analyzeCampaigns(model: string, context: AiCampaignContext, trace: AiTrace): Promise<AiAnalysis> {
  return callModel("analyze_campaigns", trace, {
    model,
    store: false,
    reasoning: REASONING,
    max_output_tokens: 6000,
    instructions: ANALYST_INSTRUCTIONS,
    input: compactContext(context),
  }, (response) => analysisSchema.parse(readJsonOutput(response)));
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
export async function reviewCampaignWithAi(model: string, context: AiSingleCampaignContext, trace: AiTrace): Promise<AiCampaignReview> {
  const { organization, campaign, account } = context;
  return callModel("campaign_review", trace, {
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
  }, (response) => campaignReviewSchema.parse(readJsonOutput(response)));
}

export async function askPulso(model: string, context: AiCampaignContext, question: string, trace: AiTrace): Promise<string> {
  return callModel("ask", trace, {
    model,
    store: false,
    reasoning: REASONING,
    text: { verbosity: "low" },
    max_output_tokens: 4000,
    instructions: ADVISOR_INSTRUCTIONS,
    input: `Contexto de la cuenta: ${compactContext(context)}\n\nPregunta del usuario: ${question}`,
  }, readOutputText);
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

const PLANNER_INSTRUCTIONS = [
  "Eres estratega senior de Meta Ads para negocios mexicanos. Con la descripción del negocio recomienda cómo configurar UNA campaña en Facebook e Instagram y explica cada decisión en lenguaje sencillo para un dueño de negocio sin experiencia en publicidad.",
  "objective: Ventas solo si tiene_sitio_web y tiene_pixel son true; Prospectos si conviene captar datos con un formulario instantáneo; Mensajes para negocios locales o de venta por chat. messagingApp solo con Mensajes: WHATSAPP si la venta se cierra por WhatsApp, MESSENGER en otro caso; null con otros objetivos.",
  "audience: ageMin y ageMax entre 18 y 65; genders es all salvo que el producto sea claramente para un género; locations son de 1 a 5 nombres reales de ciudades, estados o país como los reconoce Meta (por ejemplo 'Oaxaca de Juárez', 'Jalisco' o 'México'), según la zona indicada; interests son de 2 a 6 intereses amplios en español que existan en Meta (por ejemplo 'Fútbol' o 'Decoración de interiores'); advantage es true salvo que el público deba limitarse estrictamente.",
  "dailyBudget en MXN entre 100 y presupuesto_diario_maximo_mxn: suficiente para que Meta aprenda sin comprometer el límite mensual.",
  "customerProfile describe en una frase al cliente ideal. tips son 2 a 4 consejos concretos para la foto o video, la oferta y la atención. No inventes precios, promociones ni datos del negocio.",
  "Devuelve JSON estricto sin Markdown: {objective,objectiveReason,messagingApp,customerProfile,audience:{ageMin,ageMax,genders,locations,interests,advantage,reason},dailyBudget,budgetReason,tips}.",
].join(" ");

const planSchema = z.object({
  objective: z.enum(["Ventas", "Prospectos", "Mensajes"]),
  objectiveReason: z.string().trim().min(8).max(500),
  messagingApp: z.enum(["WHATSAPP", "MESSENGER"]).nullish(),
  customerProfile: z.string().trim().min(8).max(300),
  audience: z.object({
    ageMin: z.number().min(13).max(65),
    ageMax: z.number().min(13).max(65),
    genders: z.enum(["all", "male", "female"]),
    locations: z.array(z.string().trim().min(2).max(80)).max(8),
    interests: z.array(z.string().trim().min(2).max(80)).max(10),
    advantage: z.boolean(),
    reason: z.string().trim().min(8).max(500),
  }),
  dailyBudget: z.number().min(1),
  budgetReason: z.string().trim().min(8).max(400),
  tips: z.array(z.string().trim().min(4).max(280)).max(6).default([]),
});

export type AiCampaignPlan = z.infer<typeof planSchema>;

export interface CampaignPlanBrief {
  business: string;
  pageName?: string;
  offer: string;
  customer: string;
  area: string;
  details: string;
  website?: string;
  hasPixel: boolean;
  monthlyLimit: number;
}

/** Objective, audience, budget and tips for a new campaign, with the reasons a business owner can follow. */
export async function planCampaign(model: string, brief: CampaignPlanBrief, trace: AiTrace): Promise<AiCampaignPlan> {
  return callModel("campaign_plan", trace, {
    model,
    store: false,
    reasoning: REASONING,
    max_output_tokens: 5000,
    instructions: PLANNER_INSTRUCTIONS,
    input: JSON.stringify({
      negocio: brief.business,
      pagina: brief.pageName ?? "",
      oferta: brief.offer,
      cliente_ideal: brief.customer,
      zona: brief.area,
      detalles: brief.details,
      tiene_sitio_web: Boolean(brief.website),
      tiene_pixel: brief.hasPixel,
      limite_mensual_mxn: brief.monthlyLimit,
      presupuesto_diario_maximo_mxn: Math.max(100, Math.floor(brief.monthlyLimit / 30)),
    }),
  }, (response) => planSchema.parse(readJsonOutput(response)));
}

const AD_COPY_INSTRUCTIONS = [
  "Eres copywriter senior de anuncios de Facebook e Instagram para negocios mexicanos.",
  "Escribe tres opciones de texto para un anuncio nuevo con ángulos distintos (beneficio principal, problema y solución, oportunidad del momento), pensadas para el cliente ideal y el objetivo de la campaña.",
  "Si recibes la imagen o un cuadro del video, haz que el texto conecte con lo que se ve, sin describirla literalmente.",
  "No inventes precios, descuentos, fechas, garantías, testimonios ni cifras que no estén en los datos. El llamado a la acción corresponde al objetivo: comprar en el sitio (Ventas), dejar sus datos (Prospectos) o enviar un mensaje (Mensajes).",
  "Español de México, claro y directo, con máximo dos emojis. headline de 3 a 60 caracteres; primaryText de 10 a 500 caracteres; angle es el nombre corto del ángulo.",
  "Devuelve JSON estricto sin Markdown: {variants:[{headline,primaryText,angle}]}.",
].join(" ");

export interface AdCopyBrief {
  business: string;
  offer: string;
  objective: string;
  customer: string;
  details: string;
  audience: string;
  mediaKind: "image" | "video" | "none";
  /** JPEG data URL of the image, or of a frame of the video. */
  image?: string;
}

/** Three copy options for a new ad, reading its image when there is one. */
export async function writeAdCopy(model: string, brief: AdCopyBrief, trace: AiTrace): Promise<AdVariantCopy[]> {
  const text = JSON.stringify({
    negocio: brief.business,
    oferta: brief.offer,
    objetivo: brief.objective,
    cliente_ideal: brief.customer,
    detalles: brief.details,
    publico: brief.audience,
    formato: brief.mediaKind === "video" ? "video (se adjunta un cuadro)" : brief.mediaKind === "image" ? "imagen" : "sin imagen todavía",
  });
  return callModel("ad_copy", trace, {
    model,
    store: false,
    reasoning: REASONING,
    max_output_tokens: 5000,
    instructions: AD_COPY_INSTRUCTIONS,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text },
        ...(brief.image ? [{ type: "input_image" as const, image_url: brief.image, detail: "low" as const }] : []),
      ],
    }],
  }, (response) => variantsSchema.parse(readJsonOutput(response)).variants);
}

const LEAD_FORM_INSTRUCTIONS = [
  "Eres especialista en formularios instantáneos de Meta para negocios mexicanos.",
  "Con la oferta y el cliente ideal escribe el contenido de un formulario que consiga prospectos de calidad: name es un nombre interno corto; headline es el título de bienvenida con el beneficio (máximo 60 caracteres); description dice en 1 o 2 frases qué pasa después de enviar (máximo 300); customQuestions son 0 a 2 preguntas que ayuden a calificar al prospecto, con options (2 a 5 opciones cortas) cuando convenga opción múltiple; thankYouTitle (máximo 60) y thankYouBody (máximo 300) confirman el siguiente paso.",
  "higherIntent es true si el negocio necesita prospectos muy calificados (servicios caros o con cita) y false si importa más el volumen. reason explica en una frase por qué.",
  "No inventes precios, promociones ni plazos que no estén en los datos. No pidas datos sensibles. Español de México.",
  "Devuelve JSON estricto sin Markdown: {name,headline,description,customQuestions:[{label,options}],higherIntent,thankYouTitle,thankYouBody,reason}.",
].join(" ");

const leadFormSchema = z.object({
  name: z.string().trim().min(3).max(100),
  headline: z.string().trim().min(3).max(60),
  description: z.string().trim().max(300),
  customQuestions: z.array(z.object({
    label: z.string().trim().min(3).max(120),
    options: z.array(z.string().trim().min(1).max(60)).max(5).nullish(),
  })).max(2).default([]),
  higherIntent: z.boolean(),
  thankYouTitle: z.string().trim().min(3).max(60),
  thankYouBody: z.string().trim().min(3).max(300),
  reason: z.string().trim().min(8).max(400),
});

export type AiLeadForm = z.infer<typeof leadFormSchema>;

/** Intro, qualifying questions and thank you message for a new instant form. */
export async function writeLeadForm(model: string, brief: { business: string; offer: string; customer: string; details: string }, trace: AiTrace): Promise<AiLeadForm> {
  return callModel("lead_form", trace, {
    model,
    store: false,
    reasoning: REASONING,
    max_output_tokens: 4000,
    instructions: LEAD_FORM_INSTRUCTIONS,
    input: JSON.stringify({ negocio: brief.business, oferta: brief.offer, cliente_ideal: brief.customer, detalles: brief.details }),
  }, (response) => leadFormSchema.parse(readJsonOutput(response)));
}

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
export async function writeAdVariants(model: string, brief: AdVariantBrief, trace: AiTrace): Promise<AdVariantCopy[]> {
  return callModel("ad_variants", trace, {
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
  }, (response) => variantsSchema.parse(readJsonOutput(response)).variants);
}
