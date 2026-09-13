import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getWorkspaceSession } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { exchangeCode, fetchMetaIdentity, syncMetaWorkspace } from "@/lib/meta";
import { readWorkspace, updateWorkspace } from "@/lib/store";
import type { WorkspaceData } from "@/lib/types";
import { applyMetaConnection, clearDemoData } from "@/lib/workspace";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || url.origin;
  // The Meta token is stored in the workspace of whoever started the connection.
  const session = await getWorkspaceSession();
  if (!session) return NextResponse.redirect(`${appUrl}/login`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error_description");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("meta_oauth_state")?.value;
  if (error) return NextResponse.redirect(`${appUrl}/?connection=denied`);
  if (!code || !state || !expectedState || state !== expectedState) return NextResponse.redirect(`${appUrl}/?connection=invalid-state`);
  try {
    const token = await exchangeCode(code, `${appUrl}/api/meta/callback`);
    const identity = await fetchMetaIdentity(token);
    const now = new Date().toISOString();
    const connection: WorkspaceData["metaConnection"] = {
      status: "connected",
      userName: identity.name,
      connectedAt: now,
      lastSyncAt: now,
      encryptedAccessToken: encryptSecret(token),
    };
    // Sync before persisting anything: if Meta fails, the workspace keeps its previous state.
    const snapshot = await readWorkspace(session.workspaceId);
    const base = snapshot.metaConnection.status === "demo" ? clearDemoData(snapshot) : snapshot;
    const synced = await syncMetaWorkspace({ ...base, metaConnection: connection });
    await updateWorkspace(session.workspaceId, (current) => applyMetaConnection(current, connection, synced));
    const response = NextResponse.redirect(`${appUrl}/?connection=success`);
    response.cookies.delete("meta_oauth_state");
    return response;
  } catch (callbackError) {
    console.error(callbackError);
    return NextResponse.redirect(`${appUrl}/?connection=error`);
  }
}
