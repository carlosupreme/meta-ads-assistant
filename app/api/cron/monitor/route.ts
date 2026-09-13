import { NextResponse } from "next/server";
import { runAgentEngine } from "@/lib/agent-engine";
import { syncMetaWorkspace } from "@/lib/meta";
import { commitAgentRun } from "@/lib/optimizer";
import { AgentBusyError, listWorkspaceIds, updateWorkspace, withAgentLock } from "@/lib/store";
import { mergeSyncedWorkspace } from "@/lib/workspace";

export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // The cron can move money in every account, so production always requires the secret.
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function monitorWorkspace(workspaceId: string) {
  return withAgentLock(workspaceId, async (locked) => {
    let workspace = locked;
    if (workspace.metaConnection.status === "connected") {
      // Decide on fresh numbers: sync first, then plan against what was stored.
      const synced = await syncMetaWorkspace(workspace);
      workspace = await updateWorkspace(workspaceId, (current) => mergeSyncedWorkspace(current, synced));
    }
    const run = await runAgentEngine(workspace);
    await updateWorkspace(workspaceId, (current) => commitAgentRun(current, run, new Date()));
    return run;
  });
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const workspaceIds = await listWorkspaceIds();
    let executed = 0;
    let pending = 0;
    let skipped = 0;
    const failures: Array<{ workspaceId: string; error: string }> = [];
    // One workspace failing (revoked token, Meta outage) must not stop the others.
    for (const workspaceId of workspaceIds) {
      try {
        const run = await monitorWorkspace(workspaceId);
        executed += run.actions.filter((action) => action.status === "executed").length;
        pending += run.actions.filter((action) => action.status === "pending").length;
      } catch (error) {
        if (error instanceof AgentBusyError) skipped += 1;
        else failures.push({ workspaceId, error: error instanceof Error ? error.message : "Falló el monitoreo" });
      }
    }
    return NextResponse.json(
      { ok: failures.length === 0, workspaces: workspaceIds.length, executed, pending, skipped, failures },
      { status: failures.length && failures.length === workspaceIds.length ? 500 : 200 },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falló el monitoreo" }, { status: 500 });
  }
}
