import { z } from "zod";
import {
  LibraryArtifactId,
  LibraryParamValue,
  VisualKind,
  type ArtifactBlueprint,
  type ExploreSection,
} from "./blueprint";
import { ObjectiveIntent } from "./plan";

/**
 * The artifact library's shared language: the manifest every imported
 * artifact carries, the ArtifactKit messages between an artifact and the
 * frame that embeds it, and the search request and result types.
 *
 * Library artifacts are made outside Everprimer and imported; nothing here
 * generates them.
 */

const PACKAGE_PIN = /^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*@\d+\.\d+\.\d+$/;
const PARAM_KEY = /^[a-z][a-zA-Z0-9]{0,39}$/;
const EVENT_NAME = /^[a-z][a-z0-9_]{1,47}$/;
const FIELD_NAME = /^[a-z][a-zA-Z0-9_]{0,39}$/;

export const MIN_LEARNER_AGE = 3;
export const MAX_LEARNER_AGE = 18;
/** Matches the bundle cap the importer enforces (15 MB). */
export const MAX_BUNDLE_KB = 15 * 1024;
export const MAX_EVENT_DATA_KEYS = 16;
export const MAX_EVENT_DATA_BYTES = 2048;

/** Sent by the injected runtime for every artifact, so it is never declared in a manifest. */
export const ARTIFACTKIT_BUILTIN_EVENTS = ["interacted"] as const;

export const InteractionType = z.enum([
  "observe",
  "select",
  "drag",
  "sort",
  "sequence",
  "build",
  "label",
  "rotate",
  "adjust",
  "simulate",
  "compare",
  "predict",
  "measure",
]);
export type InteractionType = z.infer<typeof InteractionType>;

export const ArtifactEventName = z.string().regex(EVENT_NAME, "event names are snake_case, e.g. planet_selected");

export const ArtifactFieldType = z.enum(["string", "number", "boolean", "string[]", "number[]"]);
export type ArtifactFieldType = z.infer<typeof ArtifactFieldType>;

const FieldValue = z.union([
  z.string().max(200),
  z.number().finite(),
  z.boolean(),
  z.array(z.union([z.string().max(60), z.number().finite()])).max(20),
]);

/** Payload of one artifact event. Flat and small: it is evidence for the tutor, not storage. */
export const ArtifactEventData = z
  .record(z.string().regex(FIELD_NAME), FieldValue)
  .refine((d) => Object.keys(d).length <= MAX_EVENT_DATA_KEYS, `event data holds at most ${MAX_EVENT_DATA_KEYS} fields`)
  .refine((d) => JSON.stringify(d).length <= MAX_EVENT_DATA_BYTES, `event data is at most ${MAX_EVENT_DATA_BYTES} bytes of JSON`);
export type ArtifactEventData = z.infer<typeof ArtifactEventData>;

const ParamBase = {
  key: z.string().regex(PARAM_KEY, "param keys are camelCase, e.g. orbitSpeed"),
  description: z.string().min(5).max(300),
};

export const ArtifactParam = z.discriminatedUnion("type", [
  z.object({ ...ParamBase, type: z.literal("string"), default: z.string().max(200), options: z.array(z.string().max(60)).min(2).max(40).optional() }),
  z.object({ ...ParamBase, type: z.literal("number"), default: z.number().finite(), min: z.number().finite().optional(), max: z.number().finite().optional() }),
  z.object({ ...ParamBase, type: z.literal("boolean"), default: z.boolean() }),
  z.object({ ...ParamBase, type: z.literal("string[]"), default: z.array(z.string().max(60)).max(20), options: z.array(z.string().max(60)).min(1).max(40).optional() }),
  z.object({ ...ParamBase, type: z.literal("number[]"), default: z.array(z.number().finite()).max(20) }),
]);
export type ArtifactParam = z.infer<typeof ArtifactParam>;

export const ArtifactEventDecl = z.object({
  name: ArtifactEventName,
  data: z
    .record(z.string().regex(FIELD_NAME), ArtifactFieldType)
    .refine((d) => Object.keys(d).length <= MAX_EVENT_DATA_KEYS, `an event declares at most ${MAX_EVENT_DATA_KEYS} fields`)
    .default({}),
  description: z.string().min(5).max(300),
});
export type ArtifactEventDecl = z.infer<typeof ArtifactEventDecl>;

