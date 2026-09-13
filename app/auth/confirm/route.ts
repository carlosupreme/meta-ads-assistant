import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Handles both email link styles: PKCE `code` (default template) and `token_hash` (custom template).
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const supabase = await createSupabaseServerClient();

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : { error: new Error("Enlace incompleto") };

  if (!error) return NextResponse.redirect(new URL(safeRedirectPath(searchParams.get("next")), request.url));
  const login = new URL("/login", request.url);
  login.searchParams.set("error", "El enlace expiró o ya fue usado. Inicia sesión o crea la cuenta de nuevo.");
  return NextResponse.redirect(login);
}
