// Pure helpers for the OpenAI usage log: trace context, tokens, cost and the stored row. Type-only imports so it runs under `node --test`.
import type { Organization } from "../types";

export type AiFeature = "analyze_campaigns" | "campaign_review" | "ask" | "ad_variants" | "campaign_plan" | "ad_copy" | "lead_form" | "posts_analysis";

/** App view a call was made from; "monitor" is the scheduled run. */
export type AiView = "dashboard" | "agents" | "campaigns" | "new-campaign" | "monitor";
export const AI_VIEWS: readonly AiView[] = ["dashboard", "agents", "campaigns", "new-campaign", "monitor"];

/** Who and where an OpenAI call is for; stored with every log entry. */
export interface AiTrace {
  workspaceId: string;
  ownerEmail?: string;
  organizationId?: string;
  organizationName?: string;
  /** API route that made the call. */
  route: string;
  view?: AiView;
  trigger: "user" | "cron";
}

export function forOrganization(trace: AiTrace, organization: Pick<Organization, "id" | "name">): AiTrace {
  return { ...trace, organizationId: organization.id, organizationName: organization.name };
}

export interface AiUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

/**
 * USD per million tokens on OpenAI's standard tier. Keep in sync with openai.com/api/pricing when prices or the allowed
 * models change; the stored token counts let past costs be recomputed.
 */
export const AI_PRICES_USD_PER_MILLION: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
};

interface UsageLike {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number } | null;
  output_tokens_details?: { reasoning_tokens?: number } | null;
}

export function usageFrom(usage: UsageLike | null | undefined): AiUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  };
}

/** Estimated USD. Cached input bills at its own rate; reasoning tokens are already counted in output. Unknown models cost 0. */
export function costUsd(model: string, usage: AiUsage): number {
  // Responses name a dated snapshot ("gpt-5-nano-2025-08-07"); prices are listed per model family.
  const price = AI_PRICES_USD_PER_MILLION[model] ?? AI_PRICES_USD_PER_MILLION[model.replace(/-\d{4}-\d{2}-\d{2}$/, "")];
  if (!price) return 0;
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return (uncached * price.input + usage.cachedInputTokens * price.cachedInput + usage.outputTokens * price.output) / 1_000_000;
}

const DATA_URL = /^data:([\w/+.-]+);base64,/;

/** Copy for the log with inline images replaced by their type and size, so a photo does not bloat every row. */
export function redactForLog(value: unknown): unknown {
  if (typeof value === "string") {
    const match = value.match(DATA_URL);
    if (!match) return value;
    const kilobytes = Math.round(((value.length - match[0].length) * 3) / 4 / 1024);
    return `[${match[1]} omitida del log: ${kilobytes} KB]`;
  }
  if (Array.isArray(value)) return value.map(redactForLog);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactForLog(item)]));
  return value;
}

function errorDetails(error: unknown): { name: string; message: string; status?: number; code?: string } | null {
  if (error === undefined) return null;
  if (!(error instanceof Error)) return { name: "Error", message: String(error) };
  const extra = error as Error & { status?: unknown; code?: unknown };
  return {
    name: error.name,
    message: error.message,
    ...(typeof extra.status === "number" && { status: extra.status }),
    ...(typeof extra.code === "string" && { code: extra.code }),
  };
}

export interface AiLogInput {
  feature: AiFeature;
  trace: AiTrace;
  /** Parameters sent to OpenAI. */
  request: { model?: string };
  /** OpenAI's response exactly as returned, when there was one. */
  response?: { id?: string; model?: string; usage?: UsageLike | null };
  /** What Pulso read from the response. */
  result?: unknown;
  error?: unknown;
  durationMs: number;
  at: Date;
}

/** The pulso_ai_logs row for one call: columns to filter and add up, plus the whole call as JSON in `entry`. */
export function buildAiLogRow(input: AiLogInput) {
  const usage = usageFrom(input.response?.usage);
  const model = input.response?.model ?? input.request.model ?? "desconocido";
  const error = errorDetails(input.error);
  return {
    created_at: input.at.toISOString(),
    workspace_id: input.trace.workspaceId,
    owner_email: input.trace.ownerEmail ?? null,
    organization_id: input.trace.organizationId ?? null,
    organization_name: input.trace.organizationName ?? null,
    feature: input.feature,
    route: input.trace.route,
    view: input.trace.view ?? null,
    trigger: input.trace.trigger,
    model,
    status: error ? "error" as const : "ok" as const,
    duration_ms: Math.round(input.durationMs),
    input_tokens: usage.inputTokens,
    cached_input_tokens: usage.cachedInputTokens,
    output_tokens: usage.outputTokens,
    reasoning_tokens: usage.reasoningTokens,
    total_tokens: usage.totalTokens,
    cost_usd: costUsd(model, usage),
    openai_response_id: input.response?.id ?? null,
    error: error?.message ?? null,
    entry: {
      version: 1,
      trace: input.trace,
      request: redactForLog(input.request),
      response: input.response ?? null,
      result: input.result ?? null,
      error,
    },
  };
}
