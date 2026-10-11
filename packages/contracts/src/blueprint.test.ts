import { describe, expect, it } from "vitest";
import { ArtifactBlueprint, isGameBlueprint, lintBlueprint, parseBlueprint, type ClassicBlueprint, type Question } from "./blueprint";
import { rockyGameBlueprint, rockyPlanetsBlueprint } from "./testing";

function finalQuiz(bp: ClassicBlueprint) {
  const s = bp.sections[bp.sections.length - 1]!;
  if (s.type !== "quiz") throw new Error("fixture changed");
  return s;
}

describe("valid v2 blueprint", () => {
  it("passes schema and lint", () => {
    const bp = rockyPlanetsBlueprint();
    expect(ArtifactBlueprint.safeParse(bp).success).toBe(true);
    expect(lintBlueprint(bp, { interests: ["dinosaurs"] })).toEqual([]);
  });
});

describe("Case 7: a question without a usable answer key", () => {
  it("an mcq with no correctOptionId fails the schema", () => {
    const bp = rockyPlanetsBlueprint() as unknown as { sections: Array<{ questions?: Array<Record<string, unknown>> }> };
    delete bp.sections[1]!.questions![0]!.correctOptionId;
    expect(ArtifactBlueprint.safeParse(bp).success).toBe(false);
  });

  it("an mcq whose key is not an option fails lint", () => {
    const bp = rockyPlanetsBlueprint();
    const q = (bp.sections[1] as { questions: Question[] }).questions[0]!;
    if (q.kind !== "mcq") throw new Error("fixture changed");
    q.correctOptionId = "z";
    expect(lintBlueprint(bp)).toContain('question "q_rocky" correctOptionId not among options');
  });

  it("a fill_blank whose blanks do not match the text or options fails lint", () => {
    const bp = rockyPlanetsBlueprint();
    const q = finalQuiz(bp).questions[1]!;
    if (q.kind !== "fill_blank") throw new Error("fixture changed");
    q.blanks = ["x", "e"];
    const problems = lintBlueprint(bp).join("\n");
    expect(problems).toMatch(/text has 1 blanks \(___\) but 2 answers/);
    expect(problems).toMatch(/blank answer "x" is not among options/);
  });

  it("a matching question missing a pair fails lint", () => {
    const bp = rockyPlanetsBlueprint();
    finalQuiz(bp).questions.push({
      kind: "matching", id: "q_pairs", prompt: "Match them.", difficulty: 2, objectiveCodes: ["lo1"], factIds: ["f1"],
      left: [{ id: "a", text: "Mars" }, { id: "b", text: "Earth" }],
      right: [{ id: "x", text: "Red" }, { id: "y", text: "Blue" }],
      pairs: [{ left: "a", right: "x" }, { left: "a", right: "y" }],
      explanation: "Mars looks red and Earth looks blue.",
    });
    expect(lintBlueprint(bp).join("\n")).toMatch(/needs exactly one pair for every left item/);
  });

  it("a v2 short answer longer than three words fails lint", () => {
    const bp = rockyPlanetsBlueprint();
    finalQuiz(bp).questions.push({
      kind: "short_answer", id: "q_long", prompt: "Why is Earth special?", difficulty: 2, objectiveCodes: ["lo2"], factIds: ["f2"],
      acceptedAnswers: ["it has liquid water oceans"], explanation: "Earth has liquid water on its surface.",
    });
    expect(lintBlueprint(bp).join("\n")).toMatch(/q_long/);
  });

  it("a question that assesses no objective and is not recall fails lint", () => {
    const bp = rockyPlanetsBlueprint();
    finalQuiz(bp).questions[0]!.objectiveCodes = [];
    expect(lintBlueprint(bp).join("\n")).toMatch(/q_water/);
  });
});

describe("Case 8: a claim outside the facts list", () => {
  it("a block citing a fact that does not exist fails", () => {
    const bp = rockyPlanetsBlueprint();
    bp.sections[2]!.factIds = ["f2", "f9"];
    expect(lintBlueprint(bp)).toContain('section "s_simple" cites unknown fact f9');
  });

  it("a teaching block that cites no facts fails", () => {
    const bp = rockyPlanetsBlueprint();
    bp.sections[3]!.factIds = [];
    expect(lintBlueprint(bp)).toContain('section "s_memory" (mnemonic) cites no facts; list the factIds it states');
  });

  it("a question whose answer relies on no fact fails", () => {
    const bp = rockyPlanetsBlueprint();
    delete finalQuiz(bp).questions[1]!.factIds;
    expect(lintBlueprint(bp).join("\n")).toMatch(/question "q_home" cites no facts/);
  });

  it("a v2 blueprint with no facts list fails", () => {
    const bp = rockyPlanetsBlueprint();
    delete bp.facts;
    expect(lintBlueprint(bp).join("\n")).toMatch(/has no facts list/);
  });

  it("an answer key that depends on the learner's interest fails", () => {
    const bp = rockyPlanetsBlueprint();
    const q = (bp.sections[1] as { questions: Question[] }).questions[0]!;
    if (q.kind !== "mcq") throw new Error("fixture changed");
    q.options = [{ id: "a", text: "A dinosaur planet" }, { id: "b", text: "Jupiter" }, { id: "c", text: "Saturn" }];
    expect(lintBlueprint(bp, { interests: ["dinosaurs"] }).join("\n")).toMatch(/depends on the interest "dinosaur"/);
    expect(lintBlueprint(bp)).toEqual([]);
  });
});

