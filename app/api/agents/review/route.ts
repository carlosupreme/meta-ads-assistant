import { NextResponse } from "next/server";
import { z } from "zod";
import { executeAction } from "@/lib/agent-engine";
import { aiStatus, reviewCampaignWithAi } from "@/lib/ai/openai";
import { requestTrace } from "@/lib/ai/trace";
import { requireApiSession } from "@/lib/auth";
import {
  actionsFromAi, openCampaignAction, projectedMonthSpend, recordAction, resolveProposals, reviewCampaigns, storeCampaignReview,
} from "@/lib/optimizer";
import { toSafeWorkspace } from "@/lib/safe-workspace";
import { AgentBusyError, updateWorkspace, withAgentLock } from "@/lib/store";
import type { AgentAction, CampaignReview } from "@/lib/types";

// One model call per request; the client walks the campaigns one by one.
export const maxDuration = 60;

const schema = z.object({ organizationId: z.string().min(1), campaignId: z.string().min(1) });

class ReviewError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Analyzes one campaign with AI: always a verdict and summary, and at most one change that passes the guardrails. */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  const { organizationId, campaignId } = parsed.data;

  try {
    const updated = await withAgentLock(session.workspaceId, async (workspace) => {
      const now = new Date();
      const organization = workspace.organizations.find((item) => item.id === organizationId);
      const campaign = workspace.campaigns.find((item) => item.id === campaignId && item.organizationId === organizationId);
      if (!organization || !campaign) throw new ReviewError("Campaña no encontrada.", 404);
      const ai = aiStatus(workspace.aiModel);
      if (!ai.configured || !ai.model) throw new ReviewError(ai.reason ?? "OpenAI no está configurado.", 503);

      const ruleReview = workspace.campaignReviews?.[organizationId]?.items.find((item) => item.campaignId === campaignId)
        ?? reviewCampaigns(workspace, organization, [], now).find((item) => item.campaignId === campaignId);
      if (!ruleReview) throw new ReviewError("Campaña no encontrada.", 404);
      // Drafts and campaigns without spend have nothing for the model to read.
      if (campaign.status === "DRAFT" || campaign.spend <= 0) {
        return updateWorkspace(session.workspaceId, (current) => storeCampaignReview(current, organizationId, { ...ruleReview, source: "rules" }, now));
      }

      const active = workspace.campaigns.filter((item) => item.organizationId === organizationId && item.status === "ACTIVE");
      const spend = active.reduce((sum, item) => sum + item.spend, 0);
      const results = active.reduce((sum, item) => sum + item.results, 0);
      const revenue = active.reduce((sum, item) => sum + item.revenue, 0);
      const recent = openCampaignAction(workspace.actions, campaignId, now);
      const review = await reviewCampaignWithAi(ai.model, {
        organization,
        campaign: { ...campaign, pageNames: (campaign.pageIds ?? []).flatMap((id) => workspace.pages?.find((page) => page.id === id)?.name ?? []) },
        ads: workspace.ads.filter((ad) => ad.campaignId === campaignId),
        account: {
          activeCampaigns: active.length,
          averageRoas: spend ? revenue / spend : 0,
          averageCostPerResult: results ? spend / results : 0,
          projectedMonthSpend: projectedMonthSpend(organization, workspace.campaigns, now),
        },
        recentActions: recent ? [{ type: recent.type, status: recent.status, fromBudget: recent.fromBudget, toBudget: recent.toBudget, reason: recent.reason }] : [],
      }, requestTrace(request, session, organization));

      let resolved: AgentAction | undefined;
      if (review.action && !recent && campaign.status === "ACTIVE") {
        const [proposal] = actionsFromAi([{
          ...review.action, campaignId, adId: review.action.adId ?? undefined, changePct: review.action.changePct ?? undefined,
        }], organization, workspace, now);
        if (proposal) {
          const [checked] = resolveProposals(workspace, organization, [proposal], now);
          resolved = checked.status === "executing" ? await executeAction(workspace, checked, now) : checked;
        }
      }

      const item: CampaignReview = {
        ...ruleReview, verdict: review.verdict, title: review.title, detail: review.summary, actionId: resolved?.id ?? recent?.id, source: "ai",
      };
      return updateWorkspace(session.workspaceId, (current) =>
        storeCampaignReview(resolved ? recordAction(current, resolved, now) : current, organizationId, item, now));
    });
    return NextResponse.json({ workspace: toSafeWorkspace(updated) });
  } catch (error) {
    const status = error instanceof ReviewError ? error.status : error instanceof AgentBusyError ? 409 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo analizar la campaña" }, { status });
  }
}
