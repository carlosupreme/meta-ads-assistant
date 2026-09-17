import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDays, dailySeries, formatAxisUsd, formatUsd, groupUsage, localDay, niceMax, normalizeUsage, resolveRange, sumRows,
} from "../lib/aggregate.ts";

const row = (overrides: Record<string, unknown>) => normalizeUsage({
  day: "2026-09-15", workspace_id: "w1", owner_email: "a@b.mx", feature: "ask", view: "agents", trigger: "user", model: "gpt-5-nano",
  calls: 2, errors: 0, input_tokens: 1000, cached_input_tokens: 0, output_tokens: 500, reasoning_tokens: 200, total_tokens: 1500,
  cost_usd: "0.00025000", duration_ms: 3000, last_call_at: "2026-09-15T18:00:00+00:00",
  ...overrides,
});

describe("usage aggregation", () => {
  it("reads PostgREST numeric strings and adds rows up", () => {
    const totals = sumRows([row({}), row({ cost_usd: "0.0005", calls: 1, last_call_at: "2026-09-16T10:00:00+00:00" })]);
    assert.equal(totals.calls, 3);
    assert.equal(totals.costUsd.toFixed(5), "0.00075");
    assert.equal(totals.lastCallAt, "2026-09-16T10:00:00+00:00");
  });

  it("groups by client with the most expensive first", () => {
    const groups = groupUsage([row({ workspace_id: "w1" }), row({ workspace_id: "w2", cost_usd: "1" }), row({ workspace_id: "w1" })], (item) => item.workspaceId ?? "");
    assert.deepEqual(groups.map((group) => [group.key, group.totals.calls]), [["w2", 2], ["w1", 4]]);
  });

  it("builds Mexico City day ranges and fills days without calls", () => {
    // 03:00 UTC on the 17th is still the 16th in Mexico City.
    assert.equal(localDay(new Date("2026-09-17T03:00:00Z")), "2026-09-16");
    assert.deepEqual(resolveRange("7d", new Date("2026-09-17T18:00:00Z")), { key: "7d", from: "2026-09-11", to: "2026-09-17" });
    assert.deepEqual(resolveRange("month", new Date("2026-09-17T18:00:00Z")), { key: "month", from: "2026-09-01", to: "2026-09-17" });
    assert.equal(resolveRange("otro", new Date("2026-09-17T18:00:00Z")).key, "30d");
    assert.equal(addDays("2026-02-28", 1), "2026-03-01");
    const series = dailySeries([row({ day: "2026-09-15" })], "2026-09-14", "2026-09-16");
    assert.deepEqual(series.map((point) => [point.day, point.totals.calls]), [["2026-09-14", 0], ["2026-09-15", 2], ["2026-09-16", 0]]);
  });

  it("scales the axis to clean values and keeps tiny costs readable", () => {
    assert.equal(niceMax(0.0031), 0.005);
    assert.equal(niceMax(0.3), 0.5);
    assert.equal(niceMax(2), 2);
    assert.equal(niceMax(0), 1);
    assert.equal(formatAxisUsd(0.00125, 0.005), "$0.0013");
    assert.equal(formatUsd(0.00031), "$0.00031");
    assert.equal(formatUsd(12.345), "$12.35");
  });
});
