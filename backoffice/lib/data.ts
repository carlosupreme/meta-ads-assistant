import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { addDays, dayStartIso, normalizeCall, normalizeUsage, UUID, type CallRow, type UsageRow } from "./aggregate";

let client: SupabaseClient | undefined;

/** Server-only client with the secret key: it reads every client's logs, so it never reaches the browser. */
function supabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) throw new Error("Faltan SUPABASE_URL o SUPABASE_SECRET_KEY");
  client = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  return client;
}

// PostgREST returns at most 1000 rows per request.
const PAGE_SIZE = 1000;

/** Daily usage rows for the range, optionally for one client. */
export async function loadUsage(from: string, to: string, workspaceId?: string): Promise<UsageRow[]> {
  const rows: UsageRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase().from("pulso_ai_usage_daily").select("*").gte("day", from).lte("day", to);
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    const { data, error } = await query.order("day").order("last_call_at").range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Supabase: ${error.message}`);
    const page = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...page.map(normalizeUsage));
    if (page.length < PAGE_SIZE) return rows;
  }
}

export interface Client {
  workspaceId: string;
  email: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  metaConnected: boolean;
  businesses: string[];
}

/** Every workspace, including clients that have not used AI yet. Only the fields shown here are read, never Meta tokens. */
export async function loadClients(): Promise<Client[]> {
  const { data, error } = await supabase()
    .from("pulso_workspaces")
    .select("id, created_at, updated_at, owner:payload->user, meta_status:payload->metaConnection->>status, organizations:payload->organizations")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Supabase: ${error.message}`);
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
    const owner = (row.owner ?? {}) as { name?: unknown; email?: unknown };
    const organizations = Array.isArray(row.organizations) ? (row.organizations as Array<{ name?: unknown }>) : [];
    return {
      workspaceId: String(row.id),
      email: typeof owner.email === "string" ? owner.email : "",
      name: typeof owner.name === "string" ? owner.name : "",
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      metaConnected: row.meta_status === "connected",
      businesses: organizations.flatMap((organization) => (typeof organization.name === "string" ? [organization.name] : [])),
    };
  });
}

export interface CallFilters {
  from: string;
  to: string;
  workspaceId?: string;
  feature?: string;
  status?: string;
}

const CALL_COLUMNS = "id, created_at, workspace_id, owner_email, organization_name, feature, route, view, trigger, model, status, duration_ms, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, total_tokens, cost_usd, openai_response_id, error";

function callsQuery(columns: string, filters: CallFilters, withCount = false) {
  let query = supabase()
    .from("pulso_ai_logs")
    .select(columns, withCount ? { count: "exact" } : undefined)
    .gte("created_at", dayStartIso(filters.from))
    .lt("created_at", dayStartIso(addDays(filters.to, 1)));
  if (filters.workspaceId && UUID.test(filters.workspaceId)) query = query.eq("workspace_id", filters.workspaceId);
  if (filters.feature) query = query.eq("feature", filters.feature);
  if (filters.status === "ok" || filters.status === "error") query = query.eq("status", filters.status);
  return query.order("created_at", { ascending: false });
}

/** One page of calls, newest first, with the total that matches the filters. */
export async function loadCalls(filters: CallFilters, page: number, pageSize = 50): Promise<{ calls: CallRow[]; total: number }> {
  const start = (Math.max(1, page) - 1) * pageSize;
  const { data, error, count } = await callsQuery(CALL_COLUMNS, filters, true).range(start, start + pageSize - 1);
  if (error) throw new Error(`Supabase: ${error.message}`);
  return { calls: ((data ?? []) as unknown as Array<Record<string, unknown>>).map(normalizeCall), total: count ?? 0 };
}

/** A call with its full JSON: trace, request, OpenAI's exact response, parsed result and error. */
export async function loadCall(id: string): Promise<{ call: CallRow; entry: unknown } | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await supabase().from("pulso_ai_logs").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Supabase: ${error.message}`);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return { call: normalizeCall(row), entry: row.entry };
}

export const EXPORT_LIMIT = 5000;

/** Full rows, entry included, for a JSON download. Stops at EXPORT_LIMIT. */
export async function exportCalls(filters: CallFilters): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  const batch = 500;
  while (rows.length < EXPORT_LIMIT) {
    const { data, error } = await callsQuery("*", filters).range(rows.length, rows.length + batch - 1);
    if (error) throw new Error(`Supabase: ${error.message}`);
    const page = (data ?? []) as unknown as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < batch) break;
  }
  return rows.slice(0, EXPORT_LIMIT);
}
