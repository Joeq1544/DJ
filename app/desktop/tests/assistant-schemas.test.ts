import { describe, expect, it } from "vitest";
import {
  assistantPlanOutputSchema,
  assistantRevisionOutputSchema,
  assistantSearchOutputSchema,
  normalizeCodexOutputSchema,
} from "../src/main/assistant/schemas";

const filterKeys = [
  "playlistId",
  "text",
  "bpmMinMilli",
  "bpmMaxMilli",
  "musicalKey",
  "keyRelation",
  "genre",
  "energyMinPpm",
  "energyMaxPpm",
  "analysisState",
  "availability",
  "ratingMin",
  "tag",
] as const;

const nullFilters = Object.fromEntries(filterKeys.map((key) => [key, null]));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function visitSchema(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visitSchema(item, visit));
    return;
  }
  if (!isRecord(value)) return;
  visit(value);
  Object.values(value).forEach((item) => visitSchema(item, visit));
}

function expectCodexStrictSchema(schema: Readonly<Record<string, unknown>>): void {
  expect(schema.type).toBe("object");
  expect(schema).not.toHaveProperty("oneOf");
  expect(schema).not.toHaveProperty("anyOf");
  visitSchema(schema, (node) => {
    if (Object.hasOwn(node, "const")) {
      const value = node.const;
      const expectedType = value === null ? "null" : typeof value;
      expect(node.type).toBe(expectedType);
    }
    if (!isRecord(node.properties)) return;
    const properties = Object.keys(node.properties).sort();
    expect(node.additionalProperties).toBe(false);
    expect(Array.isArray(node.required) ? [...node.required].sort() : node.required).toEqual(properties);
  });
}

describe("assistant structured output schemas", () => {
  it("recursively supplies primitive types for const nodes", () => {
    const normalized = normalizeCodexOutputSchema({
      type: "object",
      required: ["result"],
      properties: {
        result: {
          oneOf: [
            { const: "filters" },
            { type: "array", items: { const: true } },
          ],
        },
      },
    });

    expect(normalized).toMatchObject({
      properties: {
        result: {
          oneOf: [
            { type: "string", const: "filters" },
            { type: "array", items: { type: "boolean", const: true } },
          ],
        },
      },
      required: ["result"],
      additionalProperties: false,
    });
  });

  it("emits only strict object schemas accepted by Codex structured output", () => {
    expectCodexStrictSchema(assistantSearchOutputSchema.jsonSchema);
    expectCodexStrictSchema(assistantPlanOutputSchema.jsonSchema);
    expectCodexStrictSchema(assistantRevisionOutputSchema(new Set(["entry-1"])).jsonSchema);
  });

  it("decodes required null filter sentinels without changing sparse local values", () => {
    expect(assistantSearchOutputSchema.zodSchema.parse({
      result: {
        type: "filters",
        summary: "Warm house",
        filters: nullFilters,
      },
    })).toEqual({ type: "filters", summary: "Warm house", filters: {} });

    expect(assistantPlanOutputSchema.zodSchema.parse({
      result: {
        type: "create_draft",
        summary: "Smooth set",
        title: "Sunset Session",
        plan: {
          intent: "smooth",
          targetDurationMs: null,
          maxArtistRepeats: null,
          candidateFilters: { ...nullFilters, genre: "House" },
        },
        maxTracks: 5,
        useSelectedTrackAsSeed: false,
      },
    })).toMatchObject({ plan: { candidateFilters: { genre: "House" } } });

    expect(assistantRevisionOutputSchema(new Set(["entry-1"])).zodSchema.parse({
      result: {
        type: "set_plan",
        plan: {
          intent: "build",
          targetDurationMs: null,
          maxArtistRepeats: null,
          candidateFilters: nullFilters,
        },
      },
    })).toEqual({
      type: "set_plan",
      plan: {
        intent: "build",
        targetDurationMs: null,
        maxArtistRepeats: null,
        candidateFilters: {},
      },
    });

    expect(assistantSearchOutputSchema.zodSchema.parse({
      type: "filters",
      summary: "Warm house",
      filters: { genre: "House" },
    })).toMatchObject({ filters: { genre: "House" } });
  });
});
