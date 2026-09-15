// Pure workspace transitions for Meta connection and sync. Type-only imports so it runs under `node --test`.
import type { ManagedPage, Organization, WorkspaceData } from "./types";

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
        ...(localPage && pageFields(localPage)),
      };
    }),
    pages: synced.pages,
    campaigns: synced.campaigns,
    ads: synced.ads,
    metrics: synced.metrics,
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
