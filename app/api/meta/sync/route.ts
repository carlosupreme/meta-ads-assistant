import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { mergeSyncedWorkspace, syncMetaWorkspace } from "@/lib/meta";
import { readWorkspace, updateWorkspace } from "@/lib/store";

export async function POST() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const workspace = await readWorkspace(session.workspaceId);
    if (workspace.metaConnection.status !== "connected") return NextResponse.json({ demo: true, message: "Los datos demo ya están actualizados" });
    const synced = await syncMetaWorkspace(workspace);
    await updateWorkspace(session.workspaceId, (current) => mergeSyncedWorkspace(current, synced));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible sincronizar" }, { status: 500 });
  }
}
