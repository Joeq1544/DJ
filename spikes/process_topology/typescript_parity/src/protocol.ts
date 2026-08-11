import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

export const MAX_PAYLOAD = 65_536;
export const MAX_JSON_DEPTH = 32;
export const MAX_JSON_NODES = 4_096;
export const MIN_JSON_INTEGER = -(1n << 63n);
export const MAX_JSON_INTEGER = (1n << 63n) - 1n;

const CAPABILITY_MIN_BYTES = 32;
const CAPABILITY_MAX_BYTES = 128;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]+$/u;

export type JsonValue = null | boolean | string | number | bigint | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export type Handshake = {
  type: "handshake";
  version: 1;
  role: "trusted-main" | "mcp-bridge";
  session_id: string;
  capability: string;
};

export type Request = {
  type: "request";
  id: string;
  operation: string;
  payload: Record<string, unknown>;
  idempotency_key?: string;
};

export class ProtocolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
  }

  asObject(): { code: string; message: string } {
    return { code: this.code, message: this.message };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new ProtocolError("invalid_unicode", "JSON string contains an unpaired surrogate");
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new ProtocolError("invalid_unicode", "JSON string contains an unpaired surrogate");
    }
  }
}

function utf8Length(value: string): number {
  assertValidUnicode(value);
  return Buffer.byteLength(value, "utf8");
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

type Counter = { nodes: number };

function countNode(counter: Counter, depth: number): void {
  counter.nodes += 1;
  if (counter.nodes > MAX_JSON_NODES) {
    throw new ProtocolError("json_too_many_nodes", "JSON value exceeds the node bound");
  }
  if (depth > MAX_JSON_DEPTH) {
    throw new ProtocolError("json_too_deep", "JSON value exceeds the nesting bound");
  }
}

function serialize(value: unknown, depth: number, counter: Counter): string {
  countNode(counter, depth);
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertValidUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") {
    if (value < MIN_JSON_INTEGER || value > MAX_JSON_INTEGER) {
      throw new ProtocolError("integer_out_of_range", "JSON integer exceeds signed 64-bit range");
    }
    return value.toString(10);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ProtocolError("invalid_json_constant", "JSON numbers must be finite");
    }
    if (Object.is(value, -0) || !Number.isInteger(value)) {
      throw new ProtocolError(
        "float_contract_unsupported",
        "JSON transport uses an integer-only numeric contract",
      );
    }
    if (!Number.isSafeInteger(value)) {
      throw new ProtocolError(
        "integer_precision_loss",
        "unsafe JavaScript integers must be supplied as bigint",
      );
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_NODES - counter.nodes) {
      throw new ProtocolError("json_too_many_nodes", "JSON value exceeds the node bound");
    }
    const children: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor)) {
        throw new ProtocolError("invalid_json_type", "value is not representable as JSON");
      }
      children.push(serialize(descriptor.value, depth + 1, counter));
    }
    return `[${children.join(",")}]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    for (const key of keys) assertValidUnicode(key);
    keys.sort(compareUnicodeCodePoints);
    const members = keys.map((key) => {
      const encodedKey = serialize(key, depth + 1, counter);
      const encodedValue = serialize(value[key], depth + 1, counter);
      return `${encodedKey}:${encodedValue}`;
    });
    return `{${members.join(",")}}`;
  }
  throw new ProtocolError("invalid_json_type", "value is not representable as JSON");
}

export function canonicalJson(value: unknown): Buffer {
  return Buffer.from(serialize(value, 0, { nodes: 0 }), "utf8");
}

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

class StrictJsonParser {
  private position = 0;
  private nodes = 0;
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  parse(): unknown {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.position !== this.source.length) this.invalidJson();
    return value;
  }

  private count(depth: number): void {
    this.nodes += 1;
    if (this.nodes > MAX_JSON_NODES) {
      throw new ProtocolError("json_too_many_nodes", "JSON value exceeds the node bound");
    }
    if (depth > MAX_JSON_DEPTH) {
      throw new ProtocolError("json_too_deep", "JSON value exceeds the nesting bound");
    }
  }

  private parseValue(depth: number): unknown {
    this.count(depth);
    const character = this.source[this.position];
    if (character === "{") return this.parseObject(depth);
    if (character === "[") return this.parseArray(depth);
    if (character === '"') return this.parseString();
    if (this.source.startsWith("true", this.position)) return this.parseLiteral("true", true);
    if (this.source.startsWith("false", this.position)) return this.parseLiteral("false", false);
    if (this.source.startsWith("null", this.position)) return this.parseLiteral("null", null);
    if (
      this.source.startsWith("NaN", this.position)
      || this.source.startsWith("Infinity", this.position)
      || this.source.startsWith("-Infinity", this.position)
    ) {
      throw new ProtocolError("invalid_json_constant", "JSON numbers must be finite");
    }
    if (character === "-" || (character !== undefined && character >= "0" && character <= "9")) {
      return this.parseNumber();
    }
    return this.invalidJson();
  }

  private parseObject(depth: number): JsonObject {
    this.position += 1;
    const result: JsonObject = {};
    this.skipWhitespace();
    if (this.source[this.position] === "}") {
      this.position += 1;
      return result;
    }
    while (true) {
      if (this.source[this.position] !== '"') this.invalidJson();
      this.count(depth + 1);
      const key = this.parseString();
      if (Object.hasOwn(result, key)) {
        throw new ProtocolError("duplicate_key", `duplicate JSON object key: ${key}`);
      }
      this.skipWhitespace();
      if (this.source[this.position] !== ":") this.invalidJson();
      this.position += 1;
      this.skipWhitespace();
      const value = this.parseValue(depth + 1) as JsonValue;
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
      this.skipWhitespace();
      const separator = this.source[this.position];
      if (separator === "}") {
        this.position += 1;
        return result;
      }
      if (separator !== ",") this.invalidJson();
      this.position += 1;
      this.skipWhitespace();
    }
  }

  private parseArray(depth: number): JsonValue[] {
    this.position += 1;
    const result: JsonValue[] = [];
    this.skipWhitespace();
    if (this.source[this.position] === "]") {
      this.position += 1;
      return result;
    }
    while (true) {
      result.push(this.parseValue(depth + 1) as JsonValue);
      this.skipWhitespace();
      const separator = this.source[this.position];
      if (separator === "]") {
        this.position += 1;
        return result;
      }
      if (separator !== ",") this.invalidJson();
      this.position += 1;
      this.skipWhitespace();
    }
  }

  private parseString(): string {
    const start = this.position;
    this.position += 1;
    let escaped = false;
    while (this.position < this.source.length) {
      const unit = this.source.charCodeAt(this.position);
      if (!escaped && unit === 0x22) {
        this.position += 1;
        const token = this.source.slice(start, this.position);
        let value: unknown;
        try {
          value = JSON.parse(token) as unknown;
        } catch {
          return this.invalidJson();
        }
        if (typeof value !== "string") return this.invalidJson();
        assertValidUnicode(value);
        return value;
      }
      if (!escaped && unit < 0x20) return this.invalidJson();
      if (!escaped && unit === 0x5c) {
        escaped = true;
      } else {
        escaped = false;
      }
      this.position += 1;
    }
    return this.invalidJson();
  }

  private parseNumber(): number | bigint {
    const remainder = this.source.slice(this.position);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(remainder);
    if (!match) return this.invalidJson();
    const token = match[0];
    this.position += token.length;
    if (token.includes(".") || token.includes("e") || token.includes("E")) {
      const value = Number(token);
      if (!Number.isFinite(value)) {
        throw new ProtocolError("invalid_json_constant", "JSON numbers must be finite");
      }
      throw new ProtocolError(
        "float_contract_unsupported",
        "JSON transport uses an integer-only numeric contract",
      );
    }
    const integer = BigInt(token);
    if (integer < MIN_JSON_INTEGER || integer > MAX_JSON_INTEGER) {
      throw new ProtocolError("integer_out_of_range", "JSON integer exceeds signed 64-bit range");
    }
    if (integer >= BigInt(Number.MIN_SAFE_INTEGER) && integer <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(integer);
    }
    return integer;
  }

  private parseLiteral<T>(token: string, value: T): T {
    this.position += token.length;
    return value;
  }

  private skipWhitespace(): void {
    while (
      this.source[this.position] === " "
      || this.source[this.position] === "\n"
      || this.source[this.position] === "\r"
      || this.source[this.position] === "\t"
    ) {
      this.position += 1;
    }
  }

  private invalidJson(): never {
    throw new ProtocolError("invalid_json", "frame payload is not valid JSON");
  }
}

export function decodePayload(payload: Uint8Array): JsonObject {
  if (payload.length >= 3 && payload[0] === 0xef && payload[1] === 0xbb && payload[2] === 0xbf) {
    throw new ProtocolError("invalid_json", "frame payload is not valid JSON");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch {
    throw new ProtocolError("invalid_utf8", "frame payload is not valid UTF-8");
  }
  const value: unknown = new StrictJsonParser(text).parse();
  if (!isRecord(value)) {
    throw new ProtocolError("invalid_top_level", "frame payload must be a JSON object");
  }
  return value as JsonObject;
}

export function encodeFrame(value: JsonObject): Buffer {
  if (!isRecord(value)) {
    throw new ProtocolError("invalid_top_level", "frame payload must be a JSON object");
  }
  const payload = canonicalJson(value);
  if (payload.length === 0) {
    throw new ProtocolError("frame_empty", "frame payload cannot be empty");
  }
  if (payload.length > MAX_PAYLOAD) {
    throw new ProtocolError("frame_too_large", "frame payload exceeds 65536 bytes");
  }
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

export class FrameDecoder {
  private buffer = Buffer.alloc(0);
  private expected: number | undefined;

  feed(data: Uint8Array): JsonObject[] {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(data)]);
    const output: JsonObject[] = [];
    while (true) {
      if (this.expected === undefined) {
        if (this.buffer.length < 4) break;
        this.expected = this.buffer.readUInt32BE(0);
        this.buffer = this.buffer.subarray(4);
        if (this.expected === 0) {
          throw new ProtocolError("frame_empty", "zero-length frames are forbidden");
        }
        if (this.expected > MAX_PAYLOAD) {
          throw new ProtocolError("frame_too_large", "frame payload exceeds 65536 bytes");
        }
      }
      if (this.buffer.length < this.expected) break;
      const payload = this.buffer.subarray(0, this.expected);
      this.buffer = this.buffer.subarray(this.expected);
      this.expected = undefined;
      output.push(decodePayload(payload));
    }
    return output;
  }

  finish(): void {
    if (this.buffer.length !== 0 || this.expected !== undefined) {
      throw new ProtocolError("incomplete_frame", "stream ended with a trailing incomplete frame");
    }
  }
}

function boundedString(value: unknown, code: string, label: string, maximum = 128): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProtocolError(code, `${label} must be a non-empty bounded string`);
  }
  let length: number;
  try {
    length = utf8Length(value);
  } catch {
    throw new ProtocolError(code, `${label} must be a non-empty bounded string`);
  }
  if (length > maximum) {
    throw new ProtocolError(code, `${label} must be a non-empty bounded string`);
  }
  return value;
}

function validateCapabilityToken(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length < CAPABILITY_MIN_BYTES
    || value.length > CAPABILITY_MAX_BYTES
    || !CAPABILITY_PATTERN.test(value)
  ) {
    throw new ProtocolError(
      "invalid_handshake_capability",
      "capability must be a bounded ASCII URL-safe token",
    );
  }
  return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

export function validateHandshake(value: unknown): Handshake {
  const record = isRecord(value) ? value : Object.create(null) as Record<string, unknown>;
  if (record.type !== "handshake") {
    throw new ProtocolError("handshake_required", "first client message must be a handshake");
  }
  if (record.version !== 1) {
    throw new ProtocolError("version_mismatch", "protocol version 1 is required");
  }
  if (record.role !== "trusted-main" && record.role !== "mcp-bridge") {
    throw new ProtocolError("invalid_role", "role must be trusted-main or mcp-bridge");
  }
  boundedString(record.session_id, "invalid_session_id", "session_id");
  validateCapabilityToken(record.capability);
  if (!exactKeys(record, ["type", "version", "role", "session_id", "capability"])) {
    throw new ProtocolError("invalid_handshake_schema", "handshake has unknown or missing fields");
  }
  return value as Handshake;
}

export function validateRequest(value: unknown): Request {
  const record = isRecord(value) ? value : Object.create(null) as Record<string, unknown>;
  if (record.type !== "request") {
    throw new ProtocolError("invalid_request", "message must be a request");
  }
  boundedString(record.id, "invalid_request_id", "request id");
  boundedString(record.operation, "invalid_operation", "operation");
  if (!isRecord(record.payload)) {
    throw new ProtocolError("invalid_request_payload", "request payload must be an object");
  }
  const allowed = new Set(["type", "id", "operation", "payload", "idempotency_key"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new ProtocolError("invalid_request_schema", "request has unknown fields");
  }
  if (Object.hasOwn(record, "idempotency_key")) {
    boundedString(record.idempotency_key, "invalid_idempotency_key", "idempotency key");
  }
  return value as Request;
}
