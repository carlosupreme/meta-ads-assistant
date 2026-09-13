import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatMoney } from "@/lib/optimizer";
import { buildClientReport, monitoringSentence, outcomeSentence, percentChange, type ClientReport } from "@/lib/report";
import { findReportLink, readWorkspace } from "@/lib/store";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reporte de publicidad", robots: { index: false, follow: false } };

const STATUS_LABELS: Record<string, string> = { ACTIVE: "Activa", PAUSED: "Pausada", DRAFT: "Borrador" };

function Change({ current, previous }: { current: number; previous: number }) {
  const change = percentChange(current, previous);
  if (change === null) return <small>Sin periodo previo para comparar</small>;
  return <small className={change >= 0 ? "up" : "down"}>{change >= 0 ? "+" : ""}{change.toFixed(1)}% vs. 7 días previos</small>;
}

function DailyChart({ points, accent }: { points: ClientReport["week"]["points"]; accent: string }) {
  if (!points.length) return <p className="report-empty">Aún no hay datos diarios para este periodo.</p>;
  const width = 720;
  const height = 200;
  const pad = { left: 8, right: 8, top: 8, bottom: 26 };
  const chartHeight = height - pad.top - pad.bottom;
  const max = Math.max(1, ...points.flatMap((point) => [point.spend, point.revenue]));
  const slot = (width - pad.left - pad.right) / points.length;
  const barWidth = Math.min(24, slot / 3);
  return (
    <svg className="report-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Ingresos e inversión por día">
      {points.map((point, index) => {
        const center = pad.left + slot * index + slot / 2;
        const revenueHeight = (point.revenue / max) * chartHeight;
        const spendHeight = (point.spend / max) * chartHeight;
        return (
          <g key={`${point.date}-${index}`}>
            <rect x={center - barWidth - 1} y={pad.top + chartHeight - revenueHeight} width={barWidth} height={revenueHeight} rx="3" fill={accent} />
            <rect x={center + 1} y={pad.top + chartHeight - spendHeight} width={barWidth} height={spendHeight} rx="3" fill="#20b486" />
            <text x={center} y={height - 8} textAnchor="middle" fontSize="12" fill="#8b8d98">{point.date}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default async function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await findReportLink(token);
  if (!link) notFound();
  const workspace = await readWorkspace(link.workspaceId).catch(() => null);
  const report = workspace && buildClientReport(workspace, link.organizationId, new Date());
  if (!report) notFound();

  const { branding, week, month, agentWork, monitoring } = report;
  const watched = monitoringSentence(report);
  const generated = new Date(report.generatedAt).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });

  return (
    <main className="report-page" style={{ "--report-accent": branding.accentColor } as CSSProperties}>
      <header className="report-header">
        <div>
          <span>{branding.agencyName}</span>
          <h1>{report.organization.name}</h1>
          <p>Publicidad en Facebook e Instagram · {report.periodLabel} · Generado el {generated}</p>
        </div>
        <PrintButton />
      </header>

      <section className="report-kpis">
        <div className="report-kpi"><span>Inversión</span><strong>{formatMoney(week.spend)}</strong><Change current={week.spend} previous={week.previousSpend} /></div>
        <div className="report-kpi"><span>Ingresos atribuidos</span><strong>{formatMoney(week.revenue)}</strong><Change current={week.revenue} previous={week.previousRevenue} /></div>
        <div className="report-kpi"><span>ROAS</span><strong>{week.roas.toFixed(2)}×</strong><small>Ingresos por cada $1 invertido</small></div>
        <div className="report-kpi"><span>Presupuesto del mes</span><strong>{Math.round(month.budgetUsed * 100)}%</strong><small>{formatMoney(month.spend)} de {formatMoney(report.organization.monthlyLimit)}</small></div>
      </section>

      {watched && (
        <section className="report-panel">
          <h2>Monitoreo continuo</h2>
          <p className="report-monitoring-lead">{watched} {outcomeSentence(report)}</p>
          <div className="report-work">
            <div><b>{monitoring.runs}</b><span>Revisiones de la cuenta</span></div>
            <div><b>{monitoring.adsWatched}</b><span>Anuncios vigilados</span></div>
            <div><b>{monitoring.pacingChecks}</b><span>Verificaciones del ritmo de gasto</span></div>
            <div><b>{monitoring.anomalies}</b><span>Señales de riesgo detectadas</span></div>
          </div>
        </section>
      )}

      <section className="report-panel">
        <h2>Ingresos e inversión por día</h2>
        <div className="report-legend"><span><i style={{ background: branding.accentColor }} />Ingresos</span><span><i style={{ background: "#20b486" }} />Inversión</span></div>
        <DailyChart points={week.points} accent={branding.accentColor} />
      </section>

      <section className="report-panel">
        <h2>Campañas</h2>
        {report.campaigns.length ? (
          <div className="report-table-wrap">
            <table className="report-table">
              <thead><tr><th>Campaña</th><th>Estado</th><th className="num">Inversión del mes</th><th className="num">Resultados</th><th className="num">Costo por resultado</th><th className="num">ROAS</th></tr></thead>
              <tbody>
                {report.campaigns.map((campaign, index) => (
                  <tr key={`${campaign.name}-${index}`}>
                    <td>{campaign.name}</td>
                    <td>{STATUS_LABELS[campaign.status] ?? campaign.status}</td>
                    <td className="num">{formatMoney(campaign.spend)}</td>
                    <td className="num">{campaign.results}</td>
                    <td className="num">{campaign.costPerResult ? formatMoney(campaign.costPerResult) : "—"}</td>
                    <td className="num">{campaign.roas.toFixed(2)}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="report-empty">Todavía no hay campañas con actividad.</p>}
      </section>

      <section className="report-panel">
        <h2>Lo que hicieron los agentes</h2>
        <div className="report-work">
          <div><b>{agentWork.executed}</b><span>Cambios aplicados</span></div>
          <div><b>{agentWork.budgetChanges}</b><span>Ajustes de presupuesto</span></div>
          <div><b>{agentWork.pauses + agentWork.resumes}</b><span>Pausas y reactivaciones</span></div>
          <div><b>{agentWork.blocked}</b><span>Cambios frenados por límites</span></div>
        </div>
        {agentWork.highlights.length ? (
          <ul className="report-highlights">
            {agentWork.highlights.map((item, index) => <li key={`${item.at}-${index}`}><b>{item.title}</b><span>{item.reason}</span></li>)}
          </ul>
        ) : <p className="report-empty">Sin cambios automáticos en este periodo.</p>}
      </section>

      <p className="report-footer-note">Preparado por {branding.agencyName}. Datos reportados por Meta; los ingresos son atribuidos por la plataforma.</p>
    </main>
  );
}
