// Client-facing report built from stored workspace data. No Node APIs, so it runs under `node --test`.
import { describeAction, formatMoney } from "./optimizer.ts";
import type { Branding, Campaign, MetricPoint, Organization, WorkspaceData } from "./types";

export const DEFAULT_BRANDING: Branding = { agencyName: "Pulso AI", accentColor: "#7056e8" };
const REPORT_DAYS = 7;
const DAY_MS = 86_400_000;

export interface ClientReport {
  organization: Pick<Organization, "id" | "name" | "objective" | "monthlyLimit">;
  branding: Branding;
  generatedAt: string;
  periodLabel: string;
  month: { spend: number; revenue: number; roas: number; results: number; budgetUsed: number };
  week: {
    spend: number;
    revenue: number;
    roas: number;
    previousSpend: number;
    previousRevenue: number;
    points: Array<Pick<MetricPoint, "date" | "spend" | "revenue">>;
  };
  campaigns: Array<Pick<Campaign, "name" | "status" | "spend" | "results" | "costPerResult" | "roas" | "dailyBudget">>;
  agentWork: {
    executed: number;
    budgetChanges: number;
    pauses: number;
    resumes: number;
    blocked: number;
    highlights: Array<{ title: string; reason: string; at: string }>;
  };
}

const sum = (points: MetricPoint[], key: "spend" | "revenue") => points.reduce((total, point) => total + point[key], 0);

export function buildClientReport(workspace: WorkspaceData, organizationId: string, now: Date): ClientReport | null {
  const organization = workspace.organizations.find((item) => item.id === organizationId);
  if (!organization) return null;
  const campaigns = workspace.campaigns.filter((campaign) => campaign.organizationId === organizationId);
  const points = workspace.metrics[organizationId] ?? [];
  const recent = points.slice(-REPORT_DAYS);
  const previous = points.slice(-REPORT_DAYS * 2, -REPORT_DAYS);
  const weekSpend = sum(recent, "spend");
  const weekRevenue = sum(recent, "revenue");

  const since = now.getTime() - REPORT_DAYS * DAY_MS;
  const inPeriod = workspace.actions.filter((action) => action.organizationId === organizationId && Date.parse(action.resolvedAt ?? action.createdAt) >= since);
  const executed = inPeriod.filter((action) => action.status === "executed");
  const ofTypes = (...types: string[]) => executed.filter((action) => types.includes(action.type)).length;

  return {
    organization: { id: organization.id, name: organization.name, objective: organization.objective, monthlyLimit: organization.monthlyLimit },
    branding: { ...DEFAULT_BRANDING, ...workspace.branding },
    generatedAt: now.toISOString(),
    periodLabel: `Últimos ${REPORT_DAYS} días`,
    month: {
      spend: organization.spentThisMonth,
      revenue: organization.revenueThisMonth,
      roas: organization.spentThisMonth ? organization.revenueThisMonth / organization.spentThisMonth : 0,
      results: campaigns.reduce((total, campaign) => total + campaign.results, 0),
      budgetUsed: organization.monthlyLimit ? organization.spentThisMonth / organization.monthlyLimit : 0,
    },
    week: {
      spend: weekSpend,
      revenue: weekRevenue,
      roas: weekSpend ? weekRevenue / weekSpend : 0,
      previousSpend: sum(previous, "spend"),
      previousRevenue: sum(previous, "revenue"),
      points: recent.map(({ date, spend, revenue }) => ({ date, spend, revenue })),
    },
    campaigns: campaigns
      .filter((campaign) => campaign.status !== "DRAFT")
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 10)
      .map(({ name, status, spend, results, costPerResult, roas, dailyBudget }) => ({ name, status, spend, results, costPerResult, roas, dailyBudget })),
    agentWork: {
      executed: executed.length,
      budgetChanges: ofTypes("increase_budget", "decrease_budget"),
      pauses: ofTypes("pause_campaign", "pause_ad"),
      resumes: ofTypes("resume_campaign", "resume_ad"),
      blocked: inPeriod.filter((action) => action.status === "blocked").length,
      // Highlights show the agents' own work; manual changes stay in the internal log.
      highlights: executed
        .filter((action) => action.source !== "user")
        .slice(0, 6)
        .map((action) => {
          const title = describeAction(action);
          return { title: title.charAt(0).toUpperCase() + title.slice(1), reason: action.reason, at: action.resolvedAt ?? action.createdAt };
        }),
    },
  };
}

