import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getWorkspaceSession } from "@/lib/auth";
import { toSafeWorkspace } from "@/lib/safe-workspace";
import { readWorkspace } from "@/lib/store";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getWorkspaceSession();
  if (!session) {
    if (!isSupabaseConfigured()) return <div className="empty-state">Pulso requiere Supabase. Revisa las variables de entorno.</div>;
    redirect("/login");
  }
  return <AppShell initialData={toSafeWorkspace(await readWorkspace(session.workspaceId))} account={session.user} />;
}
