import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, supabaseAuthConfig } from "@/lib/supabase/config";

// Crons authenticate with CRON_SECRET; login, email confirmation, shared client reports (/r/<token>)
// and public landing page (/landing) must work signed out.
const PUBLIC_PREFIXES = ["/login", "/auth/", "/api/cron/", "/r/", "/landing"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isPublic = PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const config = supabaseAuthConfig();

  if (!isSupabaseConfigured() || !config) {
    if (isPublic || pathname === "/") return NextResponse.next();
    return isApi
      ? NextResponse.json({ error: "Supabase no está configurado en el servidor." }, { status: 503 })
      : new NextResponse("Pulso requiere Supabase. Revisa las variables de entorno.", { status: 503 });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Refreshes an expiring session and verifies the token.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const redirectTo = (url: URL) => {
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  if (!signedIn && !isPublic) {
    if (pathname === "/") return response;
    if (isApi) return NextResponse.json({ error: "Inicia sesión para continuar." }, { status: 401 });
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return redirectTo(login);
  }
  if (signedIn && pathname === "/login") return redirectTo(new URL("/", request.url));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
