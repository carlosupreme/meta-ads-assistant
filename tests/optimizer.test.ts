import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionsFromAi, checkGuardrails, commitAgentRun, lastStatusChanges, monitoringSummary, planRuleActions, projectedMonthSpend, recordAction, resolveProposals,
} from "../lib/optimizer.ts";
import type { Ad, AgentAction, Campaign, Organization, WorkspaceData } from "../lib/types.ts";

// September has 30 days, so on the 13th there are 18 days left counting today.
const now = new Date(2026, 8, 13, 12);

function organization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: "org", name: "Negocio", initials: "NG", color: "#000", pageName: "Página", instagramHandle: "@negocio",
    adAccountId: "act_1", currency: "MXN", objective: "Ventas", mode: "autonomous", monthlyLimit: 100_000,
    targetRoas: 3, spentThisMonth: 10_000, revenueThisMonth: 40_000, resultValue: 0, connected: true, ...overrides,
  };
}

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "c1", organizationId: "org", name: "Campaña", status: "ACTIVE", objective: "Ventas", channel: "Facebook",
    spend: 5_000, results: 20, costPerResult: 250, revenue: 20_000, roas: 4, trend: 0, dailyBudget: 1_000,
    budgetLevel: "campaign", updatedAt: "Ahora", ...overrides,
  };
}

function ad(overrides: Partial<Ad> = {}): Ad {
  return {
    id: "a1", organizationId: "org", campaignId: "c1", adSetId: "s1", name: "Anuncio", status: "ACTIVE",
    spend: 1_000, impressions: 10_000, clicks: 150, ctr: 1.5, frequency: 2, results: 5, revenue: 5_000, ...overrides,
  };
}

function budgetAction(overrides: Partial<AgentAction> = {}): AgentAction {
  return {
    id: "x", organizationId: "org", agent: "Presupuesto", type: "increase_budget", campaignId: "c1", campaignName: "Campaña",
    fromBudget: 1_000, toBudget: 1_150, reason: "Prueba de guardrails", impact: "—", source: "rules", status: "recommended",
    createdAt: now.toISOString(), ...overrides,
  };
}

function workspace(overrides: Partial<WorkspaceData> = {}): WorkspaceData {
  return {
    user: { name: "Test", email: "test@example.com" }, metaConnection: { status: "demo" },
    organizations: [organization()], campaigns: [campaign()], ads: [], metrics: {}, activities: [], alerts: [],
    creatives: [], actions: [], budgetChanges: [], ...overrides,
  };
}

const context = (overrides: Partial<Parameters<typeof checkGuardrails>[1]> = {}) => ({
  organization: organization(), campaigns: [campaign()], ads: [], budgetChanges: [], now, ...overrides,
});

describe("guardrails", () => {
  it("allows a change within 20% and the monthly limit", () => {
    assert.deepEqual(checkGuardrails(budgetAction(), context()), { allowed: true });
  });

  it("measures the 20% cap against the budget before recent changes", () => {
    const earlier = { campaignId: "c1", organizationId: "org", from: 1_000, to: 1_150, at: new Date(now.getTime() - 3_600_000).toISOString() };
    const result = checkGuardrails(
      budgetAction({ fromBudget: 1_150, toBudget: 1_300 }),
      context({ campaigns: [campaign({ dailyBudget: 1_150 })], budgetChanges: [earlier] }),
    );
    assert.equal(result.allowed, false);
  });

  it("forgets changes older than 24 hours", () => {
    const old = { campaignId: "c1", organizationId: "org", from: 800, to: 1_000, at: new Date(now.getTime() - 30 * 3_600_000).toISOString() };
    assert.equal(checkGuardrails(budgetAction(), context({ budgetChanges: [old] })).allowed, true);
  });

  it("blocks increases whose month-end projection exceeds the limit", () => {
    // 10,000 spent + 1,150 × 18 days = 30,700 > 30,000.
    const result = checkGuardrails(budgetAction(), context({ organization: organization({ monthlyLimit: 30_000 }) }));
    assert.equal(result.allowed, false);
  });

  it("never manages lifetime budgets", () => {
    const result = checkGuardrails(budgetAction(), context({ campaigns: [campaign({ budgetLevel: "none" })] }));
    assert.equal(result.allowed, false);
  });

  it("refuses to pause the last active ad of an ad set", () => {
    const action = budgetAction({ type: "pause_ad", adId: "a1", adName: "Anuncio", fromBudget: undefined, toBudget: undefined });
    assert.equal(checkGuardrails(action, context({ ads: [ad()] })).allowed, false);
    assert.equal(checkGuardrails(action, context({ ads: [ad(), ad({ id: "a2" })] })).allowed, true);
  });
});

