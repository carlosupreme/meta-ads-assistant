import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoData } from "../lib/demo-data.ts";
import { buildClientReport, renderReportEmail } from "../lib/report.ts";
import type { AgentAction, WorkspaceData } from "../lib/types.ts";

const now = new Date(2026, 8, 13, 12);
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

function action(overrides: Partial<AgentAction>): AgentAction {
  return {
    id: "a", organizationId: "org-casa-norte", agent: "Presupuesto", type: "decrease_budget", campaignId: "cmp-3",
    campaignName: "Advantage+ · Catálogo", fromBudget: 720, toBudget: 576, reason: "ROAS por debajo de la meta", impact: "—",
    source: "rules", status: "executed", createdAt: daysAgo(1), resolvedAt: daysAgo(1), ...overrides,
  };
}

describe("client report", () => {
  it("summarizes the last seven daily points against the ones before", () => {
    const report = buildClientReport(structuredClone(demoData), "org-casa-norte", now);
    const points = demoData.metrics["org-casa-norte"];
    assert.ok(report);
    assert.equal(report.week.points.length, 7);
    assert.equal(report.week.spend, points.slice(-7).reduce((total, point) => total + point.spend, 0));
    assert.equal(report.week.previousSpend, points.slice(0, -7).reduce((total, point) => total + point.spend, 0));
    assert.ok(report.campaigns.every((campaign, index, list) => index === 0 || list[index - 1].spend >= campaign.spend), "sorted by spend");
  });

  it("returns nothing for a business outside the workspace", () => {
    assert.equal(buildClientReport(structuredClone(demoData), "otro-negocio", now), null);
  });

  it("counts agent work inside the period and keeps manual changes out of highlights", () => {
    const workspace: WorkspaceData = {
      ...structuredClone(demoData),
      actions: [
        action({ id: "budget" }),
        action({ id: "pause", type: "pause_ad", adId: "ad-1b", adName: "Detalle madera", fromBudget: undefined, toBudget: undefined }),
        action({ id: "manual", type: "pause_campaign", source: "user", fromBudget: undefined, toBudget: undefined }),
        action({ id: "old", createdAt: daysAgo(30), resolvedAt: daysAgo(30) }),
        action({ id: "blocked", status: "blocked" }),
      ],
    };
    const work = buildClientReport(workspace, "org-casa-norte", now)?.agentWork;
    assert.equal(work?.executed, 3);
    assert.equal(work?.budgetChanges, 1);
    assert.equal(work?.pauses, 2);
    assert.equal(work?.blocked, 1);
    assert.equal(work?.highlights.length, 2);
  });

  it("uses the workspace branding and falls back to Pulso", () => {
    assert.equal(buildClientReport(structuredClone(demoData), "org-casa-norte", now)?.branding.agencyName, "Pulso AI");
    const branded: WorkspaceData = { ...structuredClone(demoData), branding: { agencyName: "Agencia Norte", accentColor: "#0f766e" } };
    assert.deepEqual(buildClientReport(branded, "org-casa-norte", now)?.branding, { agencyName: "Agencia Norte", accentColor: "#0f766e" });
  });

  it("escapes client data in the weekly email and links to the report", () => {
    const workspace = structuredClone(demoData);
    workspace.organizations[0].name = "<script>alert(\"x\")</script>";
    const report = buildClientReport(workspace, "org-casa-norte", now);
    assert.ok(report);
    const { subject, html } = renderReportEmail(report, "https://pulso.test/r/abc");
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes("https://pulso.test/r/abc"));
    assert.match(subject, /Resumen semanal/);
  });

  it("shows what Pulso watched and tells a quiet week as good news", () => {
    const today = now.toISOString().slice(0, 10);
    const workspace: WorkspaceData = {
      ...structuredClone(demoData),
      actions: [],
      monitoring: { "org-casa-norte": [{ date: today, runs: 24, campaignsChecked: 3, adsChecked: 5, anomalies: 0, blocked: 0, executed: 0, lastRunAt: now.toISOString() }] },
    };
    const report = buildClientReport(workspace, "org-casa-norte", now);
    assert.ok(report);
    assert.equal(report.monitoring.runs, 24);
    const { html } = renderReportEmail(report, "https://pulso.test/r/abc");
    assert.match(html, /revisó tu cuenta 24 veces, vigiló 5 anuncios en 3 campañas/);
    assert.match(html, /no hizo falta intervenir/);
  });
});
