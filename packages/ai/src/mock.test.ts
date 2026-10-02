import { describe, expect, it } from "vitest";
import { ArtifactBlueprint, GeneratedCurriculum, lintBlueprint, type LearnerContext } from "@eco/contracts";
import { validateArtifactHtml } from "@eco/learnkit";
import { mockBlueprint, mockCurriculum } from "./mock";
import { SOLAR_SYSTEM_BLUEPRINTS, SOLAR_SYSTEM_CURRICULUM } from "./mock/solarSystem";
import { generateArtifactHtml, generateBlueprint, generateCurriculum } from "./pipelines";

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

  it("every seeded blueprint passes schema and lint", () => {
    for (const [slug, bp] of Object.entries(SOLAR_SYSTEM_BLUEPRINTS)) {
      const parsed = ArtifactBlueprint.safeParse(bp);
      expect(parsed.success, slug).toBe(true);
      expect(lintBlueprint(bp), slug).toEqual([]);
      expect(bp.topicSlug).toBe(slug);
    }
  });
});

describe("mock generators", () => {
  it("builds a valid generic curriculum from any goal", () => {
    const c = mockCurriculum("I want my child to learn about fractions.", learner);
    expect(GeneratedCurriculum.safeParse(c).success).toBe(true);
    expect(c.title).toBe("Fractions");
    expect(c.topics.length).toBeGreaterThanOrEqual(3);
  });

  it("builds a valid generic blueprint for any topic", () => {
    const c = mockCurriculum("photosynthesis", learner);
    for (const t of c.topics) {
      const bp = mockBlueprint({ topic: { ...t, objectives: t.learningObjectives }, learner });
      expect(ArtifactBlueprint.safeParse(bp).success, t.slug).toBe(true);
      expect(lintBlueprint(bp), t.slug).toEqual([]);
    }
  });
});

describe("pipelines in mock mode", () => {
  it("run end to end without network", async () => {
    process.env.AI_PROVIDER = "mock";
    const { curriculum } = await generateCurriculum({ goal: "the solar system", learner, tier: "free" });
    const topic = curriculum.topics.find((t) => t.slug === "jupiter")!;
    const { blueprint, factcheck, lintProblems } = await generateBlueprint({
      topic: { ...topic, objectives: topic.learningObjectives },
      curriculum: { title: curriculum.title, description: curriculum.description, topicTitles: curriculum.topics.map((t) => t.title) },
      learner,
      tier: "free",
    });
    expect(factcheck.ok).toBe(true);
    expect(lintProblems).toEqual([]);
    const art = await generateArtifactHtml({ blueprint, tier: "free" });
    expect(art.usedFallback).toBe(true);
    expect(art.validation.ok).toBe(true);
    expect(validateArtifactHtml(art.html).ok).toBe(true);
  });
});
