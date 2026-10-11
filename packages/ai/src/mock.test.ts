import { describe, expect, it } from "vitest";
import { ArtifactBlueprint, GeneratedCurriculum, isGameBlueprint, lintBlueprint, lintBlueprintAgainstPlan, type LearnerContext } from "@eco/contracts";
import { validateArtifactHtml, validateHtmlAgainstBlueprint } from "@eco/learnkit";
import { mockBlueprint, mockCurriculum } from "./mock";
import { SOLAR_SYSTEM_BLUEPRINTS, SOLAR_SYSTEM_CURRICULUM } from "./mock/solarSystem";
import { planFromBlueprint } from "./planDefaults";
import { generateCurriculum, generateLesson } from "./pipelines";

const learner: LearnerContext = {
  displayName: "Ava",
  age: 8,
  readingLevel: "developing",
  interests: ["dinosaurs"],
  notes: [],
  strengths: [],
  misconceptions: [],
  analogies: [],
};

describe("seed content", () => {
  it("solar system curriculum is valid", () => {
    expect(GeneratedCurriculum.safeParse(SOLAR_SYSTEM_CURRICULUM).success).toBe(true);
    const slugs = new Set(SOLAR_SYSTEM_CURRICULUM.topics.map((t) => t.slug));
    for (const t of SOLAR_SYSTEM_CURRICULUM.topics) for (const p of t.prerequisites) expect(slugs.has(p)).toBe(true);
  });

  it("every seeded blueprint is v3 and passes schema, lint and its own plan", () => {
    for (const [slug, bp] of Object.entries(SOLAR_SYSTEM_BLUEPRINTS)) {
      const parsed = ArtifactBlueprint.safeParse(bp);
      expect(parsed.success, slug).toBe(true);
      expect(bp.schemaVersion, slug).toBe(3);
      expect(lintBlueprint(bp, { interests: learner.interests }), slug).toEqual([]);
      expect(lintBlueprintAgainstPlan(bp, planFromBlueprint(bp, { scope: "hobby", framingInterest: null })), slug).toEqual([]);
      expect(bp.topicSlug).toBe(slug);
    }
  });

  it("seeded lessons do not share one fixed bite order", () => {
    const orders = new Set(
      Object.values(SOLAR_SYSTEM_BLUEPRINTS).map((bp) => (isGameBlueprint(bp) ? bp.sessions[0]!.bites.map((b) => b.type).join(">") : "")),
    );
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe("mock generators", () => {
  it("builds a valid generic curriculum from any goal", () => {
    const c = mockCurriculum("I want my child to learn about fractions.", learner);
    expect(GeneratedCurriculum.safeParse(c).success).toBe(true);
    expect(c.title).toBe("Fractions");
    expect(c.topics.length).toBeGreaterThanOrEqual(3);
  });

  it("builds a valid generic v3 blueprint for any topic", () => {
    const c = mockCurriculum("photosynthesis", learner);
    for (const t of c.topics) {
      const bp = mockBlueprint({ topic: { ...t, objectives: t.learningObjectives }, learner });
      expect(ArtifactBlueprint.safeParse(bp).success, t.slug).toBe(true);
      expect(bp.schemaVersion).toBe(3);
      expect(lintBlueprint(bp), t.slug).toEqual([]);
    }
  });
});

describe("pipelines in mock mode", () => {
  it("run end to end without network", async () => {
    process.env.AI_PROVIDER = "mock";
    const { curriculum } = await generateCurriculum({ goal: "the solar system", scope: "hobby", learner, tier: "free" });
    const topic = curriculum.topics.find((t) => t.slug === "jupiter")!;
    const lesson = await generateLesson({
      topic: { ...topic, objectives: topic.learningObjectives },
      curriculum: {
        title: curriculum.title,
        description: curriculum.description,
        topicTitles: curriculum.topics.map((t) => t.title),
        scope: "hobby",
      },
      learner,
      framingInterest: "dinosaurs",
      recallCandidates: [],
      tier: "free",
    });
    if (lesson.kind !== "lesson") throw new Error("expected a lesson");
    expect(lesson.factcheck.ok).toBe(true);
    expect(lesson.lintProblems).toEqual([]);
    expect(isGameBlueprint(lesson.blueprint)).toBe(true);
    if (isGameBlueprint(lesson.blueprint)) {
      expect(lesson.plan.sessions.map((s) => s.id)).toEqual(lesson.blueprint.sessions.map((s) => s.id));
    }
    expect(lesson.html).toContain("window.__BLUEPRINT__");
    expect(validateArtifactHtml(lesson.html).ok).toBe(true);
    expect(validateHtmlAgainstBlueprint(lesson.html, lesson.blueprint).ok).toBe(true);
  });
});
