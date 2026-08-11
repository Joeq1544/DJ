import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

import {
  FrameDecoder,
  MAX_PAYLOAD,
  ProtocolError,
  type JsonObject,
  canonicalHash,
  canonicalJson,
  decodePayload,
  encodeFrame,
  validateHandshake,
  validateRequest,
} from "../src/protocol.ts";

type OracleCommand = Record<string, unknown>;
type OracleResponse = {
  ok: boolean;
  error?: string;
  canonical_base64?: string;
  frame_base64?: string;
  frames_base64?: string[];
  hash?: string;
  message?: string;
};

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../../../..");
const oraclePath = resolve(here, "../oracle.py");

function oracle(commands: OracleCommand[]): OracleResponse[] {
  const result = spawnSync("python3", ["-B", oraclePath], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONPATH: projectRoot },
    input: `${commands.map((command) => JSON.stringify(command)).join("\n")}\n`,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `Python oracle failed: ${result.stderr}`);
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  assert.equal(lines.length, commands.length, `unexpected oracle output: ${result.stdout}`);
  return lines.map((line) => JSON.parse(line) as OracleResponse);
}

function oracleOne(command: OracleCommand): OracleResponse {
  const response = oracle([command])[0];
  assert.ok(response);
  return response;
}

function decodedBase64(value: string | undefined): Buffer {
  assert.ok(value);
  return Buffer.from(value, "base64");
}

function expectProtocolError(action: () => unknown, code: string): ProtocolError {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ProtocolError, `expected ProtocolError ${code}`);
  assert.equal(caught.code, code);
  return caught;
}

test("canonical bytes, SHA-256, and Unicode code-point key ordering match Python", () => {
  const value = { "😀": "astral", "\ue000": "bmp", z: "é", a: [2, 1] };
  const expected = Buffer.from('{"a":[2,1],"z":"é","":"bmp","😀":"astral"}', "utf8");
  const response = oracleOne({
    action: "canonical",
    raw: '{"😀":"astral","":"bmp","z":"é","a":[2,1]}',
  });

  assert.equal(response.ok, true);
  assert.deepEqual(canonicalJson(value), expected);
  assert.deepEqual(canonicalJson(value), decodedBase64(response.canonical_base64));
  assert.equal(canonicalHash(value), "b5219b865fb55eda907bf29db6df5401e50ab60e68815e173dcdfa3e8fb8daf8");
  assert.equal(canonicalHash(value), response.hash);
});

test("signed-64 bigint boundaries match Python while unsafe Number input fails closed", () => {
  const source = '{"max":9223372036854775807,"min":-9223372036854775808,"safe":9007199254740991}';
  const value = {
    max: 9_223_372_036_854_775_807n,
    min: -9_223_372_036_854_775_808n,
    safe: 9_007_199_254_740_991,
  };
  const response = oracleOne({ action: "canonical", raw: source });

  assert.equal(canonicalJson(value).toString("utf8"), source);
  assert.deepEqual(canonicalJson(value), decodedBase64(response.canonical_base64));
  assert.deepEqual(decodePayload(Buffer.from(source)), value);
  expectProtocolError(
    () => canonicalJson({ imprecise: Number.MAX_SAFE_INTEGER + 1 }),
    "integer_precision_loss",
  );
  expectProtocolError(
    () => canonicalJson({ tooLarge: 9_223_372_036_854_775_808n }),
    "integer_out_of_range",
  );
});

test("finite float spellings and negative zero fail closed with Python parity", () => {
  const cases = [
    '{"v":1.0}',
    '{"v":-0.0}',
    '{"v":1e-7}',
    '{"v":1e20}',
  ] as const;

  for (const source of cases) {
    const response = oracleOne({
      action: "decode_payload",
      payload_base64: Buffer.from(source).toString("base64"),
      include_message: true,
    });
    const error = expectProtocolError(
      () => decodePayload(Buffer.from(source)),
      "float_contract_unsupported",
    );
    assert.deepEqual(response, {
      ok: false,
      error: "float_contract_unsupported",
      message: "JSON transport uses an integer-only numeric contract",
    });
    assert.equal(error.message, response.message);
  }

  expectProtocolError(() => canonicalJson({ value: -0 }), "float_contract_unsupported");
  expectProtocolError(() => canonicalJson({ value: 0.5 }), "float_contract_unsupported");
  expectProtocolError(() => canonicalJson({ value: 1e20 }), "integer_precision_loss");
});

