import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { demoData } from "./demo-data";
import type { WorkspaceData } from "./types";
import { getSupabaseAdmin } from "./supabase/admin";
import type { Json } from "./supabase/database.types";

const dataDirectory = path.join(process.cwd(), "data");
const dataFile = path.join(dataDirectory, "workspace.json");
const defaultWorkspaceId = process.env.PULSO_WORKSPACE_ID || "00000000-0000-4000-8000-000000000001";
const AGENT_LOCK_MS = 5 * 60_000;

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

async function readSupabaseRecord(): Promise<{ data: WorkspaceData; version: number }> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase no está configurado");
  const { data: record, error } = await supabase
    .from("pulso_workspaces")
    .select("payload,version")
    .eq("id", defaultWorkspaceId)
    .maybeSingle();
  if (error) throw new Error(`Supabase: ${error.message}. Ejecuta la migración incluida en supabase/migrations.`);
  if (record) return { data: normalizeWorkspace(record.payload), version: record.version };
  // First connection: preserve any workspace that was already used locally.
  const initial = await readLocalWorkspace();
  const { error: insertError } = await supabase.from("pulso_workspaces").insert({
    id: defaultWorkspaceId,
    name: "Pulso AI",
    payload: asJson(initial),
    version: 1,
  });
  if (insertError) throw new Error(`Supabase: ${insertError.message}`);
  return { data: initial, version: 1 };
}

export async function readWorkspace(): Promise<WorkspaceData> {
  return getSupabaseAdmin() ? (await readSupabaseRecord()).data : readLocalWorkspace();
}

/**
 * The only write path. The updater may run more than once when Supabase detects a concurrent
 * write, so it must be free of side effects such as Meta API calls.
 */
export async function updateWorkspace(
  updater: (current: WorkspaceData) => WorkspaceData | Promise<WorkspaceData>,
): Promise<WorkspaceData> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return updateLocalWorkspace(updater);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readSupabaseRecord();
    const next = await updater(current.data);
    const { data: updated, error } = await supabase
      .from("pulso_workspaces")
      .update({ payload: asJson(next), version: current.version + 1 })
      .eq("id", defaultWorkspaceId)
      .eq("version", current.version)
      .select("version")
      .maybeSingle();
    if (error) throw new Error(`Supabase: ${error.message}`);
    if (updated) return next;
  }
  throw new Error("El workspace cambió al mismo tiempo; intenta nuevamente");
}

export class AgentBusyError extends Error {
  constructor() {
    super("Los agentes ya están analizando esta cuenta; intenta en unos minutos.");
  }
}

/** Runs `task` while holding the workspace agent lock, so two runs never change the same budgets. */
export async function withAgentLock<T>(task: (workspace: WorkspaceData) => Promise<T>): Promise<T> {
  const token = randomUUID();
  let acquired = false;
  const workspace = await updateWorkspace((current) => {
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
    await updateWorkspace((current) => {
      if (current.agentLock?.token !== token) return current;
      const { agentLock, ...rest } = current;
      void agentLock;
      return rest;
    }).catch((error) => console.error("Could not release agent lock", error));
  }
}
