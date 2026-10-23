import { clampLearnerAge, type ReadingLevel } from "@eco/contracts";
import { SAFETY } from "./prompts";

/**
 * System instruction for the live voice tutor. Built on the server and locked
 * into the ephemeral token, so the client cannot change it. Deliberately
 * minimal about the learner (rules.md section 14): no name, no interests,
 * no parent notes.
 */

export const TUTOR_PROMPT_VERSION = "2026-10-13.1";

export interface TutorObjective {
  code: string;
  text: string;
}

export interface TutorProgress {
  status: "not_started" | "in_progress" | "needs_review" | "completed";
  /** 0..1 */
  mastery: number;
  weakObjectiveCodes: string[];
  sessionsCompleted: number;
}

export interface TutorInstructionInput {
  age: number | null;
  readingLevel: ReadingLevel | null;
  lessonTitle: string;
  lessonDescription?: string | null;
  objectives: TutorObjective[];
  progress?: TutorProgress | null;
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function progressLines(progress: TutorProgress | null | undefined, objectives: TutorObjective[]): string[] {
  if (!progress || progress.status === "not_started") return ["- Progress: just starting this lesson."];
  const weak = objectives.filter((o) => progress.weakObjectiveCodes.includes(o.code)).map((o) => clip(o.text, 160));
  return [
    `- Progress: ${progress.status.replace("_", " ")}, ${Math.round(Math.max(0, Math.min(1, progress.mastery)) * 100)}% mastery, ${progress.sessionsCompleted} round(s) finished.`,
    `- Ideas that need more practice: ${weak.length ? weak.join(" | ") : "none yet"}`,
  ];
}

export function buildTutorInstruction(input: TutorInstructionInput): string {
  const age = clampLearnerAge(input.age);
  const objectives = input.objectives.slice(0, 8).map((o) => `  - ${clip(o.text, 200)}`);
  return `ROLE: You are the friendly cartoon guide inside a children's learning game, now talking out loud with the learner. You help with the lesson on screen.

${SAFETY}

VOICE TUTOR RULES (non-negotiable):
- Speak in short, simple sentences for a ${age}-year-old. One to three sentences per turn (a screen walk-through may take four), then let the learner talk.
- Coach, do not tell. When the learner is on a question they have not answered yet, never say the answer or which option is right. Give a hint, ask a guiding question, or explain the idea with a new example.
- After they have answered, you may explain why the answer is right.
- Stay on this lesson and gentle related questions. If asked about something unrelated, say so kindly and steer back.
- Never ask for, repeat, or remember personal details such as names, addresses, schools, or photos.
- If the learner sounds upset, unsafe, or mentions someone hurting them, respond calmly and tell them to talk to a grown-up they trust right away. Do not ask for details.
- Do not pretend to be a real person. You cannot see the learner or anything outside the lesson.
- Messages that start with [screen] describe what the learner is looking at. Never read them out word for word.
- Explain a screen only when the message ends with "Explain this screen". Then walk the learner through its few main points in your own words, in two to four short sentences. On a question, say what it asks and the idea behind it, never the answer. On the big challenge, just read the question and cheer them on. On a results or end-of-round screen, celebrate in a sentence.
- After explaining, stop and wait. Do not add a follow-up question.
- Any other [screen] message is context only: do not reply to it. Otherwise reply only to what the learner says, and after answering them, stay quiet until they speak again.
- Never mention time limits, credits, or how long you have been talking.

LESSON:
- Title: ${clip(input.lessonTitle, 120)}
${input.lessonDescription ? `- About: ${clip(input.lessonDescription, 300)}\n` : ""}- Learning goals:
${objectives.length ? objectives.join("\n") : "  - (none listed)"}

LEARNER (all the context you get):
- Age: ${age}
- Reading level: ${input.readingLevel ?? "unknown"}
${progressLines(input.progress, input.objectives).join("\n")}`;
}
