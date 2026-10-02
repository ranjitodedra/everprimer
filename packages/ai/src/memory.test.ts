import { describe, expect, it } from "vitest";
import { ageFromBirth, cardsForPrompt, isForbiddenMemory, type PromptMemoryCard } from "@eco/contracts";
import { learnerBlock } from "./prompts";

const today = new Date(Date.UTC(2026, 8, 27));

function card(partial: Partial<PromptMemoryCard> & Pick<PromptMemoryCard, "kind" | "value">): PromptMemoryCard {
  return {
    source: "inferred",
    confidence: 0.5,
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    active: true,
    ...partial,
  };
}

describe("ageFromBirth", () => {
  it("counts completed years, with the birthday on the first of the month", () => {
    expect(ageFromBirth(2018, 9, today)).toBe(8);
    expect(ageFromBirth(2018, 10, today)).toBe(7);
    expect(ageFromBirth(2018, 1, today)).toBe(8);
  });
});

describe("isForbiddenMemory", () => {
  it("drops health, family, address, school, religion, friends, and emotions", () => {
    expect(isForbiddenMemory("has asthma")).toBe(true);
    expect(isForbiddenMemory("mom likes space")).toBe(true);
    expect(isForbiddenMemory("lives at 12 Oak Street")).toBe(true);
    expect(isForbiddenMemory("goes to Lincoln school")).toBe(true);
    expect(isForbiddenMemory("learns about church")).toBe(true);
    expect(isForbiddenMemory("best friend helped")).toBe(true);
    expect(isForbiddenMemory("felt sad about fractions")).toBe(true);
  });

  it("keeps learning facts", () => {
    expect(isForbiddenMemory("loves dinosaurs")).toBe(false);
    expect(isForbiddenMemory("thinks the moon makes its own light")).toBe(false);
    expect(isForbiddenMemory("a pizza cut into fractions")).toBe(false);
  });
});

describe("cardsForPrompt", () => {
  it("keeps parent cards on the free tier and drops inferred ones", () => {
    const fields = cardsForPrompt(
      [
        { kind: "interest", value: "dinosaurs", active: true },
        { kind: "note", value: "short sentences", active: true },
      ],
      [
        card({ kind: "interest", value: "drawing", source: "parent", confidence: 1 }),
        card({ kind: "interest", value: "rockets", confidence: 0.9 }),
        card({ kind: "misconception", value: "the moon makes its own light", confidence: 0.8 }),
      ],
      "free",
    );
    expect(fields.interests).toEqual(["dinosaurs", "drawing"]);
    expect(fields.notes).toEqual(["short sentences"]);
    expect(fields.misconceptions).toEqual([]);
  });

  it("caps the prompt and prefers parent interests, then confident recent cards", () => {
    const inferred = Array.from({ length: 12 }, (_, i) =>
      card({
        kind: "interest",
        value: `topic ${i}`,
        confidence: i / 12,
        lastSeenAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    const fields = cardsForPrompt(
      [{ kind: "interest", value: "dinosaurs", active: true }],
      [
        ...inferred,
        card({ kind: "misconception", value: "older wrong idea", confidence: 0.2, lastSeenAt: "2024-01-01T00:00:00.000Z" }),
        card({ kind: "misconception", value: "newer wrong idea", confidence: 0.2, lastSeenAt: "2026-06-01T00:00:00.000Z" }),
        ...Array.from({ length: 8 }, (_, i) => card({ kind: "misconception", value: `extra ${i}`, confidence: 0.9 - i / 100 })),
      ],
      "paid",
    );
    expect(fields.interests).toHaveLength(10);
    expect(fields.interests[0]).toBe("dinosaurs");
    expect(fields.interests).toContain("topic 11");
    expect(fields.interests).not.toContain("topic 0");
    expect(fields.misconceptions).toHaveLength(8);
    expect(fields.misconceptions[0]).toBe("extra 0");
  });
});

describe("learnerBlock", () => {
  it("tells the model that interests and analogies are framing, and misconceptions need practice", () => {
    const text = learnerBlock({
      displayName: "Ava",
      age: 8,
      readingLevel: "developing",
      interests: ["dinosaurs"],
      notes: ["short sentences"],
      strengths: ["can order the planets"],
      misconceptions: ["the moon makes its own light"],
      analogies: ["a pizza cut into slices"],
    });
    expect(text).toContain("Interests (framing only");
    expect(text).toContain("Analogies that worked (framing only)");
    expect(text).toContain("more practice");
    expect(text).toContain("dinosaurs");
    expect(text).toContain("the moon makes its own light");
    expect(text).toContain("a pizza cut into slices");
  });
});
