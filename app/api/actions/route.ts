import { NextResponse } from "next/server";
import { z } from "zod";
import { executeAction } from "@/lib/agent-engine";
import { activityFromAction, applyAction, checkGuardrails, expireStalePending } from "@/lib/optimizer";
import { updateWorkspace } from "@/lib/store";
import type { AgentAction, WorkspaceData } from "@/lib/types";

const schema = z.object({ actionId: z.string().min(1), decision: z.enum(["approve", "reject"]) });

function finalize(current: WorkspaceData, resolved: AgentAction, now: Date): WorkspaceData {
  const next = resolved.status === "executed" ? applyAction(current, resolved, now) : current;
  return {
    ...next,
    actions: next.actions.map((action) => action.id === resolved.id ? resolved : action),
    activities: [activityFromAction(resolved), ...next.activities].slice(0, 150),
  };
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  const { actionId, decision } = parsed.data;
  const now = new Date();

  // Claim atomically: only one request can move a pending action forward.
  let claimed: AgentAction | undefined;
  const workspace = await updateWorkspace((stored) => {
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
    await updateWorkspace((current) => finalize(current, rejected, now));
    return NextResponse.json({ success: true, status: "rejected", message: "Propuesta rechazada. El agente no volverá a aplicarla sin tu aprobación." });
  }

  const organization = workspace.organizations.find((item) => item.id === claimed?.organizationId);
  const check = organization
    ? checkGuardrails(claimed, { organization, campaigns: workspace.campaigns, ads: workspace.ads, budgetChanges: workspace.budgetChanges, now })
    : { allowed: false as const, reason: "El negocio ya no existe." };
  const resolved: AgentAction = check.allowed
    ? await executeAction(workspace, claimed, now)
    : { ...claimed, status: "blocked", guardrail: check.reason, resolvedAt: now.toISOString() };
  await updateWorkspace((current) => finalize(current, resolved, now));

  const messages: Partial<Record<AgentAction["status"], string>> = {
    executed: "Cambio aprobado y aplicado.",
    blocked: `No se aplicó: ${resolved.guardrail}`,
    failed: `Meta rechazó el cambio: ${resolved.error}`,
  };
  return NextResponse.json(
    { success: resolved.status === "executed", status: resolved.status, message: messages[resolved.status] },
    { status: resolved.status === "executed" ? 200 : resolved.status === "blocked" ? 409 : 502 },
  );
}