describe("planner", () => {
  it("pauses every active campaign once the monthly limit is reached", () => {
    const org = organization({ spentThisMonth: 100_000 });
    const campaigns = [campaign(), campaign({ id: "c2" })];
    const actions = planRuleActions(workspace({ campaigns }), org, now);
    assert.deepEqual(actions.map((action) => [action.type, action.campaignId]), [["pause_campaign", "c1"], ["pause_campaign", "c2"]]);
  });

  it("trims the weakest campaign first when the pace would exceed the limit", () => {
    const org = organization({ monthlyLimit: 40_000 });
    const campaigns = [campaign({ id: "strong", roas: 5 }), campaign({ id: "weak", roas: 3.2 })];
    // 10,000 + 2,000 × 18 = 46,000 → 333/day over the limit.
    assert.ok(projectedMonthSpend(org, campaigns, now) > org.monthlyLimit);
    const [first] = planRuleActions(workspace({ campaigns }), org, now);
    assert.equal(first.campaignId, "weak");
    assert.equal(first.type, "decrease_budget");
    assert.ok((first.toBudget ?? 0) >= 800, "never cuts more than 20%");
  });

  it("does not scale while the projection is over the limit", () => {
    const org = organization({ monthlyLimit: 25_000 });
    const actions = planRuleActions(workspace({ campaigns: [campaign({ roas: 6 })] }), org, now);
    assert.ok(actions.every((action) => action.type !== "increase_budget"));
  });

  it("scales a campaign well above the ROAS target when there is room", () => {
    const actions = planRuleActions(workspace(), organization(), now);
    const increase = actions.find((action) => action.type === "increase_budget");
    assert.equal(increase?.toBudget, 1_150);
  });

  it("detects creative fatigue", () => {
    const ads = [ad({ id: "fresh", ctr: 2 }), ad({ id: "tired", ctr: 0.8, frequency: 4.5 }), ad({ id: "ok", ctr: 1.8 })];
    const actions = planRuleActions(workspace({ ads }), organization(), now);
    assert.ok(actions.some((action) => action.type === "pause_ad" && action.adId === "tired"));
  });

  it("skips targets that already have a pending proposal", () => {
    const pending = budgetAction({ status: "pending" });
    const actions = planRuleActions(workspace({ actions: [pending] }), organization(), now);
    assert.ok(actions.every((action) => action.campaignId !== "c1" || action.type === "pause_ad"));
  });
});

describe("resolution", () => {
  const proposals = () => [budgetAction({ id: "a" }), budgetAction({ id: "b", toBudget: 1_100 })];

  it("maps automation modes to statuses and ignores duplicates for the same target", () => {
    const state = { campaigns: [campaign()], ads: [], budgetChanges: [] };
    const statuses = (mode: Organization["mode"]) => resolveProposals(state, organization({ mode }), proposals(), now).map((action) => action.status);
    assert.deepEqual(statuses("observer"), ["recommended"]);
    assert.deepEqual(statuses("copilot"), ["pending"]);
    assert.deepEqual(statuses("autonomous"), ["executing"]);
  });

  it("drops AI proposals for campaigns outside the organization or with the wrong sign", () => {
    const state = { campaigns: [campaign()], ads: [] };
    const actions = actionsFromAi([
      { type: "increase_budget", campaignId: "c1", changePct: 20, reason: "Escalar ganador", impact: "+" },
      { type: "increase_budget", campaignId: "c1", changePct: -10, reason: "Signo incorrecto", impact: "-" },
      { type: "pause_campaign", campaignId: "unknown", reason: "No existe", impact: "-" },
    ], organization(), state, now);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].toBudget, 1_200);
  });

  it("commits executed changes, records budget history and expires stale proposals", () => {
    const stale = budgetAction({ id: "old", status: "pending", createdAt: new Date(now.getTime() - 72 * 3_600_000).toISOString() });
    const executed = budgetAction({ id: "new", status: "executed" });
    const next = commitAgentRun(workspace({ actions: [stale] }), { actions: [executed], insights: [] }, now);
    assert.equal(next.campaigns[0].dailyBudget, 1_150);
    assert.equal(next.budgetChanges.length, 1);
    assert.equal(next.actions.find((action) => action.id === "old")?.status, "expired");
  });
});

