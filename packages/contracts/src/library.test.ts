import { describe, expect, it } from "vitest";
import { gameBites, type ExploreSection } from "./blueprint";
import {
  ARTIFACTKIT_PROTOCOL_VERSION,
  ArtifactKitHostMessage,
  ArtifactKitMessage,
  ArtifactManifest,
  ArtifactMatch,
  ArtifactNeed,
  artifactNeedFromBite,
  checkDeclaredEvent,
  complianceLevel,
  lintManifest,
  parseManifest,
  type ArtifactManifest as Manifest,
} from "./library";
import { rockyGameBlueprint, solarSystemManifest } from "./testing";

function withChanges(change: (m: Manifest) => void): Manifest {
  const m = solarSystemManifest();
  change(m);
  return m;
}

describe("manifest schema", () => {
  it("accepts the reference manifest and lints clean", () => {
    const result = parseManifest(solarSystemManifest());
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(lintManifest(result.manifest)).toEqual([]);
  });

  it("fills defaults for optional lists", () => {
    const { params: _p, events: _e, prerequisites: _r, tutorGuide: _t, performance: _perf, ...rest } = solarSystemManifest();
    const m = ArtifactManifest.parse(rest);
    expect(m.params).toEqual([]);
    expect(m.events).toEqual([]);
    expect(m.prerequisites).toEqual([]);
    expect(m.performance).toEqual({ mobileTested: false });
  });

  it.each([
    ["an id with spaces", (m: Record<string, unknown>) => (m.id = "Solar System")],
    ["version 0", (m: Record<string, unknown>) => (m.version = 0)],
    ["a missing license", (m: Record<string, unknown>) => delete m.license],
    ["an unknown visual kind", (m: Record<string, unknown>) => (m.visualKinds = ["hologram"])],
    ["an unpinned library", (m: Record<string, unknown>) => (m.rendering = { dimension: "3d", tech: ["three@latest"], webgl: true })],
    ["a camelCase event name", (m: Record<string, unknown>) => (m.events = [{ name: "planetSelected", data: {}, description: "Tapped a planet." }])],
    ["a param default of the wrong type", (m: Record<string, unknown>) => (m.params = [{ key: "speed", type: "number", default: "fast", description: "Orbit speed." }])],
    ["manifestVersion 2", (m: Record<string, unknown>) => (m.manifestVersion = 2)],
  ])("rejects %s", (_label, change) => {
    const raw = solarSystemManifest() as unknown as Record<string, unknown>;
    change(raw);
    const result = parseManifest(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.every((p) => p.includes(":"))).toBe(true);
  });
});

describe("lintManifest", () => {
  it.each<[string, (m: Manifest) => void, RegExp]>([
    ["ages outside 3-18", (m) => (m.ageRange = [2, 12]), /ageRange must stay within 3-18/],
    ["reversed ages", (m) => (m.ageRange = [12, 8]), /ageRange is reversed/],
    ["reversed duration", (m) => (m.durationSec = [240, 60]), /durationSec is reversed/],
    ["a duplicate event", (m) => m.events.push({ ...m.events[0]! }), /event "planet_selected" is declared twice/],
    ["a reserved event name", (m) => m.events.push({ name: "interacted", data: {}, description: "Any input." }), /reserved for ArtifactKit/],
    ["a duplicate param", (m) => m.params.push({ ...m.params[1]! }), /param "orbitSpeed" is declared twice/],
    ["a number default outside min/max", (m) => (m.params[1] = { key: "orbitSpeed", type: "number", default: 9, min: 0.1, max: 5, description: "Speed." }), /default 9 is outside/],
    ["a list default outside its options", (m) => (m.params[0] = { key: "planets", type: "string[]", default: ["pluto"], options: ["earth", "mars"], description: "Planets." }), /"pluto" is not one of its options/],
    ["a success criterion citing an undeclared event", (m) => (m.tutorGuide!.successCriteria[0]!.evidence = ["orbit_raced"]), /undeclared event "orbit_raced"/],
    ["an absolute entry path", (m) => (m.entry = "/index.html"), /must be a relative path/],
    ["an entry escaping the bundle", (m) => (m.entry = "../index.html"), /must be a relative path/],
    ["a non-html entry", (m) => (m.entry = "main.js"), /must be a relative path to an .html file/],
    ["a single-file artifact not on index.html", (m) => { m.format = "html"; m.entry = "scene.html"; }, /must use entry "index.html"/],
    ["a library without a license entry", (m) => (m.license.thirdParty = []), /tech "three@0.170.0" has no license.thirdParty entry/],
    ["a 3d artifact without webgl", (m) => { m.rendering.webgl = false; }, /a 3d artifact must declare webgl: true/],
    ["three.js in 2d without webgl", (m) => { m.rendering = { dimension: "2d", tech: ["three@0.170.0"], webgl: false }; }, /three.js needs webgl: true/],
    ["an oversized bundle budget", (m) => (m.performance.maxBundleKB = 20_000), /over the 15360 KB bundle cap/],
  ])("flags %s", (_label, change, expected) => {
    expect(lintManifest(withChanges(change)).join("\n")).toMatch(expected);
  });

  it("lets success criteria cite the built-in interacted event", () => {
    const m = withChanges((m) => (m.tutorGuide!.successCriteria[0]!.evidence = ["interacted"]));
    expect(lintManifest(m)).toEqual([]);
  });

  it("accepts scoped package pins", () => {
    const m = withChanges((m) => {
      m.rendering.tech = ["three@0.170.0", "@tweenjs/tween.js@23.1.3"];
      m.license.thirdParty.push({ name: "@tweenjs/tween.js", license: "MIT" });
    });
    expect(ArtifactManifest.safeParse(m).success).toBe(true);
    expect(lintManifest(m)).toEqual([]);
  });
});

