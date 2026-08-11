export const MAX_IDS = 5;
const OUTPUT_CAP_BYTES = 512;
const KNOWN_ID_VALUES = [
  "fixture-1",
  "fixture-2",
  "fixture-3",
  "fixture-4",
  "fixture-5",
  "fixture-1234567890",
] as const;
const KNOWN_IDS = new Set<string>(KNOWN_ID_VALUES);

export const ECHO_LIBRARY_IDS_DEFINITION = {
  name: "echo_library_ids",
  description: "Echo fixture library IDs after strict local validation.",
  inputSchema: {
    type: "object",
    properties: {
      ids: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: MAX_IDS,
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
        items: { type: "string", enum: [...KNOWN_ID_VALUES] },
        minItems: 1,
        maxItems: MAX_IDS,
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
} as const;

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: { ids: string[] };
  isError: boolean;
};

const SAFE_ERROR: ToolResult = {
  content: [{ type: "text", text: "invalid echo_library_ids input" }],
  isError: true,
};

export function callEchoLibraryIds(input: unknown): ToolResult {
  if (!isValidInput(input)) return SAFE_ERROR;
  const structuredContent = { ids: [...input.ids] };
  const result: ToolResult = {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: false,
  };
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > OUTPUT_CAP_BYTES) return SAFE_ERROR;
  validateEchoLibraryIdsResult(result);
  return result;
}

export function validateEchoLibraryIdsResult(result: unknown): { ids: string[] } {
  try {
    if (typeof result !== "object" || result === null || Array.isArray(result)) throw new Error();
    const value = result as Record<string, unknown>;
    if (value.isError !== false || !Array.isArray(value.content) || value.content.length !== 1) throw new Error();
    const block = value.content[0] as Record<string, unknown>;
    if (block.type !== "text" || typeof block.text !== "string" || Buffer.byteLength(block.text, "utf8") > OUTPUT_CAP_BYTES) throw new Error();
    const structured = validateIdsObject(value.structuredContent);
    const content = validateIdsObject(JSON.parse(block.text));
    if (JSON.stringify(content) !== JSON.stringify(structured)) throw new Error();
    return structured;
  } catch {
    throw new Error("invalid echo_library_ids result");
  }
}

function validateIdsObject(value: unknown): { ids: string[] } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Array.isArray(record.ids) || record.ids.length < 1 || record.ids.length > MAX_IDS) throw new Error();
  if (!record.ids.every((id) => typeof id === "string" && KNOWN_IDS.has(id))) throw new Error();
  return { ids: [...record.ids] as string[] };
}

function isValidInput(input: unknown): input is { ids: string[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const record = input as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !("ids" in record)) return false;
  if (!Array.isArray(record.ids) || record.ids.length < 1 || record.ids.length > MAX_IDS) return false;
  return record.ids.every((id) => typeof id === "string" && KNOWN_IDS.has(id));
}
