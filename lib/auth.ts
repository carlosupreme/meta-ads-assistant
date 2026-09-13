import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "./supabase/config";
import { createSupabaseServerClient } from "./supabase/server";
import { findOrCreateWorkspace, type WorkspaceOwner } from "./store";

export interface WorkspaceSession {
  workspaceId: string;
  user: WorkspaceOwner;
}

/** Resolves the workspace for the current request from the verified Supabase session. */
export async function getWorkspaceSession(): Promise<WorkspaceSession | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  // getClaims verifies the JWT signature; getSession alone would trust the cookie.
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  const email = typeof claims.email === "string" ? claims.email : "";
  const metadata = (claims.user_metadata ?? {}) as { full_name?: unknown };
  const fullName = typeof metadata.full_name === "string" ? metadata.full_name.trim() : "";
  const user: WorkspaceOwner = { id: claims.sub, email, name: fullName || email.split("@")[0] || "Usuario" };
  return { workspaceId: await findOrCreateWorkspace(user), user };
}

/** For route handlers: the session, or the response to return when there is none. */
export async function requireApiSession(): Promise<WorkspaceSession | NextResponse> {
  const session = await getWorkspaceSession();
  if (session) return session;
  return isSupabaseConfigured()
    ? NextResponse.json({ error: "Inicia sesión para continuar." }, { status: 401 })
    : NextResponse.json({ error: "Supabase no está configurado en el servidor." }, { status: 503 });
}
