// Pure workspace transitions for Meta connection and sync. Type-only imports so it runs under `node --test`.
import type { Ad, Campaign, ManagedPage, MetricPoint, Organization, WorkspaceData } from "./types";

/** Page scope values besides a Page id: every campaign, or the ones whose Page is not detected yet. */
export const ALL_PAGES = "all";
export const NO_PAGE = "none";

export function campaignsForPage<T extends Pick<Campaign, "pageIds">>(campaigns: T[], scope: string): T[] {
  if (scope === ALL_PAGES) return campaigns;
  if (scope === NO_PAGE) return campaigns.filter((campaign) => !campaign.pageIds?.length);
  return campaigns.filter((campaign) => campaign.pageIds?.includes(scope));
}

/** Pages that run at least one of these campaigns, busiest first, and how many campaigns have no Page yet. */
export function pageOptions(campaigns: Array<Pick<Campaign, "pageIds">>, pages: ManagedPage[]): { pages: Array<ManagedPage & { campaigns: number }>; withoutPage: number } {
  return {
    pages: pages
      .map((page) => ({ ...page, campaigns: campaigns.filter((campaign) => campaign.pageIds?.includes(page.id)).length }))
      .filter((page) => page.campaigns > 0)
      .sort((a, b) => b.campaigns - a.campaigns || a.name.localeCompare(b.name)),
    withoutPage: campaigns.filter((campaign) => !campaign.pageIds?.length).length,
  };
}

/** Daily series for a group of campaigns: their points added by day, oldest first. */
export function sumMetrics(campaignMetrics: Record<string, MetricPoint[]> | undefined, campaignIds: string[]): MetricPoint[] {
  const days = new Map<string, MetricPoint>();
  for (const id of new Set(campaignIds)) {
    for (const point of campaignMetrics?.[id] ?? []) {
      const key = point.day ?? point.date;
      const total = days.get(key) ?? { day: point.day, date: point.date, spend: 0, revenue: 0, roas: 0 };
      days.set(key, { ...total, spend: total.spend + point.spend, revenue: total.revenue + point.revenue });
    }
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, point]) => ({ ...point, roas: point.spend ? point.revenue / point.spend : 0 }));
}

/** Page an ad publishes for: its story spec Page, or the Page part of a boosted post id ("pageId_postId"). */
export function pageIdFromCreative(specPageId: string | undefined, effectiveObjectStoryId: string | undefined): string | undefined {
  return specPageId || effectiveObjectStoryId?.split("_")[0] || undefined;
}

/** Distinct Pages used by a campaign's ads, in order of first appearance. */
export function campaignPageIds(ads: Array<Pick<Ad, "campaignId" | "pageId">>, campaignId: string): string[] {
  return [...new Set(ads.flatMap((ad) => ad.campaignId === campaignId && ad.pageId ? [ad.pageId] : []))];
}

type PageFields = Pick<Organization, "pageId" | "pageName" | "instagramAccountId" | "instagramHandle">;

/** Organization fields that describe which Page (and its Instagram account) a business publishes with. */
export function pageFields(page: ManagedPage): PageFields {
  return {
    pageId: page.id,
    pageName: page.name,
    instagramAccountId: page.instagramAccountId,
    instagramHandle: page.instagramHandle ?? "Instagram por vincular",
  };
}

/** Each page once, keeping the first occurrence (profile pages are passed first). */
export function mergePages(...lists: ManagedPage[][]): ManagedPage[] {
  const pages = new Map<string, ManagedPage>();
  for (const list of lists) for (const page of list) if (!pages.has(page.id)) pages.set(page.id, page);
  return [...pages.values()];
}

/**
 * Default Page for an ad account: the one it already used while still available, otherwise the page named
 * like the account, otherwise the first page. Position in Meta's list says nothing about which page belongs where.
 */
export function defaultPageFor(accountName: string, pages: ManagedPage[], previousPageId?: string): ManagedPage | undefined {
  const previous = previousPageId ? pages.find((page) => page.id === previousPageId) : undefined;
  if (previous) return previous;
  const account = accountName.trim().toLowerCase();
  if (!account) return pages[0];
  return pages.find((page) => page.name.trim().toLowerCase() === account)
    ?? pages.find((page) => {
      const name = page.name.trim().toLowerCase();
      return name.includes(account) || account.includes(name);
    })
    ?? pages[0];
}

/** Amount inside Meta's funding description, e.g. "Available Balance ($1,234.50 MXN)" → 1234.5. */
export function parseAvailableBalance(display: string | undefined): number | undefined {
  const match = display?.match(/\$\s?([\d,]+(?:\.\d{1,2})?)/);
  return match ? Number(match[1].replaceAll(",", "")) : undefined;
}

/** Removes every record that came from the demo seed, keeping the owner and their preferences. */
export function clearDemoData(workspace: WorkspaceData): WorkspaceData {
  return {
    ...workspace,
    organizations: [],
    campaigns: [],
    ads: [],
    pages: [],
    metrics: {},
    activities: [],
    alerts: [],
    creatives: [],
    actions: [],
    budgetChanges: [],
    campaignReviews: {},
    campaignMetrics: {},
  };
}

/**
 * Applies synced Meta data on top of the latest stored workspace. Settings a person may have changed
 * during the sync (mode, limits, targets) and the agents' history always come from `current`.
 */
export function mergeSyncedWorkspace(current: WorkspaceData, synced: WorkspaceData): WorkspaceData {
  if (current.metaConnection.status !== "connected") return current;
  return {
    ...current,
    metaConnection: { ...current.metaConnection, lastSyncAt: synced.metaConnection.lastSyncAt },
    organizations: synced.organizations.map((organization) => {
      const local = current.organizations.find((item) => item.id === organization.id);
      if (!local) return organization;
      // A page chosen in Pulso while the sync ran wins, as long as the profile still manages it.
      const localPage = synced.pages?.find((page) => page.id === local.pageId);
      return {
        ...organization,
        mode: local.mode,
        monthlyLimit: local.monthlyLimit,
        targetRoas: local.targetRoas,
        resultValue: local.resultValue,
        objective: local.objective,
        report: local.report,
        privacyPolicyUrl: local.privacyPolicyUrl,
        ...(localPage && pageFields(localPage)),
      };
    }),
    pages: synced.pages,
    campaigns: synced.campaigns,
    ads: synced.ads,
    metrics: synced.metrics,
    campaignMetrics: synced.campaignMetrics,
  };
}

/**
 * Stores a new Meta connection with its first sync. Leaving demo mode drops all demo records;
 * reconnecting keeps real history, including the budget changes the guardrails measure against.
 */
export function applyMetaConnection(
  current: WorkspaceData,
  connection: WorkspaceData["metaConnection"],
  synced: WorkspaceData,
): WorkspaceData {
  const base = current.metaConnection.status === "demo" ? clearDemoData(current) : current;
  return mergeSyncedWorkspace({ ...base, metaConnection: connection }, synced);
}
