import { NextResponse } from "next/server";
import { runAgentEngine } from "@/lib/agent-engine";
import { mergeSyncedWorkspace, syncMetaWorkspace } from "@/lib/meta";
import { commitAgentRun } from "@/lib/optimizer";
import { AgentBusyError, updateWorkspace, withAgentLock } from "@/lib/store";

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    const result = await withAgentLock(async (locked) => {
      let workspace = locked;
      if (workspace.metaConnection.status === "connected") {
        // Decide on fresh numbers: sync first, then plan against what was stored.
        const synced = await syncMetaWorkspace(workspace);
        workspace = await updateWorkspace((current) => mergeSyncedWorkspace(current, synced));
      }
      const run = await runAgentEngine(workspace);
      await updateWorkspace((current) => commitAgentRun(current, run, new Date()));
      return run;
    });
    return NextResponse.json({
      ok: true,
      executed: result.actions.filter((action) => action.status === "executed").length,
      pending: result.actions.filter((action) => action.status === "pending").length,
      summary: result.summary,
    });
  } catch (error) {
    if (error instanceof AgentBusyError) return NextResponse.json({ ok: true, skipped: error.message });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falló el monitoreo" }, { status: 500 });
  }
}
