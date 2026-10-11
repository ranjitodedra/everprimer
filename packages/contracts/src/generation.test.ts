import { describe, expect, it } from "vitest";
import { ARTIFACT_STAGES, ArtifactStage, CURRICULUM_STAGES, CurriculumStage, estimateProgress, stageMeta } from "./generation";

const T0 = Date.parse("2026-10-05T12:00:00Z");
const at = (sec: number) => T0 + sec * 1000;

describe("estimateProgress", () => {
  it("rises within a step and never reaches the next one", () => {
    const early = estimateProgress("artifact", "writing", T0, at(5));
    const late = estimateProgress("artifact", "writing", T0, at(60));
    const forever = estimateProgress("artifact", "writing", T0, at(3600));
    expect(early).toBeGreaterThan(ARTIFACT_STAGES.writing.from);
    expect(late).toBeGreaterThan(early);
    expect(forever).toBeLessThan(ARTIFACT_STAGES.writing.to);
  });

  it("scores every later step above any time spent on an earlier one", () => {
    for (const [kind, stages] of [
      ["artifact", [null, ...ArtifactStage.options]],
      ["curriculum", [null, ...CurriculumStage.options]],
    ] as const) {
      for (let i = 1; i < stages.length; i++) {
        const stuck = estimateProgress(kind, stages[i - 1], T0, at(3600));
        const fresh = estimateProgress(kind, stages[i], T0, T0);
        expect(fresh).toBeGreaterThan(stuck);
      }
    }
  });

  it("stays at the start of the step when the server clock is ahead", () => {
    expect(estimateProgress("curriculum", "outlining", at(30), T0)).toBe(CURRICULUM_STAGES.outlining.from);
  });

  it("reads a missing or unknown stage as queued", () => {
    expect(stageMeta("artifact", null)).toBe(ARTIFACT_STAGES.queued);
    expect(stageMeta("curriculum", "dreaming")).toBe(CURRICULUM_STAGES.queued);
    expect(estimateProgress("artifact", null, null, T0)).toBe(0);
  });

  it("keeps bands contiguous and inside 0..1", () => {
    for (const table of [ARTIFACT_STAGES, CURRICULUM_STAGES]) {
      const bands = Object.values(table);
      expect(bands[0]!.from).toBe(0);
      for (let i = 1; i < bands.length; i++) expect(bands[i]!.from).toBe(bands[i - 1]!.to);
      expect(bands.at(-1)!.to).toBeLessThan(1);
    }
  });
});