describe("complianceLevel", () => {
  it("is L3 for a manifest with events, params and a complete tutor guide", () => {
    expect(complianceLevel(solarSystemManifest())).toBe(3);
  });

  it("is L2 when the tutor guide is incomplete", () => {
    expect(complianceLevel(withChanges((m) => (m.tutorGuide!.hints = [])))).toBe(2);
    expect(complianceLevel(withChanges((m) => delete m.tutorGuide))).toBe(2);
  });

  it("is L2, not L3, when a success criterion relies only on the built-in event", () => {
    expect(complianceLevel(withChanges((m) => (m.tutorGuide!.successCriteria[0]!.evidence = ["interacted"])))).toBe(2);
  });

  it("is L1 with events but no params", () => {
    expect(complianceLevel(withChanges((m) => (m.params = [])))).toBe(1);
  });

  it("is L0 with no declared events, whatever else it has", () => {
    expect(complianceLevel(withChanges((m) => (m.events = [])))).toBe(0);
  });
});

describe("checkDeclaredEvent", () => {
  const m = solarSystemManifest();

  it("accepts a declared event with declared fields", () => {
    expect(checkDeclaredEvent(m, "planet_selected", { planet: "earth" })).toBeNull();
    expect(checkDeclaredEvent(m, "orbit_comparison_completed", { inner: "earth", outer: "mars", seconds: 12 })).toBeNull();
  });

  it("treats declared fields as optional", () => {
    expect(checkDeclaredEvent(m, "planet_selected", {})).toBeNull();
    expect(checkDeclaredEvent(m, "planet_selected", undefined)).toBeNull();
  });

  it("accepts the built-in interacted event only without data", () => {
    expect(checkDeclaredEvent(m, "interacted", {})).toBeNull();
    expect(checkDeclaredEvent(m, "interacted", { x: 1 })).toMatch(/carries no data/);
  });

  it("drops undeclared events, undeclared fields and wrong types", () => {
    expect(checkDeclaredEvent(m, "planet_deleted", {})).toMatch(/not declared by solar-system-simulator@3/);
    expect(checkDeclaredEvent(m, "planet_selected", { planet: "earth", secret: "x" })).toMatch(/field "secret" is not declared/);
    expect(checkDeclaredEvent(m, "planet_selected", { planet: 3 })).toMatch(/should be string/);
  });

  it("drops oversized or nested data", () => {
    expect(checkDeclaredEvent(m, "planet_selected", { planet: "x".repeat(201) })).toMatch(/invalid/);
    expect(checkDeclaredEvent(m, "planet_selected", { planet: { name: "earth" } })).toMatch(/invalid/);
    const many = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`f${i}`, 1]));
    expect(checkDeclaredEvent(m, "planet_selected", many)).toMatch(/at most 16 fields/);
  });
});

