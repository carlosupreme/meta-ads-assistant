// Pure optimization core: planning rules, hard guardrails and state transitions.
// It only has type imports so it runs on the server, in the browser and under `node --test`.
import type {
  Ad, AdVariant, AgentAction, AgentActionType, AgentActivity, AgentName, AlertItem, AutomationMode, BudgetChange, Campaign, CampaignReview, CampaignVerdict,
  MonitoringDay, Organization, WorkspaceData,
} from "./types";
import type { AiActionProposal } from "./ai/contracts";

export const GUARDRAILS = {
  maxBudgetChange: 0.2,
  changeWindowHours: 24,
  minDailyBudget: 50,
  maxActionsPerRun: 3,
  pendingTtlHours: 48,
  fatigueFrequency: 4,
  audienceSaturationFrequency: 3,
  fatigueCtrRatio: 0.7,
  fatigueMinImpressions: 1000,
  scaleStep: 0.15,
  fatigueRestDays: 7,
  creativeRefreshDays: 7,
} as const;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MONITORING_DAYS_KEPT = 35;
const DEFAULT_TARGET_ROAS = 3;

export interface OptimizationState {
  campaigns: Campaign[];
  ads: Ad[];
  budgetChanges: BudgetChange[];
}

export const formatMoney = (value: number) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", maximumFractionDigits: 0,
}).format(value);

