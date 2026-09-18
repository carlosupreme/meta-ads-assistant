// Pure usage math for the backoffice: rows, totals, groupings, date ranges, chart scale and formatting.
// No imports, so it runs under `node --test`.

export interface UsageRow {
  day: string;
  workspaceId: string | null;
  ownerEmail: string | null;
  organizationId: string | null;
  organizationName: string | null;
  feature: string;
  view: string | null;
  trigger: string;
  model: string;
  calls: number;
  errors: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
  lastCallAt: string;
}

export interface CallRow {
  id: string;
  createdAt: string;
  workspaceId: string | null;
  ownerEmail: string | null;
  organizationName: string | null;
  feature: string;
  route: string | null;
  view: string | null;
  trigger: string;
  model: string;
  status: string;
  durationMs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
  responseId: string | null;
  error: string | null;
}

const toNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};
const toText = (value: unknown) => (typeof value === "string" && value ? value : null);

/** A pulso_ai_usage_daily row from PostgREST, where numeric sums can arrive as strings. */
export function normalizeUsage(raw: Record<string, unknown>): UsageRow {
  return {
    day: String(raw.day),
    workspaceId: toText(raw.workspace_id),
    ownerEmail: toText(raw.owner_email),
    organizationId: toText(raw.organization_id),
    organizationName: toText(raw.organization_name),
    feature: String(raw.feature ?? "desconocida"),
    view: toText(raw.view),
    trigger: String(raw.trigger ?? "user"),
    model: String(raw.model ?? ""),
    calls: toNumber(raw.calls),
    errors: toNumber(raw.errors),
    inputTokens: toNumber(raw.input_tokens),
    cachedInputTokens: toNumber(raw.cached_input_tokens),
    outputTokens: toNumber(raw.output_tokens),
    reasoningTokens: toNumber(raw.reasoning_tokens),
    totalTokens: toNumber(raw.total_tokens),
    costUsd: toNumber(raw.cost_usd),
    durationMs: toNumber(raw.duration_ms),
    lastCallAt: String(raw.last_call_at ?? ""),
  };
}

export function normalizeCall(raw: Record<string, unknown>): CallRow {
  return {
    id: String(raw.id),
    createdAt: String(raw.created_at),
    workspaceId: toText(raw.workspace_id),
    ownerEmail: toText(raw.owner_email),
    organizationName: toText(raw.organization_name),
    feature: String(raw.feature ?? "desconocida"),
    route: toText(raw.route),
    view: toText(raw.view),
    trigger: String(raw.trigger ?? "user"),
    model: String(raw.model ?? ""),
    status: String(raw.status ?? "ok"),
    durationMs: toNumber(raw.duration_ms),
    inputTokens: toNumber(raw.input_tokens),
    cachedInputTokens: toNumber(raw.cached_input_tokens),
    outputTokens: toNumber(raw.output_tokens),
    reasoningTokens: toNumber(raw.reasoning_tokens),
    totalTokens: toNumber(raw.total_tokens),
    costUsd: toNumber(raw.cost_usd),
    responseId: toText(raw.openai_response_id),
    error: toText(raw.error),
  };
}

export interface Totals {
  calls: number;
  errors: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
  lastCallAt: string | null;
}

export function emptyTotals(): Totals {
  return { calls: 0, errors: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0, costUsd: 0, durationMs: 0, lastCallAt: null };
}

export function sumRows(rows: UsageRow[]): Totals {
  const totals = emptyTotals();
  for (const row of rows) {
    totals.calls += row.calls;
    totals.errors += row.errors;
    totals.inputTokens += row.inputTokens;
    totals.cachedInputTokens += row.cachedInputTokens;
    totals.outputTokens += row.outputTokens;
    totals.reasoningTokens += row.reasoningTokens;
    totals.totalTokens += row.totalTokens;
    totals.costUsd += row.costUsd;
    totals.durationMs += row.durationMs;
    // Postgres timestamps share one ISO format, so they order as strings.
    if (row.lastCallAt && (!totals.lastCallAt || row.lastCallAt > totals.lastCallAt)) totals.lastCallAt = row.lastCallAt;
  }
  return totals;
}

