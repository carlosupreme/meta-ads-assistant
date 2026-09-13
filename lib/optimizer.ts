// Pure optimization core: planning rules, hard guardrails and state transitions.
// It only has type imports so it runs on the server, in the browser and under `node --test`.
import type {
  Ad, AgentAction, AgentActionType, AgentActivity, AlertItem, AutomationMode, BudgetChange, Campaign, Organization, WorkspaceData,
} from "./types";
import type { AiActionProposal } from "./ai/contracts";

export const GUARDRAILS = {
  maxBudgetChange: 0.2,
  changeWindowHours: 24,
  minDailyBudget: 50,
  maxActionsPerRun: 3,
  pendingTtlHours: 48,
  fatigueFrequency: 4,
  fatigueCtrRatio: 0.7,
  fatigueMinImpressions: 1000,
  scaleStep: 0.15,
} as const;

const HOUR_MS = 3_600_000;
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

/** Budget the campaign had before any change in the rolling window; the 20% cap is measured against it. */
export function budgetBaseline(campaign: Campaign, changes: BudgetChange[], now: Date): number {
  const windowStart = now.getTime() - GUARDRAILS.changeWindowHours * HOUR_MS;
  const recent = changes
    .filter((change) => change.campaignId === campaign.id && Date.parse(change.at) >= windowStart)
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

  if (action.type === "pause_campaign") {
    return campaign.status === "ACTIVE" ? allow : block("La campaña ya no está activa.");
  }

  if (action.type === "pause_ad") {
    const ad = ads.find((item) => item.id === action.adId && item.campaignId === campaign.id);
    if (!ad || ad.status !== "ACTIVE") return block("El anuncio ya no está activo.");
    const siblings = ads.filter((item) => item.adSetId === ad.adSetId && item.id !== ad.id && item.status === "ACTIVE");
    if (!siblings.length) return block("Es el último anuncio activo de su conjunto; pausarlo detendría la entrega.");
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

  const baseline = budgetBaseline(campaign, budgetChanges, now);
  const variation = Math.abs(toBudget - baseline) / baseline;
  if (variation > GUARDRAILS.maxBudgetChange + 1e-9) {
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
  if (action.type === "pause_ad") {
    return { ...state, ads: state.ads.map((ad) => ad.id === action.adId ? { ...ad, status: "PAUSED" as const } : ad) };
  }
  if (action.type === "pause_campaign") {
    return {
      ...state,
      campaigns: state.campaigns.map((campaign) => campaign.id === action.campaignId
        ? { ...campaign, status: "PAUSED" as const, updatedAt: "Ahora" }
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
      { campaignId: campaign.id, organizationId: campaign.organizationId, from: campaign.dailyBudget, to: toBudget, at: now.toISOString() },
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
const actionKey = (action: Pick<AgentAction, "type" | "campaignId" | "adId">) =>
  action.type === "pause_ad" ? `ad:${action.adId}` : `campaign:${action.campaignId}`;

type ProposalFields = Omit<AgentAction, "id" | "organizationId" | "status" | "createdAt" | "source">;

/** Deterministic rules. Protective actions (limit and pacing) are never capped; the rest are. */
export function planRuleActions(
  workspace: Pick<WorkspaceData, "campaigns" | "ads" | "actions">,
  organization: Organization,
  now: Date,
): AgentAction[] {
  const campaigns = workspace.campaigns.filter((campaign) => campaign.organizationId === organization.id && campaign.status === "ACTIVE");
  if (!campaigns.length) return [];
  const make = (fields: ProposalFields): AgentAction => ({
    id: newId("action"), organizationId: organization.id, status: "recommended", createdAt: now.toISOString(), source: "rules", ...fields,
  });
  const busy = new Set(workspace.actions
    .filter((action) => action.organizationId === organization.id && (action.status === "pending" || action.status === "executing"))
    .map(actionKey));

  if (organization.spentThisMonth >= organization.monthlyLimit) {
    return campaigns.filter((campaign) => !busy.has(`campaign:${campaign.id}`)).map((campaign) => make({
      agent: "Supervisor", type: "pause_campaign", campaignId: campaign.id, campaignName: campaign.name,
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

  // Waste: more than three days of budget without a single result.
  for (const campaign of campaigns) {
    if (!available(campaign) || campaign.results > 0 || campaign.dailyBudget <= 0 || campaign.spend < campaign.dailyBudget * 3) continue;
    optional.push(make({
      agent: "Analista", type: "pause_campaign", campaignId: campaign.id, campaignName: campaign.name,
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
          ...base, agent: "Creativos",
          reason: `Frecuencia de ${ad.frequency.toFixed(1)} y CTR de ${ad.ctr.toFixed(2)}% frente a ${medianCtr.toFixed(2)}% de los demás anuncios: señales de fatiga.`,
          impact: "El presupuesto se concentra en los anuncios vigentes",
        }));
      } else if (ad.results === 0 && ads.some((other) => other.id !== ad.id && other.results > 0) && ad.spend >= Math.max(campaignCpa * 2, campaign.dailyBudget)) {
        optional.push(make({
          ...base, agent: "Analista",
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

  return [...protective, ...optional.slice(0, GUARDRAILS.maxActionsPerRun)];
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
    resolved.push({ ...proposal, status: statusForMode(organization.mode) });
    working = applyAction(working, proposal, now);
  }
  return resolved;
}

function statusForMode(mode: AutomationMode): AgentAction["status"] {
  if (mode === "observer") return "recommended";
  if (mode === "copilot") return "pending";
  return "executing";
}

export function describeAction(action: Pick<AgentAction, "type" | "campaignName" | "adName" | "fromBudget" | "toBudget">): string {
  const budgets = action.fromBudget !== undefined && action.toBudget !== undefined
    ? ` de ${formatMoney(action.fromBudget)} a ${formatMoney(action.toBudget)}/día`
    : "";
  const descriptions: Record<AgentActionType, string> = {
    increase_budget: `subir el presupuesto de ${action.campaignName}${budgets}`,
    decrease_budget: `bajar el presupuesto de ${action.campaignName}${budgets}`,
    pause_campaign: `pausar la campaña ${action.campaignName}`,
    pause_ad: `pausar el anuncio ${action.adName} de ${action.campaignName}`,
  };
  return descriptions[action.type];
}

function executedTitle(action: AgentAction): string {
  const titles: Record<AgentActionType, string> = {
    increase_budget: `Subí el presupuesto de ${action.campaignName} a ${formatMoney(action.toBudget ?? 0)}/día`,
    decrease_budget: `Bajé el presupuesto de ${action.campaignName} a ${formatMoney(action.toBudget ?? 0)}/día`,
    pause_campaign: `Pausé la campaña ${action.campaignName}`,
    pause_ad: `Pausé el anuncio ${action.adName}`,
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
    title: entry.title, detail: action.reason, impact: entry.impact, kind: entry.kind, createdAt: "Ahora",
  };
}

function alertsFromActions(actions: AgentAction[]): AlertItem[] {
  const alerts: AlertItem[] = [];
  for (const organizationId of new Set(actions.map((action) => action.organizationId))) {
    const own = actions.filter((action) => action.organizationId === organizationId);
    const alert = (fields: Pick<AlertItem, "severity" | "title" | "detail">): AlertItem =>
      ({ id: newId("al"), organizationId, createdAt: "Ahora", read: false, ...fields });
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

export interface AgentRunOutcome {
  actions: AgentAction[];
  insights: AgentActivity[];
}

/** Merges a finished run into the latest stored workspace. Repeated blocks within 24 h are not logged again. */
export function commitAgentRun(current: WorkspaceData, run: AgentRunOutcome, now: Date): WorkspaceData {
  let next = expireStalePending(current, now);
  const dayAgo = now.getTime() - 24 * HOUR_MS;
  const recentlyBlocked = new Set(next.actions
    .filter((action) => action.status === "blocked" && Date.parse(action.createdAt) >= dayAgo)
    .map(signature));
  const fresh = run.actions.filter((action) => action.status !== "blocked" || !recentlyBlocked.has(signature(action)));
  for (const action of fresh.filter((item) => item.status === "executed")) next = applyAction(next, action, now);
  return {
    ...next,
    actions: [...fresh, ...next.actions].slice(0, 300),
    activities: [...run.insights, ...fresh.map(activityFromAction), ...next.activities].slice(0, 150),
    alerts: [...alertsFromActions(fresh), ...next.alerts].slice(0, 100),
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
