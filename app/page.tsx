import { AppShell } from "@/components/app-shell";
import { LandingPage } from "@/components/landing-page";
import { getWorkspaceSession } from "@/lib/auth";
import { toSafeWorkspace } from "@/lib/safe-workspace";
import { readWorkspace } from "@/lib/store";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!isSupabaseConfigured()) {
    return <LandingPage />;
  }
  const session = await getWorkspaceSession();
  if (!session) {
    return <LandingPage />;
  }
  return <AppShell initialData={toSafeWorkspace(await readWorkspace(session.workspaceId))} account={session.user} />;
}
