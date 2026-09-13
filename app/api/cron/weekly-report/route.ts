import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron";
import { emailConfigured } from "@/lib/email";
import { deliverReport } from "@/lib/report-delivery";
import { listWorkspaceIds, readWorkspace } from "@/lib/store";

export const maxDuration = 300;

// A little under a week, so a delayed run does not skip the next Monday.
const MIN_INTERVAL_MS = 6 * 86_400_000;

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!emailConfigured()) return NextResponse.json({ ok: true, skipped: "Resend no está configurado." });

  let sent = 0;
  let skipped = 0;
  const failures: Array<{ workspaceId: string; organizationId: string; error: string }> = [];
  for (const workspaceId of await listWorkspaceIds()) {
    const workspace = await readWorkspace(workspaceId).catch(() => null);
    if (!workspace) continue;
    for (const organization of workspace.organizations) {
      const settings = organization.report;
      if (!settings?.weeklyEmail || !settings.clientEmails.length) continue;
      if (settings.lastSentAt && Date.now() - Date.parse(settings.lastSentAt) < MIN_INTERVAL_MS) {
        skipped += 1;
        continue;
      }
      try {
        await deliverReport(workspaceId, organization.id, { request });
        sent += 1;
      } catch (error) {
        failures.push({ workspaceId, organizationId: organization.id, error: error instanceof Error ? error.message : "No se envió" });
      }
    }
  }
  return NextResponse.json({ ok: failures.length === 0, sent, skipped, failures });
}
