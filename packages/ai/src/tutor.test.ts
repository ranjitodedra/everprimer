import { describe, expect, it } from "vitest";
import { buildTutorInstruction } from "./tutor";

const base = {
  age: 8,
  readingLevel: "developing" as const,
  lessonTitle: "Why the Moon changes shape",
  objectives: [
    { code: "lo1", text: "Explain that the Moon reflects sunlight" },
    { code: "lo2", text: "Name the main Moon phases" },
  ],
};

describe("buildTutorInstruction", () => {
  it("includes the lesson, goals, age and the safety rules", () => {
    const text = buildTutorInstruction(base);
    expect(text).toContain("Why the Moon changes shape");
    expect(text).toContain("Explain that the Moon reflects sunlight");
    expect(text).toContain("8-year-old");
    expect(text).toMatch(/SAFETY AND VOICE/);
    expect(text).toMatch(/never say the answer/);
    expect(text).toMatch(/grown-up they trust/);
    expect(text).toMatch(/\[screen\]/);
    expect(text).not.toMatch(/at most \d+ minutes/);
    expect(text).toMatch(/Never mention time limits, credits/);
  });

  it("explains a screen only when asked, then waits for the learner", () => {
    const text = buildTutorInstruction(base);
    expect(text).toContain('ends with "Explain this screen"');
    expect(text).toMatch(/never read them out word for word/i);
    expect(text).toMatch(/stop and wait/);
    expect(text).toMatch(/reply only to what the learner says/);
    expect(text).not.toMatch(/do not reply to them on their own/);
  });

  it("names weak objectives from progress", () => {
    const text = buildTutorInstruction({
      ...base,
      progress: { status: "in_progress", mastery: 0.42, weakObjectiveCodes: ["lo2"], sessionsCompleted: 1 },
    });
    expect(text).toContain("42% mastery");
    expect(text).toMatch(/more practice: Name the main Moon phases/);
  });

  it("clamps an unknown age and never mentions a name", () => {
    const text = buildTutorInstruction({ ...base, age: null });
    expect(text).toContain("10-year-old");
    expect(text).not.toMatch(/Name:/);
  });

  it("trims very long lesson text", () => {
    const text = buildTutorInstruction({ ...base, lessonTitle: "x".repeat(500) });
    expect(text).not.toContain("x".repeat(200));
  });
});