export const SuccessCriterion = z.object({
  description: z.string().min(5).max(300),
  evidence: z.array(ArtifactEventName).min(1).max(8).describe("Declared events that show the criterion was met"),
});

export const TutorGuide = z.object({
  intro: z.string().max(400).optional(),
  steps: z.array(z.string().min(3).max(300)).max(12).default([]),
  observationPrompts: z.array(z.string().min(3).max(300)).max(12).default([]),
  misconceptions: z.array(z.object({ belief: z.string().min(3).max(300), response: z.string().min(3).max(400) })).max(12).default([]),
  hints: z.array(z.string().min(3).max(300)).max(5).default([]).describe("Gentle first, near-answer last"),
  successCriteria: z.array(SuccessCriterion).max(8).default([]),
});
export type TutorGuide = z.infer<typeof TutorGuide>;

export const ArtifactAccessibility = z.object({
  reducedMotion: z.boolean(),
  keyboard: z.boolean(),
  screenReaderSummary: z.string().min(10).max(600),
  colorSafe: z.boolean(),
});

export const ArtifactPerformance = z.object({
  maxBundleKB: z.number().int().min(1).optional(),
  targetFps: z.number().int().min(1).max(120).optional(),
  mobileTested: z.boolean().default(false),
});

export const ArtifactProvenance = z.object({
  createdWith: z.array(z.string().min(2).max(60)).min(1).max(8),
  createdAt: z.string().datetime(),
  notes: z.string().max(1000).optional(),
});

export const ArtifactLicense = z.object({
  artifact: z.string().min(2).max(60),
  thirdParty: z
    .array(z.object({ name: z.string().min(1).max(80), version: z.string().max(40).optional(), license: z.string().min(2).max(120) }))
    .max(40)
    .default([]),
  attributions: z
    .array(z.object({ what: z.string().min(2).max(200), source: z.string().min(2).max(300), license: z.string().min(2).max(120) }))
    .max(40)
    .default([]),
});

const Tag = z.string().min(2).max(60);

export const ArtifactManifest = z.object({
  manifestVersion: z.literal(1),
  id: LibraryArtifactId,
  version: z.number().int().min(1),
  title: z.string().min(3).max(80),
  description: z.string().min(10).max(400),
  format: z.enum(["html", "bundle"]),
  entry: z.string().min(1).max(200),
  rendering: z.object({
    dimension: z.enum(["2d", "3d"]),
    tech: z.array(z.string().regex(PACKAGE_PIN, "tech entries are exact pins, e.g. three@0.170.0")).max(12).default([]),
    webgl: z.boolean(),
  }),
  layout: z
    .object({
      aspectRatio: z.string().regex(/^\d{1,2}:\d{1,2}$/, "aspect ratios look like 16:9").optional(),
      minHeightPx: z.number().int().min(200).max(1200).optional(),
    })
    .optional(),
  subjects: z.array(Tag).min(1).max(6),
  topics: z.array(Tag).min(1).max(12),
  concepts: z.array(Tag).min(1).max(20),
  prerequisites: z.array(z.string().min(3).max(200)).max(10).default([]),
  learningObjectives: z.array(z.string().min(5).max(200)).min(1).max(8),
  objectiveIntents: z.array(ObjectiveIntent).min(1).max(7),
  visualKinds: z.array(VisualKind).min(1).max(6).describe("Built-in visuals this artifact can replace"),
  interactionTypes: z.array(InteractionType).min(1).max(13),
  ageRange: z.tuple([z.number().int(), z.number().int()]),
  difficulty: z.number().int().min(1).max(3),
  durationSec: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
  params: z.array(ArtifactParam).max(20).default([]),
  events: z.array(ArtifactEventDecl).max(30).default([]),
  tutorGuide: TutorGuide.optional(),
  accessibility: ArtifactAccessibility,
  performance: ArtifactPerformance.default({ mobileTested: false }),
  provenance: ArtifactProvenance,
  license: ArtifactLicense,
});
export type ArtifactManifest = z.infer<typeof ArtifactManifest>;

export type ParseManifestResult = { ok: true; manifest: ArtifactManifest } | { ok: false; problems: string[] };

