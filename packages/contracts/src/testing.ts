import type { Bite, ClassicBlueprint, GameBlueprint, Question } from "./blueprint";
import type { ArtifactManifest } from "./library";
import type { LessonPlan, PlanLintContext, PlanSession } from "./plan";

/**
 * Test fixtures shared by the contracts tests. Not exported from the package.
 */

export function rockyPlanetsBlueprint(): ClassicBlueprint {
  return {
    schemaVersion: 2,
    topicSlug: "the-rocky-planets",
    title: "The Rocky Planets",
    audience: { age: 8, readingLevel: "developing" },
    theme: { primary: "#9a3412", accent: "#0ea5e9", background: "#fff7ed", mood: "dusty and warm", emoji: "🪨" },
    learningObjectives: [
      { code: "lo1", text: "Name the four rocky planets" },
      { code: "lo2", text: "Explain why Earth can support life" },
    ],
    stages: ["discover", "understand", "practice"],
    facts: [
      { id: "f1", text: "The four rocky planets are Mercury, Venus, Earth and Mars." },
      { id: "f2", text: "Earth has liquid water on its surface." },
      { id: "f3", text: "Life as we know it needs liquid water." },
    ],
    sections: [
      {
        type: "explore", id: "s_explore", title: "Four rocky worlds", stage: "discover", objectiveCodes: ["lo1", "lo2"], factIds: ["f1", "f2"],
        lead: "Tap each rocky planet.", prompt: "Tap a planet",
        visual: {
          kind: "parts", purpose: "show_the_four_rocky_planets", caption: "The rocky planets",
          items: [
            { id: "mercury", label: "Mercury", description: "A rocky planet." },
            { id: "venus", label: "Venus", description: "A rocky planet." },
            { id: "earth", label: "Earth", description: "A rocky planet with water." },
            { id: "mars", label: "Mars", description: "A rocky planet." },
          ],
        },
      },
      {
        type: "quiz", id: "s_check", role: "formative", title: "Quick check", stage: "practice",
        questions: [
          {
            kind: "mcq", id: "q_rocky", prompt: "Which planet is rocky?", difficulty: 1, objectiveCodes: ["lo1"], factIds: ["f1"],
            options: [{ id: "a", text: "Mars" }, { id: "b", text: "Jupiter" }, { id: "c", text: "Saturn" }], correctOptionId: "a",
            explanation: "Mars is one of the four rocky planets.",
          },
        ],
      },
      {
        type: "simple_explain", id: "s_simple", title: "Why Earth is special", stage: "understand", objectiveCodes: ["lo2"], factIds: ["f2", "f3"],
        simple: "Earth has water you can splash in, and living things need water.",
        term: "Liquid water", definition: "Water that flows, not ice or steam. Life as we know it needs it.",
      },
      {
        type: "mnemonic", id: "s_memory", title: "Remember them", stage: "understand", objectiveCodes: ["lo1"], factIds: ["f1"],
        phrase: "My Very Easy Method",
        lines: [
          { cue: "My", text: "Mercury" },
          { cue: "Very", text: "Venus" },
          { cue: "Easy", text: "Earth" },
          { cue: "Method", text: "Mars" },
        ],
      },
      {
        type: "quiz", id: "s_final", role: "final_check", title: "Check what you know", stage: "practice",
        questions: [
          {
            kind: "true_false", id: "q_water", prompt: "Life as we know it needs liquid water.", answer: true, difficulty: 1, objectiveCodes: ["lo2"], factIds: ["f3"],
            explanation: "True. Earth has liquid water, and life needs it.",
          },
          {
            kind: "fill_blank", id: "q_home", prompt: "Fill in the blank.", text: "The rocky planet we live on is ___.", difficulty: 1, objectiveCodes: ["lo1"], factIds: ["f1"],
            options: [{ id: "e", text: "Earth" }, { id: "j", text: "Jupiter" }], blanks: ["e"],
            explanation: "We live on Earth, one of the four rocky planets.",
          },
        ],
      },
    ],
  };
}

const KINDS = ["explore", "quiz", "simple_explain", "quiz", "key_points", "apply"] as const;

