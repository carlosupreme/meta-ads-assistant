"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeRedirectPath } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  name: z.string().trim().max(80).optional(),
  next: z.string().optional(),
});

function backToLogin(params: Record<string, string>): never {
  redirect(`/login?${new URLSearchParams(params)}`);
}

function friendlyError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Correo o contraseña incorrectos.";
  if (/email not confirmed/i.test(message)) return "Confirma tu correo antes de entrar.";
  if (/already registered/i.test(message)) return "Ya existe una cuenta con ese correo.";
  return message;
}

export async function signIn(formData: FormData) {
  const parsed = credentialsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backToLogin({ error: "Revisa tu correo y contraseña (mínimo 8 caracteres)." });
  const { email, password, next } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) backToLogin({ error: friendlyError(error.message), ...(next && { next }) });
  revalidatePath("/", "layout");
  redirect(safeRedirectPath(next));
}

export async function signUp(formData: FormData) {
  const parsed = credentialsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) backToLogin({ mode: "signup", error: "Usa un correo válido y una contraseña de al menos 8 caracteres." });
  const { email, password, name } = parsed.data;
  const origin = process.env.NEXT_PUBLIC_APP_URL || (await headers()).get("origin") || "";
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: name }, emailRedirectTo: `${origin}/auth/confirm` },
  });
  if (error) backToLogin({ mode: "signup", error: friendlyError(error.message) });
  if (data.session) {
    // Email confirmation is disabled in the project: the user is already signed in.
    revalidatePath("/", "layout");
    redirect("/");
  }
  backToLogin({ message: "Te enviamos un correo para confirmar tu cuenta." });
}
