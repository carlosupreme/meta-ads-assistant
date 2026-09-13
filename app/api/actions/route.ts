import { NextResponse } from "next/server";
import { z } from "zod";
import { executeAction } from "@/lib/agent-engine";
import { requireApiSession } from "@/lib/auth";
import { activityFromAction, applyAction, checkGuardrails, expireStalePending } from "@/lib/optimizer";
import { readWorkspace, updateWorkspace } from "@/lib/store";
import type { AgentAction, WorkspaceData } from "@/lib/types";

const schema = z.object({ actionId: z.string().min(1), decision: z.enum(["approve", "reject", "resume"]) });

/** Stores a resolved action: replaces it when it is already in the log, otherwise adds it. */
function recordResolved(current: WorkspaceData, resolved: AgentAction, now: Date): WorkspaceData {
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

function respond(resolved: AgentAction, executedMessage: string) {
  const messages: Partial<Record<AgentAction["status"], string>> = {
    executed: executedMessage,
    blocked: `No se aplicó: ${resolved.guardrail}`,
    failed: `Meta rechazó el cambio: ${resolved.error}`,
  };
  return NextResponse.json(
    { success: resolved.status === "executed", status: resolved.status, message: messages[resolved.status] },
    { status: resolved.status === "executed" ? 200 : resolved.status === "blocked" ? 409 : 502 },
  );
}

/** Undoes an executed pause on request of the user, still subject to the guardrails. */
async function resumePaused(workspaceId: string, actionId: string, now: Date) {
  const workspace = await readWorkspace(workspaceId);
  const pause = workspace.actions.find((action) => action.id === actionId);
  if (!pause || pause.status !== "executed" || (pause.type !== "pause_campaign" && pause.type !== "pause_ad")) {
    return NextResponse.json({ error: "Solo se pueden reactivar pausas ya ejecutadas." }, { status: 409 });
  }
  const organization = workspace.organizations.find((item) => item.id === pause.organizationId);
  if (!organization) return NextResponse.json({ error: "El negocio ya no existe." }, { status: 404 });
  const resume: AgentAction = {
    id: `action-${globalThis.crypto.randomUUID()}`,
    organizationId: pause.organizationId,
    agent: pause.agent,
    type: pause.type === "pause_ad" ? "resume_ad" : "resume_campaign",
    campaignId: pause.campaignId,
    campaignName: pause.campaignName,
    adId: pause.adId,
    adName: pause.adName,
    reason: "Reactivado manualmente desde el registro de cambios.",
    impact: "La entrega vuelve a iniciar",
    source: "user",
    trigger: "manual",
    status: "executing",
    createdAt: now.toISOString(),
  };
  const check = checkGuardrails(resume, { organization, campaigns: workspace.campaigns, ads: workspace.ads, budgetChanges: workspace.budgetChanges, now });
  const resolved: AgentAction = check.allowed
    ? await executeAction(workspace, resume, now)
    : { ...resume, status: "blocked", guardrail: check.reason, resolvedAt: now.toISOString() };
  await updateWorkspace(workspaceId, (current) => recordResolved(current, resolved, now));
  return respond(resolved, "Listo, se reactivó.");
}

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  const { actionId, decision } = parsed.data;
  const { workspaceId } = session;
  const now = new Date();

  if (decision === "resume") return resumePaused(workspaceId, actionId, now);

  // Claim atomically: only one request can move a pending action forward.
  let claimed: AgentAction | undefined;
  const workspace = await updateWorkspace(workspaceId, (stored) => {
    const current = expireStalePending(stored, now);
    const action = current.actions.find((item) => item.id === actionId);
    claimed = action?.status === "pending" ? action : undefined;
    if (!claimed) return current;
    const status = decision === "approve" ? "executing" : "rejected";
    return {
      ...current,
      actions: current.actions.map((item) => item.id === actionId ? { ...item, status, ...(status === "rejected" && { resolvedAt: now.toISOString() }) } : item),
    };
  });
  if (!claimed) return NextResponse.json({ error: "Esta propuesta ya fue resuelta o expiró." }, { status: 409 });

  if (decision === "reject") {
    const rejected: AgentAction = { ...claimed, status: "rejected", resolvedAt: now.toISOString() };
    await updateWorkspace(workspaceId, (current) => recordResolved(current, rejected, now));
    return NextResponse.json({ success: true, status: "rejected", message: "Propuesta rechazada. El agente no volverá a aplicarla sin tu aprobación." });
  }

  const organization = workspace.organizations.find((item) => item.id === claimed?.organizationId);
  const check = organization
    ? checkGuardrails(claimed, { organization, campaigns: workspace.campaigns, ads: workspace.ads, budgetChanges: workspace.budgetChanges, now })
    : { allowed: false as const, reason: "El negocio ya no existe." };
  const resolved: AgentAction = check.allowed
    ? await executeAction(workspace, claimed, now)
    : { ...claimed, status: "blocked", guardrail: check.reason, resolvedAt: now.toISOString() };
  await updateWorkspace(workspaceId, (current) => recordResolved(current, resolved, now));
  return respond(resolved, "Cambio aprobado y aplicado.");
}