export function percentChange(current: number, previous: number): number | null {
  return previous ? ((current - previous) / previous) * 100 : null;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);

/** Email-client-safe HTML (tables and inline styles). Every client-provided value is escaped. */
export function renderReportEmail(report: ClientReport, reportUrl: string): { subject: string; html: string } {
  const e = escapeHtml;
  const accent = e(report.branding.accentColor);
  const kpi = (label: string, value: string) =>
    `<td style="padding:12px;border:1px solid #e7e7ed;border-radius:8px;width:33%"><div style="color:#81838f;font-size:13px">${e(label)}</div><div style="font-size:22px;font-weight:700;margin-top:4px">${e(value)}</div></td>`;
  const rows = report.campaigns.slice(0, 3).map((campaign) =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f3">${e(campaign.name)}</td><td style="padding:8px 0;border-bottom:1px solid #f0f0f3;text-align:right">${e(formatMoney(campaign.spend))}</td><td style="padding:8px 0;border-bottom:1px solid #f0f0f3;text-align:right">${campaign.roas.toFixed(2)}×</td></tr>`).join("");
  const work = report.agentWork;
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f5f5f8;font-family:Arial,Helvetica,sans-serif;color:#171821">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${accent};color:#ffffff;padding:24px">
<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.85">${e(report.branding.agencyName)}</div>
<div style="font-size:24px;font-weight:700;margin-top:6px">${e(report.organization.name)}</div>
<div style="font-size:14px;opacity:.85;margin-top:4px">Resumen de publicidad · ${e(report.periodLabel)}</div>
</td></tr>
<tr><td style="padding:20px 24px">
<table role="presentation" width="100%" cellspacing="8"><tr>${kpi("Inversión", formatMoney(report.week.spend))}${kpi("Ingresos atribuidos", formatMoney(report.week.revenue))}${kpi("ROAS", `${report.week.roas.toFixed(2)}×`)}</tr></table>
<p style="font-size:14px;line-height:1.5;color:#585a66;margin:16px 0">En el mes llevan ${e(formatMoney(report.month.spend))} de un límite de ${e(formatMoney(report.organization.monthlyLimit))} (${Math.round(report.month.budgetUsed * 100)}%). Esta semana los agentes hicieron ${work.executed} ${work.executed === 1 ? "cambio" : "cambios"}: ${work.budgetChanges} de presupuesto, ${work.pauses} pausas y ${work.resumes} reactivaciones.</p>
${rows ? `<table role="presentation" width="100%" style="font-size:14px"><tr><th align="left" style="color:#9a9ba4;font-size:12px">Campaña</th><th align="right" style="color:#9a9ba4;font-size:12px">Inversión del mes</th><th align="right" style="color:#9a9ba4;font-size:12px">ROAS</th></tr>${rows}</table>` : ""}
<p style="margin:24px 0 8px;text-align:center"><a href="${e(reportUrl)}" style="background:${accent};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;display:inline-block">Ver reporte completo</a></p>
</td></tr>
<tr><td style="padding:16px 24px;color:#9899a2;font-size:12px;text-align:center;border-top:1px solid #f0f0f3">Preparado por ${e(report.branding.agencyName)}. Datos reportados por Meta; los ingresos son atribuidos.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: `${report.organization.name} · Resumen semanal de publicidad`, html };
}
