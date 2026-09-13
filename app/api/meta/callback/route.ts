import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { encryptSecret } from "@/lib/crypto";
import { exchangeCode, fetchMetaIdentity, mergeSyncedWorkspace, syncMetaWorkspace } from "@/lib/meta";
import { updateWorkspace } from "@/lib/store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || url.origin;
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
    const connected = await updateWorkspace((current) => ({
      ...current,
      metaConnection: {
        status: "connected",
        userName: identity.name,
        connectedAt: new Date().toISOString(),
        lastSyncAt: new Date().toISOString(),
        encryptedAccessToken: encryptSecret(token),
      },
    }));
    const synced = await syncMetaWorkspace(connected);
    await updateWorkspace((current) => mergeSyncedWorkspace(current, synced));
    const response = NextResponse.redirect(`${appUrl}/?connection=success`);
    response.cookies.delete("meta_oauth_state");
    return response;
  } catch (callbackError) {
    console.error(callbackError);
    return NextResponse.redirect(`${appUrl}/?connection=error`);
  }
}