export function parseManifest(data: unknown): ParseManifestResult {
  const parsed = ArtifactManifest.safeParse(data);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  return {
    ok: false,
    problems: parsed.error.issues.map((issue) => `${issue.path.length ? issue.path.join(".") : "(root)"}: ${issue.message}`),
  };
}

function isSafeEntryPath(entry: string): boolean {
  if (entry.startsWith("/") || entry.includes("\\") || entry.includes("\0") || /^[a-z][a-z0-9+.-]*:/i.test(entry)) return false;
  if (entry.split("/").some((part) => part === "" || part === "." || part === "..")) return false;
  return /\.html?$/i.test(entry);
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) out.add(v);
    seen.add(v);
  }
  return [...out];
}

function paramProblems(p: ArtifactParam): string[] {
  const problems: string[] = [];
  if (p.type === "number") {
    if (p.min !== undefined && p.max !== undefined && p.min > p.max) problems.push(`param "${p.key}" has min greater than max`);
    if ((p.min !== undefined && p.default < p.min) || (p.max !== undefined && p.default > p.max)) {
      problems.push(`param "${p.key}" default ${p.default} is outside its min/max`);
    }
  }
  if (p.type === "string" && p.options && !p.options.includes(p.default)) {
    problems.push(`param "${p.key}" default "${p.default}" is not one of its options`);
  }
  if (p.type === "string[]" && p.options) {
    for (const v of p.default) if (!p.options.includes(v)) problems.push(`param "${p.key}" default value "${v}" is not one of its options`);
  }
  return problems;
}

function knownEvent(m: ArtifactManifest, name: string): boolean {
  return (ARTIFACTKIT_BUILTIN_EVENTS as readonly string[]).includes(name) || m.events.some((e) => e.name === name);
}

function packageName(pin: string): string {
  return pin.slice(0, pin.lastIndexOf("@"));
}

/** Checks Zod alone cannot express. Returns human-readable problems; empty means publishable metadata. */
export function lintManifest(m: ArtifactManifest): string[] {
  const problems: string[] = [];

  const [youngest, oldest] = m.ageRange;
  if (youngest < MIN_LEARNER_AGE || oldest > MAX_LEARNER_AGE) problems.push(`ageRange must stay within ${MIN_LEARNER_AGE}-${MAX_LEARNER_AGE}`);
  if (youngest > oldest) problems.push("ageRange is reversed; put the youngest age first");
  if (m.durationSec[0] > m.durationSec[1]) problems.push("durationSec is reversed; put the shortest time first");

  for (const name of duplicates(m.events.map((e) => e.name))) problems.push(`event "${name}" is declared twice`);
  for (const name of m.events.map((e) => e.name)) {
    if ((ARTIFACTKIT_BUILTIN_EVENTS as readonly string[]).includes(name)) problems.push(`event "${name}" is reserved for ArtifactKit; pick another name`);
  }
  for (const key of duplicates(m.params.map((p) => p.key))) problems.push(`param "${key}" is declared twice`);
  for (const p of m.params) problems.push(...paramProblems(p));

  for (const c of m.tutorGuide?.successCriteria ?? []) {
    for (const name of c.evidence) {
      if (!knownEvent(m, name)) problems.push(`success criterion "${c.description}" cites undeclared event "${name}"`);
    }
  }

  if (!isSafeEntryPath(m.entry)) problems.push(`entry "${m.entry}" must be a relative path to an .html file inside the bundle`);
  if (m.format === "html" && m.entry !== "index.html") problems.push('a single-file ("html") artifact must use entry "index.html"');

  const licensed = new Set(m.license.thirdParty.map((t) => t.name));
  for (const pin of m.rendering.tech) {
    if (!licensed.has(packageName(pin))) problems.push(`tech "${pin}" has no license.thirdParty entry`);
  }
  for (const pin of duplicates(m.rendering.tech.map(packageName))) problems.push(`tech lists "${pin}" more than once`);

  if (m.rendering.dimension === "3d" && !m.rendering.webgl) problems.push("a 3d artifact must declare webgl: true");
  if (m.rendering.tech.some((pin) => packageName(pin) === "three") && !m.rendering.webgl) problems.push("three.js needs webgl: true");

  if (m.performance.maxBundleKB !== undefined && m.performance.maxBundleKB > MAX_BUNDLE_KB) {
    problems.push(`performance.maxBundleKB ${m.performance.maxBundleKB} is over the ${MAX_BUNDLE_KB} KB bundle cap`);
  }
  return problems;
}

