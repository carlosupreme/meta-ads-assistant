import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoData } from "../lib/demo-data.ts";
import type { Campaign, ManagedPage, Organization, WorkspaceData } from "../lib/types.ts";
import {
  applyMetaConnection, campaignPageIds, defaultPageFor, mergePages, mergeSyncedWorkspace, pageIdFromCreative, parseAvailableBalance,
} from "../lib/workspace.ts";

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

describe("pages", () => {
  const pages: ManagedPage[] = [
    { id: "p1", name: "Decor Centro", source: "profile" },
    { id: "p2", name: "DecorSport", source: "profile" },
    { id: "p3", name: "Magaña Sports", instagramAccountId: "ig3", instagramHandle: "@magana", source: "business" },
  ];

  it("keeps the page a business already uses while it is still available", () => {
    assert.equal(defaultPageFor("Alberto López", pages, "p2")?.id, "p2");
    assert.equal(defaultPageFor("Alberto López", pages, "gone")?.id, "p1");
  });

  it("prefers the page named like the ad account, otherwise the first", () => {
    assert.equal(defaultPageFor("Magaña Sports", pages)?.id, "p3");
    assert.equal(defaultPageFor("Alberto López", pages)?.id, "p1");
    assert.equal(defaultPageFor("Test", []), undefined);
  });

  it("lists each page once, keeping the profile's copy", () => {
    const merged = mergePages([pages[0]], [{ ...pages[0], source: "business" }, pages[2]]);
    assert.deepEqual(merged.map((page) => [page.id, page.source]), [["p1", "profile"], ["p3", "business"]]);
  });

  it("keeps the page chosen in Pulso through a sync", () => {
    const current: WorkspaceData = { ...structuredClone(demoData), metaConnection: connection, organizations: [realOrganization({ pageId: "p3", pageName: "Magaña Sports" })] };
    const next = mergeSyncedWorkspace(current, synced({ pages, organizations: [realOrganization({ pageId: "p1", pageName: "Decor Centro" })] }));
    assert.equal(next.organizations[0].pageId, "p3");
    assert.equal(next.organizations[0].instagramHandle, "@magana");
    assert.equal(next.pages?.length, 3);
  });
});

describe("campaign pages", () => {
  it("reads the Page from the story spec or from a boosted post id", () => {
    assert.equal(pageIdFromCreative("p1", "p9_555"), "p1");
    assert.equal(pageIdFromCreative(undefined, "p7_123456"), "p7");
    assert.equal(pageIdFromCreative(undefined, undefined), undefined);
  });

  it("lists each Page a campaign's ads use once", () => {
    const ads = [
      { campaignId: "c1", pageId: "p7" },
      { campaignId: "c1", pageId: "p7" },
      { campaignId: "c1", pageId: "p3" },
      { campaignId: "c2", pageId: "p1" },
      { campaignId: "c1" },
    ];
    assert.deepEqual(campaignPageIds(ads, "c1"), ["p7", "p3"]);
    assert.deepEqual(campaignPageIds(ads, "c3"), []);
  });
});

describe("account funding", () => {
  it("reads the prepaid amount from Meta's funding description", () => {
    assert.equal(parseAvailableBalance("Available Balance ($0.00 MXN)"), 0);
    assert.equal(parseAvailableBalance("Available Balance ($1,234.50 MXN)"), 1234.5);
  });

  it("returns nothing when the description has no amount", () => {
    assert.equal(parseAvailableBalance("Visa *1234"), undefined);
    assert.equal(parseAvailableBalance(undefined), undefined);
  });
});