test("canonical input rejects nonfinite numbers, invalid Unicode, depth, and node excess", () => {
  expectProtocolError(() => canonicalJson({ value: Number.NaN }), "invalid_json_constant");
  expectProtocolError(() => canonicalJson({ value: Number.POSITIVE_INFINITY }), "invalid_json_constant");
  expectProtocolError(() => canonicalJson({ value: "\ud800" }), "invalid_unicode");

  let deep: unknown = 0;
  for (let index = 0; index < 34; index += 1) deep = [deep];
  expectProtocolError(() => canonicalJson({ value: deep }), "json_too_deep");
  expectProtocolError(
    () => canonicalJson({ value: Array.from({ length: 4_097 }, () => 0) }),
    "json_too_many_nodes",
  );
});

test("canonical input rejects sparse and accessor-backed arrays before framing", () => {
  const sparse = new Array<JsonObject>(5_000);
  const sparseRequest = { type: "request", id: "sparse", operation: "ping", payload: { items: sparse } };
  assert.deepEqual(validateRequest(sparseRequest), sparseRequest);
  expectProtocolError(() => encodeFrame(sparseRequest), "json_too_many_nodes");
  expectProtocolError(
    () => encodeFrame({ type: "request", id: "hole", operation: "ping", payload: { items: new Array(1) } }),
    "invalid_json_type",
  );

  let getterCalls = 0;
  const accessor: string[] = [];
  Object.defineProperty(accessor, 0, {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "unsafe";
    },
  });
  expectProtocolError(
    () => encodeFrame({ type: "request", id: "accessor", operation: "ping", payload: { items: accessor } }),
    "invalid_json_type",
  );
  assert.equal(getterCalls, 0);
});

test("four-byte big-endian frames and the exact 65,536-byte cap match Python", () => {
  const maximumValue = { x: "a".repeat(MAX_PAYLOAD - 8) };
  const maximumSource = `{"x":"${"a".repeat(MAX_PAYLOAD - 8)}"}`;
  const response = oracleOne({ action: "encode_frame", raw: maximumSource });
  const encoded = encodeFrame(maximumValue);

  assert.equal(encoded.readUInt32BE(0), MAX_PAYLOAD);
  assert.equal(encoded.length, MAX_PAYLOAD + 4);
  assert.deepEqual(encoded, decodedBase64(response.frame_base64));
  expectProtocolError(
    () => encodeFrame({ x: "a".repeat(MAX_PAYLOAD - 7) }),
    "frame_too_large",
  );
});

test("split and coalesced frames decode identically in TypeScript and Python", () => {
  const first = encodeFrame({ kind: "one" });
  const second = encodeFrame({ kind: "two" });
  const chunks = [first.subarray(0, 2), Buffer.concat([first.subarray(2), second])];
  const decoder = new FrameDecoder();

  assert.deepEqual(decoder.feed(chunks[0]!), []);
  assert.deepEqual(decoder.feed(chunks[1]!), [{ kind: "one" }, { kind: "two" }]);
  decoder.finish();

  const response = oracleOne({
    action: "decode_chunks",
    chunks_base64: chunks.map((chunk) => chunk.toString("base64")),
  });
  assert.deepEqual(
    response.frames_base64?.map((frame) => decodedBase64(frame).toString("utf8")),
    ['{"kind":"one"}', '{"kind":"two"}'],
  );
});

