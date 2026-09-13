import { sendEmail } from "./email";
import { buildClientReport, renderReportEmail } from "./report";
import { getReportLink, readWorkspace, rotateReportLink, updateWorkspace } from "./store";

export function reportUrl(token: string, request?: Request): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || (request ? new URL(request.url).origin : "");
  if (!base) throw new Error("Falta NEXT_PUBLIC_APP_URL para generar el enlace del reporte.");
  return `${base.replace(/\/$/, "")}/r/${token}`;
}

/** Emails the weekly summary to every client address of a business and records when it was sent. */
export async function deliverReport(
  workspaceId: string,
  organizationId: string,
  options: { request?: Request; manual?: boolean; now?: Date } = {},
): Promise<{ sentTo: number }> {
  const now = options.now ?? new Date();
  const workspace = await readWorkspace(workspaceId);
  const organization = workspace.organizations.find((item) => item.id === organizationId);
  const report = buildClientReport(workspace, organizationId, now);
  if (!organization || !report) throw new Error("Negocio no encontrado.");
  const recipients = organization.report?.clientEmails ?? [];
  if (!recipients.length) throw new Error("Agrega al menos un correo de cliente.");

  const link = (await getReportLink(workspaceId, organizationId)) ?? (await rotateReportLink(workspaceId, organizationId));
  const { subject, html } = renderReportEmail(report, reportUrl(link.token, options.request));
  const day = now.toISOString().slice(0, 10);
  for (const email of recipients) {
    // One message per person keeps client addresses private; the key stops duplicates when the cron retries.
    await sendEmail({ to: [email], subject, html, idempotencyKey: options.manual ? undefined : `weekly-${organizationId}-${day}-${email}` });
  }
  await updateWorkspace(workspaceId, (current) => ({
    ...current,
    organizations: current.organizations.map((item) => item.id === organizationId && item.report
      ? { ...item, report: { ...item.report, lastSentAt: now.toISOString() } }
      : item),
  }));
  return { sentTo: recipients.length };
}
