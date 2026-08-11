import { z } from "zod";
import {
  discoveryIntentSchema,
  setDraftPlanSchema,
  trackFiltersSchema,
} from "../../shared/contracts";
import type { AIProviderOutputSchema } from "./provider";

const idSchema = z.string().min(1).max(128);
const summarySchema = z.string().trim().min(1).max(500);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripNullFields(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== null));
}

function stripPlanFilterNulls(value: unknown): unknown {
  if (!isRecord(value) || !("candidateFilters" in value)) return value;
  return { ...value, candidateFilters: stripNullFields(value.candidateFilters) };
}

function unwrapStructuredResult(value: unknown): unknown {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !("result" in value)) return value;
  return value.result;
}

const providerTrackFiltersSchema = z.preprocess(stripNullFields, trackFiltersSchema);
const providerSetDraftPlanSchema = z.preprocess(stripPlanFilterNulls, setDraftPlanSchema);

export const assistantSearchOutputZodSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("filters"), summary: summarySchema, filters: providerTrackFiltersSchema }),
  z.strictObject({ type: z.literal("similar"), summary: summarySchema, useSelectedTrack: z.literal(true) }),
  z.strictObject({
    type: z.literal("next"),
    summary: summarySchema,
    useSelectedTrack: z.literal(true),
    intent: discoveryIntentSchema,
  }),
  z.strictObject({ type: z.literal("unsupported"), reason: summarySchema }),
]);

export const assistantPlanOutputZodSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("create_draft"),
    summary: summarySchema,
    title: z.string().trim().min(1).max(200),
    plan: providerSetDraftPlanSchema,
    maxTracks: z.number().int().min(1).max(50),
    useSelectedTrackAsSeed: z.boolean(),
  }),
  z.strictObject({ type: z.literal("unsupported"), reason: summarySchema }),
]);

const revisionMutationSchemas = [
  z.strictObject({ type: z.literal("rename"), title: z.string().trim().min(1).max(200) }),
  z.strictObject({ type: z.literal("set_plan"), plan: providerSetDraftPlanSchema }),
  z.strictObject({ type: z.literal("move_entry"), entryId: idSchema, toIndex: z.number().int().min(0).max(99) }),
  z.strictObject({ type: z.literal("set_track_pin"), entryId: idSchema, pinned: z.boolean() }),
  z.strictObject({ type: z.literal("set_position_pin"), entryId: idSchema, pinned: z.boolean() }),
  z.strictObject({ type: z.literal("remove_entry"), entryId: idSchema }),
  z.strictObject({ type: z.literal("ban_entry"), entryId: idSchema }),
  z.strictObject({ type: z.literal("replace_with_best"), entryId: idSchema }),
  z.strictObject({
    type: z.literal("set_entry_goal"),
    entryId: idSchema,
    role: z.enum(["warmup", "groove", "build", "peak", "singalong", "reset", "bridge", "closer"]).nullable(),
    targetEnergyPpm: z.number().int().min(0).max(1_000_000).nullable(),
  }),
  z.strictObject({ type: z.literal("optimize") }),
  z.strictObject({ type: z.literal("unsupported"), reason: summarySchema }),
] as const;

export const assistantRevisionOutputZodSchema = z.discriminatedUnion("type", revisionMutationSchemas);

export type AssistantSearchOutput = z.infer<typeof assistantSearchOutputZodSchema>;
export type AssistantPlanOutput = z.infer<typeof assistantPlanOutputZodSchema>;
export type AssistantRevisionOutput = z.infer<typeof assistantRevisionOutputZodSchema>;

function constType(value: unknown): string | undefined {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return typeof value;
    default:
      return undefined;
  }
}

function acceptsNull(schema: unknown): boolean {
  if (!isRecord(schema)) return false;
  if (schema.type === "null") return true;
  if (Array.isArray(schema.type) && schema.type.includes("null")) return true;
  if (Array.isArray(schema.enum) && schema.enum.includes(null)) return true;
  return [schema.anyOf, schema.oneOf].some(
    (alternatives) => Array.isArray(alternatives) && alternatives.some(acceptsNull),
  );
}

function nullable(schema: unknown): unknown {
  return acceptsNull(schema) ? schema : { anyOf: [schema, { type: "null" }] };
}

function normalizeSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSchemaValue);
  if (!isRecord(value)) return value;

  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, field]) => [key, normalizeSchemaValue(field)]),
  );
  if (Object.hasOwn(normalized, "const") && normalized.type === undefined) {
    const type = constType(normalized.const);
    if (type !== undefined) normalized.type = type;
  }

  if (isRecord(normalized.properties)) {
    const requiredBefore = new Set(
      Array.isArray(normalized.required)
        ? normalized.required.filter((field): field is string => typeof field === "string")
        : [],
    );
    const properties = { ...normalized.properties };
    for (const key of Object.keys(properties)) {
      if (!requiredBefore.has(key)) properties[key] = nullable(properties[key]);
    }
    normalized.properties = properties;
    normalized.required = Object.keys(properties);
    normalized.additionalProperties = false;
  }

  return normalized;
}

export function normalizeCodexOutputSchema(
  schema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const normalized = normalizeSchemaValue(schema) as Record<string, unknown>;
  const alternatives = Array.isArray(normalized.oneOf)
    ? normalized.oneOf
    : Array.isArray(normalized.anyOf)
      ? normalized.anyOf
      : undefined;
  if (normalized.type === "object" || alternatives === undefined) return normalized;

  const { oneOf: _oneOf, anyOf: _anyOf, ...metadata } = normalized;
  return {
    ...metadata,
    type: "object",
    properties: { result: { anyOf: alternatives } },
    required: ["result"],
    additionalProperties: false,
  };
}

function outputSchema<Output>(
  zodSchema: z.ZodType<Output>,
  validateKnownIds?: (value: Output) => boolean,
): AIProviderOutputSchema<Output> {
  const jsonSchema = normalizeCodexOutputSchema(
    zodSchema.toJSONSchema({ target: "draft-07", unrepresentable: "throw" }),
  );
  const providerZodSchema = z.preprocess(unwrapStructuredResult, zodSchema) as z.ZodType<Output>;
  return validateKnownIds === undefined
    ? { zodSchema: providerZodSchema, jsonSchema }
    : { zodSchema: providerZodSchema, jsonSchema, validateKnownIds };
}

export const assistantSearchOutputSchema = outputSchema(assistantSearchOutputZodSchema);
export const assistantPlanOutputSchema = outputSchema(assistantPlanOutputZodSchema);

export function assistantRevisionOutputSchema(knownEntryIds: ReadonlySet<string>) {
  return outputSchema(
    assistantRevisionOutputZodSchema,
    (value) => !("entryId" in value) || knownEntryIds.has(value.entryId),
  );
}
