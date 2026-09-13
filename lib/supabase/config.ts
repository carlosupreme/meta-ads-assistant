// Edge-safe: imported by middleware, so no Node APIs or Supabase clients here.
// Variables are read at runtime (no NEXT_PUBLIC_ prefix), so they work even when only set on the host.

export function supabaseAuthConfig(): { url: string; publishableKey: string } | null {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  return url && publishableKey ? { url, publishableKey } : null;
}

/** Pulso requires Supabase for both auth and data; without it every protected request is refused. */
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseAuthConfig() && process.env.SUPABASE_SECRET_KEY);
}

/** Only same-origin relative paths are valid post-login destinations. */
export function safeRedirectPath(path: string | null | undefined): string {
  return path && path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/";
}