const newId = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID()}`;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function targetRoas(organization: Pick<Organization, "targetRoas">): number {
  return organization.targetRoas && organization.targetRoas > 0 ? organization.targetRoas : DEFAULT_TARGET_ROAS;
}

/** Days left in the month, counting today. */
export function daysLeftInMonth(now: Date): number {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return daysInMonth - now.getDate() + 1;
}

/** Conservative month-end projection: spend so far plus every active daily budget until month end. */
export function projectedMonthSpend(organization: Organization, campaigns: Campaign[], now: Date): number {
  const activeDaily = campaigns
    .filter((campaign) => campaign.organizationId === organization.id && campaign.status === "ACTIVE")
    .reduce((sum, campaign) => sum + campaign.dailyBudget, 0);
  return organization.spentThisMonth + activeDaily * daysLeftInMonth(now);
}

/**
 * Budget before the agents' changes in the rolling window; their 20% cap is measured against it.
 * A budget set by the user resets the baseline, so earlier agent changes no longer count.
 */
export function budgetBaseline(campaign: Campaign, changes: BudgetChange[], now: Date): number {
  const windowStart = now.getTime() - GUARDRAILS.changeWindowHours * HOUR_MS;
  const own = changes.filter((change) => change.campaignId === campaign.id);
  const lastUserChange = Math.max(-Infinity, ...own.filter((change) => change.source === "user").map((change) => Date.parse(change.at)));
  const recent = own
    .filter((change) => change.source !== "user" && Date.parse(change.at) >= windowStart && Date.parse(change.at) > lastUserChange)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return recent[0]?.from ?? campaign.dailyBudget;
}

export const scaledAdSetBudget = (budget: number, factor: number) =>
  Math.max(GUARDRAILS.minDailyBudget, Math.round(budget * factor));

export type GuardrailResult = { allowed: true } | { allowed: false; reason: string };

export interface GuardrailContext extends OptimizationState {
  organization: Organization;
  now: Date;
}

const allow: GuardrailResult = { allowed: true };
const block = (reason: string): GuardrailResult => ({ allowed: false, reason });

/** Final authority over every change, whether proposed by rules, AI or approved by a person. */
export function checkGuardrails(action: AgentAction, context: GuardrailContext): GuardrailResult {
  const { organization, campaigns, ads, budgetChanges, now } = context;
  const campaign = campaigns.find((item) => item.id === action.campaignId && item.organizationId === organization.id);
  if (!campaign) return block("La campaña ya no existe en la cuenta sincronizada.");

  if (action.type === "create_ad") {
    const variant = action.variant;
    if (!variant) return block("Falta el contenido del anuncio nuevo.");
    const source = ads.find((item) => item.id === variant.sourceAdId && item.campaignId === campaign.id);
    if (!source || source.adSetId !== variant.adSetId) return block("El anuncio base ya no existe en esta campaña.");
    if (!source.creative?.reusable) return block("El anuncio base no usa imagen con enlace; crea el nuevo desde el creador de campañas.");
    const headline = variant.headline.trim().length;
    const text = variant.primaryText.trim().length;
    if (headline < 3 || headline > 60 || text < 10 || text > 500) return block("El título debe tener de 3 a 60 caracteres y el texto de 10 a 500.");
    if (action.source !== "user" && campaign.status !== "ACTIVE") return block("La campaña está pausada; no hace falta renovar sus anuncios ahora.");
    return allow;
  }

  if (action.type === "resume_campaign") {
    if (campaign.status !== "PAUSED") return block("La campaña no está pausada.");
    if (organization.spentThisMonth >= organization.monthlyLimit) return block("El gasto del mes ya alcanzó el límite; la campaña sigue pausada.");
    const projected = projectedMonthSpend(organization, campaigns, now) + campaign.dailyBudget * daysLeftInMonth(now);
    if (projected > organization.monthlyLimit) {
      return block(`Reactivarla llevaría el gasto proyectado a ${formatMoney(projected)}, por encima del límite de ${formatMoney(organization.monthlyLimit)}.`);
    }
    return allow;
  }

  if (action.type === "resume_ad") {
    const ad = ads.find((item) => item.id === action.adId && item.campaignId === campaign.id);
    if (!ad || ad.status !== "PAUSED") return block("El anuncio no está pausado.");
    if (action.source !== "user" && campaign.status !== "ACTIVE") return block("La campaña del anuncio está pausada; reactívala primero.");
    return allow;
  }

  if (action.type === "pause_campaign") {
    return campaign.status === "ACTIVE" ? allow : block("La campaña ya no está activa.");
  }

  if (action.type === "pause_ad") {
    const ad = ads.find((item) => item.id === action.adId && item.campaignId === campaign.id);
    if (!ad || ad.status !== "ACTIVE") return block("El anuncio ya no está activo.");
    const siblings = ads.filter((item) => item.adSetId === ad.adSetId && item.id !== ad.id && item.status === "ACTIVE");
    // Agents never stop an ad set's delivery; the user may decide to.
    if (action.source !== "user" && !siblings.length) return block("Es el último anuncio activo de su conjunto; pausarlo detendría la entrega.");
    return allow;
  }

  if (campaign.status !== "ACTIVE") return block("La campaña ya no está activa.");
  if ((campaign.budgetLevel ?? "campaign") === "none" || campaign.dailyBudget <= 0) {
    return block("La campaña no tiene un presupuesto diario administrable (usa presupuesto total).");
  }
  const toBudget = action.toBudget;
  if (toBudget === undefined || !Number.isFinite(toBudget)) return block("El cambio no indica un presupuesto válido.");
  if (toBudget < GUARDRAILS.minDailyBudget) return block(`El presupuesto mínimo permitido es ${formatMoney(GUARDRAILS.minDailyBudget)} al día.`);
  if (action.type === "increase_budget" && toBudget <= campaign.dailyBudget) return block("El aumento no supera el presupuesto actual.");
  if (action.type === "decrease_budget" && toBudget >= campaign.dailyBudget) return block("La reducción no baja el presupuesto actual.");

  // The 20% cap limits the agents; a budget set by the user only has to respect the monthly limit.
  const baseline = budgetBaseline(campaign, budgetChanges, now);
  const variation = Math.abs(toBudget - baseline) / baseline;
  if (action.source !== "user" && variation > GUARDRAILS.maxBudgetChange + 1e-9) {
    return block(`El cambio acumulado sería de ${Math.round(variation * 100)}% en 24 h; el máximo es ${GUARDRAILS.maxBudgetChange * 100}%.`);
  }

  if (action.type === "increase_budget") {
    const projected = projectedMonthSpend(organization, campaigns, now) + (toBudget - campaign.dailyBudget) * daysLeftInMonth(now);
    if (projected > organization.monthlyLimit) {
      return block(`El gasto proyectado del mes sería ${formatMoney(projected)}, por encima del límite de ${formatMoney(organization.monthlyLimit)}.`);
    }
  }
  return allow;
}

/** Applies the local effect of an executed action. */
export function applyAction<T extends OptimizationState>(state: T, action: AgentAction, now: Date): T {
  if (action.type === "create_ad") {
    const variant = action.variant;
    const source = state.ads.find((ad) => ad.id === variant?.sourceAdId);
    if (!variant || !source) return state;
    const created: Ad = {
      id: action.createdAdId ?? `ad-${action.id}`,
      organizationId: source.organizationId,
      campaignId: source.campaignId,
      adSetId: variant.adSetId,
      name: `Pulso · ${variant.headline}`,
      status: "ACTIVE",
      spend: 0, impressions: 0, clicks: 0, ctr: 0, frequency: 0, results: 0, revenue: 0,
      creative: {
        id: `pending-${action.id}`,
        headline: variant.headline,
        primaryText: variant.primaryText,
        reusable: Boolean(source.creative?.reusable),
        spec: source.creative?.spec ? buildVariantSpec(source.creative.spec, variant) : undefined,
      },
    };
    return { ...state, ads: [created, ...state.ads.filter((ad) => ad.id !== created.id)] };
  }
  if (action.type === "pause_ad" || action.type === "resume_ad") {
    const status = action.type === "pause_ad" ? "PAUSED" as const : "ACTIVE" as const;
    return { ...state, ads: state.ads.map((ad) => ad.id === action.adId ? { ...ad, status } : ad) };
  }
  if (action.type === "pause_campaign" || action.type === "resume_campaign") {
    const status = action.type === "pause_campaign" ? "PAUSED" as const : "ACTIVE" as const;
    return {
      ...state,
      campaigns: state.campaigns.map((campaign) => campaign.id === action.campaignId
        ? { ...campaign, status, updatedAt: "Ahora" }
        : campaign),
    };
  }
  const campaign = state.campaigns.find((item) => item.id === action.campaignId);
  const toBudget = action.toBudget;
  if (!campaign || toBudget === undefined) return state;
  const factor = campaign.dailyBudget ? toBudget / campaign.dailyBudget : 1;
  return {
    ...state,
    campaigns: state.campaigns.map((item) => item.id === campaign.id ? {
      ...item,
      dailyBudget: toBudget,
      adSets: item.adSets?.map((adSet) => adSet.status === "ACTIVE" && adSet.dailyBudget > 0
        ? { ...adSet, dailyBudget: scaledAdSetBudget(adSet.dailyBudget, factor) }
        : adSet),
      updatedAt: "Ahora",
    } : item),
    budgetChanges: [
      {
        campaignId: campaign.id,
        organizationId: campaign.organizationId,
        from: campaign.dailyBudget,
        to: toBudget,
        at: now.toISOString(),
        source: action.source === "user" ? "user" as const : "agent" as const,
      },
      ...state.budgetChanges,
    ].slice(0, 500),
  };
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const isMature = (campaign: Campaign) => campaign.dailyBudget > 0 ? campaign.spend >= campaign.dailyBudget * 2 : campaign.spend > 0;
const hasManagedBudget = (campaign: Campaign) => (campaign.budgetLevel ?? "campaign") !== "none" && campaign.dailyBudget > 0;
const actionKey = (action: Pick<AgentAction, "type" | "campaignId" | "adId" | "variant">) => {
  if (action.type === "create_ad") return `adset:${action.variant?.adSetId}`;
  return action.type === "pause_ad" || action.type === "resume_ad" ? `ad:${action.adId}` : `campaign:${action.campaignId}`;
};

/** Copy of a reusable object_story_spec with new text and, when given, a new image. */
export function buildVariantSpec(spec: string, variant: Pick<AdVariant, "headline" | "primaryText" | "imageHash">): string {
  const parsed = JSON.parse(spec) as Record<string, unknown> & { link_data?: Record<string, unknown> };
  if (!parsed.link_data) throw new Error("El anuncio base no usa imagen con enlace.");
  const linkData: Record<string, unknown> = { ...parsed.link_data, message: variant.primaryText, name: variant.headline };
  if (variant.imageHash) {
    // Meta derives these from the old image; keeping them would conflict with the new hash.
    delete linkData.picture;
    delete linkData.image_url;
    linkData.image_hash = variant.imageHash;
  }
  return JSON.stringify({ ...parsed, link_data: linkData });
}

const STATUS_ACTIONS = new Set<AgentActionType>(["pause_campaign", "resume_campaign", "pause_ad", "resume_ad"]);

/** Latest executed status change per campaign or ad (`campaign:<id>` / `ad:<id>`), by agents or the user. */
export function lastStatusChanges(actions: AgentAction[]): Map<string, AgentAction> {
  const latest = new Map<string, AgentAction>();
  const at = (action: AgentAction) => Date.parse(action.resolvedAt ?? action.createdAt);
  for (const action of actions) {
    if (action.status !== "executed" || !STATUS_ACTIONS.has(action.type)) continue;
    const key = actionKey(action);
    const current = latest.get(key);
    if (!current || at(action) > at(current)) latest.set(key, action);
  }
  return latest;
}

type ProposalFields = Omit<AgentAction, "id" | "organizationId" | "status" | "createdAt" | "source">;

/** Deterministic rules. Protective actions (limit and pacing) are never capped; the rest are. */
export function planRuleActions(
  workspace: Pick<WorkspaceData, "campaigns" | "ads" | "actions">,
  organization: Organization,
  now: Date,
): AgentAction[] {
  const orgCampaigns = workspace.campaigns.filter((campaign) => campaign.organizationId === organization.id);
  // Accounts whose campaigns are all paused are still planned: they may be due for a resume.
  if (!orgCampaigns.length) return [];
  const campaigns = orgCampaigns.filter((campaign) => campaign.status === "ACTIVE");
  const make = (fields: ProposalFields): AgentAction => ({
    id: newId("action"), organizationId: organization.id, status: "recommended", createdAt: now.toISOString(), source: "rules", ...fields,
  });
  const busy = new Set(workspace.actions
    .filter((action) => action.organizationId === organization.id && (action.status === "pending" || action.status === "executing"))
    .map(actionKey));

  if (organization.spentThisMonth >= organization.monthlyLimit) {
    return campaigns.filter((campaign) => !busy.has(`campaign:${campaign.id}`)).map((campaign) => make({
      agent: "Supervisor", type: "pause_campaign", trigger: "limit", campaignId: campaign.id, campaignName: campaign.name,
      reason: `El gasto del mes (${formatMoney(organization.spentThisMonth)}) alcanzó el límite de ${formatMoney(organization.monthlyLimit)}.`,
      impact: "Protección de presupuesto",
    }));
  }

  const target = targetRoas(organization);
  const useValue = campaigns.some((campaign) => campaign.revenue > 0);
  const totalResults = campaigns.reduce((sum, campaign) => sum + campaign.results, 0);
  const averageCpa = totalResults ? campaigns.reduce((sum, campaign) => sum + campaign.spend, 0) / totalResults : 0;
  const score = (campaign: Campaign) => useValue ? campaign.roas : campaign.results > 0 ? -campaign.costPerResult : -Infinity;
  const worstFirst = [...campaigns].sort((a, b) => score(a) - score(b));
  const touched = new Set<string>();
  const available = (campaign: Campaign) => !busy.has(`campaign:${campaign.id}`) && !touched.has(campaign.id);
  const protective: AgentAction[] = [];
  const optional: AgentAction[] = [];

  // Pacing: trim the weakest campaigns until the month-end projection fits the limit.
  const daysLeft = daysLeftInMonth(now);
  const projected = projectedMonthSpend(organization, workspace.campaigns, now);
  const initialExcessPerDay = (projected - organization.monthlyLimit) / daysLeft;
  let excessPerDay = initialExcessPerDay;
  for (const campaign of worstFirst) {
    if (excessPerDay <= 0) break;
    if (!available(campaign) || !hasManagedBudget(campaign)) continue;
    const floor = Math.max(GUARDRAILS.minDailyBudget, Math.ceil(campaign.dailyBudget * (1 - GUARDRAILS.maxBudgetChange)));
    const toBudget = Math.max(floor, Math.round(campaign.dailyBudget - excessPerDay));
    if (toBudget >= campaign.dailyBudget) continue;
    protective.push(make({
      agent: "Supervisor", type: "decrease_budget", campaignId: campaign.id, campaignName: campaign.name,
      fromBudget: campaign.dailyBudget, toBudget,
      reason: `Al ritmo actual el gasto del mes llegaría a ${formatMoney(projected)}, por encima del límite de ${formatMoney(organization.monthlyLimit)}. Reduzco primero la campaña con menor rendimiento.`,
      impact: `Ahorro de ${formatMoney((campaign.dailyBudget - toBudget) * daysLeft)} en lo que resta del mes`,
    }));
    touched.add(campaign.id);
    excessPerDay -= campaign.dailyBudget - toBudget;
  }

  // Restore what the agents paused once the reason is gone. Pauses made by the user are never undone.
  const restorative: AgentAction[] = [];
  const latestStatus = lastStatusChanges(workspace.actions);
  const pausedByAgents = (key: string, trigger: NonNullable<AgentAction["trigger"]>) => {
    const last = latestStatus.get(key);
    return last && last.source !== "user" && last.trigger === trigger && (last.type === "pause_campaign" || last.type === "pause_ad") ? last : undefined;
  };
  const pausedAt = (action: AgentAction) => Date.parse(action.resolvedAt ?? action.createdAt);
  if (initialExcessPerDay <= 0) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    for (const campaign of orgCampaigns.filter((item) => item.status === "PAUSED")) {
      const pause = pausedByAgents(`campaign:${campaign.id}`, "limit");
      if (!pause || busy.has(`campaign:${campaign.id}`) || pausedAt(pause) >= monthStart) continue;
      restorative.push(make({
        agent: "Supervisor", type: "resume_campaign", trigger: "limit", campaignId: campaign.id, campaignName: campaign.name,
        reason: "Pulso la pausó el mes pasado al alcanzar el límite mensual; empezó un mes nuevo y hay presupuesto disponible.",
        impact: `Reanuda ${formatMoney(campaign.dailyBudget)}/día dentro del límite de ${formatMoney(organization.monthlyLimit)}`,
      }));
    }
    for (const ad of workspace.ads.filter((item) => item.organizationId === organization.id && item.status === "PAUSED")) {
      const pause = pausedByAgents(`ad:${ad.id}`, "fatigue");
      const campaign = campaigns.find((item) => item.id === ad.campaignId);
      if (!pause || !campaign || busy.has(`ad:${ad.id}`)) continue;
      const restedDays = (now.getTime() - pausedAt(pause)) / 86_400_000;
      if (restedDays < GUARDRAILS.fatigueRestDays) continue;
      optional.push(make({
        agent: "Creativos", type: "resume_ad", trigger: "fatigue", campaignId: campaign.id, campaignName: campaign.name, adId: ad.id, adName: ad.name,
        reason: `Lleva ${Math.floor(restedDays)} días en pausa por fatiga; la audiencia ya descansó de este anuncio.`,
        impact: "Vuelve a rotar junto con los anuncios activos",
      }));
    }
  }

  // Waste: more than three days of budget without a single result.
  for (const campaign of campaigns) {
    if (!available(campaign) || campaign.results > 0 || campaign.dailyBudget <= 0 || campaign.spend < campaign.dailyBudget * 3) continue;
    optional.push(make({
      agent: "Analista", type: "pause_campaign", trigger: "no_results", campaignId: campaign.id, campaignName: campaign.name,
      reason: `Gastó ${formatMoney(campaign.spend)} (más de tres días de presupuesto) sin registrar resultados.`,
      impact: `Evita ${formatMoney(campaign.dailyBudget)} diarios sin retorno`,
    }));
    touched.add(campaign.id);
  }
  const pausedCampaigns = new Set(optional.filter((action) => action.type === "pause_campaign").map((action) => action.campaignId));

  // Underperformers with enough data lose up to 20% of budget.
  for (const campaign of worstFirst) {
    if (!available(campaign) || !hasManagedBudget(campaign) || !isMature(campaign)) continue;
    const underperforms = useValue
      ? campaign.roas < target * 0.8
      : averageCpa > 0 && campaign.results > 0 && campaign.costPerResult > averageCpa * 1.5;
    if (!underperforms) continue;
    const toBudget = Math.max(GUARDRAILS.minDailyBudget, Math.ceil(campaign.dailyBudget * (1 - GUARDRAILS.maxBudgetChange)));
    if (toBudget >= campaign.dailyBudget) continue;
    optional.push(make({
      agent: "Presupuesto", type: "decrease_budget", campaignId: campaign.id, campaignName: campaign.name,
      fromBudget: campaign.dailyBudget, toBudget,
      reason: useValue
        ? `Su ROAS de ${campaign.roas.toFixed(2)}× está por debajo de la meta de ${target.toFixed(2)}×.`
        : `Su costo por resultado de ${formatMoney(campaign.costPerResult)} supera 50% el promedio de la cuenta (${formatMoney(averageCpa)}).`,
      impact: `Libera ${formatMoney(campaign.dailyBudget - toBudget)}/día para campañas más rentables`,
    }));
    touched.add(campaign.id);
  }

  // Ads: creative fatigue and ads that spend without converting while their siblings do.
  for (const campaign of campaigns) {
    if (pausedCampaigns.has(campaign.id)) continue;
    const ads = workspace.ads.filter((ad) => ad.campaignId === campaign.id && ad.status === "ACTIVE");
    if (ads.length < 2) continue;
    const medianCtr = median(ads.map((ad) => ad.ctr));
    const campaignCpa = campaign.results ? campaign.spend / campaign.results : 0;
    for (const ad of ads) {
      if (busy.has(`ad:${ad.id}`)) continue;
      const base = { type: "pause_ad" as const, campaignId: campaign.id, campaignName: campaign.name, adId: ad.id, adName: ad.name };
      if (ad.frequency >= GUARDRAILS.fatigueFrequency && ad.impressions >= GUARDRAILS.fatigueMinImpressions && ad.ctr < medianCtr * GUARDRAILS.fatigueCtrRatio) {
        optional.push(make({
          ...base, agent: "Creativos", trigger: "fatigue",
          reason: `Frecuencia de ${ad.frequency.toFixed(1)} y CTR de ${ad.ctr.toFixed(2)}% frente a ${medianCtr.toFixed(2)}% de los demás anuncios: señales de fatiga.`,
          impact: "El presupuesto se concentra en los anuncios vigentes",
        }));
      } else if (ad.results === 0 && ads.some((other) => other.id !== ad.id && other.results > 0) && ad.spend >= Math.max(campaignCpa * 2, campaign.dailyBudget)) {
        optional.push(make({
          ...base, agent: "Analista", trigger: "no_results",
          reason: `Gastó ${formatMoney(ad.spend)} sin resultados mientras otros anuncios de la campaña sí convierten.`,
          impact: `Recupera hasta ${formatMoney(ad.spend)} por semana`,
        }));
      }
    }
  }

  // Scale the strongest campaign only when the month has room for it.
  const budgetUse = organization.monthlyLimit ? organization.spentThisMonth / organization.monthlyLimit : 1;
  if (initialExcessPerDay <= 0 && budgetUse < 0.9) {
    const best = [...worstFirst].reverse().find((campaign) => available(campaign) && hasManagedBudget(campaign) && isMature(campaign) && campaign.trend >= 0 && (useValue
      ? campaign.roas >= target * 1.2
      : averageCpa > 0 && campaign.results > 0 && campaign.costPerResult <= averageCpa * 0.75));
    if (best) {
      const increase = Math.min(best.dailyBudget * GUARDRAILS.scaleStep, -initialExcessPerDay);
      const toBudget = Math.floor(best.dailyBudget + increase);
      if (toBudget - best.dailyBudget >= best.dailyBudget * 0.05) {
        optional.push(make({
          agent: "Presupuesto", type: "increase_budget", campaignId: best.id, campaignName: best.name,
          fromBudget: best.dailyBudget, toBudget,
          reason: useValue
            ? `Mantiene un ROAS de ${best.roas.toFixed(2)}×, por encima de la meta de ${target.toFixed(2)}×, con datos suficientes y margen en el límite mensual.`
            : `Su costo por resultado de ${formatMoney(best.costPerResult)} es de los más eficientes de la cuenta y hay margen en el límite mensual.`,
          impact: `+${formatMoney(toBudget - best.dailyBudget)}/día · proyección ${formatMoney(projected + (toBudget - best.dailyBudget) * daysLeft)} de ${formatMoney(organization.monthlyLimit)}`,
        }));
      }
    }
  }

  return [...protective, ...restorative, ...optional.slice(0, GUARDRAILS.maxActionsPerRun)];
}

/** Converts AI proposals into actions. Unknown campaigns or ads are dropped; guardrails still apply later. */
export function actionsFromAi(
  proposals: AiActionProposal[],
  organization: Organization,
  state: Pick<OptimizationState, "campaigns" | "ads">,
  now: Date,
): AgentAction[] {
  return proposals.flatMap((proposal): AgentAction[] => {
    const campaign = state.campaigns.find((item) => item.id === proposal.campaignId && item.organizationId === organization.id);
    if (!campaign) return [];
    const base = {
      id: newId("action"), organizationId: organization.id, status: "recommended" as const, createdAt: now.toISOString(), source: "ai" as const,
      campaignId: campaign.id, campaignName: campaign.name, reason: proposal.reason, impact: proposal.impact,
    };
    if (proposal.type === "pause_ad") {
      const ad = state.ads.find((item) => item.id === proposal.adId && item.campaignId === campaign.id);
      return ad ? [{ ...base, agent: "Creativos", type: "pause_ad", adId: ad.id, adName: ad.name }] : [];
    }
    if (proposal.type === "pause_campaign") return [{ ...base, agent: "Estratega", type: "pause_campaign" }];
    const percent = proposal.changePct ?? 0;
    const increase = proposal.type === "increase_budget";
    if ((increase && percent <= 0) || (!increase && percent >= 0)) return [];
    const raw = campaign.dailyBudget * (1 + percent / 100);
    return [{
      ...base, agent: "Presupuesto", type: proposal.type,
      fromBudget: campaign.dailyBudget, toBudget: increase ? Math.floor(raw) : Math.ceil(raw),
    }];
  });
}

export interface CreativeRefreshTarget {
  campaign: Campaign;
  adSetId: string;
  /** Best ad in the set whose image and destination can be reused. */
  source: Ad;
}

/**
 * Ad sets that are running out of fresh creatives: at most one active ad left that is not fatigued, with
 * fatigue already showing. Sets refreshed in the last week are skipped, so the agents never flood a set.
 */
export function creativeRefreshTargets(
  workspace: Pick<WorkspaceData, "campaigns" | "ads" | "actions">,
  organization: Organization,
  proposals: AgentAction[],
  now: Date,
): CreativeRefreshTarget[] {
  const since = now.getTime() - GUARDRAILS.creativeRefreshDays * DAY_MS;
  const recentlyRefreshed = new Set(workspace.actions
    .filter((action) => action.organizationId === organization.id && action.type === "create_ad" && action.status !== "rejected" && action.status !== "blocked" && action.status !== "failed" && Date.parse(action.createdAt) >= since)
    .flatMap((action) => action.variant ? [action.variant.adSetId] : []));
  const pausing = new Set(proposals.filter((proposal) => proposal.type === "pause_ad" && proposal.trigger === "fatigue").map((proposal) => proposal.adId));
  const ads = workspace.ads.filter((ad) => ad.organizationId === organization.id);
  const targets: CreativeRefreshTarget[] = [];
  for (const adSetId of new Set(ads.map((ad) => ad.adSetId))) {
    if (recentlyRefreshed.has(adSetId)) continue;
    const adSetAds = ads.filter((ad) => ad.adSetId === adSetId);
    const campaign = workspace.campaigns.find((item) => item.id === adSetAds[0].campaignId && item.status === "ACTIVE");
    if (!campaign) continue;
    const active = adSetAds.filter((ad) => ad.status === "ACTIVE");
    const fatigued = active.filter((ad) => pausing.has(ad.id) || ad.frequency >= GUARDRAILS.fatigueFrequency);
    const fresh = active.filter((ad) => !pausing.has(ad.id) && ad.frequency < GUARDRAILS.fatigueFrequency);
    if (!fatigued.length || fresh.length > 1) continue;
    const source = adSetAds.filter((ad) => ad.creative?.reusable).sort((a, b) => b.results - a.results || b.ctr - a.ctr)[0];
    if (source) targets.push({ campaign, adSetId, source });
  }
  return targets.slice(0, 1);
}

/** Runs proposals through guardrails in order and assigns a status according to the automation mode. */
export function resolveProposals(
  state: OptimizationState,
  organization: Organization,
  proposals: AgentAction[],
  now: Date,
): AgentAction[] {
  let working = state;
  const seen = new Set<string>();
  const resolved: AgentAction[] = [];
  for (const proposal of proposals) {
    const key = actionKey(proposal);
    if (seen.has(key)) continue;
    seen.add(key);
    const check = checkGuardrails(proposal, { ...working, organization, now });
    if (!check.allowed) {
      resolved.push({ ...proposal, status: "blocked", guardrail: check.reason, resolvedAt: now.toISOString() });
      continue;
    }
    resolved.push({ ...proposal, status: statusForMode(organization.mode, proposal.type) });
    working = applyAction(working, proposal, now);
  }
  return resolved;
}

function statusForMode(mode: AutomationMode, type: AgentActionType): AgentAction["status"] {
  if (mode === "observer") return "recommended";
  if (mode === "copilot") return "pending";
  // New ads publish copy under the brand's name: only YOLO does that without a human look.
  if (type === "create_ad" && mode !== "yolo") return "pending";
  return "executing";
}

export function describeAction(action: Pick<AgentAction, "type" | "campaignName" | "adName" | "fromBudget" | "toBudget" | "variant">): string {
  const budgets = action.fromBudget !== undefined && action.toBudget !== undefined
    ? ` de ${formatMoney(action.fromBudget)} a ${formatMoney(action.toBudget)}/día`
    : "";
  const descriptions: Record<AgentActionType, string> = {
    increase_budget: `subir el presupuesto de ${action.campaignName}${budgets}`,
    decrease_budget: `bajar el presupuesto de ${action.campaignName}${budgets}`,
    pause_campaign: `pausar la campaña ${action.campaignName}`,
    resume_campaign: `reactivar la campaña ${action.campaignName}`,
    pause_ad: `pausar el anuncio ${action.adName} de ${action.campaignName}`,
    resume_ad: `reactivar el anuncio ${action.adName} de ${action.campaignName}`,
    create_ad: `crear un anuncio nuevo en ${action.campaignName}: “${action.variant?.headline ?? ""}”`,
  };
  return descriptions[action.type];
}

function executedTitle(action: AgentAction): string {
  const titles: Record<AgentActionType, string> = {
    increase_budget: `Subí el presupuesto de ${action.campaignName} a ${formatMoney(action.toBudget ?? 0)}/día`,
    decrease_budget: `Bajé el presupuesto de ${action.campaignName} a ${formatMoney(action.toBudget ?? 0)}/día`,
    pause_campaign: `Pausé la campaña ${action.campaignName}`,
    resume_campaign: `Reactivé la campaña ${action.campaignName}`,
    pause_ad: `Pausé el anuncio ${action.adName}`,
    resume_ad: `Reactivé el anuncio ${action.adName}`,
    create_ad: `Publiqué un anuncio nuevo en ${action.campaignName}`,
  };
  return titles[action.type];
}

export function activityFromAction(action: AgentAction): AgentActivity {
  const description = describeAction(action);
  const byStatus: Partial<Record<AgentAction["status"], { title: string; kind: AgentActivity["kind"]; impact: string }>> = {
    executed: { title: executedTitle(action), kind: "action", impact: action.impact },
    recommended: { title: `Recomiendo ${description}`, kind: "insight", impact: action.impact },
    pending: { title: `Pendiente de aprobación: ${description}`, kind: "insight", impact: action.impact },
    blocked: { title: `Guardrail detuvo: ${description}`, kind: "warning", impact: action.guardrail ?? "Bloqueado" },
    failed: { title: `Meta rechazó ${description}`, kind: "warning", impact: action.error ?? "Error de Meta" },
    rejected: { title: `Rechazaste ${description}`, kind: "insight", impact: "Sin cambios" },
  };
  const entry = byStatus[action.status] ?? { title: capitalize(description), kind: "insight" as const, impact: action.impact };
  return {
    id: newId("act"), organizationId: action.organizationId, agent: action.agent,
    title: entry.title, detail: action.reason, impact: entry.impact, kind: entry.kind, createdAt: action.resolvedAt ?? action.createdAt,
  };
}

function alertsFromActions(actions: AgentAction[]): AlertItem[] {
  const alerts: AlertItem[] = [];
  for (const organizationId of new Set(actions.map((action) => action.organizationId))) {
    const own = actions.filter((action) => action.organizationId === organizationId);
    const alert = (fields: Pick<AlertItem, "severity" | "title" | "detail">): AlertItem =>
      ({ id: newId("al"), organizationId, createdAt: own[0].resolvedAt ?? own[0].createdAt, read: false, ...fields });
    if (own.some((action) => action.agent === "Supervisor" && action.type === "pause_campaign" && action.status === "executed")) {
      alerts.push(alert({ severity: "critical", title: "Límite mensual alcanzado", detail: "Pulso pausó las campañas activas para no superar tu límite." }));
    }
    const pending = own.filter((action) => action.status === "pending").length;
    if (pending) {
      alerts.push(alert({ severity: "warning", title: `${pending} ${pending === 1 ? "cambio espera" : "cambios esperan"} tu aprobación`, detail: "Revisa las propuestas en Agentes IA; se revalidan contra los guardrails al aprobarlas." }));
    }
    const failed = own.find((action) => action.status === "failed");
    if (failed) {
      alerts.push(alert({ severity: "critical", title: "Meta rechazó un cambio", detail: failed.error ?? "Revisa permisos y el estado de la cuenta." }));
    }
  }
  return alerts;
}

const signature = (action: AgentAction) => `${action.type}:${action.campaignId}:${action.adId ?? ""}`;

export function expireStalePending(workspace: WorkspaceData, now: Date): WorkspaceData {
  const cutoff = now.getTime() - GUARDRAILS.pendingTtlHours * HOUR_MS;
  if (!workspace.actions.some((action) => action.status === "pending" && Date.parse(action.createdAt) < cutoff)) return workspace;
  return {
    ...workspace,
    actions: workspace.actions.map((action) => action.status === "pending" && Date.parse(action.createdAt) < cutoff
      ? { ...action, status: "expired" as const, resolvedAt: now.toISOString() }
      : action),
  };
}

/** Stores one action resolved outside an agent run (approvals, manual changes): updates it if logged, otherwise adds it. */
export function recordAction(current: WorkspaceData, resolved: AgentAction, now: Date): WorkspaceData {
  const next = resolved.status === "executed" ? applyAction(current, resolved, now) : current;
  const exists = next.actions.some((action) => action.id === resolved.id);
  return {
    ...next,
    actions: exists
      ? next.actions.map((action) => action.id === resolved.id ? resolved : action)
      : [resolved, ...next.actions].slice(0, 300),
    activities: [activityFromAction(resolved), ...next.activities].slice(0, 150),
  };
}

/** What one run looked at for a business; findings are counted later from the deduplicated log. */
export interface RunCheck {
  organizationId: string;
  campaignsChecked: number;
  adsChecked: number;
}

export interface AgentRunOutcome {
  actions: AgentAction[];
  insights: AgentActivity[];
  checks?: RunCheck[];
  reviews?: Array<{ organizationId: string; items: CampaignReview[] }>;
}

const FINDING_TYPES = new Set<AgentActionType>(["pause_campaign", "pause_ad", "decrease_budget"]);

/** Adds a run's checks to the per-day monitoring history, dropping days older than five weeks. */
export function recordMonitoring(
  monitoring: WorkspaceData["monitoring"],
  checks: Array<RunCheck & Pick<MonitoringDay, "anomalies" | "blocked" | "executed">>,
  now: Date,
): Record<string, MonitoringDay[]> {
  const next = { ...(monitoring ?? {}) };
  const date = now.toISOString().slice(0, 10);
  const oldest = new Date(now.getTime() - MONITORING_DAYS_KEPT * DAY_MS).toISOString().slice(0, 10);
  for (const check of checks) {
    const days = (next[check.organizationId] ?? []).filter((day) => day.date >= oldest);
    const today = days.find((day) => day.date === date);
    const updated: MonitoringDay = {
      date,
      runs: (today?.runs ?? 0) + 1,
      campaignsChecked: Math.max(today?.campaignsChecked ?? 0, check.campaignsChecked),
      adsChecked: Math.max(today?.adsChecked ?? 0, check.adsChecked),
      anomalies: (today?.anomalies ?? 0) + check.anomalies,
      blocked: (today?.blocked ?? 0) + check.blocked,
      executed: (today?.executed ?? 0) + check.executed,
      lastRunAt: now.toISOString(),
    };
    next[check.organizationId] = [...days.filter((day) => day.date !== date), updated].sort((a, b) => a.date.localeCompare(b.date));
  }
  return next;
}

/**
 * Merges a finished run into the latest stored workspace. Recommendations and blocks already logged in the
 * last 24 h are not logged or counted again, so hourly runs neither spam the log nor inflate the numbers.
 */
export function commitAgentRun(current: WorkspaceData, run: AgentRunOutcome, now: Date): WorkspaceData {
  let next = expireStalePending(current, now);
  const dayAgo = now.getTime() - DAY_MS;
  const repeatable = (action: AgentAction) => action.status === "blocked" || action.status === "recommended";
  const recentlyLogged = new Set(next.actions
    .filter((action) => repeatable(action) && Date.parse(action.createdAt) >= dayAgo)
    .map(signature));
  const fresh = run.actions.filter((action) => !repeatable(action) || !recentlyLogged.has(signature(action)));
  for (const action of fresh.filter((item) => item.status === "executed")) next = applyAction(next, action, now);
  const monitoring = run.checks?.length
    ? recordMonitoring(next.monitoring, run.checks.map((check) => {
      const own = fresh.filter((action) => action.organizationId === check.organizationId);
      return {
        ...check,
        anomalies: own.filter((action) => action.source !== "user" && FINDING_TYPES.has(action.type)).length,
        blocked: own.filter((action) => action.status === "blocked").length,
        executed: own.filter((action) => action.status === "executed").length,
      };
    }), now)
    : next.monitoring;
  return {
    ...next,
    monitoring,
    campaignReviews: run.reviews?.length
      ? { ...next.campaignReviews, ...Object.fromEntries(run.reviews.map((review) => [review.organizationId, { at: now.toISOString(), items: review.items }])) }
      : next.campaignReviews,
    actions: [...fresh, ...next.actions].slice(0, 300),
    activities: [...run.insights, ...fresh.map(activityFromAction), ...next.activities].slice(0, 150),
    alerts: [...alertsFromActions(fresh), ...next.alerts].slice(0, 100),
  };
}

export interface AgentBrief {
  agent: AgentName;
  /** alert: something for the owner to look at; ok: watched and fine; idle: nothing to watch yet. */
  state: "alert" | "ok" | "idle";
  status: string;
  /** What the agent sees right now in the account, with the same thresholds it acts on. */
  signal: string;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Live diagnosis per agent from the current account data, so every agent card says what it is watching. */
export function agentBriefs(
  workspace: Pick<WorkspaceData, "campaigns" | "ads">,
  organization: Organization,
  now: Date,
  aiEnabled: boolean,
): AgentBrief[] {
  const campaigns = workspace.campaigns.filter((campaign) => campaign.organizationId === organization.id);
  const active = campaigns.filter((campaign) => campaign.status === "ACTIVE");
  const ads = workspace.ads.filter((ad) => ad.organizationId === organization.id && ad.status === "ACTIVE" && active.some((campaign) => campaign.id === ad.campaignId));
  const brief = (agent: AgentName, state: AgentBrief["state"], status: string, signal: string): AgentBrief => ({ agent, state, status, signal });
  const noActive = (agent: AgentName) => brief(agent, "idle", "Sin datos", campaigns.length ? "No hay campañas activas que vigilar." : "Aún no hay campañas en esta cuenta.");

  const projected = projectedMonthSpend(organization, workspace.campaigns, now);
  const supervisor = organization.monthlyLimit <= 0
    ? brief("Supervisor", "idle", "Sin límite", "Define un límite mensual en Ajustes para proteger el presupuesto.")
    : organization.spentThisMonth >= organization.monthlyLimit
      ? brief("Supervisor", "alert", "Límite alcanzado", `Gastado ${formatMoney(organization.spentThisMonth)} de ${formatMoney(organization.monthlyLimit)}; las campañas activas se pausan.`)
      : brief("Supervisor", projected > organization.monthlyLimit ? "alert" : "ok", projected > organization.monthlyLimit ? "Sobre el ritmo" : "Al día",
        `Proyección del mes ${formatMoney(projected)} de ${formatMoney(organization.monthlyLimit)} (${Math.round((projected / organization.monthlyLimit) * 100)}%).`);

  const target = targetRoas(organization);
  const useValue = active.some((campaign) => campaign.revenue > 0);
  const totalResults = active.reduce((sum, campaign) => sum + campaign.results, 0);
  const averageCpa = totalResults ? active.reduce((sum, campaign) => sum + campaign.spend, 0) / totalResults : 0;

  const waste = active.filter((campaign) => !campaign.results && campaign.dailyBudget > 0 && campaign.spend >= campaign.dailyBudget * 3);
  const analyst = active.length
    ? brief("Analista", waste.length ? "alert" : "ok", waste.length ? "Atención" : "Al día", waste.length
      ? `${plural(waste.length, "campaña gasta", "campañas gastan")} más de tres días de presupuesto sin resultados.`
      : `${plural(active.length, "campaña activa", "campañas activas")} sin gasto desperdiciado.`)
    : noActive("Analista");

  const mature = active.filter((campaign) => hasManagedBudget(campaign) && isMature(campaign));
  const under = mature.filter((campaign) => useValue ? campaign.roas < target * 0.8 : averageCpa > 0 && campaign.results > 0 && campaign.costPerResult > averageCpa * 1.5);
  const scalable = mature.filter((campaign) => useValue ? campaign.roas >= target * 1.2 : averageCpa > 0 && campaign.results > 0 && campaign.costPerResult <= averageCpa * 0.75);
  const budget = !active.length ? noActive("Presupuesto")
    : !mature.length ? brief("Presupuesto", "ok", "Aprendiendo", "Ninguna campaña junta dos días de presupuesto todavía; espera datos antes de mover dinero.")
      : brief("Presupuesto", under.length ? "alert" : "ok", under.length ? "Atención" : "Al día",
        `${under.length} bajo la meta · ${scalable.length} para escalar · ${plural(mature.length, "campaña evaluada", "campañas evaluadas")}${useValue ? ` contra ROAS ${target.toFixed(2)}×` : " por costo por resultado"}.`);

  const frequencyOf = (campaignId: string) => {
    const own = ads.filter((ad) => ad.campaignId === campaignId && ad.impressions > 0);
    const impressions = own.reduce((sum, ad) => sum + ad.impressions, 0);
    return impressions ? own.reduce((sum, ad) => sum + ad.frequency * ad.impressions, 0) / impressions : undefined;
  };
  const frequencies = active.flatMap((campaign) => {
    const frequency = frequencyOf(campaign.id);
    return frequency === undefined ? [] : [frequency];
  });
  const saturated = frequencies.filter((frequency) => frequency >= GUARDRAILS.audienceSaturationFrequency).length;
  const audiences = !frequencies.length ? (active.length ? brief("Audiencias", "idle", "Sin datos", "Los anuncios activos aún no tienen impresiones.") : noActive("Audiencias"))
    : brief("Audiencias", saturated ? "alert" : "ok", saturated ? "Saturándose" : "Al día",
      `Frecuencia promedio ${(frequencies.reduce((sum, value) => sum + value, 0) / frequencies.length).toFixed(1)}${saturated ? ` · ${plural(saturated, "público ve", "públicos ven")} los anuncios ${GUARDRAILS.audienceSaturationFrequency}+ veces` : ""}.`);

  const fatigued = ads.filter((ad) => ad.frequency >= GUARDRAILS.fatigueFrequency && ad.impressions >= GUARDRAILS.fatigueMinImpressions).length;
  const creatives = !ads.length ? noActive("Creativos")
    : brief("Creativos", fatigued ? "alert" : "ok", fatigued ? "Fatiga" : "Al día",
      `${fatigued} de ${plural(ads.length, "anuncio activo", "anuncios activos")} con fatiga${aiEnabled ? "; escribe variantes nuevas con IA." : "; sin IA solo pausa, no crea variantes."}`);

  const strategist = !campaigns.length ? brief("Estratega", "alert", "Sin campañas", "Crea tu primera campaña desde Campañas.")
    : !active.length ? brief("Estratega", "alert", "Sin entrega", "Ninguna campaña está activa; tu cuenta no está generando resultados.")
      : !aiEnabled ? brief("Estratega", "idle", "Sin IA", "Configura OpenAI para recibir propuestas de estrategia en cada análisis.")
        : brief("Estratega", "ok", "Al día", `Analiza ${plural(active.length, "campaña activa", "campañas activas")} con IA en cada análisis.`);

  return [supervisor, strategist, analyst, budget, audiences, creatives];
}

const VERDICT_ORDER: CampaignVerdict[] =["attention", "watch", "learning", "no_data", "good", "excellent", "paused", "draft"];

const ACTION_STATE: Record<AgentAction["status"], string> = {
  executed: "Aplicado",
  pending: "Espera tu aprobación",
  executing: "En curso",
  recommended: "Recomendación",
  blocked: "Frenado por tus límites",
  failed: "Meta lo rechazó",
  rejected: "Rechazado",
  expired: "Expirado",
};

/**
 * A verdict and a message for every campaign of a business, including the ones doing well, so the owner sees
 * that each campaign was looked at. Campaign-level actions from this run take priority in the message.
 */
export function reviewCampaigns(
  workspace: Pick<WorkspaceData, "campaigns" | "ads" | "actions">,
  organization: Organization,
  runActions: AgentAction[],
  now: Date,
): CampaignReview[] {
  const campaigns = workspace.campaigns.filter((campaign) => campaign.organizationId === organization.id);
  const active = campaigns.filter((campaign) => campaign.status === "ACTIVE");
  const target = targetRoas(organization);
  const useValue = active.some((campaign) => campaign.revenue > 0);
  const totalResults = active.reduce((sum, campaign) => sum + campaign.results, 0);
  const averageCpa = totalResults ? active.reduce((sum, campaign) => sum + campaign.spend, 0) / totalResults : 0;
  const latestStatus = lastStatusChanges(workspace.actions);
  const campaignLevel = new Set<AgentActionType>(["increase_budget", "decrease_budget", "pause_campaign", "resume_campaign"]);

  const reviews = campaigns.map((campaign): CampaignReview => {
    const review = (verdict: CampaignVerdict, title: string, detail: string): CampaignReview => ({
      campaignId: campaign.id, campaignName: campaign.name, pageIds: campaign.pageIds, verdict, title, detail,
      spend: campaign.spend, results: campaign.results, roas: campaign.roas, costPerResult: campaign.costPerResult, dailyBudget: campaign.dailyBudget,
    });
    const own = runActions.filter((action) => action.campaignId === campaign.id);
    const action = own.find((item) => campaignLevel.has(item.type)) ?? own[0];
    const fatigued = workspace.ads.filter((ad) => ad.campaignId === campaign.id && ad.status === "ACTIVE" && ad.frequency >= GUARDRAILS.fatigueFrequency).length;
    const fatigueNote = fatigued ? ` ${fatigued} ${fatigued === 1 ? "anuncio tiene" : "anuncios tienen"} frecuencia alta.` : "";
    const performance = useValue
      ? `ROAS de ${campaign.roas.toFixed(2)}× frente a la meta de ${target.toFixed(2)}×`
      : campaign.results
        ? `Costo por resultado de ${formatMoney(campaign.costPerResult)} frente a ${formatMoney(averageCpa)} de promedio`
        : "Sin resultados registrados";

    if (campaign.status === "DRAFT") return review("draft", "Borrador sin publicar", "Publícala para que Pulso pueda medirla.");
    if (action) {
      const verdict: CampaignVerdict = action.status === "blocked" ? "watch"
        : action.type === "increase_budget" || action.type === "resume_campaign" ? "excellent"
          : "attention";
      return review(verdict, `${ACTION_STATE[action.status]}: ${describeAction(action)}`, `${action.reason}${action.guardrail ? ` ${action.guardrail}` : ""}${fatigueNote}`);
    }
    if (campaign.status === "PAUSED") {
      const pause = latestStatus.get(`campaign:${campaign.id}`);
      if (pause && pause.source !== "user" && pause.type === "pause_campaign") {
        const resumeNote = pause.trigger === "limit" ? " Se reactivará al empezar el mes si hay margen en el límite." : "";
        return review("paused", "Pausada por Pulso", `${pause.reason}${resumeNote}`);
      }
      return review("paused", "Pausada", "No se evalúa mientras esté en pausa.");
    }
    if (campaign.spend <= 0) return review("no_data", "Aún sin gasto", "Pulso la evaluará cuando empiece a gastar.");
    if (!isMature(campaign)) {
      return review("learning", "Juntando datos", `Lleva ${formatMoney(campaign.spend)} de ${formatMoney(campaign.dailyBudget * 2)} (dos días de presupuesto) para evaluarla con confianza. ${performance}.${fatigueNote}`);
    }
    if (!campaign.results) return review("attention", "Gasta sin resultados", `Ha invertido ${formatMoney(campaign.spend)} sin registrar resultados.${fatigueNote}`);
    // Same bands the planner acts on: under 80% of target (or 50% over average cost) is a problem, 20% over target is a scaling candidate.
    const ratio = useValue ? campaign.roas / target : averageCpa && campaign.costPerResult ? averageCpa / campaign.costPerResult : 1;
    const [excellentAt, attentionBelow] = useValue ? [1.2, 0.8] : [1 / 0.75, 1 / 1.5];
    if (ratio >= excellentAt) return review("excellent", "Rinde por encima de la meta", `${performance}. Es candidata a escalar cuando haya margen en el límite mensual.${fatigueNote}`);
    if (ratio >= 1) return review("good", "En meta", `${performance}. No hace falta cambiar nada.${fatigueNote}`);
    if (ratio >= attentionBelow) return review("watch", "Ligeramente bajo la meta", `${performance}. Está dentro del margen tolerado; Pulso la sigue vigilando.${fatigueNote}`);
    return review("attention", "Bajo la meta", `${performance}.${fatigueNote}`);
  });

  void now;
  return reviews.sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || b.spend - a.spend);
}

export interface MonitoringSummary {
  days: number;
  runs: number;
  /** Every run re-checks the month-end projection against the limit. */
  pacingChecks: number;
  campaignsWatched: number;
  adsWatched: number;
  anomalies: number;
  blocked: number;
  executed: number;
  lastRunAt?: string;
}

/** Totals for the last `days` days (today included), shown to prove the account was watched. */
export function monitoringSummary(workspace: Pick<WorkspaceData, "monitoring">, organizationId: string, now: Date, days = 7): MonitoringSummary {
  const since = new Date(now.getTime() - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  const recent = (workspace.monitoring?.[organizationId] ?? []).filter((day) => day.date >= since);
  const total = (key: "runs" | "anomalies" | "blocked" | "executed") => recent.reduce((sum, day) => sum + day[key], 0);
  return {
    days,
    runs: total("runs"),
    pacingChecks: total("runs"),
    campaignsWatched: Math.max(0, ...recent.map((day) => day.campaignsChecked)),
    adsWatched: Math.max(0, ...recent.map((day) => day.adsChecked)),
    anomalies: total("anomalies"),
    blocked: total("blocked"),
    executed: total("executed"),
    lastRunAt: recent.at(-1)?.lastRunAt,
  };
}

export function summarizeRun(actions: AgentAction[]): string {
  const count = (status: AgentAction["status"]) => actions.filter((action) => action.status === status).length;
  const parts = [
    count("executed") && `${count("executed")} ${count("executed") === 1 ? "cambio ejecutado" : "cambios ejecutados"}`,
    count("pending") && `${count("pending")} en espera de aprobación`,
    count("recommended") && `${count("recommended")} ${count("recommended") === 1 ? "recomendación" : "recomendaciones"}`,
    count("blocked") && `${count("blocked")} ${count("blocked") === 1 ? "bloqueado" : "bloqueados"} por guardrails`,
    count("failed") && `${count("failed")} con error de Meta`,
  ].filter(Boolean);
  return parts.length ? `Análisis completo: ${parts.join(", ")}.` : "Analicé las campañas y no encontré cambios urgentes.";
}

/** 0–100 score shown on the dashboard. */
export function accountHealth(organization: Organization, campaigns: Campaign[], actions: AgentAction[], now: Date): number {
  let score = 100;
  const roas = organization.spentThisMonth ? organization.revenueThisMonth / organization.spentThisMonth : 0;
  const target = targetRoas(organization);
  if (organization.spentThisMonth > 0 && roas < target) score -= Math.min(40, (1 - roas / target) * 80);
  if (projectedMonthSpend(organization, campaigns, now) > organization.monthlyLimit) score -= 20;
  const own = actions.filter((action) => action.organizationId === organization.id);
  score -= Math.min(15, own.filter((action) => action.status === "pending").length * 5);
  if (own.slice(0, 20).some((action) => action.status === "failed")) score -= 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}
