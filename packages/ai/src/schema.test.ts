import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GameBlueprint, GeneratedCurriculum } from "@eco/contracts";
import { rockyGameBlueprint } from "../../contracts/src/testing";
import { forceBlueprintFields } from "./pipelines";
import { SERVER_OWNED_BLUEPRINT_FIELDS, coercePlanFields, dropBlank, modelSchema, schemaProblems, shortenChoiceIds } from "./schema";

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
    expect(optionalCount(modelSchema(GameBlueprint, { omit: SERVER_OWNED_BLUEPRINT_FIELDS }).jsonSchema)).toBe(0);
  });

  it("never shows the model the server-owned library reference", () => {
    const withLibrary = raw(modelSchema(GameBlueprint));
    const forModel = raw(modelSchema(GameBlueprint, { omit: SERVER_OWNED_BLUEPRINT_FIELDS }));
    expect(withLibrary).toContain('"library"');
    expect(forModel).not.toContain('"library"');
    expect(forModel).not.toContain('"artifactId"');
    expect(forModel).toContain('"visual"');
  });

  it("drops a library reference the model sends anyway", () => {
    const bp = rockyGameBlueprint();
    const bite = bp.sessions[0]!.bites.find((b) => b.type === "explore");
    if (bite?.type !== "explore") throw new Error("fixture changed");
    bite.library = { artifactId: "made-up-artifact", version: 1, params: {} };
    const forced = forceBlueprintFields(bp, { topic: { slug: bp.topicSlug }, learner: { age: 8, readingLevel: "developing" } } as Parameters<typeof forceBlueprintFields>[1]);
    expect(JSON.stringify(forced)).not.toContain("made-up-artifact");
    expect(forced.sessions[0]!.bites.find((b) => b.type === "explore")).toMatchObject({ visual: bite.visual });
  });

  it("drops blank strings the model uses for fields that do not apply", () => {
    expect(dropBlank({ hint: "", recallObjectiveId: "  ", factIds: [], nested: { color: null, label: "A" } })).toEqual({
      factIds: [],
      nested: { label: "A" },
    });
  });

  it("shortens verbose choice ids and rewrites every reference in the question", () => {
    const raw = {
      sessions: [
        {
          bites: [
            {
              questions: [
                {
                  kind: "mcq",
                  options: [
                    { id: "opt_thousand", text: "1000" },
                    { id: "opt_hundred", text: "100" },
                    { id: "opt_thousand", text: "also 1000" },
                  ],
                  correctOptionId: "opt_thousand",
                },
                {
                  kind: "ordering",
                  items: [{ id: "step_first" }, { id: "step_second" }, { id: "step_third" }],
                  correctOrder: ["step_first", "step_second", "step_third"],
                },
              ],
            },
          ],
        },
      ],
      finalTest: {
        questions: [
          {
            kind: "fill_blank",
            options: [{ id: "blank_hippocampus" }, { id: "blank_amygdala" }],
            blanks: ["blank_hippocampus"],
          },
        ],
      },
    };
    const out = shortenChoiceIds(raw) as typeof raw;
    const mcq = out.sessions[0]!.bites[0]!.questions[0]!;
    expect(mcq.options[0]!.id.length).toBeLessThanOrEqual(8);
    expect(mcq.options[0]!.id).toBe(mcq.correctOptionId);
    expect(mcq.options[0]!.id).toBe(mcq.options[2]!.id);
    expect(mcq.options[0]!.id).not.toBe(mcq.options[1]!.id);
    const order = out.sessions[0]!.bites[0]!.questions[1]!;
    expect(order.correctOrder).toEqual(order.items.map((item) => item.id));
    expect(order.items.every((item) => item.id.length <= 8)).toBe(true);
    const blank = out.finalTest.questions[0]!;
    expect(blank.blanks[0]).toBe(blank.options[0]!.id);
    expect(blank.options[0]!.id.length).toBeLessThanOrEqual(8);
  });

  it("keeps already-short unique ids", () => {
    const q = { options: [{ id: "a" }, { id: "b" }], correctOptionId: "b" };
    shortenChoiceIds({ sessions: [{ bites: [{ questions: [q] }] }] });
    expect(q).toEqual({ options: [{ id: "a" }, { id: "b" }], correctOptionId: "b" });
  });

  it("coerces unknown planner reading levels and a missing framing interest", () => {
    const plan = { learnerConstraints: { readingLevel: "early_reader", textBudget: 40 } };
    coercePlanFields(plan);
    expect(plan.learnerConstraints).toEqual({ readingLevel: null, textBudget: 40, framingInterest: null });
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
