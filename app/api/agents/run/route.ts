import { NextResponse } from "next/server";
import { z } from "zod";
import { runAgentEngine } from "@/lib/agent-engine";
import { requestTrace } from "@/lib/ai/trace";
import { requireApiSession } from "@/lib/auth";
import { commitAgentRun } from "@/lib/optimizer";
import { AgentBusyError, updateWorkspace, withAgentLock } from "@/lib/store";

const schema = z.object({ organizationId: z.string().optional() });

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  try {
    const result = await withAgentLock(session.workspaceId, async (workspace) => {
      const run = await runAgentEngine(workspace, requestTrace(request, session), parsed.data.organizationId);
      await updateWorkspace(session.workspaceId, (current) => commitAgentRun(current, run, new Date()));
      return run;
    });
    return NextResponse.json({
      success: true,
      summary: result.summary,
      actions: result.actions.filter((action) => action.status === "executed").length,
    });
  } catch (error) {
    const status = error instanceof AgentBusyError ? 409 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falló el análisis" }, { status });
  }
}
