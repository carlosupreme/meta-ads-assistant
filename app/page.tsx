import { AppShell } from "@/components/app-shell";
import { toSafeWorkspace } from "@/lib/safe-workspace";
import { readWorkspace } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  return <AppShell initialData={toSafeWorkspace(await readWorkspace())} />;
}
