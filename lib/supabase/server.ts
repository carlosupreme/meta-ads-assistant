import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAuthConfig } from "./config";

/** Auth client bound to the request cookies. Uses the publishable key, never the secret key. */
export async function createSupabaseServerClient() {
  const config = supabaseAuthConfig();
  if (!config) throw new Error("Supabase Auth no está configurado");
  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; the middleware already refreshed the session.
        }
      },
    },
  });
}
