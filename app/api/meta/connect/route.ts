import crypto from "node:crypto";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const appId = process.env.META_APP_ID;
  if (!appId) return NextResponse.redirect(new URL("/?connection=missing-config", request.url));
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const redirectUri = `${appUrl}/api/meta/callback`;
  const state = crypto.randomBytes(24).toString("base64url");
  const version = process.env.META_GRAPH_VERSION || "v26.0";
  const authorize = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
  authorize.searchParams.set("client_id", appId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "ads_read,ads_management,business_management,pages_show_list,pages_read_engagement,instagram_basic");
  const response = NextResponse.redirect(authorize);
  response.cookies.set("meta_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
  return response;
}
