import OpenAI from "openai";
import { z } from "zod";
import type { AiAnalysis, AiCampaignContext, AiProvider, AiProviderId, AiProviderStatus } from "./contracts";

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

function providerConfig(): { id: AiProviderId; apiKey?: string; model: string; baseURL?: string } {
  const provider = (process.env.AI_PROVIDER || "local").toLowerCase();
  if (provider === "openai") return {
    id: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-6-astra",
  };
  if (provider === "openai-compatible") return {
    id: "openai-compatible",
    apiKey: process.env.AI_API_KEY,
    model: process.env.AI_MODEL || "",
    baseURL: process.env.AI_BASE_URL,
  };
  if (provider === "gemini") return { id: "gemini", model: process.env.GEMINI_MODEL || "" };
  if (provider === "custom") return { id: "custom", model: process.env.AI_MODEL || "" };
  return { id: "local", model: "Reglas y límites" };
}

function labels(id: AiProviderId): string {
  return { local: "Motor local", openai: "OpenAI", "openai-compatible": "Compatible con OpenAI", gemini: "Google Gemini", custom: "Proveedor personalizado" }[id];
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

class LocalProvider implements AiProvider {
  status(): AiProviderStatus { return { id: "local", label: labels("local"), model: "Reglas y límites", configured: false, reason: "Análisis determinista activo; configura un proveedor para habilitar IA generativa." }; }
  async analyze(): Promise<AiAnalysis> { throw new Error("Configura un proveedor de IA para obtener análisis generativo"); }
  async ask(): Promise<string> { throw new Error("Configura un proveedor de IA para conversar con Pulso"); }
}

class UnavailableProvider implements AiProvider {
  constructor(private readonly id: AiProviderId, private readonly reason: string) {}
  status(): AiProviderStatus { return { id: this.id, label: labels(this.id), model: null, configured: false, reason: this.reason }; }
  async analyze(): Promise<AiAnalysis> { throw new Error(this.reason); }
  async ask(): Promise<string> { throw new Error(this.reason); }
}

class OpenAiCompatibleProvider implements AiProvider {
  private readonly client: OpenAI;
  constructor(private readonly config: { id: "openai" | "openai-compatible"; apiKey: string; model: string; baseURL?: string }) {
    this.client = new OpenAI({ apiKey: config.apiKey, ...(config.baseURL ? { baseURL: config.baseURL } : {}) });
  }
  status(): AiProviderStatus { return { id: this.config.id, label: labels(this.config.id), model: this.config.model, configured: true }; }
  async analyze(context: AiCampaignContext): Promise<AiAnalysis> {
    const response = await this.client.responses.create({
      model: this.config.model,
      store: false,
      max_output_tokens: 1600,
      instructions: [
        "Eres el analista senior de Pulso, un SaaS de Meta Ads para dueños de negocio mexicanos. Analiza exclusivamente los datos proporcionados. No inventes métricas, políticas de Meta ni resultados.",
        "Entrega máximo tres recomendaciones prácticas en español de México y, solo si los datos lo justifican, hasta tres acciones concretas.",
        "Las acciones usan exactamente los id de campanas y anuncios_7d. Tipos: increase_budget y decrease_budget con changePct entre -20 y 20; pause_campaign; pause_ad con adId. No repitas objetivos que ya estén en cambios_ya_planeados.",
        "Un motor de guardrails validará cada acción: nunca exceder el límite mensual, variación máxima de 20% en 24 h y no pausar el último anuncio activo de un conjunto.",
        "Devuelve JSON estricto sin Markdown: {headline,summary,recommendations:[{agent,title,detail,impact,urgency}],actions:[{type,campaignId,adId?,changePct?,reason,impact}]}. agent es Supervisor, Presupuesto, Audiencias, Creativos, Analista o Estratega. urgency es info, warning o action.",
      ].join(" "),
      input: compactContext(context),
    });
    const raw = response.output_text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return analysisSchema.parse(JSON.parse(raw));
  }
  async ask(context: AiCampaignContext, question: string): Promise<string> {
    const response = await this.client.responses.create({
      model: this.config.model,
      store: false,
      max_output_tokens: 800,
      instructions: "Eres Pulso, un asistente de Meta Ads para dueños de negocio mexicanos. Responde en español claro, breve y accionable. Usa únicamente los datos de contexto entregados. No prometas rendimientos ni indiques acciones que rompan el límite mensual o aumenten un presupuesto más de 20% en un día.",
      input: `Contexto de la cuenta: ${compactContext(context)}\n\nPregunta del usuario: ${question}`,
    });
    return response.output_text.trim();
  }
}

export function getAiProvider(): AiProvider {
  const config = providerConfig();
  if (config.id === "local") return new LocalProvider();
  if (config.id === "gemini") return new UnavailableProvider("gemini", "El adaptador Gemini está reservado. La interfaz y los contratos ya son compatibles; solo falta configurar su cliente.");
  if (config.id === "custom") return new UnavailableProvider("custom", "Configura un adaptador personalizado que implemente el contrato de Pulso.");
  if (!config.apiKey) return new UnavailableProvider(config.id, `Falta la API key de ${labels(config.id)} en el servidor.`);
  if (config.id === "openai-compatible" && (!config.baseURL || !config.model)) return new UnavailableProvider(config.id, "AI_BASE_URL y AI_MODEL son obligatorios para un proveedor compatible.");
  return new OpenAiCompatibleProvider({ id: config.id, apiKey: config.apiKey, model: config.model, baseURL: config.baseURL });
}

export function buildAiContext(
  organization: AiCampaignContext["organization"],
  campaigns: AiCampaignContext["campaigns"],
  ads: AiCampaignContext["ads"] = [],
  plannedActions: AiCampaignContext["plannedActions"] = [],
): AiCampaignContext {
  return { organization, campaigns, ads, plannedActions };
}
