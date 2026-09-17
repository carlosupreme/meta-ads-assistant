import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAiLogRow, costUsd, forOrganization, redactForLog, usageFrom, type AiTrace } from "../lib/ai/usage.ts";

const trace: AiTrace = { workspaceId: "ws-1", ownerEmail: "dueño@negocio.mx", route: "/api/ai/ad-copy", view: "new-campaign", trigger: "user" };

describe("AI usage log", () => {
  it("prices cached input, output and dated model snapshots", () => {
    const usage = usageFrom({
      input_tokens: 1_000_000, input_tokens_details: { cached_tokens: 200_000 },
      output_tokens: 500_000, output_tokens_details: { reasoning_tokens: 300_000 }, total_tokens: 1_500_000,
    });
    assert.deepEqual(usage, { inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 500_000, reasoningTokens: 300_000, totalTokens: 1_500_000 });
    // 800k × $0.05 + 200k × $0.005 + 500k × $0.40 per million
    assert.equal(costUsd("gpt-5-nano-2025-08-07", usage).toFixed(6), "0.241000");
    assert.equal(costUsd("modelo-desconocido", usage), 0);
  });

  it("keeps images out of stored requests", () => {
    const request = { model: "gpt-5-nano", input: [{ content: [{ type: "input_text", text: "hola" }, { type: "input_image", image_url: `data:image/jpeg;base64,${"A".repeat(4096)}` }] }] };
    assert.deepEqual(redactForLog(request), {
      model: "gpt-5-nano",
      input: [{ content: [{ type: "input_text", text: "hola" }, { type: "input_image", image_url: "[image/jpeg omitida del log: 3 KB]" }] }],
    });
  });

  it("stores who, where, tokens, cost and the exact response", () => {
    const response = { id: "resp_1", model: "gpt-5-nano-2025-08-07", usage: { input_tokens: 1000, output_tokens: 2000, total_tokens: 3000 }, output_text: "{}" };
    const row = buildAiLogRow({
      feature: "ad_copy", trace: forOrganization(trace, { id: "meta-1", name: "Villa 7" }), request: { model: "gpt-5-nano" },
      response, result: ["copy"], durationMs: 1234.6, at: new Date("2026-09-17T12:00:00Z"),
    });
    assert.equal(row.status, "ok");
    assert.equal(row.organization_name, "Villa 7");
    assert.equal(row.view, "new-campaign");
    assert.equal(row.model, "gpt-5-nano-2025-08-07");
    assert.equal(row.duration_ms, 1235);
    assert.equal(row.cost_usd.toFixed(8), "0.00085000");
    assert.deepEqual(row.entry.response, response);
    assert.deepEqual(row.entry.result, ["copy"]);
  });

  it("records failures with the error and whatever OpenAI returned", () => {
    const failure = Object.assign(new Error("OpenAI usó todos los tokens razonando"), { status: 400 });
    const row = buildAiLogRow({ feature: "ask", trace, request: { model: "gpt-5-nano" }, error: failure, durationMs: 10, at: new Date() });
    assert.equal(row.status, "error");
    assert.equal(row.error, "OpenAI usó todos los tokens razonando");
    assert.deepEqual(row.entry.error, { name: "Error", message: "OpenAI usó todos los tokens razonando", status: 400 });
    assert.equal(row.input_tokens, 0);
  });
});
