import { describe, expect, it } from "vitest";
import { ArtifactBlueprint } from "./blueprint";
import { LessonPlan, lintBlueprintAgainstPlan, lintLessonPlan } from "./plan";
import { basePlan, ctxFor, rockyGameBlueprint, rockyPlanetsBlueprint, rockyPlanetsPlan } from "./testing";

const KINDS = ["explore", "quiz", "simple_explain", "quiz", "key_points", "apply"] as const;

describe("Case 1: age 8 overview plan", () => {
  const plan = rockyPlanetsPlan();
  plan.scope = "overview";
  plan.objectives = [
    { code: "lo1", intent: "identify", depth: "recognize" },
    { code: "lo2", intent: "explain", depth: "explain" },
  ];

  it("a full session plan passes", () => {
    expect(lintLessonPlan(plan, ctxFor(plan))).toEqual([]);
    expect(plan.sessions).toHaveLength(4);
  });

  it("overview rejects transfer depth except for apply", () => {
    const deeper = { ...plan, objectives: plan.objectives.map((o) => (o.code === "lo2" ? { ...o, depth: "transfer" as const } : o)) };
    expect(lintLessonPlan(deeper, ctxFor(deeper)).join("\n")).toMatch(/overview scope cannot plan transfer depth/);
  });
});

describe("Case 2: mastery needs an apply bite", () => {
  const plan = rockyPlanetsPlan();
  plan.scope = "mastery";
  plan.objectives = [
    { code: "lo1", intent: "explain", depth: "explain" },
    { code: "lo2", intent: "apply", depth: "transfer" },
  ];

  it("passes when sessions include apply", () => {
    expect(lintLessonPlan(plan, ctxFor(plan))).toEqual([]);
  });

  it("mastery without apply fails", () => {
    const noApply = {
      ...plan,
      sessions: plan.sessions.map((s) => ({
        ...s,
        biteKinds: s.biteKinds.map((k) => (k === "apply" ? "key_points" as const : k)),
        taskCount: 2,
      })),
    };
    expect(lintLessonPlan(noApply, ctxFor(noApply)).join("\n")).toMatch(/mastery scope needs at least one transfer-depth objective with an apply bite/);
  });
});

describe("Case 3: Electricity, age 8, mastery → sub_index", () => {
  const objectives = [
    { code: "lo1", intent: "explain_process", depth: "explain" },
    { code: "lo2", intent: "identify", depth: "explain" },
    { code: "lo3", intent: "explain", depth: "explain" },
    { code: "lo4", intent: "apply", depth: "transfer" },
    { code: "lo5", intent: "explain", depth: "explain" },
    { code: "lo6", intent: "identify", depth: "recognize" },
  ] as LessonPlan["objectives"];
  const clusters = [
    { id: "c1", title: "Circuits", objectiveCodes: ["lo1"] },
    { id: "c2", title: "Conductors and insulators", objectiveCodes: ["lo2", "lo3"] },
    { id: "c3", title: "Using electricity safely", objectiveCodes: ["lo4"] },
    { id: "c4", title: "Static electricity", objectiveCodes: ["lo5", "lo6"] },
  ];
  const plan = basePlan({
    scope: "mastery",
    mode: "sub_index",
    splitReason: "Four separate concept clusters are too much for one lesson at age 8.",
    conceptClusters: clusters,
    proposedChildTopics: clusters.map((c) => ({
      clusterId: c.id,
      title: c.title,
      description: `A short lesson on ${c.title.toLowerCase()}.`,
      objectiveTexts: [`Describe ${c.title.toLowerCase()}`, `Explain one example of ${c.title.toLowerCase()}`],
    })),
    objectives,
    sessions: [],
  });

  it("a topic over the cluster limit is a valid sub_index", () => {
    expect(lintLessonPlan(plan, ctxFor(plan))).toEqual([]);
  });

  it("the same clusters as one lesson fail", () => {
    const single = { ...plan, mode: "single" as const };
    expect(lintLessonPlan(single, ctxFor(single)).join("\n")).toMatch(/concept clusters exceed 3 for ages 7-9/);
  });

  it("splitting a topic that fits in one lesson fails", () => {
    const small = { ...plan, conceptClusters: [{ id: "c1", title: "All", objectiveCodes: ["lo1", "lo2", "lo3"] }, { id: "c2", title: "Rest", objectiveCodes: ["lo4", "lo5", "lo6"] }] };
    small.proposedChildTopics = plan.proposedChildTopics!.slice(0, 2).map((p, i) => ({ ...p, clusterId: `c${i + 1}` }));
    expect(lintLessonPlan(small, ctxFor(small)).join("\n")).toMatch(/fit in one lesson/);
  });
});