describe("resume", () => {
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const pause = (overrides: Partial<AgentAction>): AgentAction => budgetAction({
    type: "pause_campaign", agent: "Supervisor", trigger: "limit", status: "executed", fromBudget: undefined, toBudget: undefined, ...overrides,
  });

  it("allows resuming a paused campaign only while the month has room", () => {
    const action = budgetAction({ type: "resume_campaign", fromBudget: undefined, toBudget: undefined });
    const paused = [campaign({ status: "PAUSED" })];
    assert.equal(checkGuardrails(action, context({ campaigns: paused })).allowed, true);
    // 10,000 + 1,000 × 18 = 28,000 > 25,000.
    assert.equal(checkGuardrails(action, context({ campaigns: paused, organization: organization({ monthlyLimit: 25_000 }) })).allowed, false);
    assert.equal(checkGuardrails(action, context()).allowed, false, "an active campaign cannot be resumed");
  });

  it("resumes campaigns paused by the monthly limit once a new month starts", () => {
    const campaigns = [campaign({ status: "PAUSED" })];
    const lastMonth = planRuleActions(workspace({ campaigns, actions: [pause({ createdAt: daysAgo(14), resolvedAt: daysAgo(14) })] }), organization(), now);
    assert.ok(lastMonth.some((action) => action.type === "resume_campaign" && action.campaignId === "c1"));
    const thisMonth = planRuleActions(workspace({ campaigns, actions: [pause({ createdAt: daysAgo(2), resolvedAt: daysAgo(2) })] }), organization(), now);
    assert.ok(thisMonth.every((action) => action.type !== "resume_campaign"));
  });

  it("never undoes a pause made by the user", () => {
    const campaigns = [campaign({ status: "PAUSED" })];
    const actions = [
      pause({ id: "user", source: "user", trigger: "manual", createdAt: daysAgo(10), resolvedAt: daysAgo(10) }),
      pause({ id: "agent", createdAt: daysAgo(20), resolvedAt: daysAgo(20) }),
    ];
    assert.ok(planRuleActions(workspace({ campaigns, actions }), organization(), now).every((action) => action.type !== "resume_campaign"));
  });

  it("gives fatigued ads a seven-day rest before resuming them", () => {
    const ads = [ad({ id: "rested", status: "PAUSED" }), ad({ id: "active" })];
    const adPause = (days: number) => pause({ type: "pause_ad", agent: "Creativos", trigger: "fatigue", adId: "rested", createdAt: daysAgo(days), resolvedAt: daysAgo(days) });
    assert.ok(planRuleActions(workspace({ ads, actions: [adPause(8)] }), organization(), now).some((action) => action.type === "resume_ad" && action.adId === "rested"));
    assert.ok(planRuleActions(workspace({ ads, actions: [adPause(3)] }), organization(), now).every((action) => action.type !== "resume_ad"));
  });

  it("applies a resume and records it as the latest status change", () => {
    const resumed = budgetAction({ id: "resume", type: "resume_campaign", status: "executed", fromBudget: undefined, toBudget: undefined, createdAt: daysAgo(0) });
    const next = commitAgentRun(workspace({ campaigns: [campaign({ status: "PAUSED" })], actions: [pause({ createdAt: daysAgo(5) })] }), { actions: [resumed], insights: [] }, now);
    assert.equal(next.campaigns[0].status, "ACTIVE");
    assert.equal(lastStatusChanges(next.actions).get("campaign:c1")?.id, "resume");
  });
});

