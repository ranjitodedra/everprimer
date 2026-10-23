import { describe, expect, it } from "vitest";
import type { ArtifactBlueprint } from "@eco/contracts";
import { ArtifactBlueprint as BlueprintSchema, isGameBlueprint, lintBlueprint, parseBlueprint } from "@eco/contracts";
import type { ArtifactManifest } from "@eco/contracts";
import { solarSystemManifest } from "@eco/contracts/testing";
import {
  ARTIFACT_CSP,
  collectLibraryRefs,
  inlineAssets,
  libraryArtifactCsp,
  normalizeGeneratedHtml,
  refreshPlayerHtml,
  renderBlueprintHtml,
  validateArtifactHtml,
  validateHtmlAgainstBlueprint,
  withTouchGuards,
} from "./html";
import { PLAYER_CSS, PLAYER_SOURCE } from "./player";
import { LEARNKIT_RUNTIME_SOURCE } from "./runtime";

const bp: ArtifactBlueprint = {
  schemaVersion: 1,
  topicSlug: "jupiter",
  title: "Jupiter",
  audience: { age: 8, readingLevel: "developing" },
  theme: { primary: "#4f46e5", accent: "#f59e0b", background: "#fafaf9", mood: "cosmic", emoji: "🪐" },
  learningObjectives: [
    { code: "lo1", text: "Identify Jupiter as a gas giant" },
    { code: "lo2", text: "Explain why Jupiter is much larger than Earth" },
  ],
  stages: ["discover", "understand", "recognize", "practice"],
  sections: [
    { type: "intro", id: "s1", title: "Meet Jupiter", stage: "discover", body: "Jupiter is the biggest planet in our solar system, a giant ball of swirling gas.", hook: "How many Earths fit inside Jupiter?" },
    {
      type: "explore", id: "s2", title: "How huge?", stage: "discover",
      lead: "Tap each world to compare size.",
      prompt: "Tap a planet",
      visual: {
        kind: "comparison", caption: "Width compared with Earth",
        items: [
          { id: "earth", label: "Earth", description: "Our home planet.", value: 1, emoji: "🌍", color: "#3b82f6" },
          { id: "jupiter", label: "Jupiter", description: "About 11 Earths wide.", value: 11, emoji: "🟠", color: "#ea580c" },
        ],
      },
    },
    { type: "review", id: "s3", title: "Remember", stage: "understand", bullets: ["Jupiter is the largest planet", "It is a gas giant with no solid surface"] },
    { type: "quiz", id: "s4", title: "Check", stage: "practice", questions: [
      { kind: "mcq", id: "q1", prompt: "Jupiter is a...", options: [{ id: "a", text: "Rocky planet" }, { id: "b", text: "Gas giant" }, { id: "c", text: "Moon" }], correctOptionId: "b", explanation: "Jupiter is a gas giant, made mostly of hydrogen and helium with no solid surface.", difficulty: 1, objectiveCodes: ["lo1"] },
      { kind: "true_false", id: "q2", prompt: "Over 1000 Earths could fit inside Jupiter.", answer: true, explanation: "About 1,300 Earths would fit inside Jupiter because its volume is enormous.", difficulty: 2, objectiveCodes: ["lo2"] },
    ] },
  ],
};

describe("blueprint fixture", () => {
  it("passes schema and lint", () => {
    expect(BlueprintSchema.safeParse(bp).success).toBe(true);
    expect(lintBlueprint(bp)).toEqual([]);
  });

  it("parseBlueprint drops legacy flashcard sections", () => {
    const raw = {
      ...bp,
      sections: [
        bp.sections[0],
        { type: "flashcards", id: "old", title: "Words", stage: "recognize", cards: [
          { id: "c1", front: "A", back: "B", objectiveCodes: ["lo1"] },
          { id: "c2", front: "C", back: "D", objectiveCodes: ["lo1"] },
          { id: "c3", front: "E", back: "F", objectiveCodes: ["lo2"] },
        ] },
        ...bp.sections.slice(1),
      ],
    };
    const parsed = parseBlueprint(raw);
    if (isGameBlueprint(parsed)) throw new Error("expected classic blueprint");
    expect(parsed.sections.some((s) => (s as { type: string }).type === "flashcards")).toBe(false);
    expect(parsed.sections.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
  });
});

describe("renderBlueprintHtml", () => {
  it("produces a self-contained valid artifact", () => {
    const html = renderBlueprintHtml(bp);
    const result = validateArtifactHtml(html);
    expect(result.errors).toEqual([]);
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("window.__BLUEPRINT__");
  });

  it("escapes closing script tags inside embedded JSON", () => {
    const evil = { ...bp, title: "</script><script>alert(1)</script>" };
    const html = renderBlueprintHtml(evil);
    expect(html).not.toContain("</script><script>alert(1)");
  });
});

describe("validateArtifactHtml", () => {
  it("rejects authored JavaScript that does not parse", () => {
    const html = '<!doctype html><html><head></head><body><script>window.LearnKit={};LearnKit.emit(\'question_answered\');LearnKit.emit(\'topic_completed\'); const x = `stroke="${var(--border-color)}"`;</script></body></html>';
    const r = validateArtifactHtml(html);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/syntax error/i);
  });

  it("rejects network access and external resources", () => {
    const html = `<!doctype html><html><head></head><body><script>window.LearnKit={};LearnKit.emit('question_answered');LearnKit.emit('topic_completed');fetch('/x')</script><img src="https://x/y.png"></body></html>`;
    const r = validateArtifactHtml(html);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/network/);
    expect(r.errors.join(" ")).toMatch(/external/);
  });
});

