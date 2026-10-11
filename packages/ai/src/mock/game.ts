import {
  LESSON_LIMITS,
  ageBandFor,
  type Bite,
  type BiteType,
  type GameBlueprint,
  type LearnerContext,
  type Question,
} from "@eco/contracts";
import { defaultBiteKinds } from "../planDefaults";

const PALETTES = [
  { primary: "#4f46e5", accent: "#f59e0b", background: "#fafaf9", mood: "bright and curious", emoji: "✨" },
  { primary: "#0f766e", accent: "#f97316", background: "#f0fdfa", mood: "fresh and green", emoji: "🌱" },
  { primary: "#be185d", accent: "#eab308", background: "#fdf2f8", mood: "playful", emoji: "🎈" },
  { primary: "#1d4ed8", accent: "#22c55e", background: "#eff6ff", mood: "clear sky", emoji: "🧭" },
];

const ROUND_TITLES = ["Look close", "Try it out", "Hold onto it", "Use it", "Big finish"];
const ROUND_OPENERS = [
  "Come look at this with me.",
  "Want to try this yourself?",
  "Let's lock this in.",
  "Ready to use what you know?",
  "One more round, then the big challenge.",
];
const ROUND_EMOJI = ["🌟", "🔍", "🎯", "🚀", "🏆"];

export interface MockSeed {
  facts: Array<{ id: string; text: string }>;
  theme?: GameBlueprint["theme"];
  personalization?: string;
  items?: Array<{ id: string; label: string; description: string; emoji?: string }>;
}

function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function makeQuestion(id: string, prompt: string, obj: string, factId: string, correct: string, distractors: string[]): Question {
  return {
    kind: "mcq",
    id,
    prompt,
    difficulty: 1,
    objectiveCodes: [obj],
    factIds: [factId],
    options: [{ id: "a", text: correct }, { id: "b", text: distractors[0] ?? "Something else" }, { id: "c", text: distractors[1] ?? "A different idea" }],
    correctOptionId: "a",
    explanation: clip(`Yes — ${correct}. That matches what you just saw.`, 80),
  };
}

function makeTf(id: string, prompt: string, answer: boolean, obj: string, factId: string): Question {
  return {
    kind: "true_false",
    id,
    prompt,
    answer,
    difficulty: 1,
    objectiveCodes: [obj],
    factIds: [factId],
    explanation: clip(answer ? `True. ${prompt.replace(/\.$/, ".")}` : `False. Check the fact you just learned.`, 80),
  };
}

function biteFor(
  type: BiteType,
  id: string,
  qid: string,
  obj: string,
  title: string,
  facts: Array<{ id: string; text: string }>,
  items: Array<{ id: string; label: string; description: string; emoji?: string }>,
): Bite {
  const factIds = facts.slice(0, 2).map((f) => f.id);
  const fact = facts[0]!;
  const second = facts[1] ?? facts[0]!;
  if (type === "explore") {
    return {
      type, id, title, stage: "discover", objectiveCodes: [obj], factIds,
      lead: "Tap each card and see what you notice.",
      prompt: "Tap a card",
      visual: {
        kind: "parts",
        purpose: "show_the_main_parts",
        caption: "Tap to look closer",
        items: items.slice(0, 4),
      },
    };
  }
  if (type === "explain") {
    return {
      type, id, title, stage: "understand", objectiveCodes: [obj], factIds,
      paragraphs: [clip(fact.text, 45)],
    };
  }
  if (type === "simple_explain") {
    return {
      type, id, title, stage: "understand", objectiveCodes: [obj], factIds,
      simple: clip(fact.text, 45),
      term: clip(title, 40),
      definition: clip(second.text, 45),
    };
  }
  if (type === "key_points") {
    const points = facts.slice(0, 3).map((f) => clip(f.text, 40));
    if (points.length < 2) points.push("You can use this idea again.");
    return {
      type, id, title, stage: "understand", objectiveCodes: [obj], factIds,
      lead: "Keep these in your pocket.",
      points,
    };
  }
  if (type === "mnemonic") {
    const lines = items.slice(0, 4).map((it) => ({ cue: clip(it.label, 8), text: clip(it.description, 40) }));
    if (lines.length < 2) lines.push({ cue: "Two", text: "A second hook." });
    return {
      type, id, title, stage: "understand", objectiveCodes: [obj], factIds,
      phrase: "Try this phrase",
      lines,
    };
  }
  if (type === "analogy") {
    return {
      type, id, title, stage: "understand", objectiveCodes: [obj], factIds,
      interest: "everyday life",
      familiar: "You already know how a team has a captain.",
      bridge: clip(`This idea works a bit like that: ${fact.text}`, 80),
      limit: "The comparison stops when the facts differ.",
    };
  }
  if (type === "apply") {
    return {
      type, id, title, stage: "apply", objectiveCodes: [obj], factIds,
      scenario: "A friend asks you about this. Use what you just learned.",
      questions: [makeTf(qid, clip(fact.text.replace(/\.$/, "?"), 80), true, obj, fact.id)],
    };
  }
  return {
    type: "quiz", id, title, stage: "practice",
    questions: [makeQuestion(qid, clip("Which is true: " + fact.text, 80), obj, fact.id, clip(fact.text, 60), ["A random date from history", "How to juggle three balls"])],
  };
}