function sessionBites(n: number, obj: "lo1" | "lo2"): Bite[] {
  return KINDS.map((type, i) => {
    const id = `s_${n}_${i}`;
    const qid = `q_${n}_${i}`;
    if (type === "explore") {
      return {
        type, id, title: "Look close", stage: "discover", objectiveCodes: [obj], factIds: ["f1", "f2"],
        lead: "Tap each rocky world and see what you notice.",
        prompt: "Tap a planet",
        visual: {
          kind: "parts", purpose: "show_the_four_rocky_planets", caption: "Four rocky worlds",
          items: [
            { id: "mercury", label: "Mercury", description: "A small rocky world." },
            { id: "venus", label: "Venus", description: "A hot rocky world." },
            { id: "earth", label: "Earth", description: "Our home, with water." },
            { id: "mars", label: "Mars", description: "A rusty rocky world." },
          ],
        },
      };
    }
    if (type === "quiz") {
      return {
        type, id, title: "Your turn", stage: "practice",
        questions: [
          {
            kind: "mcq", id: qid, prompt: "Which one is a rocky planet? (" + qid + ")", difficulty: 1, objectiveCodes: [obj], factIds: ["f1"],
            options: [{ id: "a", text: "Mars" }, { id: "b", text: "Jupiter" }, { id: "c", text: "Saturn" }],
            correctOptionId: "a", explanation: "Mars is one of the four rocky planets.",
          },
        ],
      };
    }
    if (type === "simple_explain") {
      return {
        type, id, title: "Here is why", stage: "understand", objectiveCodes: [obj], factIds: ["f2", "f3"],
        simple: "Earth has water you can splash in, and living things need that water.",
        term: "Liquid water", definition: "Water that flows, not ice or steam.",
      };
    }
    if (type === "key_points") {
      return {
        type, id, title: "Hold onto this", stage: "understand", objectiveCodes: [obj], factIds: ["f1"],
        lead: "Keep these in your pocket.",
        points: ["Mercury, Venus, Earth and Mars are rocky.", "Earth is the one with splashable water."],
      };
    }
    return {
      type: "apply", id, title: "Try this", stage: "apply", objectiveCodes: [obj], factIds: ["f2", "f3"],
      scenario: "A probe finds a world with flowing water. Would living things like us have a chance?",
      questions: [
        {
          kind: "true_false", id: `${qid}_a`, prompt: "Could a watery world help life like us? (" + qid + ")",
          answer: true, difficulty: 2, objectiveCodes: [obj], factIds: ["f3"],
          explanation: "Yes. Life as we know it needs liquid water.",
        },
      ],
    };
  });
}

function finalQuestions(): Question[] {
  const kinds: Array<(i: number) => Question> = [
    (i) => ({
      kind: "mcq", id: `q_f_${i}`, prompt: "Which planet is rocky? #" + i, difficulty: 1, objectiveCodes: ["lo1"], factIds: ["f1"],
      options: [{ id: "a", text: "Mars" }, { id: "b", text: "Jupiter" }, { id: "c", text: "Saturn" }],
      correctOptionId: "a", explanation: "Mars is one of the four rocky planets.",
    }),
    (i) => ({
      kind: "true_false", id: `q_f_${i}`, prompt: "Does life as we know it need liquid water? #" + i, answer: true, difficulty: 1,
      objectiveCodes: ["lo2"], factIds: ["f3"], explanation: "True. Earth has liquid water, and life needs it.",
    }),
  ];
  return Array.from({ length: 8 }, (_, i) => kinds[i % 2]!(i));
}

export function rockyGameBlueprint(): GameBlueprint {
  return {
    schemaVersion: 3,
    topicSlug: "the-rocky-planets",
    title: "The Rocky Planets",
    audience: { age: 8, readingLevel: "developing" },
    theme: { primary: "#9a3412", accent: "#0ea5e9", background: "#fff7ed", mood: "dusty and warm", emoji: "🪨" },
    learningObjectives: [
      { code: "lo1", text: "Name the four rocky planets" },
      { code: "lo2", text: "Explain why Earth can support life" },
    ],
    stages: ["discover", "understand", "practice"],
    facts: [
      { id: "f1", text: "The four rocky planets are Mercury, Venus, Earth and Mars." },
      { id: "f2", text: "Earth has liquid water on its surface." },
      { id: "f3", text: "Life as we know it needs liquid water." },
    ],
    sessions: [0, 1, 2, 3].map((n) => ({
      id: `sess_${n + 1}`,
      title: n === 0 ? "Meet the rocky worlds" : n === 1 ? "Why Earth feels like home" : n === 2 ? "Spot them again" : "Use what you know",
      emoji: ["🪨", "💧", "🌍", "🚀"][n]!,
      opener: n === 0 ? "Come look at four worlds made of rock." : n === 1 ? "Want to know why you can live here?" : n === 2 ? "Let's hunt for those four names again." : "Ready to use this on a new world?",
      objectiveCodes: n % 2 === 0 ? ["lo1"] : ["lo2"],
      bites: sessionBites(n, n % 2 === 0 ? "lo1" : "lo2"),
    })),
    finalTest: {
      intro: "Big challenge time. Show me what you know about these rocky worlds.",
      questions: finalQuestions(),
    },
  };
}