describe("Case 4: quiz only for an explain_process objective", () => {
  it("fails lint", () => {
    const plan = basePlan({
      objectives: [{ code: "lo1", intent: "explain_process", depth: "explain" }],
      sessions: [
        { id: "sess_1", title: "Quiz only", emoji: "❓", purpose: "test", objectiveCodes: ["lo1"], biteKinds: ["quiz", "quiz", "quiz", "quiz", "quiz"], taskCount: 5 },
        { id: "sess_2", title: "More quiz", emoji: "❓", purpose: "test", objectiveCodes: ["lo1"], biteKinds: ["quiz", "quiz", "quiz", "quiz", "quiz"], taskCount: 5 },
        { id: "sess_3", title: "Still quiz", emoji: "❓", purpose: "test", objectiveCodes: ["lo1"], biteKinds: ["quiz", "quiz", "quiz", "quiz", "quiz"], taskCount: 5 },
        { id: "sess_4", title: "Last quiz", emoji: "❓", purpose: "test", objectiveCodes: ["lo1"], biteKinds: ["quiz", "quiz", "quiz", "quiz", "quiz"], taskCount: 5 },
      ],
    });
    const problems = lintLessonPlan(plan, ctxFor(plan)).join("\n");
    expect(problems).toMatch(/needs a representation/);
    expect(problems).toMatch(/lo1 has no teaching bite/);
  });
});

describe("Case 5: an objective is not assessed", () => {
  it("fails lint", () => {
    const plan = rockyPlanetsPlan();
    plan.finalTest = { questionCount: 8, objectiveCodes: ["lo1"], questionKinds: ["mcq"] };
    expect(lintLessonPlan(plan, ctxFor(plan))).toContain("finalTest does not assess objective lo2");
  });
});

describe("Case 6: unknown visual kind", () => {
  it("fails the blueprint schema", () => {
    const bp = rockyPlanetsBlueprint() as unknown as { sections: Array<{ visual?: { kind: string } }> };
    bp.sections[0]!.visual!.kind = "3d_globe";
    expect(ArtifactBlueprint.safeParse(bp).success).toBe(false);
  });
});

describe("Case 10: a valid session plan", () => {
  it("rocky planets plan and game blueprint match", () => {
    const plan = rockyPlanetsPlan();
    expect(lintLessonPlan(plan, ctxFor(plan))).toEqual([]);
    expect(lintBlueprintAgainstPlan(rockyGameBlueprint(), plan)).toEqual([]);
  });
});

describe("hard limits and fidelity", () => {
  it("rejects too few sessions for ages 4-6", () => {
    const plan = rockyPlanetsPlan();
    plan.learnerConstraints.ageBand = "4-6";
    plan.learnerConstraints.textBudget = 25;
    expect(lintLessonPlan(plan, ctxFor(plan, { age: 5 })).join("\n")).toMatch(/4 sessions; ages 4-6 need 3/);
  });

  it("recall must come from the offered candidates", () => {
    const plan = rockyPlanetsPlan();
    plan.recall = [{ objectiveId: "obj-123", reason: "weak last week" }];
    expect(lintLessonPlan(plan, ctxFor(plan)).join("\n")).toMatch(/not one of the offered recall candidates/);
    expect(lintLessonPlan(plan, ctxFor(plan, { recallCandidateIds: ["obj-123"] }))).toEqual([]);
  });

  it("a blueprint that reorders sessions breaks fidelity", () => {
    const plan = rockyPlanetsPlan();
    const swapped = rockyGameBlueprint();
    [swapped.sessions[0], swapped.sessions[1]] = [swapped.sessions[1]!, swapped.sessions[0]!];
    expect(lintBlueprintAgainstPlan(swapped, plan).length).toBeGreaterThan(0);
  });
});

describe("LessonPlan schema", () => {
  it("rejects a v1 plan", () => {
    expect(LessonPlan.safeParse({ ...rockyPlanetsPlan(), planVersion: 1 }).success).toBe(false);
  });
  it("uses the planned bite kinds", () => {
    expect(rockyPlanetsPlan().sessions[0]!.biteKinds).toEqual([...KINDS]);
  });
});
