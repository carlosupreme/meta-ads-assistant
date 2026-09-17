import { getSupabaseAdmin } from "../supabase/admin.ts";
import type { Json } from "../supabase/database.types";
import { buildAiLogRow, type AiLogInput } from "./usage.ts";

/** Stores one OpenAI call. Logging never breaks the feature: a failed insert only reaches the server log. */
export async function recordAiCall(input: AiLogInput): Promise<void> {
  try {
    const row = buildAiLogRow(input);
    // Round-trip through JSON so the SDK response class and undefined fields become plain JSON.
    const { error } = await getSupabaseAdmin().from("pulso_ai_logs").insert({ ...row, entry: JSON.parse(JSON.stringify(row.entry)) as Json });
    if (error) console.error("Could not store AI usage log", error.message);
  } catch (error) {
    console.error("Could not store AI usage log", error);
  }
}