describe("final check and limits", () => {
  it("the final_check must be last", () => {
    const reordered = rockyPlanetsBlueprint();
    const last = reordered.sections.pop()!;
    reordered.sections.splice(1, 0, last);
    expect(lintBlueprint(reordered).join("\n")).toMatch(/final_check/);
  });

  it("the final_check must assess every objective", () => {
    const bp = rockyPlanetsBlueprint();
    finalQuiz(bp).questions = finalQuiz(bp).questions.filter((q) => q.id !== "q_water");
    expect(lintBlueprint(bp).join("\n")).toMatch(/lo2/);
  });

  it("text over the age-band word budget fails", () => {
    const bp = rockyPlanetsBlueprint();
    bp.audience.age = 5;
    const s = bp.sections[2]!;
    if (s.type !== "simple_explain") throw new Error("fixture changed");
    s.definition = "Water that flows freely across the surface of a planet rather than being frozen as ice or floating as steam, which matters because every living thing we know about needs it.";
    expect(lintBlueprint(bp).join("\n")).toMatch(/31-word text block; the limit for this age is 30/);
  });

  it("a recall question is credited to an earlier objective, not this lesson", () => {
    const bp = rockyPlanetsBlueprint();
    finalQuiz(bp).questions.push({
      kind: "true_false", id: "q_recall", prompt: "The Sun is a star.", answer: true, difficulty: 1, objectiveCodes: [], recallObjectiveId: "obj-earlier",
      explanation: "The Sun is a star, like the ones you see at night.",
    });
    expect(lintBlueprint(bp)).toEqual([]);
    finalQuiz(bp).questions[2]!.objectiveCodes = ["lo1"];
    expect(lintBlueprint(bp).join("\n")).toMatch(/q_recall/);
  });
});

describe("compatibility with stored v1 lessons", () => {
  const v1 = (): ArtifactBlueprint => ({
    schemaVersion: 1,
    topicSlug: "old",
    title: "An old lesson",
    audience: { age: 8, readingLevel: null },
    theme: { primary: "#1d4ed8", accent: "#f59e0b", background: "#f8fafc", mood: "calm", emoji: "✨" },
    learningObjectives: [{ code: "lo1", text: "Name one planet" }],
    stages: ["discover", "practice"],
    sections: [
      {
        type: "explore", id: "explore", title: "Look", stage: "discover", lead: "Tap the planets.", prompt: "Tap one",
        visual: { kind: "parts", caption: "Planets", items: [{ id: "a", label: "Mars", description: "Red" }, { id: "b", label: "Earth", description: "Home" }] },
      },
      {
        type: "quiz", id: "quiz", title: "Check", stage: "practice",
        questions: [{ kind: "true_false", id: "q1", prompt: "Mars is a planet.", answer: true, difficulty: 1, objectiveCodes: ["lo1"], explanation: "Mars is the fourth planet." }],
      },
    ],
  });

  it("a v1 lesson without intro or review still parses and lints clean", () => {
    const bp = parseBlueprint(v1());
    expect(bp.schemaVersion).toBe(1);
    expect(lintBlueprint(bp)).toEqual([]);
  });

  it("stored flashcard sections are dropped on read", () => {
    const raw = v1() as unknown as { sections: unknown[] };
    raw.sections.splice(1, 0, { type: "flashcards", id: "cards", title: "Cards", stage: "recognize", cards: [] });
    const parsed = parseBlueprint(raw);
    if (isGameBlueprint(parsed)) throw new Error("expected classic");
    expect(parsed.sections.map((s) => s.type)).toEqual(["explore", "quiz"]);
  });
});

describe("v3 game blueprint", () => {
  it("passes schema and lint", () => {
    const bp = rockyGameBlueprint();
    expect(ArtifactBlueprint.safeParse(bp).success).toBe(true);
    expect(lintBlueprint(bp, { interests: ["dinosaurs"] })).toEqual([]);
  });

  it("rejects instruction voice", () => {
    const bp = rockyGameBlueprint();
    bp.sessions[0]!.opener = "In this lesson the learner will name planets.";
    expect(lintBlueprint(bp).join("\n")).toMatch(/talk to the learner/);
  });

  it("rejects a missing teaching bite for an objective", () => {
    const bp = rockyGameBlueprint();
    for (const sess of bp.sessions) {
      sess.bites = sess.bites.filter((b) => b.type === "quiz" || b.type === "apply");
    }
    expect(lintBlueprint(bp).join("\n")).toMatch(/has no teaching bite/);
  });
});
