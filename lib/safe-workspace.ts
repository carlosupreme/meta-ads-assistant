import type { WorkspaceData } from "./types";

export type SafeWorkspace = Omit<WorkspaceData, "metaConnection" | "agentLock"> & {
  metaConnection: Omit<WorkspaceData["metaConnection"], "encryptedAccessToken">;
};

/** Removes the encrypted token and internal lock before data reaches the browser. */
export function toSafeWorkspace(workspace: WorkspaceData): SafeWorkspace {
  const { metaConnection, agentLock, ...rest } = workspace;
  void agentLock;
  const { status, userName, connectedAt, lastSyncAt } = metaConnection;
  return { ...rest, metaConnection: { status, userName, connectedAt, lastSyncAt } };
}