test("frame headers and trailing fragments fail with the Python error codes", () => {
  for (const [length, code] of [[0, "frame_empty"], [MAX_PAYLOAD + 1, "frame_too_large"]] as const) {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(length);
    const decoder = new FrameDecoder();
    expectProtocolError(() => decoder.feed(header), code);
    const response = oracleOne({
      action: "decode_chunks",
      chunks_base64: [header.toString("base64")],
      finish: false,
    });
    assert.deepEqual(response, { ok: false, error: code });
  }

  for (const partial of [Buffer.from([0]), Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from('{"x"')])]) {
    const decoder = new FrameDecoder();
    decoder.feed(partial);
    expectProtocolError(() => decoder.finish(), "incomplete_frame");
    const response = oracleOne({
      action: "decode_chunks",
      chunks_base64: [partial.toString("base64")],
      finish: true,
    });
    assert.deepEqual(response, { ok: false, error: "incomplete_frame" });
  }
});

test("hostile UTF-8, duplicate keys, constants, bounds, depth, and nodes match Python", () => {
  const cases: Array<[Buffer, string]> = [
    [Buffer.from([0xff]), "invalid_utf8"],
    [Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), "invalid_json"],
    [Buffer.from("[]"), "invalid_top_level"],
    [Buffer.from('{"a":1,"a":2}'), "duplicate_key"],
    [Buffer.from('{"a":1,"\\u0061":2}'), "duplicate_key"],
    [Buffer.from('{"x":NaN}'), "invalid_json_constant"],
    [Buffer.from('{"x":1e999}'), "invalid_json_constant"],
    [Buffer.from('{"x":"\\ud800"}'), "invalid_unicode"],
    [Buffer.from('{"x":9223372036854775808}'), "integer_out_of_range"],
    [Buffer.from('{"x":-9223372036854775809}'), "integer_out_of_range"],
    [Buffer.from(`{"x":${"[".repeat(34)}0${"]".repeat(34)}}`), "json_too_deep"],
    [Buffer.from(`{"x":[${Array.from({ length: 4_097 }, () => "0").join(",")}]}`), "json_too_many_nodes"],
    [Buffer.from("{not-json}"), "invalid_json"],
  ];

  const responses = oracle(cases.map(([payload]) => ({
    action: "decode_payload",
    payload_base64: payload.toString("base64"),
  })));
  cases.forEach(([payload, code], index) => {
    expectProtocolError(() => decodePayload(payload), code);
    assert.deepEqual(responses[index], { ok: false, error: code });
  });
});

test("both roles and boundary-sized capabilities validate exactly like Python", () => {
  for (const role of ["trusted-main", "mcp-bridge"] as const) {
    for (const capability of ["a".repeat(32), "z".repeat(128)]) {
      const value = { type: "handshake", version: 1, role, session_id: "session", capability };
      const source = JSON.stringify(value);
      const response = oracleOne({ action: "validate_handshake", raw: source });
      assert.equal(response.ok, true);
      assert.deepEqual(validateHandshake(value), value);
      assert.deepEqual(canonicalJson(value), decodedBase64(response.canonical_base64));
    }
  }
});

test("handshake validation order, exact fields, and string byte bounds match Python", () => {
  const valid = {
    type: "handshake",
    version: 1,
    role: "trusted-main",
    session_id: "main-1",
    capability: "t".repeat(43),
  };
  const cases: Array<[Record<string, unknown>, string]> = [
    [{}, "handshake_required"],
    [{ ...valid, version: 2 }, "version_mismatch"],
    [{ ...valid, role: "other" }, "invalid_role"],
    [{ ...valid, session_id: "" }, "invalid_session_id"],
    [{ ...valid, session_id: "é".repeat(65) }, "invalid_session_id"],
    [{ type: valid.type, version: valid.version, role: valid.role, session_id: valid.session_id }, "invalid_handshake_capability"],
    [{ ...valid, capability: "a".repeat(31) }, "invalid_handshake_capability"],
    [{ ...valid, capability: "a".repeat(129) }, "invalid_handshake_capability"],
    [{ ...valid, capability: "é".repeat(32) }, "invalid_handshake_capability"],
    [{ ...valid, extra: true }, "invalid_handshake_schema"],
  ];
  const responses = oracle(cases.map(([value]) => ({
    action: "validate_handshake",
    raw: JSON.stringify(value),
  })));

  cases.forEach(([value, code], index) => {
    expectProtocolError(() => validateHandshake(value), code);
    assert.deepEqual(responses[index], { ok: false, error: code });
  });
});

