import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GameBlueprint, GeneratedCurriculum } from "@eco/contracts";
import { dropBlank, modelSchema, schemaProblems } from "./schema";

/** Keywords that make Gemini reject a response schema as "too many states". */
const BANNED = [
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "multipleOf",
  "oneOf",
  "$ref",
  "$defs",
];

function raw(schema: ReturnType<typeof modelSchema>): string {
  return JSON.stringify(schema.jsonSchema);
}

describe("modelSchema", () => {
  it.each([
    ["blueprint", GameBlueprint],
    ["curriculum", GeneratedCurriculum],
  ])("strips decoding-grammar constraints from the %s schema", (_name, schema) => {
    const json = raw(modelSchema(schema as z.ZodType));
    for (const keyword of BANNED) expect(json, keyword).not.toContain(`"${keyword}"`);
  });

  it("keeps the shape the model needs: properties, required and enums", () => {
    const json = modelSchema(GameBlueprint).jsonSchema as Record<string, unknown>;
    const props = (json.properties ?? {}) as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(["title", "theme", "sessions", "learningObjectives", "finalTest"]));
    expect(json.required).toEqual(expect.arrayContaining(["title", "sessions"]));
    // Bite/question discriminators must survive so the model picks a variant.
    expect(raw(modelSchema(GameBlueprint))).toContain("explore");
  });

  it("lists every blueprint property as required", () => {
    function optionalCount(node: unknown): number {
      if (!node || typeof node !== "object") return 0;
      if (Array.isArray(node)) return node.reduce((sum, item) => sum + optionalCount(item), 0);
      const record = node as Record<string, unknown>;
      let count = 0;
      const props = record.properties;
      if (props && typeof props === "object" && !Array.isArray(props)) {
        const required = new Set((record.required as string[] | undefined) ?? []);
        for (const [key, value] of Object.entries(props)) {
          if (!required.has(key)) count++;
          count += optionalCount(value);
        }
      }
      for (const key of ["anyOf", "oneOf", "allOf", "items"]) count += optionalCount(record[key]);
      return count;
    }
    expect(optionalCount(modelSchema(GameBlueprint).jsonSchema)).toBe(0);
  });

  it("drops blank strings the model uses for fields that do not apply", () => {
    expect(dropBlank({ hint: "", recallObjectiveId: "  ", factIds: [], nested: { color: null, label: "A" } })).toEqual({
      factIds: [],
      nested: { label: "A" },
    });
  });

  it("reports out-of-bounds responses as fixable problems", () => {
    // Shape is right but values violate bounds, which is what the model may now return.
    const parsed = GeneratedCurriculum.safeParse({ title: "x", description: "short", topics: [] });
    expect(parsed.success).toBe(false);
    const problems = schemaProblems(parsed.error!);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => p.includes(":"))).toBe(true);
  });
});
