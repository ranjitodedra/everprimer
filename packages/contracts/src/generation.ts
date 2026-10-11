import { z } from "zod";

/**
 * Steps a generation job reports while it runs. A null stage means the job
 * has not been picked up yet and reads as "queued". Each step owns a band of
 * the progress bar; within a step the bar eases toward the top of its band
 * over roughly `expectedSec`, so a long model call never looks frozen.
 */

export const CurriculumStage = z.enum(["outlining", "saving"]);
export type CurriculumStage = z.infer<typeof CurriculumStage>;

export const ArtifactStage = z.enum(["planning", "writing", "checking", "building"]);
export type ArtifactStage = z.infer<typeof ArtifactStage>;

export type GenerationKind = "curriculum" | "artifact";

export interface StageMeta {
  label: string;
  /** Share of the bar this step covers, 0..1. */
  from: number;
  to: number;
  expectedSec: number;
}

export const CURRICULUM_STAGES: Record<"queued" | CurriculumStage, StageMeta> = {
  queued: { label: "Getting started…", from: 0, to: 0.08, expectedSec: 4 },
  outlining: { label: "Mapping out your lessons…", from: 0.08, to: 0.85, expectedSec: 25 },
  saving: { label: "Putting your path together…", from: 0.85, to: 0.98, expectedSec: 3 },
};

export const ARTIFACT_STAGES: Record<"queued" | ArtifactStage, StageMeta> = {
  queued: { label: "Getting started…", from: 0, to: 0.05, expectedSec: 4 },
  planning: { label: "Picking the best way to explain this…", from: 0.05, to: 0.22, expectedSec: 15 },
  writing: { label: "Writing the lesson and questions…", from: 0.22, to: 0.7, expectedSec: 50 },
  checking: { label: "Checking every fact twice…", from: 0.7, to: 0.88, expectedSec: 20 },
  building: { label: "Building your lesson…", from: 0.88, to: 0.98, expectedSec: 8 },
};

/** The bar never fills a band completely; the next step does that. */
const BAND_CAP = 0.95;

export function stageMeta(kind: GenerationKind, stage: string | null | undefined): StageMeta {
  const table: Record<string, StageMeta | undefined> = kind === "curriculum" ? CURRICULUM_STAGES : ARTIFACT_STAGES;
  return (stage ? table[stage] : undefined) ?? (kind === "curriculum" ? CURRICULUM_STAGES.queued : ARTIFACT_STAGES.queued);
}

/**
 * Estimated completion, 0..1, for a job on `stage` since `stageAt`. Clock
 * skew between server and browser is clamped so the bar never starts ahead.
 */
export function estimateProgress(kind: GenerationKind, stage: string | null | undefined, stageAt: string | number | Date | null | undefined, now: number = Date.now()): number {
  const meta = stageMeta(kind, stage);
  const started = stageAt == null ? now : new Date(stageAt).getTime();
  const elapsedSec = Number.isFinite(started) ? Math.max(0, (now - started) / 1000) : 0;
  const eased = 1 - Math.exp(-elapsedSec / meta.expectedSec);
  return meta.from + (meta.to - meta.from) * Math.min(eased, BAND_CAP);
}