test("boolean protocol versions are rejected with exact Python parity", () => {
  const value = {
    type: "handshake",
    version: true,
    role: "trusted-main",
    session_id: "main-boolean",
    capability: "t".repeat(43),
  };
  const response = oracleOne({
    action: "validate_handshake",
    raw: JSON.stringify(value),
    include_message: true,
  });

  const error = expectProtocolError(() => validateHandshake(value), "version_mismatch");
  assert.deepEqual(response, {
    ok: false,
    error: "version_mismatch",
    message: "protocol version 1 is required",
  });
  assert.equal(error.message, response.message);
});

test("request required fields, optional idempotency key, and exact schema match Python", () => {
  const accepted = [
    { type: "request", id: "r1", operation: "ping", payload: {} },
    { type: "request", id: "r2", operation: "insert", payload: { value: "safe" }, idempotency_key: "key-1" },
    {
      type: "request",
      id: "r3",
      operation: "create_proposal",
      payload: {
        tool: "insert_row",
        payload: { value: "safe" },
        destination: "app_db.rows",
        ttl_ms: 300_000,
      },
    },
  ];
  for (const value of accepted) {
    const response = oracleOne({ action: "validate_request", raw: JSON.stringify(value) });
    assert.equal(response.ok, true);
    assert.deepEqual(validateRequest(value), value);
    assert.deepEqual(canonicalJson(value), decodedBase64(response.canonical_base64));
  }

  const valid = accepted[0]!;
  const cases: Array<[Record<string, unknown>, string]> = [
    [{}, "invalid_request"],
    [{ ...valid, id: "" }, "invalid_request_id"],
    [{ ...valid, id: "é".repeat(65) }, "invalid_request_id"],
    [{ ...valid, operation: "" }, "invalid_operation"],
    [{ ...valid, payload: [] }, "invalid_request_payload"],
    [{ ...valid, extra: true }, "invalid_request_schema"],
    [{ ...valid, idempotency_key: "" }, "invalid_idempotency_key"],
  ];
  const responses = oracle(cases.map(([value]) => ({
    action: "validate_request",
    raw: JSON.stringify(value),
  })));
  cases.forEach(([value, code], index) => {
    expectProtocolError(() => validateRequest(value), code);
    assert.deepEqual(responses[index], { ok: false, error: code });
  });
});

test("integer delay_ms request validates and frames with Python parity", () => {
  const value = { type: "request", id: "r1", operation: "delayed_result", payload: { delay_ms: 150 } };
  const source = JSON.stringify(value);
  const response = oracleOne({ action: "validate_request", raw: source });
  const frameResponse = oracleOne({ action: "encode_frame", raw: source });

  assert.equal(response.ok, true);
  assert.deepEqual(validateRequest(value), value);
  assert.deepEqual(encodeFrame(value), decodedBase64(frameResponse.frame_base64));
});

test("representative progress and every terminal status have byte-for-byte frame parity", () => {
  const envelopes: JsonObject[] = [
    { type: "progress", request_id: "r1", completed: 0, total: 1 },
    { type: "terminal", request_id: "r1", status: "succeeded", result: { pong: true } },
    { type: "terminal", request_id: "r2", status: "failed", error: { code: "bad", message: "safe" } },
    { type: "terminal", request_id: "r3", status: "cancelled", result: { cancelled: true } },
    { type: "terminal", request_id: "r4", status: "outcome-unknown", error: { code: "internal_error", message: "unknown" } },
  ];

  const responses = oracle(envelopes.map((value) => ({
    action: "encode_frame",
    raw: JSON.stringify(value),
  })));
  envelopes.forEach((value, index) => {
    const encoded = encodeFrame(value);
    assert.deepEqual(encoded, decodedBase64(responses[index]?.frame_base64));
    const decoder = new FrameDecoder();
    assert.deepEqual(decoder.feed(encoded), [value]);
    decoder.finish();
  });
});
