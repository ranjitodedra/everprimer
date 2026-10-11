import { describe, expect, it } from "vitest";
import { lintLessonPlan, type LearningScope } from "@eco/contracts";
import { classifyIntent, defaultLessonPlan } from "./planDefaults";
import { lintPlanForInput } from "./pipelines";

const OBJECTIVES = [
  "Identify the Sun as the centre of the solar system",
  "Explain how gravity keeps planets in orbit",
  "Compare the sizes of the planets",
  "Apply the idea of orbits to a new moon",
];

describe("classifyIntent", () => {
  it("reads the verb of the objective", () => {
    expect(classifyIntent("Identify the Sun as a star")).toBe("identify");
    expect(classifyIntent("Explain how day turns into night")).toBe("explain_process");
    expect(classifyIntent("Explain why Earth supports life")).toBe("explain");
    expect(classifyIntent("Compare rocky planets with gas giants")).toBe("compare");
    expect(classifyIntent("Order the planets from the Sun")).toBe("sequence");
    expect(classifyIntent("Predict what happens if the Sun vanished")).toBe("predict");
    expect(classifyIntent("Use the idea of orbits in a new situation")).toBe("apply");
  });
});

describe("defaultLessonPlan (planner fallback)", () => {
  const scopes: LearningScope[] = ["overview", "hobby", "exam", "mastery"];
  const ages = [5, 8, 11, 15, null];

  for (const scope of scopes) {
    for (const age of ages) {
      it(`always lints clean: scope ${scope}, age ${age ?? "unknown"}`, () => {
        for (const n of [1, 2, 4]) {
          const objectives = OBJECTIVES.slice(0, n);
          const plan = defaultLessonPlan({ objectives, age, readingLevel: null, scope, framingInterest: null });
          const problems = lintLessonPlan(plan, {
            objectiveCodes: objectives.map((_, i) => `lo${i + 1}`),
            age,
            scope,
          });
          expect(problems, `${n} objectives`).toEqual([]);
          expect(plan.planVersion).toBe(2);
          expect(plan.finalTest).toBeDefined();
          expect(plan.sessions.length).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }
});

describe("lintPlanForInput", () => {
  it("refuses to split a topic that is already part of a unit", () => {
    const plan = defaultLessonPlan({ objectives: OBJECTIVES.slice(0, 2), age: 8, readingLevel: null, scope: "hobby", framingInterest: null });
    const asSplit = { ...plan, mode: "sub_index" as const };
    const problems = lintPlanForInput(asSplit, {
      topic: { slug: "t", title: "T", description: "", objectives: OBJECTIVES.slice(0, 2), difficulty: 1 },
      curriculum: { title: "C", description: "", topicTitles: [], scope: "hobby" },
      learner: { displayName: "A", age: 8, readingLevel: null, interests: [], notes: [], strengths: [], misconceptions: [], analogies: [] },
      framingInterest: null,
      recallCandidates: [],
      allowSplit: false,
    });
    expect(problems.join("\n")).toMatch(/already part of a unit/);
  });
});
