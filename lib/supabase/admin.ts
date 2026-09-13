import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

let adminClient: SupabaseClient<Database> | undefined;

/** Server-only client. It bypasses RLS, so every query must filter by the session's workspace. */
export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (adminClient) return adminClient;
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) throw new Error("Faltan SUPABASE_URL o SUPABASE_SECRET_KEY");
  adminClient = createClient<Database>(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: { headers: { "x-application-name": "pulso-ai" } },
  });
  return adminClient;
}
