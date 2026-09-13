import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { updateWorkspace } from "@/lib/store";

export async function POST() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  await updateWorkspace(session.workspaceId, (current) => ({
    ...current,
    metaConnection: { status: "disconnected" },
    organizations: current.organizations.map((organization) => ({ ...organization, connected: false })),
  }));
  return NextResponse.json({ success: true });
}
