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

function relax(node: unknown, omit: ReadonlySet<string>): unknown {
  if (Array.isArray(node)) return node.map((item) => relax(item, omit));
  if (node === null || typeof node !== "object") return node;

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node as JsonObject)) {
    if ((CONSTRAINT_KEYWORDS as readonly string[]).includes(key)) continue;
    // Gemini understands anyOf but not oneOf.
    out[key === "oneOf" ? "anyOf" : key] = relax(value, omit);
  }
  // Optional properties are what the provider counts. Listing every property
  // as required keeps the same shape without tripping the limit of 24.
  const props = out.properties;
  if (props && typeof props === "object" && !Array.isArray(props)) {
    for (const name of omit) delete (props as JsonObject)[name];
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
 *
 * `omit` removes server-owned properties at any depth. Every remaining
 * property is required, so anything left in would force the model to invent it.
 */
export function modelSchema<T>(schema: z.ZodType<T>, opts: { omit?: readonly string[] } = {}): Schema<T> {
  const full = z.toJSONSchema(schema, { io: "input", reused: "inline" });
  return jsonSchema<T>(relax(full, new Set(opts.omit ?? [])) as JsonObject);
}

/** Blueprint properties the server attaches after generation. */
export const SERVER_OWNED_BLUEPRINT_FIELDS = ["library"] as const;

/** Human-readable Zod issues, phrased as instructions the model can act on. */
export function schemaProblems(error: z.ZodError): string[] {
  return error.issues.slice(0, 20).map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}

const READING_LEVELS = new Set(["pre_reader", "early", "developing", "fluent", "advanced"]);

/**
 * Gemini often emits option ids like "opt_thousand" (the shape schema has no
 * maxLength). Choice ids must be <= 8 characters; rewrite them in place and
 * keep every reference in the same question pointing at the new id.
 */
export function shortenChoiceIds(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const bp = value as JsonObject;
  const sessions = bp.sessions;
  if (Array.isArray(sessions)) {
    for (const session of sessions) {
      if (!session || typeof session !== "object") continue;
      const bites = (session as JsonObject).bites;
      if (!Array.isArray(bites)) continue;
      for (const bite of bites) {
        if (bite && typeof bite === "object") shortenQuestionIds((bite as JsonObject).questions);
      }
    }
  }
  const finalTest = bp.finalTest;
  if (finalTest && typeof finalTest === "object") shortenQuestionIds((finalTest as JsonObject).questions);
  return value;
}

function shortenQuestionIds(questions: unknown): void {
  if (!Array.isArray(questions)) return;
  for (const raw of questions) {
    if (!raw || typeof raw !== "object") continue;
    const q = raw as JsonObject;
    const used = new Set<string>();
    const map = new Map<string, string>();
    const rename = (id: unknown): unknown => {
      if (typeof id !== "string" || !id) return id;
      const existing = map.get(id);
      if (existing) return existing;
      const next = uniqueShort(id, used);
      map.set(id, next);
      return next;
    };
    for (const key of ["options", "items", "left", "right"] as const) {
      const list = q[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (item && typeof item === "object") (item as JsonObject).id = rename((item as JsonObject).id);
      }
    }
    if (typeof q.correctOptionId === "string") q.correctOptionId = rename(q.correctOptionId);
    if (Array.isArray(q.correctOrder)) q.correctOrder = q.correctOrder.map(rename);
    if (Array.isArray(q.blanks)) q.blanks = q.blanks.map(rename);
    if (Array.isArray(q.pairs)) {
      for (const pair of q.pairs) {
        if (!pair || typeof pair !== "object") continue;
        const p = pair as JsonObject;
        p.left = rename(p.left);
        p.right = rename(p.right);
      }
    }
  }
}

function uniqueShort(id: string, used: Set<string>): string {
  const cleaned = id.replace(/[^A-Za-z0-9_]/g, "") || "id";
  const base = cleaned.slice(0, 8);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let n = 2; n < 1000; n++) {
    const suffix = String(n);
    const candidate = `${base.slice(0, Math.max(1, 8 - suffix.length))}${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  used.add(base);
  return base;
}

/**
 * Planner fields the server already knows. Unknown reading levels and a
 * missing framing interest otherwise fail the Zod parse and we fall back to
 * the default plan.
 */
export function coercePlanFields(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const plan = value as JsonObject;
  const raw = plan.learnerConstraints;
  if (!raw || typeof raw !== "object") return value;
  const constraints = raw as JsonObject;
  if (typeof constraints.readingLevel === "string" && !READING_LEVELS.has(constraints.readingLevel)) {
    constraints.readingLevel = null;
  }
  if (constraints.framingInterest === undefined) constraints.framingInterest = null;
  return value;
}
