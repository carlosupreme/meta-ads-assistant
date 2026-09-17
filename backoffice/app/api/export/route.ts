import { NextResponse } from "next/server";
import { FEATURE_LABELS, UUID, resolveRange } from "@/lib/aggregate";
import { EXPORT_LIMIT, exportCalls } from "@/lib/data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Calls with their full JSON for the period and filters, as a download. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const range = resolveRange(params.get("range") ?? undefined, new Date());
  const workspace = params.get("workspace");
  const feature = params.get("feature");
  const status = params.get("status");
  const rows = await exportCalls({
    from: range.from,
    to: range.to,
    workspaceId: workspace && UUID.test(workspace) ? workspace : undefined,
    feature: feature && FEATURE_LABELS[feature] ? feature : undefined,
    status: status === "ok" || status === "error" ? status : undefined,
  });
  return new NextResponse(JSON.stringify(rows, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="pulso-ia-${range.from}_${range.to}.json"`,
      // The download stops at the limit; the header says so without breaking the JSON.
      ...(rows.length >= EXPORT_LIMIT && { "X-Pulso-Truncated": String(EXPORT_LIMIT) }),
    },
  });
}
