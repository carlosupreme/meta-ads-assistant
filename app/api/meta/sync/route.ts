import { NextResponse } from "next/server";
import { mergeSyncedWorkspace, syncMetaWorkspace } from "@/lib/meta";
import { readWorkspace, updateWorkspace } from "@/lib/store";

export async function POST() {
  try {
    const workspace = await readWorkspace();
    if (workspace.metaConnection.status !== "connected") return NextResponse.json({ demo: true, message: "Los datos demo ya están actualizados" });
    const synced = await syncMetaWorkspace(workspace);
    await updateWorkspace((current) => mergeSyncedWorkspace(current, synced));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible sincronizar" }, { status: 500 });
  }
}
