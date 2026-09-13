import { updateMetaObject } from "./meta";
import type { AgentAction, AgentActivity, WorkspaceData } from "./types";
import { aiStatus, analyzeCampaigns, buildAiContext } from "./ai/openai";
import {
  actionsFromAi, planRuleActions, resolveProposals, scaledAdSetBudget, summarizeRun, type AgentRunOutcome,
} from "./optimizer";

export interface AgentRunResult extends AgentRunOutcome {
  summary: string;
}

/**
 * Plans with rules (and AI when configured), filters everything through the guardrails and executes
 * what the automation mode allows. It does not persist: commit the result with `commitAgentRun`.
 */
export async function runAgentEngine(workspace: WorkspaceData, organizationId?: string, now = new Date()): Promise<AgentRunResult> {
  const organizations = organizationId
    ? workspace.organizations.filter((organization) => organization.id === organizationId)
    : workspace.organizations;
  const aiModel = aiStatus(workspace.aiModel).configured ? workspace.aiModel : undefined;
  const actions: AgentAction[] = [];
  const insights: AgentActivity[] = [];
  let aiHeadline: string | undefined;

  for (const organization of organizations) {
    const campaigns = workspace.campaigns.filter((campaign) => campaign.organizationId === organization.id);
    if (!campaigns.length) continue;
    const proposals = planRuleActions(workspace, organization, now);

    if (aiModel && campaigns.some((campaign) => campaign.status === "ACTIVE")) {
      try {
        const ads = workspace.ads.filter((ad) => ad.organizationId === organization.id);
        const analysis = await analyzeCampaigns(aiModel, buildAiContext(organization, campaigns, ads, proposals));
        insights.push(...analysis.recommendations.map((recommendation): AgentActivity => ({
          id: `ai-${globalThis.crypto.randomUUID()}`,
          organizationId: organization.id,
          agent: recommendation.agent,
          title: recommendation.title,
          detail: recommendation.detail,
          impact: recommendation.impact,
          kind: recommendation.urgency === "warning" ? "warning" : recommendation.urgency === "action" ? "action" : "insight",
          createdAt: "Ahora",
        })));
        proposals.push(...actionsFromAi(analysis.actions, organization, workspace, now));
        aiHeadline = analysis.headline;
      } catch (error) {
        console.error("AI analysis did not complete", error);
      }
    }

    for (const action of resolveProposals(workspace, organization, proposals, now)) {
      actions.push(action.status === "executing" ? await executeAction(workspace, action, now) : action);
    }
  }

  const summary = summarizeRun(actions);
  return { actions, insights, summary: actions.length || !aiHeadline ? summary : aiHeadline };
}

/** Pushes an already validated action to Meta. In demo mode the change is simulated locally. */
export async function executeAction(workspace: WorkspaceData, action: AgentAction, now = new Date()): Promise<AgentAction> {
  try {
    await pushActionToMeta(workspace, action);
    return { ...action, status: "executed", resolvedAt: now.toISOString() };
  } catch (error) {
    return {
      ...action,
      status: "failed",
      error: error instanceof Error ? error.message : "Meta no aceptó el cambio",
      resolvedAt: now.toISOString(),
    };
  }
}

async function pushActionToMeta(workspace: WorkspaceData, action: AgentAction): Promise<void> {
  const { status, encryptedAccessToken } = workspace.metaConnection;
  if (status !== "connected") return;
  if (!encryptedAccessToken) throw new Error("La conexión con Meta no tiene un token válido");

  if (action.type === "pause_ad") {
    if (!action.adId) throw new Error("Falta el anuncio a pausar");
    return updateMetaObject(encryptedAccessToken, action.adId, { status: "PAUSED" });
  }
  if (action.type === "pause_campaign") {
    return updateMetaObject(encryptedAccessToken, action.campaignId, { status: "PAUSED" });
  }
  if (action.type === "resume_ad") {
    if (!action.adId) throw new Error("Falta el anuncio a reactivar");
    return updateMetaObject(encryptedAccessToken, action.adId, { status: "ACTIVE" });
  }
  if (action.type === "resume_campaign") {
    return updateMetaObject(encryptedAccessToken, action.campaignId, { status: "ACTIVE" });
  }

  const campaign = workspace.campaigns.find((item) => item.id === action.campaignId);
  if (!campaign || action.toBudget === undefined || campaign.dailyBudget <= 0) throw new Error("Datos de presupuesto incompletos");
  if (campaign.budgetLevel === "adset") {
    // Ad set budgets (ABO): scale every active ad set by the same factor.
    const factor = action.toBudget / campaign.dailyBudget;
    for (const adSet of (campaign.adSets ?? []).filter((item) => item.status === "ACTIVE" && item.dailyBudget > 0)) {
      await updateMetaObject(encryptedAccessToken, adSet.id, { daily_budget: scaledAdSetBudget(adSet.dailyBudget, factor) });
    }
    return;
  }
  await updateMetaObject(encryptedAccessToken, campaign.id, { daily_budget: action.toBudget });
}
