import type { ArtifactBlueprint, GeneratedCurriculum, LearnerContext } from "@eco/contracts";
import { buildGameBlueprint } from "./game";
import { SOLAR_SYSTEM_CURRICULUM, SOLAR_SYSTEM_SEEDS } from "./solarSystem";

export { buildGameBlueprint, type MockSeed } from "./game";
export { SOLAR_SYSTEM_BLUEPRINTS, SOLAR_SYSTEM_CURRICULUM, SOLAR_SYSTEM_SEEDS } from "./solarSystem";

/**
 * Deterministic generators used when no model is configured. Solar-system
 * goals get hand-checked content; anything else gets a structurally complete
 * placeholder lesson that is clearly labelled as demo content.
 */

function subjectFromGoal(goal: string): string {
  const cleaned = goal
    .replace(/^i\s+(want|would like|'d like)\s+(my\s+\w+\s+)?to\s+(learn|understand|know)\s+(about\s+)?/i, "")
    .replace(/^(teach|help)\s+(my\s+\w+\s+)?(learn|understand|about)\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
  const s = cleaned.length > 0 ? cleaned : goal.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "topic";
}

export function mockCurriculum(goal: string, _learner: LearnerContext): GeneratedCurriculum {
  if (/solar system|planets/i.test(goal)) return SOLAR_SYSTEM_CURRICULUM;
  const subject = subjectFromGoal(goal);
  const base = slugify(subject);
  const t = (suffix: string, title: string, description: string, difficulty: number, prereq: string[], objectives: string[]) => ({
    slug: `${base}-${suffix}`,
    title,
    description,
    difficulty,
    prerequisites: prereq.map((p) => `${base}-${p}`),
    learningObjectives: objectives,
  });
  return {
    title: subject,
    description: `An introduction to ${subject.toLowerCase()}: the big idea, the key parts, how it works, and how it shows up in everyday life.`,
    topics: [
      t("intro", `What is ${subject}?`, `The big picture and why it matters.`, 1, [], [`Describe ${subject.toLowerCase()} in one sentence`, `Identify one place ${subject.toLowerCase()} shows up in everyday life`, `Recognize two key words about ${subject.toLowerCase()}`]),
      t("parts", `The parts of ${subject}`, `The main pieces and what each one does.`, 2, ["intro"], [`Name the main parts of ${subject.toLowerCase()}`, `Describe what each part does`, `Explain how the parts fit together`]),
      t("how-it-works", `How ${subject} works`, `Step by step, cause and effect.`, 2, ["parts"], [`Order the steps in how ${subject.toLowerCase()} works`, `Explain what happens if one step is missing`, `Predict the result of a change`]),
      t("everyday", `${subject} around us`, `Spotting it in daily life and using the idea.`, 2, ["how-it-works"], [`Identify examples of ${subject.toLowerCase()} in daily life`, `Apply the idea to a new situation`]),
      t("review", `${subject} review`, `Bring it all together.`, 2, ["everyday"], [`Summarize the big ideas of ${subject.toLowerCase()}`, `Explain ${subject.toLowerCase()} in your own words`]),
    ],
  };
}

export function mockBlueprint(input: {
  topic: { slug: string; title: string; description: string; objectives: string[] };
  learner: LearnerContext;
}): ArtifactBlueprint {
  return buildGameBlueprint({ ...input, seed: SOLAR_SYSTEM_SEEDS[input.topic.slug] });
}

export function mockFactcheck(): { ok: true; issues: [] } {
  return { ok: true, issues: [] };
}

export function mockReport(childName: string, stats: Record<string, unknown>): string {
  const s = stats as {
    topicsOpened?: string[];
    topicsCompleted?: string[];
    needsReview?: string[];
    questionsAnswered?: number;
    questionsCorrect?: number;
    minutesActive?: number;
  };
  if (!s.topicsOpened?.length) {
    return `${childName} did not open any lessons today. Observed: no learning activity recorded. Suggestion: pick one short topic together tomorrow and let ${childName} start it independently.`;
  }
  const acc =
    s.questionsAnswered && s.questionsAnswered > 0
      ? `${childName} answered ${s.questionsCorrect ?? 0} of ${s.questionsAnswered} questions correctly.`
      : `No questions were answered yet.`;
  const completed = s.topicsCompleted?.length ? `Completed: ${s.topicsCompleted.join(", ")}.` : `No topics were fully completed.`;
  const review = s.needsReview?.length ? `Needs review: ${s.needsReview.join(", ")}.` : "";
  return `Observed today: ${childName} opened ${s.topicsOpened.length} topic${s.topicsOpened.length === 1 ? "" : "s"} (${s.topicsOpened.join(", ")}) and was active for about ${s.minutesActive ?? 0} minutes. ${completed} ${acc} ${review} Recommendation: ${
    s.needsReview?.length ? `spend five minutes revisiting ${s.needsReview[0]} before moving on.` : `continue with the next topic in the sequence.`
  }`.replace(/\s+/g, " ").trim();
}
