import { describe, expect, it } from "vitest";
import {
  ArtifactInteractionPayload,
  EventBatch,
  HostInitMessage,
  HostTutorArtMessage,
  HostTutorStateMessage,
  LEARNKIT_PROTOCOL_VERSION,
  LearnKitMessage,
} from "./events";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("tutor protocol", () => {
  it("accepts a context message from the artifact", () => {
    const parsed = LearnKitMessage.safeParse({
      source: "learnkit",
      v: LEARNKIT_PROTOCOL_VERSION,
      kind: "context",
      nonce: "n1",
      context: { screen: "bite", title: "Orbits", question: { prompt: "What pulls the Moon?", options: ["Gravity", "Wind"] }, answered: false },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a context message with an unknown screen", () => {
    const parsed = LearnKitMessage.safeParse({ source: "learnkit", v: 1, kind: "context", nonce: "n1", context: { screen: "elsewhere" } });
    expect(parsed.success).toBe(false);
  });

  it("only accepts inline raster images for the character", () => {
    const base = { source: "learnkit-host", v: 1, kind: "tutor_art" } as const;
    expect(HostTutorArtMessage.safeParse({ ...base, talk: PNG, teach: PNG }).success).toBe(true);
    expect(HostTutorArtMessage.safeParse({ ...base, talk: "https://example.com/a.png", teach: PNG }).success).toBe(false);
    expect(HostTutorArtMessage.safeParse({ ...base, talk: "data:image/svg+xml;base64,PHN2Zz4=", teach: PNG }).success).toBe(false);
    expect(HostTutorArtMessage.safeParse({ ...base, talk: 'data:image/png;base64,AA"onload=x', teach: PNG }).success).toBe(false);
  });

  it("treats character art as not cut out unless the host says so", () => {
    const base = { source: "learnkit-host", v: 1, kind: "tutor_art", talk: PNG, teach: PNG } as const;
    expect(HostTutorArtMessage.parse(base).cutout).toBe(false);
    expect(HostTutorArtMessage.parse({ ...base, cutout: true }).cutout).toBe(true);
    expect(HostTutorArtMessage.safeParse({ ...base, cutout: "yes" }).success).toBe(false);
  });

  it("limits voice states to the four the player knows", () => {
    const base = { source: "learnkit-host", v: 1, kind: "tutor_state" } as const;
    for (const state of ["idle", "listening", "thinking", "speaking"]) {
      expect(HostTutorStateMessage.safeParse({ ...base, state }).success).toBe(true);
    }
    expect(HostTutorStateMessage.safeParse({ ...base, state: "shouting" }).success).toBe(false);
  });
});

describe("artifact interaction events", () => {
  const event = {
    clientEventId: "5e73debd-b7e8-4d95-8707-1c953b682390",
    type: "artifact_interaction",
    occurredAt: "2026-10-21T16:01:16.430Z",
    sectionId: "s_0_0",
    payload: { libraryArtifactId: "solar-system-simulator", version: 3, name: "planet_selected", data: { planet: "earth" } },
  };

  it("ride in a normal v1 event batch", () => {
    const parsed = EventBatch.safeParse({ sessionId: "6c0f4a52-2b8e-4a7a-9d0e-0b7b7b9f3c11", events: [event] });
    expect(parsed.success).toBe(true);
    expect(LearnKitMessage.safeParse({ source: "learnkit", v: 1, kind: "event", nonce: "n1", event }).success).toBe(true);
  });

  it("have a validated payload", () => {
    expect(ArtifactInteractionPayload.safeParse(event.payload).success).toBe(true);
    expect(ArtifactInteractionPayload.safeParse({ ...event.payload, name: "Planet Selected" }).success).toBe(false);
    expect(ArtifactInteractionPayload.safeParse({ ...event.payload, data: { planet: { nested: true } } }).success).toBe(false);
  });
});

describe("LearnKit protocol version", () => {
  it("stays at 1, and v2 messages are still rejected", () => {
    expect(LEARNKIT_PROTOCOL_VERSION).toBe(1);
    expect(LearnKitMessage.safeParse({ source: "learnkit", v: 1, kind: "ready" }).success).toBe(true);
    expect(LearnKitMessage.safeParse({ source: "learnkit", v: 2, kind: "ready" }).success).toBe(false);
    const init = { source: "learnkit-host", kind: "init", nonce: "n", topicId: "t", artifactId: "a", reducedMotion: false };
    expect(HostInitMessage.safeParse({ ...init, v: 1 }).success).toBe(true);
    expect(HostInitMessage.safeParse({ ...init, v: 2 }).success).toBe(false);
  });
});
