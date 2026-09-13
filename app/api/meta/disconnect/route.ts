import { NextResponse } from "next/server";
import { updateWorkspace } from "@/lib/store";

export async function POST() {
  await updateWorkspace((current) => ({
    ...current,
    metaConnection: { status: "disconnected" },
    organizations: current.organizations.map((organization) => ({ ...organization, connected: false })),
  }));
  return NextResponse.json({ success: true });
}
