import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readOutputText } from "../lib/ai/openai.ts";

describe("OpenAI output", () => {
  it("returns the trimmed text of a completed response", () => {
    assert.equal(readOutputText({ status: "completed", output_text: "  Escala Remarketing.  " }), "Escala Remarketing.");
  });

  it("explains when reasoning used the whole token budget", () => {
    assert.throws(
      () => readOutputText({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "" }),
      /razonando/,
    );
  });

  it("does not pass a truncated answer off as complete", () => {
    assert.throws(
      () => readOutputText({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "Te recomiendo" }),
      /límite de tokens/,
    );
  });

  it("never returns an empty answer", () => {
    assert.throws(() => readOutputText({ status: "completed", output_text: "" }), /no devolvió texto/);
  });
});
