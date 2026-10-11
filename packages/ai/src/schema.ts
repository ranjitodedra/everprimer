import { jsonSchema, type Schema } from "ai";
import { z } from "zod";

/**
 * Structured-output schemas for the model.
 *
 * Gemini compiles a response schema into a constrained-decoding grammar and
 * rejects anything whose state count is too large ("too many states for
 * serving"). Size bounds, numeric ranges and regex patterns multiply that
 * count fast, and our blueprint schema is deep enough to trip it.
 *
 * So the model gets a shape-only schema: same properties, same enums, no value
 * constraints. Every property is listed as required. Providers reject a schema
 * with more than 24 optional properties ("grammar compilation inefficient"),
 * and the blueprint has far more than that. Fields the lesson may omit are
 * still optional in Zod; blank strings and nulls are removed before that check.
 * Anything out of bounds is reported back to the model as a repair instruction.
 */

/** JSON Schema keywords that inflate the decoding grammar without changing shape. */
const CONSTRAINT_KEYWORDS = [
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minProperties",
  "maxProperties",
  "default",
  "$schema",
] as const;

type JsonObject = Record<string, unknown>;

function relax(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(relax);
  if (node === null || typeof node !== "object") return node;

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node as JsonObject)) {
    if ((CONSTRAINT_KEYWORDS as readonly string[]).includes(key)) continue;
    // Gemini understands anyOf but not oneOf.
    out[key === "oneOf" ? "anyOf" : key] = relax(value);
  }
  // Optional properties are what the provider counts. Listing every property
  // as required keeps the same shape without tripping the limit of 24.
  const props = out.properties;
  if (props && typeof props === "object" && !Array.isArray(props)) {
    out.required = Object.keys(props);
  }
  return out;
}

/**
 * Drop nulls and blank strings from a structured model response.
 *
 * The model schema requires every property, so the model emits "" or null
 * when a lesson field does not apply. Zod still treats those fields as optional.
 */
export function dropBlank(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropBlank);
  if (value === null || typeof value !== "object") return value;
  const out: JsonObject = {};
  for (const [key, raw] of Object.entries(value as JsonObject)) {
    if (raw === null) continue;
    if (typeof raw === "string" && raw.trim() === "") continue;
    out[key] = dropBlank(raw);
  }
  return out;
}

/**
 * Shape-only JSON Schema for a Zod schema, safe to hand to a structured-output
 * model. Validate the response with the original Zod schema.
 */
export function modelSchema<T>(schema: z.ZodType<T>): Schema<T> {
  const full = z.toJSONSchema(schema, { io: "input", reused: "inline" });
  return jsonSchema<T>(relax(full) as JsonObject);
}

/** Human-readable Zod issues, phrased as instructions the model can act on. */
export function schemaProblems(error: z.ZodError): string[] {
  return error.issues.slice(0, 20).map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}