describe("normalizeGeneratedHtml", () => {
  it("injects CSP and runtime into a bare document", () => {
    const html = normalizeGeneratedHtml(`<html><head><title>x</title></head><body><script>LearnKit.emit('question_answered',{});LearnKit.emit('topic_completed',{})</script></body></html>`);
    expect(html).toContain("Content-Security-Policy");
    expect(html.indexOf("window.LearnKit = {")).toBeLessThan(html.indexOf("LearnKit.emit('question_answered'"));
    expect(validateArtifactHtml(html).ok).toBe(true);
  });

  it("still injects the runtime when the model wrote its own LearnKit stub", () => {
    const stub = `if (typeof window.LearnKit === "undefined") { window.LearnKit = { emit: function () {} }; }`;
    const html = normalizeGeneratedHtml(`<html><head></head><body><script>${stub}LearnKit.emit('question_answered',{});LearnKit.emit('topic_completed',{})</script></body></html>`);
    expect(html).toContain(LEARNKIT_RUNTIME_SOURCE);
    expect(html.indexOf(LEARNKIT_RUNTIME_SOURCE)).toBeLessThan(html.indexOf(stub));
  });
});

describe("Case 9: generated code must follow the blueprint", () => {
  const v2: ArtifactBlueprint = {
    ...bp,
    schemaVersion: 2,
    facts: [{ id: "f1", text: "Jupiter is a gas giant." }],
    sections: [
      { type: "simple_explain", id: "s_gas", title: "Gas giant", stage: "understand", objectiveCodes: ["lo1", "lo2"], factIds: ["f1"], simple: "Jupiter is a giant ball of gas.", term: "Gas giant", definition: "A huge planet made mostly of gas." },
      {
        type: "quiz", id: "s_final", role: "final_check", title: "Check", stage: "practice",
        questions: [{ kind: "true_false", id: "q_gas", prompt: "Jupiter is a gas giant.", answer: true, difficulty: 1, objectiveCodes: ["lo1", "lo2"], factIds: ["f1"], explanation: "Jupiter is a gas giant with no solid surface." }],
      },
    ],
  };
  const page = (extra = "") =>
    normalizeGeneratedHtml(
      `<html><head></head><body><script>var S=["s_gas","s_final"];var Q=["q_gas"${extra}];LearnKit.emit('question_answered',{});LearnKit.emit('topic_completed',{})</script></body></html>`,
    );

  it("a page that renders exactly the blueprint passes", () => {
    expect(validateHtmlAgainstBlueprint(page(), v2).errors).toEqual([]);
  });

  it("a page that adds a question fails", () => {
    const r = validateHtmlAgainstBlueprint(page(`,"q_bonus"`), v2);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/adds questions that are not in the blueprint: q_bonus/);
  });

  it("a page that drops a section fails", () => {
    const html = normalizeGeneratedHtml(`<html><head></head><body><script>var Q=["q_gas"];LearnKit.emit('question_answered',{});LearnKit.emit('topic_completed',{})</script></body></html>`);
    expect(validateHtmlAgainstBlueprint(html, v2).errors.join(" ")).toMatch(/sections missing from the page: s_gas, s_final/);
  });

  it("the fallback player always satisfies the blueprint", () => {
    expect(validateHtmlAgainstBlueprint(renderBlueprintHtml(v2), v2).errors).toEqual([]);
  });
});

describe("lesson images", () => {
  const png = { key: "img_moons", mime: "image/png", dataBase64: "iVBORw0KGgo=" };

  it("inlines asset placeholders as data URIs", () => {
    const html = inlineAssets(`<img src="asset:img_moons" alt="Moons">`, [png]);
    expect(html).toBe(`<img src="data:image/png;base64,iVBORw0KGgo=" alt="Moons">`);
  });

  it("rejects a placeholder with no generated image", () => {
    const html = normalizeGeneratedHtml(`<html><head></head><body><img src="asset:img_missing" alt="x"><script>LearnKit.emit('question_answered',{});LearnKit.emit('topic_completed',{})</script></body></html>`, [png]);
    expect(validateArtifactHtml(html).errors.join(" ")).toMatch(/image placeholders with no generated image: asset:img_missing/);
  });

  it("ignores assets with an unsupported type", () => {
    const html = inlineAssets(`<img src="asset:img_moons">`, [{ ...png, mime: "image/svg+xml" }]);
    expect(html).toContain("asset:img_moons");
  });

  it("the fallback player receives assets by key", () => {
    const html = renderBlueprintHtml(bp, [png]);
    expect(html).toContain(`window.__ASSETS__={"img_moons":"data:image/png;base64,iVBORw0KGgo="}`);
    expect(validateArtifactHtml(html).errors).toEqual([]);
  });
});

