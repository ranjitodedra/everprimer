import { describe, expect, it } from "vitest";
import {
  CREDITS_PER_LESSON,
  LIVE_CREDITS_PER_MINUTE,
  boundedLiveCredits,
  creditsFor,
  creditsForCharacter,
  creditsForCutouts,
  creditsForLive,
} from "./pricing";

const call = (modelId: string, inputTokens: number, outputTokens: number) => ({ provider: "google" as const, modelId, inputTokens, outputTokens });

describe("creditsFor", () => {
  it("prices a typical lesson job near the per-lesson budget once its pictures are added", () => {
    const lesson = creditsFor([call("gemini-3.8-flash", 30_000, 35_000)]) + creditsForCharacter();
    expect(lesson).toBeGreaterThan(CREDITS_PER_LESSON * 0.7);
    expect(lesson).toBeLessThan(CREDITS_PER_LESSON * 1.3);
  });

  it("charges an outline a few credits", () => {
    const outline = creditsFor([call("gemini-3.8-flash", 700, 1700)]);
    expect(outline).toBeGreaterThanOrEqual(1);
    expect(outline).toBeLessThan(10);
  });

  it("bills unknown models at the default rate and the mock for free", () => {
    expect(creditsFor([call("some-new-model", 30_000, 35_000)])).toBe(creditsFor([call("gemini-3.8-flash", 30_000, 35_000)]));
    expect(creditsFor([{ provider: "mock", modelId: "mock", inputTokens: 1e6, outputTokens: 1e6 }])).toBe(0);
    expect(creditsFor([])).toBe(0);
  });

  it("rounds up and ignores negative counts", () => {
    expect(creditsFor([call("gemini-3.8-flash", 1, 0)])).toBe(1);
    expect(creditsFor([call("gemini-3.8-flash", -500, -500)])).toBe(0);
  });
});

describe("pictures", () => {
  it("charges a character and its cutouts", () => {
    expect(creditsForCharacter()).toBeGreaterThan(creditsForCutouts(2));
    expect(creditsForCutouts(0)).toBe(0);
    expect(creditsForCutouts(2)).toBeGreaterThan(0);
  });
});

describe("live tutor", () => {
  const minute = { textIn: 2_000, audioIn: 1_920, textOut: 300, audioOut: 900 };

  it("prices audio higher than text", () => {
    expect(creditsForLive({ textIn: 0, audioIn: 0, textOut: 0, audioOut: 100_000 })).toBeGreaterThan(
      creditsForLive({ textIn: 0, audioIn: 0, textOut: 100_000, audioOut: 0 }),
    );
  });

  it("never charges less than the microphone stream for the time spent", () => {
    const none = { textIn: 0, audioIn: 0, textOut: 0, audioOut: 0 };
    expect(boundedLiveCredits(none, 600)).toBe(10 * LIVE_CREDITS_PER_MINUTE.min);
    expect(boundedLiveCredits(none, 0)).toBe(0);
  });

  it("never charges more than the per-minute ceiling", () => {
    const huge = { textIn: 1e9, audioIn: 1e9, textOut: 1e9, audioOut: 1e9 };
    expect(boundedLiveCredits(huge, 120)).toBe(2 * LIVE_CREDITS_PER_MINUTE.max);
  });

  it("uses the reported cost between the bounds", () => {
    const reported = creditsForLive(minute);
    expect(boundedLiveCredits(minute, 60)).toBe(Math.min(LIVE_CREDITS_PER_MINUTE.max, Math.max(LIVE_CREDITS_PER_MINUTE.min, reported)));
  });
});
