import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { demoData } from "./demo-data";
import type { WorkspaceData } from "./types";
import { getSupabaseAdmin } from "./supabase/admin";
import type { Json } from "./supabase/database.types";

const dataDirectory = path.join(process.cwd(), "data");
const dataFile = path.join(dataDirectory, "workspace.json");
const singleUserWorkspaceId = process.env.PULSO_WORKSPACE_ID || "00000000-0000-4000-8000-000000000001";
const AGENT_LOCK_MS = 5 * 60_000;

export const LOCAL_WORKSPACE_ID = "local";

export interface WorkspaceOwner {
  id: string;
  email: string;
  name: string;
}

function asJson(data: WorkspaceData): Json {
  return JSON.parse(JSON.stringify(data)) as Json;
}

/** Fills collections added after a workspace was first stored. */
function normalizeWorkspace(payload: unknown): WorkspaceData {
  const data = payload as Partial<WorkspaceData> & Omit<WorkspaceData, "ads" | "actions" | "budgetChanges">;
  return {
    ...data,
    ads: data.ads ?? (data.metaConnection?.status === "demo" ? structuredClone(demoData.ads) : []),
    actions: data.actions ?? [],
    budgetChanges: data.budgetChanges ?? [],
  };
}

function requireSupabase() {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase no está configurado");
  return supabase;
}

async function readLocalWorkspace(): Promise<WorkspaceData> {
  try {
    return normalizeWorkspace(JSON.parse(await fs.readFile(dataFile, "utf8")));
  } catch {
    await fs.mkdir(dataDirectory, { recursive: true });
    await fs.writeFile(dataFile, JSON.stringify(demoData, null, 2));
    return structuredClone(demoData);
  }
}

async function writeLocalWorkspace(data: WorkspaceData): Promise<void> {
  await fs.mkdir(dataDirectory, { recursive: true });
  const temporaryFile = `${dataFile}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(data, null, 2));
  await fs.rename(temporaryFile, dataFile);
}

// The local file has no version column, so serialize read-modify-write cycles within this process.
let localQueue: Promise<unknown> = Promise.resolve();

function updateLocalWorkspace(
  updater: (current: WorkspaceData) => WorkspaceData | Promise<WorkspaceData>,
): Promise<WorkspaceData> {
  const run = localQueue.then(async () => {
    const next = await updater(await readLocalWorkspace());
    await writeLocalWorkspace(next);
    return next;
  });
  localQueue = run.catch(() => undefined);
  return run;
}

async function readSupabaseRecord(workspaceId: string): Promise<{ data: WorkspaceData; version: number }> {
  const { data: record, error } = await requireSupabase()
    .from("pulso_workspaces")
    .select("payload,version")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`Supabase: ${error.message}. Ejecuta las migraciones incluidas en supabase/migrations.`);
  if (!record) throw new Error("Workspace no encontrado");
  return { data: normalizeWorkspace(record.payload), version: record.version };
}

export async function readWorkspace(workspaceId: string): Promise<WorkspaceData> {
  return getSupabaseAdmin() ? (await readSupabaseRecord(workspaceId)).data : readLocalWorkspace();
}

/**
 * The only write path. The updater may run more than once when Supabase detects a concurrent
 * write, so it must be free of side effects such as Meta API calls.
 */
export async function updateWorkspace(
  workspaceId: string,
  updater: (current: WorkspaceData) => WorkspaceData | Promise<WorkspaceData>,
): Promise<WorkspaceData> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return updateLocalWorkspace(updater);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readSupabaseRecord(workspaceId);
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

/** Workspaces the cron should monitor: every one that belongs to a user. */
export async function listOwnedWorkspaceIds(): Promise<string[]> {
  const { data, error } = await requireSupabase().from("pulso_workspaces").select("id").not("owner_id", "is", null);
  if (error) throw new Error(`Supabase: ${error.message}`);
  return (data ?? []).map((record) => record.id);
}

/**
 * Returns the user's workspace, creating it on first login. When PULSO_LEGACY_OWNER_EMAIL matches,
 * that user claims the unowned single-tenant workspace instead, keeping its Meta connection and history.
 */
export async function findOrCreateWorkspace(owner: WorkspaceOwner): Promise<string> {
  const supabase = requireSupabase();
  const ownedId = async () => {
    const { data, error } = await supabase.from("pulso_workspaces").select("id").eq("owner_id", owner.id).maybeSingle();
    if (error) throw new Error(`Supabase: ${error.message}`);
    return data?.id;
  };
  const existing = await ownedId();
  if (existing) return existing;

  const legacyEmail = process.env.PULSO_LEGACY_OWNER_EMAIL?.trim().toLowerCase();
  if (legacyEmail && owner.email.toLowerCase() === legacyEmail) {
    const { data: claimed, error } = await supabase
      .from("pulso_workspaces")
      .update({ owner_id: owner.id })
      .eq("id", singleUserWorkspaceId)
      .is("owner_id", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`Supabase: ${error.message}`);
    if (claimed) return claimed.id;
  }

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

let singleUserWorkspace: Promise<string> | undefined;

/** Development without login: the JSON file, or the PULSO_WORKSPACE_ID row when only the database is configured. */
export function ensureSingleUserWorkspace(): Promise<string> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return Promise.resolve(LOCAL_WORKSPACE_ID);
  singleUserWorkspace ??= (async () => {
    const { error } = await supabase
      .from("pulso_workspaces")
      .upsert({ id: singleUserWorkspaceId, name: "Pulso AI", payload: asJson(structuredClone(demoData)), version: 1 }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error(`Supabase: ${error.message}. Ejecuta las migraciones incluidas en supabase/migrations.`);
    return singleUserWorkspaceId;
  })().catch((error) => {
    singleUserWorkspace = undefined;
    throw error;
  });
  return singleUserWorkspace;
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
