import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getWorkspaceSession } from "@/lib/auth";
import { toSafeWorkspace } from "@/lib/safe-workspace";
import { readWorkspace } from "@/lib/store";
import { authMode } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getWorkspaceSession();
  if (!session) {
    if (authMode() === "misconfigured") return <div className="empty-state">Pulso requiere Supabase Auth en producción.</div>;
    redirect("/login");
  }
  return <AppShell initialData={toSafeWorkspace(await readWorkspace(session.workspaceId))} account={session.user} />;
}
