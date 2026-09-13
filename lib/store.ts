import { randomBytes, randomUUID } from "node:crypto";
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

export interface ReportLink {
  token: string;
  createdAt: string;
}

export async function getReportLink(workspaceId: string, organizationId: string): Promise<ReportLink | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("pulso_report_links")
    .select("token,created_at")
    .eq("workspace_id", workspaceId)
    .eq("organization_id", organizationId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Supabase: ${error.message}. Ejecuta las migraciones incluidas en supabase/migrations.`);
  return data ? { token: data.token, createdAt: data.created_at } : null;
}

export async function revokeReportLinks(workspaceId: string, organizationId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("pulso_report_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("organization_id", organizationId)
    .is("revoked_at", null);
  if (error) throw new Error(`Supabase: ${error.message}`);
}

/** Issues a new unguessable link and revokes the previous one, so a leaked URL stops working. */
export async function rotateReportLink(workspaceId: string, organizationId: string): Promise<ReportLink> {
  await revokeReportLinks(workspaceId, organizationId);
  const { data, error } = await getSupabaseAdmin()
    .from("pulso_report_links")
    .insert({ token: randomBytes(24).toString("base64url"), workspace_id: workspaceId, organization_id: organizationId })
    .select("token,created_at")
    .single();
  if (error || !data) throw new Error(`Supabase: ${error?.message ?? "no fue posible crear el enlace"}`);
  return { token: data.token, createdAt: data.created_at };
}

export async function findReportLink(token: string): Promise<{ workspaceId: string; organizationId: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("pulso_report_links")
    .select("workspace_id,organization_id")
    .eq("token", token)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data ? { workspaceId: data.workspace_id, organizationId: data.organization_id } : null;
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
