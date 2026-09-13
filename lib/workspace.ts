// Pure workspace transitions for Meta connection and sync. Type-only imports so it runs under `node --test`.
import type { WorkspaceData } from "./types";

/** Removes every record that came from the demo seed, keeping the owner and their preferences. */
export function clearDemoData(workspace: WorkspaceData): WorkspaceData {
  return {
    ...workspace,
    organizations: [],
    campaigns: [],
    ads: [],
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
      return local
        ? { ...organization, mode: local.mode, monthlyLimit: local.monthlyLimit, targetRoas: local.targetRoas, resultValue: local.resultValue, objective: local.objective, report: local.report }
        : organization;
    }),
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