export const ComplianceLevel = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export type ComplianceLevel = z.infer<typeof ComplianceLevel>;

function tutorGuideComplete(m: ArtifactManifest): boolean {
  const g = m.tutorGuide;
  if (!g?.intro?.trim() || g.steps.length === 0 || g.hints.length === 0 || g.successCriteria.length === 0) return false;
  return g.successCriteria.every((c) => c.evidence.every((name) => m.events.some((e) => e.name === name)));
}

/**
 * What the manifest claims, cumulatively: L1 declares an event, L2 also
 * declares params, L3 also has a complete tutor guide whose success criteria
 * cite declared events. The importer separately estimates what the code does.
 */
export function complianceLevel(m: ArtifactManifest): ComplianceLevel {
  if (m.events.length === 0) return 0;
  if (m.params.length === 0) return 1;
  if (!tutorGuideComplete(m)) return 2;
  return 3;
}

function fieldMatches(type: ArtifactFieldType, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "string[]":
      return Array.isArray(value) && value.every((v) => typeof v === "string");
    case "number[]":
      return Array.isArray(value) && value.every((v) => typeof v === "number");
  }
}

/**
 * Whether an event an artifact sent matches its pinned manifest. Returns the
 * reason to drop it, or null when it may be relayed. Declared fields are
 * optional; undeclared fields and wrong types are not.
 */
export function checkDeclaredEvent(m: ArtifactManifest, name: string, data: unknown): string | null {
  const parsed = ArtifactEventData.safeParse(data ?? {});
  if (!parsed.success) return `event "${name}" data is invalid: ${parsed.error.issues[0]?.message ?? "bad shape"}`;
  if ((ARTIFACTKIT_BUILTIN_EVENTS as readonly string[]).includes(name)) {
    return Object.keys(parsed.data).length === 0 ? null : `built-in event "${name}" carries no data`;
  }
  const decl = m.events.find((e) => e.name === name);
  if (!decl) return `event "${name}" is not declared by ${m.id}@${m.version}`;
  for (const [field, value] of Object.entries(parsed.data)) {
    const type = decl.data[field];
    if (!type) return `event "${name}" field "${field}" is not declared`;
    if (!fieldMatches(type, value)) return `event "${name}" field "${field}" should be ${type}`;
  }
  return null;
}

/**
 * ArtifactKit: postMessage protocol between a library artifact and the frame
 * that embeds it. Separate from LearnKit; the lesson player relays accepted
 * events to the host as LearnKit `artifact_interaction` events.
 *
 * The artifact's origin is opaque ("null"), so messages to it use target "*".
 * Receivers must check `event.source` and the nonce from `ak-init`.
 */
export const ARTIFACTKIT_SOURCE = "artifactkit" as const;
export const ARTIFACTKIT_HOST_SOURCE = "artifactkit-host" as const;
export const ARTIFACTKIT_PROTOCOL_VERSION = 1 as const;

const Nonce = z.string().min(1).max(128);
const FromArtifact = { source: z.literal(ARTIFACTKIT_SOURCE), v: z.literal(ARTIFACTKIT_PROTOCOL_VERSION) };
const FromHost = { source: z.literal(ARTIFACTKIT_HOST_SOURCE), v: z.literal(ARTIFACTKIT_PROTOCOL_VERSION) };

/** Artifact -> embedding frame. */
export const ArtifactKitMessage = z.discriminatedUnion("kind", [
  z.object({ ...FromArtifact, kind: z.literal("ak-ready") }),
  z.object({ ...FromArtifact, kind: z.literal("ak-event"), nonce: Nonce, name: ArtifactEventName, data: ArtifactEventData.default({}) }),
  z.object({ ...FromArtifact, kind: z.literal("ak-error"), nonce: Nonce.nullish(), message: z.string().max(500), fatal: z.boolean().default(false) }),
]);
export type ArtifactKitMessage = z.infer<typeof ArtifactKitMessage>;

