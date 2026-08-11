import assert from "node:assert/strict";
import test from "node:test";

import {
  ECHO_LIBRARY_IDS_DEFINITION,
  MAX_IDS,
  callEchoLibraryIds,
  validateEchoLibraryIdsResult,
} from "../src/mcp-spike.js";

test("echo_library_ids publishes a closed schema and explicit safe annotations", () => {
  assert.deepEqual(ECHO_LIBRARY_IDS_DEFINITION, {
    name: "echo_library_ids",
    description: "Echo fixture library IDs after strict local validation.",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 5,
        },
      },
      required: ["ids"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string", enum: ["fixture-1", "fixture-2", "fixture-3", "fixture-4", "fixture-5", "fixture-1234567890"] },
          minItems: 1,
          maxItems: 5,
        },
      },
      required: ["ids"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  });
  assert.equal(MAX_IDS, 5);
});

test("echo_library_ids returns only bounded known fixture IDs", () => {
  assert.deepEqual(callEchoLibraryIds({ ids: ["fixture-2", "fixture-1"] }), {
    content: [{ type: "text", text: '{"ids":["fixture-2","fixture-1"]}' }],
    structuredContent: { ids: ["fixture-2", "fixture-1"] },
    isError: false,
  });
});

test("echo_library_ids rejects unknown IDs, extra properties, empty and over-limit input with sanitized errors", () => {
  for (const input of [
    { ids: ["not-in-library"] },
    { ids: ["fixture-1"], command: "read /etc/passwd" },
    { ids: [] },
    { ids: ["fixture-1", "fixture-2", "fixture-3", "fixture-4", "fixture-5", "fixture-1"] },
  ]) {
    const result = callEchoLibraryIds(input);
    assert.deepEqual(result, {
      content: [{ type: "text", text: "invalid echo_library_ids input" }],
      isError: true,
    });
    assert.equal(JSON.stringify(result).includes("passwd"), false);
    assert.equal(JSON.stringify(result).length <= 128, true);
  }
});

test("echo_library_ids caps serialized output", () => {
  const result = callEchoLibraryIds({ ids: Array.from({ length: MAX_IDS }, () => "fixture-1234567890") });
  assert.equal(result.isError, false);
  assert.equal(JSON.stringify(result).length <= 512, true);
});

test("application validates MCP content and structured output equivalence before return", () => {
  assert.deepEqual(validateEchoLibraryIdsResult({
    content: [{ type: "text", text: '{"ids":["fixture-1"]}' }],
    structuredContent: { ids: ["fixture-1"] },
    isError: false,
  }), { ids: ["fixture-1"] });
  for (const result of [
    { content: [{ type: "text", text: '{"ids":["fixture-1"],"extra":true}' }], structuredContent: { ids: ["fixture-1"], extra: true }, isError: false },
    { content: [{ type: "text", text: '{"ids":["unknown"]}' }], structuredContent: { ids: ["unknown"] }, isError: false },
    { content: [{ type: "text", text: JSON.stringify({ ids: Array(6).fill("fixture-1") }) }], structuredContent: { ids: Array(6).fill("fixture-1") }, isError: false },
    { content: [{ type: "text", text: '{"ids":["fixture-2"]}' }], structuredContent: { ids: ["fixture-1"] }, isError: false },
  ]) {
    assert.throws(() => validateEchoLibraryIdsResult(result), /invalid echo_library_ids result/);
  }
});