function rotateKinds(kinds: BiteType[], n: number): BiteType[] {
  if (kinds.length === 0) return kinds;
  const i = ((n % kinds.length) + kinds.length) % kinds.length;
  return [...kinds.slice(i), ...kinds.slice(0, i)];
}

export function buildGameBlueprint(input: {
  topic: { slug: string; title: string; description: string; objectives: string[] };
  learner: LearnerContext;
  seed?: MockSeed;
}): GameBlueprint {
  const { topic, learner } = input;
  const objectives = topic.objectives.slice(0, 6).map((text, i) => ({ code: `lo${i + 1}` as const, text }));
  const codes = objectives.map((o) => o.code);
  const band = ageBandFor(learner.age);
  const limits = LESSON_LIMITS[band];
  const kinds = rotateKinds(defaultBiteKinds(band), Math.abs(hash(topic.slug)));
  const palette = input.seed?.theme ?? PALETTES[Math.abs(hash(topic.slug)) % PALETTES.length]!;
  const facts = input.seed?.facts ?? [
    { id: "f1", text: clip(`${topic.title} is the idea you are exploring now.`, 80) },
    ...objectives.map((o, i) => ({ id: `f${i + 2}`, text: clip(`You can ${o.text.charAt(0).toLowerCase()}${o.text.slice(1)}.`, 80) })),
  ];
  const items = [...(input.seed?.items ?? objectives.map((o, i) => ({
    id: o.code,
    label: `Idea ${i + 1}`,
    description: clip(o.text, 80),
    emoji: ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"][i],
  })))];
  if (items.length < 2) {
    items.push({ id: "extra", label: "Also", description: clip(topic.description || topic.title, 80), emoji: "✨" });
  }

  const sessions = Array.from({ length: limits.sessions }, (_, n) => {
    const obj = codes[n % codes.length]!;
    return {
      id: `sess_${n + 1}`,
      title: ROUND_TITLES[n] ?? `Round ${n + 1}`,
      emoji: ROUND_EMOJI[n] ?? "✨",
      opener: ROUND_OPENERS[n] ?? "Come try this with me.",
      objectiveCodes: codes,
      bites: kinds.map((type, i) =>
        biteFor(type, `s_${n + 1}_${i}`, `q_${n + 1}_${i}`, obj, ROUND_TITLES[n] ?? "Look", facts, items),
      ),
    };
  });

  const finalQuestions: Question[] = Array.from({ length: limits.finalTestQuestions }, (_, i) => {
    const obj = codes[i % codes.length]!;
    const fact = facts[i % facts.length]!;
    if (i % 2 === 0) {
      return makeQuestion(`q_f_${i}`, clip("Which is true: " + fact.text, 80), obj, fact.id, clip(fact.text, 60), ["A random date from history", "How to juggle three balls"]);
    }
    return makeTf(`q_f_${i}`, clip(`${fact.text.replace(/\.$/, "")}?`, 80), true, obj, fact.id);
  });

  return {
    schemaVersion: 3,
    topicSlug: topic.slug,
    title: topic.title.slice(0, 80),
    audience: { age: learner.age, readingLevel: learner.readingLevel },
    theme: palette,
    learningObjectives: objectives,
    stages: ["discover", "understand", "practice"],
    personalization: input.seed?.personalization ?? (learner.interests.length
      ? `Demo content: interests (${learner.interests.join(", ")}) would shape analogies when a model is configured.`
      : "Demo content generated without a model."),
    facts,
    sessions,
    finalTest: {
      intro: "Big challenge time. Show me what you know.",
      questions: finalQuestions,
    },
  };
}