export function rockyPlanetsPlan(): LessonPlan {
  const sessions: PlanSession[] = [0, 1, 2, 3].map((n) => ({
    id: `sess_${n + 1}`,
    title: ["Meet the rocky worlds", "Why Earth feels like home", "Spot them again", "Use what you know"][n]!,
    emoji: ["🪨", "💧", "🌍", "🚀"][n]!,
    purpose: n % 2 === 0 ? "name the rocky planets" : "why Earth supports life",
    objectiveCodes: n % 2 === 0 ? ["lo1"] : ["lo2"],
    biteKinds: [...KINDS],
    taskCount: 3,
  }));
  return basePlan({
    scope: "hobby",
    objectives: [
      { code: "lo1", intent: "identify", depth: "recognize" },
      { code: "lo2", intent: "explain", depth: "explain" },
    ],
    sessions,
    finalTest: { questionCount: 8, objectiveCodes: ["lo1", "lo2"], questionKinds: ["mcq", "true_false"] },
  });
}

export function basePlan(over: Partial<LessonPlan> & Pick<LessonPlan, "objectives">): LessonPlan {
  const codes = over.objectives.map((o) => o.code);
  const sessions = over.sessions ?? rockyPlanetsPlanSessions(codes);
  return {
    planVersion: 2,
    mode: "single",
    scope: "hobby",
    rationale: "Test plan built by hand for the lint tests.",
    conceptClusters: [{ id: "c1", title: "Main idea", objectiveCodes: codes }],
    learnerConstraints: { ageBand: "7-9", readingLevel: "developing", textBudget: 45, misconceptionIds: [], framingInterest: "dinosaurs" },
    recall: [],
    sessions,
    finalTest: { questionCount: 8, objectiveCodes: codes, questionKinds: ["mcq", "true_false"] },
    ...over,
  };
}

function rockyPlanetsPlanSessions(codes: string[]): PlanSession[] {
  return [0, 1, 2, 3].map((n) => ({
    id: `sess_${n + 1}`,
    title: `Round ${n + 1}`,
    emoji: "🌟",
    purpose: "teach then try",
    objectiveCodes: [codes[n % codes.length]!],
    biteKinds: [...KINDS],
    taskCount: 3,
  }));
}

/** A complete L3 manifest, shaped like the D7 example in the masterplan. */
export function solarSystemManifest(): ArtifactManifest {
  return {
    manifestVersion: 1,
    id: "solar-system-simulator",
    version: 3,
    title: "Solar System Simulator",
    description: "3D solar system with adjustable orbit speed and selectable planets.",
    format: "bundle",
    entry: "index.html",
    rendering: { dimension: "3d", tech: ["three@0.170.0"], webgl: true },
    layout: { aspectRatio: "16:9" },
    subjects: ["science"],
    topics: ["astronomy", "solar system"],
    concepts: ["planetary orbit", "orbital period"],
    prerequisites: ["planets orbit the sun"],
    learningObjectives: ["Explain why planets farther from the sun take longer to orbit"],
    objectiveIntents: ["explain_process", "compare", "predict"],
    visualKinds: ["orbit", "simulation"],
    interactionTypes: ["select", "simulate", "compare", "predict"],
    ageRange: [8, 12],
    difficulty: 2,
    durationSec: [60, 240],
    params: [
      { key: "planets", type: "string[]", default: ["mercury", "venus", "earth", "mars"], options: ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"], description: "Which planets to show, inner first." },
      { key: "orbitSpeed", type: "number", default: 1, min: 0.1, max: 5, description: "Starting speed multiplier for every orbit." },
    ],
    events: [
      { name: "planet_selected", data: { planet: "string" }, description: "The child tapped a planet." },
      { name: "orbit_comparison_completed", data: { inner: "string", outer: "string", seconds: "number" }, description: "The child watched two planets complete an orbit side by side." },
    ],
    tutorGuide: {
      intro: "Let's watch the planets race around the Sun.",
      steps: ["Tap Earth and Mars.", "Speed up the orbits and watch which one finishes first."],
      observationPrompts: ["Which planet finished its lap first?"],
      misconceptions: [{ belief: "All planets take one year to go around the Sun.", response: "Only Earth takes one Earth year; farther planets have longer paths." }],
      hints: ["Look at how long each path is.", "Farther planets have a longer path to travel.", "Mars is farther out than Earth, so its lap is longer."],
      successCriteria: [{ description: "Compared an inner and an outer planet's orbit", evidence: ["orbit_comparison_completed"] }],
    },
    accessibility: { reducedMotion: true, keyboard: true, screenReaderSummary: "Planets circle the Sun; closer planets finish their laps sooner.", colorSafe: true },
    performance: { maxBundleKB: 4000, targetFps: 30, mobileTested: true },
    provenance: { createdWith: ["claude-opus-5.5"], createdAt: "2026-10-21T12:00:00.000Z" },
    license: { artifact: "proprietary", thirdParty: [{ name: "three", version: "0.170.0", license: "MIT" }], attributions: [] },
  };
}

export function ctxFor(plan: LessonPlan, over: Partial<PlanLintContext> = {}): PlanLintContext {
  return {
    objectiveCodes: plan.objectives.map((o) => o.code),
    age: 8,
    scope: plan.scope,
    ...over,
  };
}