describe("manual control", () => {
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

  it("lets the user move a budget beyond 20% but never past the monthly limit", () => {
    const manual = budgetAction({ source: "user", toBudget: 1_600 });
    assert.equal(checkGuardrails(manual, context()).allowed, true);
    assert.equal(checkGuardrails(budgetAction({ toBudget: 1_600 }), context()).allowed, false, "agents keep the 20% cap");
    // 10,000 + 1,600 × 18 = 38,800 > 30,000.
    assert.equal(checkGuardrails(manual, context({ organization: organization({ monthlyLimit: 30_000 }) })).allowed, false);
  });

  it("measures the agents' 20% from the budget the user last set", () => {
    const budgetChanges = [
      { campaignId: "c1", organizationId: "org", from: 1_000, to: 1_150, at: hoursAgo(10), source: "agent" as const },
      { campaignId: "c1", organizationId: "org", from: 1_150, to: 2_000, at: hoursAgo(5), source: "user" as const },
    ];
    const campaigns = [campaign({ dailyBudget: 2_000 })];
    assert.equal(checkGuardrails(budgetAction({ fromBudget: 2_000, toBudget: 2_400 }), context({ campaigns, budgetChanges })).allowed, true);
    assert.equal(checkGuardrails(budgetAction({ fromBudget: 2_000, toBudget: 2_500 }), context({ campaigns, budgetChanges })).allowed, false);
  });

  it("allows the user to pause the last active ad of an ad set", () => {
    const pause = budgetAction({ source: "user", type: "pause_ad", adId: "a1", adName: "Anuncio", fromBudget: undefined, toBudget: undefined });
    assert.equal(checkGuardrails(pause, context({ ads: [ad()] })).allowed, true);
  });

  it("records a manual budget change as the user's", () => {
    const next = recordAction(workspace(), budgetAction({ id: "manual", source: "user", status: "executed", toBudget: 1_500 }), now);
    assert.equal(next.campaigns[0].dailyBudget, 1_500);
    assert.equal(next.budgetChanges[0].source, "user");
    assert.equal(next.actions[0].id, "manual");
  });
});

describe("monitoring", () => {
  const run = (actions: AgentAction[] = []) => ({ actions, insights: [], checks: [{ organizationId: "org", campaignsChecked: 3, adsChecked: 12 }] });
  const blocked = (id: string) => budgetAction({ id, type: "decrease_budget", toBudget: 800, status: "blocked", guardrail: "Límite" });

  it("rolls every run into a daily record per business", () => {
    const next = commitAgentRun(commitAgentRun(workspace(), run(), now), run([blocked("b1")]), now);
    const [day] = next.monitoring?.org ?? [];
    assert.equal(day.runs, 2);
    assert.equal(day.adsChecked, 12);
    assert.equal(day.anomalies, 1);
    assert.equal(day.blocked, 1);
    const summary = monitoringSummary(next, "org", now);
    assert.equal(summary.pacingChecks, 2);
    assert.equal(summary.adsWatched, 12);
    assert.equal(summary.campaignsWatched, 3);
  });

  it("does not log or count the same finding twice within a day", () => {
    const next = commitAgentRun(commitAgentRun(workspace(), run([blocked("b1")]), now), run([blocked("b2")]), now);
    assert.equal(next.monitoring?.org[0].blocked, 1);
    assert.equal(next.actions.filter((action) => action.status === "blocked").length, 1);
  });

  it("keeps five weeks of history", () => {
    const old = { date: "2026-07-01", runs: 5, campaignsChecked: 1, adsChecked: 1, anomalies: 0, blocked: 0, executed: 0, lastRunAt: "2026-07-01T00:00:00.000Z" };
    const next = commitAgentRun(workspace({ monitoring: { org: [old] } }), run(), now);
    assert.deepEqual(next.monitoring?.org.map((day) => day.date), [now.toISOString().slice(0, 10)]);
  });
});
