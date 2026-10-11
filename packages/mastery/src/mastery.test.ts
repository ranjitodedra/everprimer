import { describe, expect, it } from "vitest";
import type { Question } from "@eco/contracts";
import { gradeAnswer, normalizeText } from "./grade";
import { EMPTY_MASTERY, applyEvidence, buildLessonFeedback, summarizeTopic, topicStatus, type ObjectiveEvidence } from "./mastery";

const base = { explanation: "Because reasons that teach.", difficulty: 2 as const, objectiveCodes: ["lo1"] };

describe("gradeAnswer", () => {
  it("grades mcq by option id", () => {
    const q: Question = { kind: "mcq", id: "q1", prompt: "?", ...base, options: [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }], correctOptionId: "b" };
    expect(gradeAnswer(q, "b").correct).toBe(true);
    expect(gradeAnswer(q, "a").correct).toBe(false);
    expect(gradeAnswer(q, ["b"]).correct).toBe(false);
  });

  it("grades true/false from boolean or string", () => {
    const q: Question = { kind: "true_false", id: "q2", prompt: "?", ...base, answer: true };
    expect(gradeAnswer(q, true).correct).toBe(true);
    expect(gradeAnswer(q, "true").correct).toBe(true);
    expect(gradeAnswer(q, false).correct).toBe(false);
  });

  it("grades fill_blank by the option id chosen for each blank, in order", () => {
    const q: Question = {
      kind: "fill_blank", id: "q_fb", prompt: "?", ...base, text: "Plants need ___ and ___.",
      options: [{ id: "w", text: "water" }, { id: "l", text: "light" }, { id: "s", text: "sand" }], blanks: ["w", "l"],
    };
    expect(gradeAnswer(q, ["w", "l"]).correct).toBe(true);
    expect(gradeAnswer(q, ["l", "w"]).correct).toBe(false);
    expect(gradeAnswer(q, ["w"]).correct).toBe(false);
    expect(gradeAnswer(q, "w").correct).toBe(false);
  });

  it("grades matching as one pair per left item, in any order", () => {
    const q: Question = {
      kind: "matching", id: "q_m", prompt: "?", ...base,
      left: [{ id: "io", text: "Io" }, { id: "eu", text: "Europa" }],
      right: [{ id: "v", text: "Volcanoes" }, { id: "i", text: "Ice" }, { id: "r", text: "Rings" }],
      pairs: [{ left: "io", right: "v" }, { left: "eu", right: "i" }],
    };
    expect(gradeAnswer(q, ["eu:i", "io:v"]).correct).toBe(true);
    expect(gradeAnswer(q, ["eu:i", "io:v"]).normalized).toEqual(["eu:i", "io:v"]);
    expect(gradeAnswer(q, ["io:v", "eu:r"]).correct).toBe(false);
    expect(gradeAnswer(q, ["io:v"]).correct).toBe(false);
    expect(gradeAnswer(q, ["io:v", "io:v", "eu:i"]).correct).toBe(false);
    expect(gradeAnswer(q, ["io-v", "eu:i"]).correct).toBe(false);
  });

  it("grades short answers leniently on case, punctuation and articles", () => {
    const q: Question = { kind: "short_answer", id: "q3", prompt: "?", ...base, acceptedAnswers: ["The Sun", "sun"] };
    expect(gradeAnswer(q, "  sun! ").correct).toBe(true);
    expect(gradeAnswer(q, "a SUN").correct).toBe(true);
    expect(gradeAnswer(q, "moon").correct).toBe(false);
    expect(gradeAnswer(q, "").correct).toBe(false);
  });

  it("grades ordering strictly", () => {
    const q: Question = { kind: "ordering", id: "q4", prompt: "?", ...base, items: [{ id: "x", text: "X" }, { id: "y", text: "Y" }, { id: "z", text: "Z" }], correctOrder: ["x", "y", "z"] };
    expect(gradeAnswer(q, ["x", "y", "z"]).correct).toBe(true);
    expect(gradeAnswer(q, ["x", "z", "y"]).correct).toBe(false);
    expect(gradeAnswer(q, ["x", "y"]).correct).toBe(false);
  });

  it("normalizes text", () => {
    expect(normalizeText("The  Great, Red Spot!")).toBe("great red spot");
  });
});

const ev = (over: Partial<ObjectiveEvidence> = {}): ObjectiveEvidence => ({
  correct: true,
  difficulty: 2,
  attempt: 1,
  hintsUsed: 0,
  activityType: "quiz",
  ...over,
});

