import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoData } from "../lib/demo-data.ts";
import type { Campaign, Organization, WorkspaceData } from "../lib/types.ts";
import { applyMetaConnection, mergeSyncedWorkspace } from "../lib/workspace.ts";

const connection: WorkspaceData["metaConnection"] = {
  status: "connected", userName: "Dueño", connectedAt: "2026-09-13T12:00:00.000Z", lastSyncAt: "2026-09-13T12:00:00.000Z", encryptedAccessToken: "token",
};

function realOrganization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: "meta-123", name: "Cuenta real", initials: "CR", color: "#000", pageName: "Página", instagramHandle: "@real",
    adAccountId: "act_123", currency: "MXN", objective: "Ventas", mode: "copilot", monthlyLimit: 50_000,
    spentThisMonth: 1_000, revenueThisMonth: 3_000, resultValue: 0, connected: true, ...overrides,
  };
}

function realCampaign(): Campaign {
  return {
    id: "120000001", organizationId: "meta-123", name: "Campaña real", status: "ACTIVE", objective: "OUTCOME SALES",
    channel: "Facebook + Instagram", spend: 1_000, results: 4, costPerResult: 250, revenue: 3_000, roas: 3, trend: 0,
    dailyBudget: 300, budgetLevel: "campaign", updatedAt: "Ahora",
  };
}

function synced(overrides: Partial<WorkspaceData> = {}): WorkspaceData {
  return {
    ...structuredClone(demoData), metaConnection: connection,
    organizations: [realOrganization()], campaigns: [realCampaign()], ads: [], metrics: { "meta-123": [] }, ...overrides,
  };
}

describe("Meta connection", () => {
  it("replaces every demo record with real data on the first connection", () => {
    const demo: WorkspaceData = { ...structuredClone(demoData), aiModel: "modelo-elegido" };
    const next = applyMetaConnection(demo, connection, synced());

    assert.equal(next.metaConnection.status, "connected");
    assert.deepEqual(next.organizations.map((organization) => organization.id), ["meta-123"]);
    assert.deepEqual(next.campaigns.map((campaign) => campaign.id), ["120000001"]);
    assert.deepEqual(Object.keys(next.metrics), ["meta-123"]);
    for (const key of ["ads", "activities", "alerts", "creatives", "actions", "budgetChanges"] as const) {
      assert.equal(next[key].length, 0, `${key} should not keep demo records`);
    }
    assert.equal(next.aiModel, "modelo-elegido", "owner preferences survive");
    assert.deepEqual(next.user, demo.user);
  });

  it("leaves no demo businesses when Meta returns no ad accounts", () => {
    const next = applyMetaConnection(structuredClone(demoData), connection, synced({ organizations: [], campaigns: [], metrics: {} }));
    assert.equal(next.organizations.length, 0);
    assert.equal(next.campaigns.length, 0);
  });

  it("keeps real history and settings when reconnecting after a disconnect", () => {
    const change = { campaignId: "120000001", organizationId: "meta-123", from: 250, to: 300, at: "2026-09-13T10:00:00.000Z" };
    const disconnected: WorkspaceData = {
      ...structuredClone(demoData),
      metaConnection: { status: "disconnected" },
      organizations: [realOrganization({ mode: "autonomous", monthlyLimit: 80_000, targetRoas: 4 })],
      campaigns: [realCampaign()], ads: [], creatives: [], alerts: [], activities: [], actions: [],
      budgetChanges: [change],
    };
    const next = applyMetaConnection(disconnected, connection, synced());

    assert.deepEqual(next.budgetChanges, [change], "guardrails keep their 24 h budget history");
    assert.equal(next.organizations[0].mode, "autonomous");
    assert.equal(next.organizations[0].monthlyLimit, 80_000);
    assert.equal(next.organizations[0].targetRoas, 4);
  });

  it("ignores a sync that finishes after the user disconnected", () => {
    const disconnected: WorkspaceData = { ...structuredClone(demoData), metaConnection: { status: "disconnected" } };
    assert.equal(mergeSyncedWorkspace(disconnected, synced()), disconnected);
  });

  it("keeps client report settings through a sync", () => {
    const report = { clientEmails: ["cliente@empresa.mx"], weeklyEmail: true };
    const current: WorkspaceData = { ...structuredClone(demoData), metaConnection: connection, organizations: [realOrganization({ report })] };
    assert.deepEqual(mergeSyncedWorkspace(current, synced()).organizations[0].report, report);
  });
});
