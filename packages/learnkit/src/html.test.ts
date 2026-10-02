import { describe, expect, it } from "vitest";
import type { ArtifactBlueprint } from "@eco/contracts";
import { ArtifactBlueprint as BlueprintSchema, lintBlueprint, parseBlueprint } from "@eco/contracts";
import { normalizeGeneratedHtml, renderBlueprintHtml, validateArtifactHtml, withTouchGuards } from "./html";

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