describe("applyEvidence", () => {
  it("rises with correct answers and falls with incorrect ones", () => {
    let s = applyEvidence(EMPTY_MASTERY, ev());
    expect(s.score).toBeGreaterThan(0.3);
    const up = s.score;
    s = applyEvidence(s, ev({ correct: false }));
    expect(s.score).toBeLessThan(up);
  });

  it("first-attempt unaided answers count more than hinted third attempts", () => {
    const strong = applyEvidence(EMPTY_MASTERY, ev());
    const weak = applyEvidence(EMPTY_MASTERY, ev({ attempt: 3, hintsUsed: 2 }));
    expect(strong.score).toBeGreaterThan(weak.score);
  });

  it("requires two activity types for mastered, no matter how many quiz answers", () => {
    let s = EMPTY_MASTERY;
    for (let i = 0; i < 10; i++) s = applyEvidence(s, ev({ difficulty: 3 }));
    expect(s.score).toBeGreaterThan(0.9);
    expect(s.status).toBe("proficient");
    s = applyEvidence(s, ev({ activityType: "apply" }));
    expect(s.status).toBe("mastered");
  });

  it("treats revealed answers as weak negative evidence", () => {
    const s = applyEvidence(EMPTY_MASTERY, ev({ revealed: true, correct: true }));
    expect(s.score).toBe(0);
    expect(s.evidenceCount).toBe(1);
  });
});

describe("topic status", () => {
  it("is needs_review when weak objectives remain after reaching the end", () => {
    let weak = EMPTY_MASTERY;
    weak = applyEvidence(weak, ev({ correct: false }));
    weak = applyEvidence(weak, ev({ correct: false }));
    let strong = EMPTY_MASTERY;
    for (let i = 0; i < 3; i++) strong = applyEvidence(strong, ev());
    const summary = summarizeTopic([
      { code: "lo1", state: weak },
      { code: "lo2", state: strong },
    ]);
    expect(summary.weakObjectiveCodes).toEqual(["lo1"]);
    expect(topicStatus(summary, true, true)).toBe("needs_review");
    expect(topicStatus(summary, false, true)).toBe("in_progress");
    expect(topicStatus(summary, false, false)).toBe("not_started");
  });

  it("is completed when the end is reached with solid evidence", () => {
    let strong = EMPTY_MASTERY;
    for (let i = 0; i < 3; i++) strong = applyEvidence(strong, ev());
    const summary = summarizeTopic([{ code: "lo1", state: strong }]);
    expect(topicStatus(summary, true, true)).toBe("completed");
  });

  it("lets a passing final score complete the topic and a failing one mark review", () => {
    const summary = summarizeTopic([{ code: "lo1", state: EMPTY_MASTERY }]);
    expect(topicStatus(summary, true, true, 0.8)).toBe("completed");
    expect(topicStatus(summary, true, true, 0.5)).toBe("needs_review");
  });

  it("weighs final-test answers more than practice quizzes", () => {
    const quiz = applyEvidence(EMPTY_MASTERY, ev());
    const exam = applyEvidence(EMPTY_MASTERY, ev({ finalTest: true }));
    expect(exam.score).toBeGreaterThan(quiz.score);
  });
});

describe("buildLessonFeedback", () => {
  const ev = (correct: boolean): ObjectiveEvidence => ({ correct, attempt: 1, hintsUsed: 0, difficulty: 2, activityType: "quiz" });

  it("tells both the learner and the grown-up what landed and what comes back", () => {
    let strong = EMPTY_MASTERY;
    for (let i = 0; i < 3; i++) strong = applyEvidence(strong, ev(true));
    let weak = EMPTY_MASTERY;
    weak = applyEvidence(weak, ev(false));
    weak = applyEvidence(weak, ev(false));
    const fb = buildLessonFeedback("Jupiter", [
      { code: "lo1", text: "Identify Jupiter as a gas giant", state: strong },
      { code: "lo2", text: "Recognize the Great Red Spot", state: weak },
      { code: "lo3", text: "Not assessed yet", state: EMPTY_MASTERY },
    ]);
    expect(fb.strong).toEqual(["Identify Jupiter as a gas giant"]);
    expect(fb.practice).toEqual(["Recognize the Great Red Spot"]);
    expect(fb.kid).toMatch(/practise "Recognize the Great Red Spot" again soon/);
    expect(fb.parent).toMatch(/come back as recall questions/);
    expect(fb.objectives.map((o) => o.status)).toEqual([strong.status, weak.status, "unknown"]);
  });

  it("is plain praise when nothing needs practice", () => {
    let strong = EMPTY_MASTERY;
    for (let i = 0; i < 3; i++) strong = applyEvidence(strong, ev(true));
    const fb = buildLessonFeedback("The Sun", [{ code: "lo1", text: "Identify the Sun as a star", state: strong }]);
    expect(fb.practice).toEqual([]);
    expect(fb.parent).toMatch(/Nothing flagged for extra practice/);
  });
});