export interface UsageGroup {
  key: string;
  rows: UsageRow[];
  totals: Totals;
}

/** Rows grouped by a key, most expensive first. */
export function groupUsage(rows: UsageRow[], key: (row: UsageRow) => string): UsageGroup[] {
  const groups = new Map<string, UsageRow[]>();
  for (const row of rows) {
    const groupKey = key(row);
    const items = groups.get(groupKey);
    if (items) items.push(row);
    else groups.set(groupKey, [row]);
  }
  return [...groups.entries()]
    .map(([groupKey, items]) => ({ key: groupKey, rows: items, totals: sumRows(items) }))
    .sort((a, b) => b.totals.costUsd - a.totals.costUsd || b.totals.calls - a.totals.calls);
}

export type RangeKey = "7d" | "30d" | "90d" | "month";

export const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: "7d", label: "Últimos 7 días" },
  { key: "30d", label: "Últimos 30 días" },
  { key: "90d", label: "Últimos 90 días" },
  { key: "month", label: "Este mes" },
];

export const TIME_ZONE = "America/Mexico_City";

/** Calendar day (YYYY-MM-DD) in Mexico City. */
export function localDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Mexico City has had no daylight saving time since 2022, so every local day starts at UTC-6. */
export const dayStartIso = (day: string) => `${day}T00:00:00-06:00`;

export function resolveRange(param: string | undefined, now: Date): { key: RangeKey; from: string; to: string } {
  const key = RANGES.find((range) => range.key === param)?.key ?? "30d";
  const to = localDay(now);
  const from = key === "month" ? `${to.slice(0, 8)}01` : addDays(to, -(Number.parseInt(key, 10) - 1));
  return { key, from, to };
}

/** Every day of the range in order, with zeros on days without calls. */
export function dailySeries(rows: UsageRow[], from: string, to: string): Array<{ day: string; totals: Totals }> {
  const byDay = new Map(groupUsage(rows, (row) => row.day).map((group) => [group.key, group.totals]));
  const series: Array<{ day: string; totals: Totals }> = [];
  for (let day = from; day <= to; day = addDays(day, 1)) series.push({ day, totals: byDay.get(day) ?? emptyTotals() });
  return series;
}

/** Clean axis maximum (1, 2, 2.5 or 5 × 10ⁿ) at or above the largest value. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value * (1 - 1e-9)) ?? 10;
  return Number((step * magnitude).toPrecision(12));
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FEATURE_LABELS: Record<string, string> = {
  analyze_campaigns: "Análisis de cuenta",
  campaign_review: "Revisión por campaña",
  ask: "Pregúntale a Pulso",
  ad_variants: "Variantes de anuncio",
  campaign_plan: "Plan de campaña",
  ad_copy: "Copy de anuncio",
  lead_form: "Formulario instantáneo",
  posts_analysis: "Análisis de publicaciones",
};

export const VIEW_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  agents: "Agentes IA",
  campaigns: "Campañas",
  "new-campaign": "Nueva campaña",
  monitor: "Monitor automático",
};

export const labelFor = (labels: Record<string, string>, key: string | null, fallback = "Sin página") => (key ? labels[key] ?? key : fallback);

/** Tiny per-call costs need more decimals than a monthly total. */
export function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  const size = Math.abs(value);
  return `$${value.toFixed(size >= 1 ? 2 : size >= 0.01 ? 3 : 5)}`;
}

/** Axis ticks share one precision, chosen from the axis maximum. */
export function formatAxisUsd(value: number, max: number): string {
  const decimals = max >= 4 ? 0 : Math.min(6, Math.max(2, Math.ceil(-Math.log10(max / 4)) + 1));
  return `$${value.toFixed(decimals)}`;
}

export const formatNumber = (value: number) => new Intl.NumberFormat("es-MX").format(Math.round(value));

export const formatCompact = (value: number) => new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 }).format(value);

export const formatPercent = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "—");

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es-MX", { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatDay(day: string): string {
  return new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", day: "2-digit", month: "short" }).format(new Date(`${day}T12:00:00Z`));
}

export const formatDuration = (milliseconds: number) => (milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(1)} s` : `${Math.round(milliseconds)} ms`);

export const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
