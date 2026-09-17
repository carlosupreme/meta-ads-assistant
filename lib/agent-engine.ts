import { createAdVariant, updateMetaObject } from "./meta";
import type { AgentAction, AgentActivity, WorkspaceData } from "./types";
import { aiStatus, analyzeCampaigns, buildAiContext, writeAdVariants } from "./ai/openai";
import { forOrganization, type AiTrace } from "./ai/usage";
import {
  actionsFromAi, buildVariantSpec, creativeRefreshTargets, planRuleActions, resolveProposals, reviewCampaigns, scaledAdSetBudget, summarizeRun,
  type AgentRunOutcome, type RunCheck,
} from "./optimizer";

export interface AgentRunResult extends AgentRunOutcome {
  summary: string;
}

/**
 * Plans with rules (and AI when configured), filters everything through the guardrails and executes
 * what the automation mode allows. It does not persist: commit the result with `commitAgentRun`.
 */
export async function runAgentEngine(workspace: WorkspaceData, trace: AiTrace, organizationId?: string, now = new Date()): Promise<AgentRunResult> {
  const organizations = organizationId
    ? workspace.organizations.filter((organization) => organization.id === organizationId)
    : workspace.organizations;
  const ai = aiStatus(workspace.aiModel);
  const aiModel = ai.configured && ai.model ? ai.model : undefined;
  const actions: AgentAction[] = [];
  const insights: AgentActivity[] = [];
  const checks: RunCheck[] = [];
  const reviews: NonNullable<AgentRunOutcome["reviews"]> = [];
  let aiHeadline: string | undefined;

  for (const organization of organizations) {
    const campaigns = workspace.campaigns.filter((campaign) => campaign.organizationId === organization.id);
    if (!campaigns.length) continue;
    const proposals = planRuleActions(workspace, organization, now);
    const organizationTrace = forOrganization(trace, organization);

    if (aiModel && campaigns.some((campaign) => campaign.status === "ACTIVE")) {
      try {
        const ads = workspace.ads.filter((ad) => ad.organizationId === organization.id);
        const analysis = await analyzeCampaigns(aiModel, buildAiContext(organization, campaigns, ads, proposals), organizationTrace);
        insights.push(...analysis.recommendations.map((recommendation): AgentActivity => ({
          id: `ai-${globalThis.crypto.randomUUID()}`,
          organizationId: organization.id,
          agent: recommendation.agent,
          title: recommendation.title,
          detail: recommendation.detail,
          impact: recommendation.impact,
          kind: recommendation.urgency === "warning" ? "warning" : recommendation.urgency === "action" ? "action" : "insight",
          createdAt: now.toISOString(),
        })));
        proposals.push(...actionsFromAi(analysis.actions, organization, workspace, now));
        aiHeadline = analysis.headline;
      } catch (error) {
        console.error("AI analysis did not complete", error);
      }

      // Replace fatigued creatives before an ad set runs dry.
      for (const target of creativeRefreshTargets(workspace, organization, proposals, now)) {
        try {
          const [variant] = await writeAdVariants(aiModel, {
            business: organization.name,
            objective: organization.objective,
            campaign: target.campaign.name,
            headline: target.source.creative?.headline,
            primaryText: target.source.creative?.primaryText,
            ctr: target.source.ctr,
            frequency: target.source.frequency,
            results: target.source.results,
          }, organizationTrace);
          if (!variant) continue;
          proposals.push({
            id: `action-${globalThis.crypto.randomUUID()}`,
            organizationId: organization.id,
            agent: "Creativos",
            type: "create_ad",
            campaignId: target.campaign.id,
            campaignName: target.campaign.name,
            adName: target.source.name,
            variant: { adSetId: target.adSetId, sourceAdId: target.source.id, headline: variant.headline, primaryText: variant.primaryText },
            reason: `Sus anuncios muestran fatiga y el conjunto se queda sin creativos frescos. Ángulo propuesto: ${variant.angle}.`,
            impact: "Anuncio nuevo con la misma imagen y destino, y texto renovado",
            source: "ai",
            status: "recommended",
            createdAt: now.toISOString(),
          });
        } catch (error) {
          console.error("Creative refresh did not complete", error);
        }
      }
    }

    for (const action of resolveProposals(workspace, organization, proposals, now)) {
      actions.push(action.status === "executing" ? await executeAction(workspace, action, now) : action);
    }
    reviews.push({
      organizationId: organization.id,
      items: reviewCampaigns(workspace, organization, actions.filter((action) => action.organizationId === organization.id), now),
    });
    checks.push({
      organizationId: organization.id,
      campaignsChecked: campaigns.filter((campaign) => campaign.status === "ACTIVE").length,
      adsChecked: workspace.ads.filter((ad) => ad.organizationId === organization.id && ad.status === "ACTIVE").length,
    });
  }

  const reviewed = reviews.reduce((sum, review) => sum + review.items.length, 0);
  const base = actions.length || !aiHeadline ? summarizeRun(actions) : aiHeadline;
  const summary = reviewed ? `${base} Revisé ${reviewed} ${reviewed === 1 ? "campaña" : "campañas"}; ve el detalle en Agentes IA.` : base;
  return { actions, insights, checks, reviews, summary };
}

/** Pushes an already validated action to Meta. In demo mode the change is simulated locally. */
export async function executeAction(workspace: WorkspaceData, action: AgentAction, now = new Date()): Promise<AgentAction> {
  try {
    const createdAdId = action.type === "create_ad"
      ? await createAdOnMeta(workspace, action)
      : (await pushActionToMeta(workspace, action), undefined);
    return { ...action, ...(createdAdId && { createdAdId }), status: "executed", resolvedAt: now.toISOString() };
  } catch (error) {
    return {
      ...action,
      status: "failed",
      error: error instanceof Error ? error.message : "Meta no aceptó el cambio",
      resolvedAt: now.toISOString(),
    };
  }
}

/** Clones the source ad's story spec with the new copy into its ad set. Returns undefined in demo mode. */
async function createAdOnMeta(workspace: WorkspaceData, action: AgentAction): Promise<string | undefined> {
  const { status, encryptedAccessToken } = workspace.metaConnection;
  if (status !== "connected") return undefined;
  if (!encryptedAccessToken) throw new Error("La conexión con Meta no tiene un token válido");
  const organization = workspace.organizations.find((item) => item.id === action.organizationId);
  const source = workspace.ads.find((ad) => ad.id === action.variant?.sourceAdId);
  if (!organization || !action.variant || !source?.creative?.spec) throw new Error("Faltan datos del anuncio base para crear la variante");
  return createAdVariant(encryptedAccessToken, organization.adAccountId, {
    adSetId: action.variant.adSetId,
    name: `Pulso · ${action.variant.headline}`,
    spec: buildVariantSpec(source.creative.spec, action.variant),
  });
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
