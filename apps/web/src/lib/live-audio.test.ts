import { describe, expect, it } from "vitest";
import { TutorContext } from "@eco/contracts";
import {
  EXPLAIN_SCREEN,
  base64ToBytes,
  bytesToBase64,
  downsample,
  encodeMicBlock,
  floatToPcm16,
  formatTutorContext,
  pcm16Bytes,
  pcm16ToFloat,
  rms,
  tutorSlideKey,
  addLiveUsage,
  emptyLiveUsage,
} from "./live-audio";

describe("live usage", () => {
  it("splits each report by modality and adds it up", () => {
    let total = emptyLiveUsage();
    total = addLiveUsage(total, {
      promptTokenCount: 1000,
      promptTokensDetails: [
        { modality: "AUDIO", tokenCount: 640 },
        { modality: "TEXT", tokenCount: 300 },
      ],
      responseTokenCount: 200,
      responseTokensDetails: [{ modality: "AUDIO", tokenCount: 200 }],
    });
    total = addLiveUsage(total, { promptTokenCount: 50, responseTokenCount: 10, thoughtsTokenCount: 5 });
    expect(total).toEqual({ textIn: 360 + 50, audioIn: 640, textOut: 15, audioOut: 200 });
  });

  it("ignores missing or broken reports", () => {
    const total = emptyLiveUsage();
    expect(addLiveUsage(total, undefined)).toBe(total);
    expect(addLiveUsage(total, { promptTokenCount: -5, responseTokenCount: Number.NaN })).toEqual(emptyLiveUsage());
  });
});

describe("pcm helpers", () => {
  it("downsamples 48 kHz to 16 kHz by averaging windows", () => {
    const input = Float32Array.from([0, 0.3, 0.6, 1, 1, 1, -1, -1, -1]);
    expect([...downsample(input, 48_000, 16_000)].map((v) => +v.toFixed(3))).toEqual([0.3, 1, -1]);
  });

  it("passes the same rate through and refuses to upsample", () => {
    const input = Float32Array.from([0.1, 0.2]);
    expect([...downsample(input, 16_000, 16_000)]).toEqual([...input]);
    expect(() => downsample(input, 8_000, 16_000)).toThrow();
  });

  it("clamps floats into PCM16", () => {
    expect([...floatToPcm16(Float32Array.from([-2, -1, 0, 1, 2]))]).toEqual([-32768, -32768, 0, 32767, 32767]);
  });

  it("round-trips PCM16 little-endian bytes", () => {
    const samples = Int16Array.from([0, 1, -1, 32767, -32768]);
    const bytes = pcm16Bytes(samples);
    expect([...bytes.slice(0, 6)]).toEqual([0, 0, 1, 0, 255, 255]);
    expect([...pcm16ToFloat(bytes)]).toEqual([0, 1 / 32768, -1 / 32768, 32767 / 32768, -1]);
  });

  it("drops a trailing odd byte", () => {
    expect(pcm16ToFloat(Uint8Array.from([0, 64, 7])).length).toBe(1);
  });

  it("round-trips base64, including large buffers", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(bytesToBase64(Uint8Array.from([104, 105]))).toBe("aGk=");
  });

  it("measures level", () => {
    expect(rms(new Float32Array(0))).toBe(0);
    expect(rms(Float32Array.from([0.5, -0.5]))).toBeCloseTo(0.5);
  });

  it("encodes a mic block as 16 kHz PCM16 base64", () => {
    const block = new Float32Array(4800).fill(0.25);
    const bytes = base64ToBytes(encodeMicBlock(block, 48_000));
    expect(bytes.length).toBe(1600 * 2);
    expect(new DataView(bytes.buffer).getInt16(0, true)).toBe(Math.round(0.25 * 0x7fff));
  });
});

describe("formatTutorContext", () => {
  it("describes an unanswered question without an explanation", () => {
    const c = TutorContext.parse({
      screen: "bite",
      title: "Check",
      biteType: "quiz",
      question: { prompt: "Which planet is largest?", options: ["Jupiter", "Mars"], hint: "A gas giant." },
      answered: false,
      progress: { round: 0, rounds: 3 },
    });
    const text = formatTutorContext(c);
    expect(text.startsWith("[screen] ")).toBe(true);
    expect(text).toContain("Round 1 of 3.");
    expect(text).toContain("Choices: Jupiter | Mars");
    expect(text).toContain("Do not give the answer.");
    expect(text).not.toContain("Why:");
  });

  it("includes the explanation once answered", () => {
    const text = formatTutorContext(
      TutorContext.parse({ screen: "section", question: { prompt: "2 + 2?" }, answered: true, correct: true, explanation: "Two pairs make four." }),
    );
    expect(text).toContain("They answered correctly.");
    expect(text).toContain("Why: Two pairs make four.");
  });
});

describe("tutorSlideKey", () => {
  const question = TutorContext.parse({ screen: "bite", title: "Check", biteType: "quiz", question: { prompt: "2 + 2?" }, answered: false, progress: { round: 0, rounds: 3 } });

  it("stays the same while the learner answers the slide", () => {
    const answered = TutorContext.parse({ ...question, answered: true, correct: false, explanation: "Two pairs make four." });
    expect(tutorSlideKey(answered)).toBe(tutorSlideKey(question));
  });

  it("changes with the slide", () => {
    expect(tutorSlideKey({ ...question, question: { prompt: "3 + 3?" } })).not.toBe(tutorSlideKey(question));
    expect(tutorSlideKey({ ...question, progress: { round: 1, rounds: 3 } })).not.toBe(tutorSlideKey(question));
    expect(tutorSlideKey({ screen: "bite", title: "Check" })).not.toBe(tutorSlideKey({ screen: "section", title: "Check" }));
  });

  it("asks for the walk-through on the last line", () => {
    expect(EXPLAIN_SCREEN.endsWith("Explain this screen")).toBe(true);
  });
});