describe("ArtifactKit protocol", () => {
  const ak = { source: "artifactkit", v: ARTIFACTKIT_PROTOCOL_VERSION } as const;
  const host = { source: "artifactkit-host", v: ARTIFACTKIT_PROTOCOL_VERSION } as const;

  it("parses every artifact message kind", () => {
    expect(ArtifactKitMessage.safeParse({ ...ak, kind: "ak-ready" }).success).toBe(true);
    expect(ArtifactKitMessage.parse({ ...ak, kind: "ak-event", nonce: "n1", name: "planet_selected" })).toMatchObject({ data: {} });
    expect(ArtifactKitMessage.parse({ ...ak, kind: "ak-error", nonce: null, message: "boom" })).toMatchObject({ fatal: false });
  });

  it("parses every host message kind", () => {
    expect(ArtifactKitHostMessage.parse({ ...host, kind: "ak-init", nonce: "n1", reducedMotion: true })).toMatchObject({ params: {} });
    expect(ArtifactKitHostMessage.safeParse({ ...host, kind: "ak-init", nonce: "n1", params: { planets: ["earth"], orbitSpeed: 2 }, reducedMotion: false }).success).toBe(true);
    expect(ArtifactKitHostMessage.safeParse({ ...host, kind: "ak-pause" }).success).toBe(true);
    expect(ArtifactKitHostMessage.safeParse({ ...host, kind: "ak-resume" }).success).toBe(true);
  });

  it("rejects the wrong source, version or direction", () => {
    expect(ArtifactKitMessage.safeParse({ source: "learnkit", v: 1, kind: "ak-ready" }).success).toBe(false);
    expect(ArtifactKitMessage.safeParse({ ...ak, v: 2, kind: "ak-ready" }).success).toBe(false);
    expect(ArtifactKitMessage.safeParse({ ...host, kind: "ak-ready" }).success).toBe(false);
    expect(ArtifactKitHostMessage.safeParse({ ...ak, kind: "ak-pause" }).success).toBe(false);
  });

  it("requires a nonce on events", () => {
    expect(ArtifactKitMessage.safeParse({ ...ak, kind: "ak-event", name: "planet_selected", data: {} }).success).toBe(false);
    expect(ArtifactKitMessage.safeParse({ ...ak, kind: "ak-event", nonce: null, name: "planet_selected", data: {} }).success).toBe(false);
    expect(ArtifactKitMessage.safeParse({ ...ak, kind: "ak-event", nonce: "", name: "planet_selected", data: {} }).success).toBe(false);
  });

  it("rejects oversized event data", () => {
    const big = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}`, "y".repeat(190)]));
    expect(ArtifactKitMessage.safeParse({ ...ak, kind: "ak-event", nonce: "n1", name: "planet_selected", data: big }).success).toBe(false);
  });
});

describe("artifactNeedFromBite", () => {
  const bp = rockyGameBlueprint();
  const bite = gameBites(bp).find((b): b is ExploreSection => b.type === "explore")!;

  it("describes the explore bite for search", () => {
    const need = artifactNeedFromBite(bite, bp, { lo1: "identify" });
    expect(ArtifactNeed.safeParse(need).success).toBe(true);
    expect(need).toMatchObject({
      biteId: bite.id,
      lessonTitle: "The Rocky Planets",
      visualKind: "parts",
      purpose: "show_the_four_rocky_planets",
      prompt: "Tap a planet",
      objectiveTexts: ["Name the four rocky planets"],
      objectiveIntents: ["identify"],
      itemLabels: ["Mercury", "Venus", "Earth", "Mars"],
      age: 8,
    });
    expect(need.interactionHints).toEqual(expect.arrayContaining(["select", "label"]));
  });

  it("adds hints from intents and the prompt's verbs", () => {
    const need = artifactNeedFromBite({ ...bite, prompt: "Drag the planets in order" }, bp, { lo1: "predict" });
    expect(need.interactionHints).toEqual(expect.arrayContaining(["predict", "drag", "sort"]));
  });

  it("works without plan intents", () => {
    expect(artifactNeedFromBite(bite, bp).objectiveIntents).toEqual([]);
  });
});

describe("ArtifactMatch", () => {
  it("bounds the score and defaults params", () => {
    const base = { artifactId: "solar-system-simulator", version: 3, title: "Solar System", breakdown: { text: 0.8 }, reasons: ["orbit visual"] };
    expect(ArtifactMatch.parse({ ...base, score: 0.82 }).params).toEqual({});
    expect(ArtifactMatch.safeParse({ ...base, score: 1.2 }).success).toBe(false);
  });
});
