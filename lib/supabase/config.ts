// Edge-safe: imported by middleware, so no Node APIs or Supabase clients here.

// Server-only names come first: Next.js inlines NEXT_PUBLIC_* at build time, so values provided only
// at runtime (containers, some hosts) would be invisible to the middleware.
export function supabaseAuthConfig(): { url: string; publishableKey: string } | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && publishableKey ? { url, publishableKey } : null;
}

const hasDatabaseConfig = () => Boolean(
  process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
);

/**
 * "supabase": login required, one workspace per user.
 * "local": single-user development without login. Never allowed in production.
 * "misconfigured": production without Supabase Auth; every request is refused.
 */
export function authMode(): "supabase" | "local" | "misconfigured" {
  if (supabaseAuthConfig() && hasDatabaseConfig()) return "supabase";
  return process.env.NODE_ENV === "production" ? "misconfigured" : "local";
}

/** Only same-origin relative paths are valid post-login destinations. */
export function safeRedirectPath(path: string | null | undefined): string {
  return path && path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/";
}
