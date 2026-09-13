import { NextResponse } from "next/server";
import { z } from "zod";
import { executeAction } from "@/lib/agent-engine";
import { requireApiSession } from "@/lib/auth";
import { checkGuardrails, formatMoney, recordAction } from "@/lib/optimizer";
import { toSafeWorkspace } from "@/lib/safe-workspace";
import { readWorkspace, updateWorkspace } from "@/lib/store";
import type { AgentAction } from "@/lib/types";

const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("campaign-status"), campaignId: z.string().min(1), status: z.enum(["ACTIVE", "PAUSED"]) }),
  z.object({ kind: z.literal("campaign-budget"), campaignId: z.string().min(1), dailyBudget: z.number().positive().max(10_000_000) }),
  z.object({ kind: z.literal("ad-status"), adId: z.string().min(1), status: z.enum(["ACTIVE", "PAUSED"]) }),
]);

const EXECUTED_MESSAGES: Record<AgentAction["type"], (action: AgentAction) => string> = {
  increase_budget: (action) => `Presupuesto actualizado a ${formatMoney(action.toBudget ?? 0)}/día.`,
  decrease_budget: (action) => `Presupuesto actualizado a ${formatMoney(action.toBudget ?? 0)}/día.`,
  pause_campaign: () => "Campaña pausada.",
  resume_campaign: () => "Campaña reactivada.",
  pause_ad: () => "Anuncio pausado.",
  resume_ad: () => "Anuncio reactivado.",
};

/**
 * Manual changes made from Pulso. They run on Meta right away, respect the monthly limit and are logged
 * as the user's, so the agents never undo them.
 */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  const input = parsed.data;
  const now = new Date();
  const workspace = await readWorkspace(session.workspaceId);

  const ad = input.kind === "ad-status" ? workspace.ads.find((item) => item.id === input.adId) : undefined;
  if (input.kind === "ad-status" && !ad) return NextResponse.json({ error: "Anuncio no encontrado." }, { status: 404 });
  const campaignId = input.kind === "ad-status" ? ad?.campaignId : input.campaignId;
  const campaign = workspace.campaigns.find((item) => item.id === campaignId);
  if (!campaign) return NextResponse.json({ error: "Campaña no encontrada." }, { status: 404 });
  if (campaign.status === "DRAFT") return NextResponse.json({ error: "Publica el borrador antes de modificarlo." }, { status: 409 });
  const organization = workspace.organizations.find((item) => item.id === campaign.organizationId);
  if (!organization) return NextResponse.json({ error: "Negocio no encontrado." }, { status: 404 });

  const base = {
    id: `action-${globalThis.crypto.randomUUID()}`,
    organizationId: organization.id,
    campaignId: campaign.id,
    campaignName: campaign.name,
    impact: "Cambio manual",
    source: "user" as const,
    trigger: "manual" as const,
    status: "executing" as const,
    createdAt: now.toISOString(),
  };
  let action: AgentAction;
  if (input.kind === "campaign-budget") {
    const toBudget = Math.round(input.dailyBudget);
    if (toBudget === campaign.dailyBudget) return NextResponse.json({ error: "Ese ya es el presupuesto actual." }, { status: 400 });
    action = {
      ...base,
      agent: "Presupuesto",
      type: toBudget > campaign.dailyBudget ? "increase_budget" : "decrease_budget",
      fromBudget: campaign.dailyBudget,
      toBudget,
      reason: "Presupuesto ajustado manualmente desde Pulso.",
    };
  } else if (input.kind === "campaign-status") {
    const pausing = input.status === "PAUSED";
    action = { ...base, agent: "Supervisor", type: pausing ? "pause_campaign" : "resume_campaign", reason: pausing ? "Pausada manualmente desde Pulso." : "Reactivada manualmente desde Pulso." };
  } else {
    const pausing = input.status === "PAUSED";
    action = { ...base, agent: "Creativos", type: pausing ? "pause_ad" : "resume_ad", adId: ad?.id, adName: ad?.name, reason: pausing ? "Pausado manualmente desde Pulso." : "Reactivado manualmente desde Pulso." };
  }

  const check = checkGuardrails(action, { organization, campaigns: workspace.campaigns, ads: workspace.ads, budgetChanges: workspace.budgetChanges, now });
  const resolved: AgentAction = check.allowed
    ? await executeAction(workspace, action, now)
    : { ...action, status: "blocked", guardrail: check.reason, resolvedAt: now.toISOString() };
  const next = await updateWorkspace(session.workspaceId, (current) => recordAction(current, resolved, now));

  const message = resolved.status === "executed" ? EXECUTED_MESSAGES[resolved.type](resolved)
    : resolved.status === "blocked" ? `No se aplicó: ${resolved.guardrail}`
      : `Meta rechazó el cambio: ${resolved.error}`;
  const status = resolved.status === "executed" ? 200 : resolved.status === "blocked" ? 409 : 502;
  return NextResponse.json({ status: resolved.status, message, workspace: toSafeWorkspace(next) }, { status });
}