describe("withTouchGuards", () => {
  const count = (s: string, needle: string) => s.split(needle).length - 1;

  it("replaces a zoomable viewport and adds touch-action once", () => {
    const html = withTouchGuards(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>`);
    expect(count(html, `name="viewport"`)).toBe(1);
    expect(html).toContain("user-scalable=no");
    expect(count(html, "data-lk-touch")).toBe(1);
  });

  it("is idempotent and keeps CSP first in <head>", () => {
    const once = normalizeGeneratedHtml(`<html><head></head><body><script>LearnKit.emit('question_answered',{});LearnKit.emit('topic_completed',{})</script></body></html>`);
    const twice = withTouchGuards(once);
    expect(count(twice, `name="viewport"`)).toBe(1);
    expect(count(twice, "data-lk-touch")).toBe(1);
    expect(twice.indexOf("Content-Security-Policy")).toBeLessThan(twice.indexOf("data-lk-touch"));
  });
});

describe("refreshPlayerHtml", () => {
  it("swaps in the current player and keeps the blueprint, assets and theme", () => {
    const fresh = renderBlueprintHtml(bp, [{ key: "pic", mime: "image/png", dataBase64: "AAAA" }]);
    const stale = fresh.replace(PLAYER_CSS, ".old{}").replace(PLAYER_SOURCE, "/* old player */");
    expect(stale).not.toContain(PLAYER_SOURCE);
    expect(refreshPlayerHtml(stale)).toBe(fresh);
  });

  it("swaps in the current runtime too", () => {
    const fresh = renderBlueprintHtml(bp);
    const old = "(function () {\n  if (window.LearnKit) return;\n  window.LearnKit = { emit: function () {} };\n})();";
    const stale = fresh.replace(LEARNKIT_RUNTIME_SOURCE, old);
    expect(stale).not.toContain(LEARNKIT_RUNTIME_SOURCE);
    expect(refreshPlayerHtml(stale)).toBe(fresh);
  });

  it("leaves generated documents alone", () => {
    const html = "<!doctype html><html><head><style>body{}</style></head><body><script>1</script></body></html>";
    expect(refreshPlayerHtml(html)).toBe(html);
  });
});

describe("library embedding", () => {
  const ORIGIN = "https://artifacts.example";
  const libBp = JSON.parse(JSON.stringify(bp)) as typeof bp & { sections: Array<{ type: string; library?: unknown }> };
  const explore = libBp.sections.find((s) => s.type === "explore")!;
  explore.library = { artifactId: "solar-system", version: 1, params: {} };
  const manifest: ArtifactManifest = solarSystemManifest();
  const manifests: Record<string, ArtifactManifest> = { "solar-system@1": manifest };

  it("libraryArtifactCsp widens only frame-src and names the origin explicitly", () => {
    const csp = libraryArtifactCsp(ORIGIN);
    expect(csp).toContain(`frame-src ${ORIGIN}`);
    expect(csp).not.toContain("frame-src 'none'");
    // Other directives are unchanged.
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'unsafe-inline'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it("collectLibraryRefs returns dedup'd pins from explore bites only", () => {
    const refs = collectLibraryRefs(libBp);
    expect(refs).toEqual([{ artifactId: "solar-system", version: 1, params: {} }]);
    expect(collectLibraryRefs(bp)).toEqual([]);
  });

  it("renderBlueprintHtml keeps the strict CSP when the blueprint has no library ref", () => {
    const html = renderBlueprintHtml(bp, [], { library: { origin: ORIGIN, manifests: {} } });
    expect(html).toContain(ARTIFACT_CSP);
    expect(html).not.toContain("window.__LIBRARY__=");
  });

  it("renderBlueprintHtml keeps the strict CSP when the blueprint has library refs but no host origin was supplied", () => {
    const html = renderBlueprintHtml(libBp);
    expect(html).toContain(ARTIFACT_CSP);
    expect(html).not.toContain("window.__LIBRARY__=");
  });

  it("renderBlueprintHtml widens CSP and embeds window.__LIBRARY__ when a library ref needs it", () => {
    const html = renderBlueprintHtml(libBp, [], { library: { origin: ORIGIN, manifests } });
    expect(html).toContain(libraryArtifactCsp(ORIGIN));
    expect(html).not.toContain("frame-src 'none'");
    expect(html).toContain("window.__LIBRARY__=");
    expect(html).toContain(`"origin":"${ORIGIN}"`);
    expect(html).toContain("solar-system@1");
  });
});