/** Embedding frame -> artifact. */
export const ArtifactKitHostMessage = z.discriminatedUnion("kind", [
  z.object({
    ...FromHost,
    kind: z.literal("ak-init"),
    nonce: Nonce,
    params: z.record(z.string().max(40), LibraryParamValue).default({}),
    reducedMotion: z.boolean(),
  }),
  z.object({ ...FromHost, kind: z.literal("ak-pause") }),
  z.object({ ...FromHost, kind: z.literal("ak-resume") }),
]);
export type ArtifactKitHostMessage = z.infer<typeof ArtifactKitHostMessage>;

/** Search request built from an explore bite. */
export const ArtifactNeed = z.object({
  biteId: z.string().min(1).max(40),
  lessonTitle: z.string().max(80),
  visualKind: VisualKind,
  purpose: z.string().max(160).optional(),
  caption: z.string().max(200),
  prompt: z.string().max(140).describe("What the bite asks the child to do"),
  objectiveTexts: z.array(z.string().max(200)).max(6),
  objectiveIntents: z.array(ObjectiveIntent).max(6),
  itemLabels: z.array(z.string().max(60)).max(12),
  age: z.number().int().min(3).max(120).nullable(),
  interactionHints: z.array(InteractionType).max(13),
});
export type ArtifactNeed = z.infer<typeof ArtifactNeed>;

/** One ranked candidate. The breakdown keys are the scorer's components (text, objective, age, ...). */
export const ArtifactMatch = z.object({
  artifactId: LibraryArtifactId,
  version: z.number().int().min(1),
  title: z.string().max(80),
  score: z.number().min(0).max(1),
  breakdown: z.record(z.string().max(40), z.number()),
  reasons: z.array(z.string().max(300)).max(12),
  params: z.record(z.string().max(40), LibraryParamValue).default({}),
});
export type ArtifactMatch = z.infer<typeof ArtifactMatch>;

const KIND_HINTS: Record<VisualKind, InteractionType[]> = {
  comparison: ["compare"],
  sequence: ["sequence"],
  parts: ["select", "label"],
  timeline: ["sequence"],
  orbit: ["observe", "select"],
  simulation: ["simulate", "adjust"],
};

const INTENT_HINTS: Partial<Record<ObjectiveIntent, InteractionType>> = {
  compare: "compare",
  sequence: "sequence",
  predict: "predict",
};

const PROMPT_HINTS: Array<[RegExp, InteractionType]> = [
  [/\b(tap|click|pick|choose|select)\b/i, "select"],
  [/\b(drag|move|drop)\b/i, "drag"],
  [/\b(sort|order|arrange)\b/i, "sort"],
  [/\b(build|make|assemble)\b/i, "build"],
  [/\b(predict|guess)\b/i, "predict"],
  [/\bcompare\b/i, "compare"],
  [/\bmeasure\b/i, "measure"],
  [/\b(rotate|spin|turn)\b/i, "rotate"],
  [/\b(slide|adjust|change)\b/i, "adjust"],
  [/\b(watch|look|see)\b/i, "observe"],
];

/**
 * Builds the search request for an explore bite. Objective intents live on
 * the lesson plan, not the blueprint, so the caller passes them in.
 */
export function artifactNeedFromBite(
  bite: ExploreSection,
  bp: ArtifactBlueprint,
  intents: Partial<Record<string, ObjectiveIntent>> = {},
): ArtifactNeed {
  const codes = bite.objectiveCodes ?? [];
  const objectiveTexts = bp.learningObjectives.filter((o) => codes.includes(o.code)).map((o) => o.text);
  const objectiveIntents = [...new Set(codes.map((c) => intents[c]).filter((i): i is ObjectiveIntent => !!i))];
  const hints = new Set<InteractionType>(KIND_HINTS[bite.visual.kind]);
  for (const intent of objectiveIntents) {
    const hint = INTENT_HINTS[intent];
    if (hint) hints.add(hint);
  }
  for (const [re, hint] of PROMPT_HINTS) if (re.test(bite.prompt)) hints.add(hint);
  return {
    biteId: bite.id,
    lessonTitle: bp.title,
    visualKind: bite.visual.kind,
    ...(bite.visual.purpose ? { purpose: bite.visual.purpose } : {}),
    caption: bite.visual.caption,
    prompt: bite.prompt,
    objectiveTexts,
    objectiveIntents,
    itemLabels: bite.visual.items.map((i) => i.label),
    age: bp.audience.age,
    interactionHints: [...hints],
  };
}
