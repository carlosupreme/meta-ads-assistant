import { randomUUID } from "node:crypto";
import { demoData } from "./demo-data";
import type { WorkspaceData } from "./types";
import { getSupabaseAdmin } from "./supabase/admin";
import type { Json } from "./supabase/database.types";

const AGENT_LOCK_MS = 5 * 60_000;

export interface WorkspaceOwner {
  id: string;
  email: string;
  name: string;
}

function asJson(data: WorkspaceData): Json {
  return JSON.parse(JSON.stringify(data)) as Json;
}

async function readRecord(workspaceId: string): Promise<{ data: WorkspaceData; version: number }> {
  const { data: record, error } = await getSupabaseAdmin()
    .from("pulso_workspaces")
    .select("payload,version")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`Supabase: ${error.message}`);
  if (!record) throw new Error("Workspace no encontrado");
  return { data: record.payload as unknown as WorkspaceData, version: record.version };
}

export async function readWorkspace(workspaceId: string): Promise<WorkspaceData> {
  return (await readRecord(workspaceId)).data;
}

/**
 * The only write path. The updater may run more than once when a concurrent write is detected,
 * so it must be free of side effects such as Meta API calls.
 */
export async function updateWorkspace(
  workspaceId: string,
  updater: (current: WorkspaceData) => WorkspaceData | Promise<WorkspaceData>,
): Promise<WorkspaceData> {
  const supabase = getSupabaseAdmin();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readRecord(workspaceId);
    const next = await updater(current.data);
    const { data: updated, error } = await supabase
      .from("pulso_workspaces")
      .update({ payload: asJson(next), version: current.version + 1 })
      .eq("id", workspaceId)
      .eq("version", current.version)
      .select("version")
      .maybeSingle();
    if (error) throw new Error(`Supabase: ${error.message}`);
    if (updated) return next;
  }
  throw new Error("El workspace cambió al mismo tiempo; intenta nuevamente");
}

/** Every workspace, for the cron monitor. */
export async function listWorkspaceIds(): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin().from("pulso_workspaces").select("id");
  if (error) throw new Error(`Supabase: ${error.message}`);
  return (data ?? []).map((record) => record.id);
}

/** Returns the user's workspace, creating it with demo data on first login. */
export async function findOrCreateWorkspace(owner: WorkspaceOwner): Promise<string> {
  const supabase = getSupabaseAdmin();
  const ownedId = async () => {
    const { data, error } = await supabase.from("pulso_workspaces").select("id").eq("owner_id", owner.id).maybeSingle();
    if (error) throw new Error(`Supabase: ${error.message}`);
    return data?.id;
  };
  const existing = await ownedId();
  if (existing) return existing;

  const initial: WorkspaceData = { ...structuredClone(demoData), user: { name: owner.name, email: owner.email } };
  const { data: created, error } = await supabase
    .from("pulso_workspaces")
    .insert({ owner_id: owner.id, name: owner.name, payload: asJson(initial), version: 1 })
    .select("id")
    .single();
  if (created) return created.id;
  // Two first requests raced; the unique owner index kept a single row.
  if (error?.code === "23505") {
    const winner = await ownedId();
    if (winner) return winner;
  }
  throw new Error(`Supabase: ${error?.message ?? "no fue posible crear el workspace"}`);
}

export class AgentBusyError extends Error {
  constructor() {
    super("Los agentes ya están analizando esta cuenta; intenta en unos minutos.");
  }
}

/** Runs `task` while holding the workspace agent lock, so two runs never change the same budgets. */
export async function withAgentLock<T>(workspaceId: string, task: (workspace: WorkspaceData) => Promise<T>): Promise<T> {
  const token = randomUUID();
  let acquired = false;
  const workspace = await updateWorkspace(workspaceId, (current) => {
    const lock = current.agentLock;
    acquired = !lock || Date.parse(lock.expiresAt) <= Date.now();
    return acquired
      ? { ...current, agentLock: { token, expiresAt: new Date(Date.now() + AGENT_LOCK_MS).toISOString() } }
      : current;
  });
  if (!acquired) throw new AgentBusyError();
  try {
    return await task(workspace);
  } finally {
    await updateWorkspace(workspaceId, (current) => {
      if (current.agentLock?.token !== token) return current;
      const { agentLock, ...rest } = current;
      void agentLock;
      return rest;
    }).catch((error) => console.error("Could not release agent lock", error));
  }
}
