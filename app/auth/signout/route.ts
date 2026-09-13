import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { authMode } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (authMode() === "supabase") {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  revalidatePath("/", "layout");
  // 303 turns the form POST into a GET of the login page.
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
