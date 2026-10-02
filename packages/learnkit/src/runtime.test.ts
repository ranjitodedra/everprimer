import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LEARNKIT_RUNTIME_SOURCE } from "./runtime";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function loadRuntime(crypto: object | undefined): { uuid: () => string } {
  const win: Record<string, unknown> = {
    crypto,
    matchMedia: () => ({ matches: false }),
    addEventListener: () => {},
    parent: { postMessage: () => {} },
  };
  const doc = { readyState: "loading", addEventListener: () => {} };
  new Function("window", "document", LEARNKIT_RUNTIME_SOURCE)(win, doc);
  return win.LearnKit as { uuid: () => string };
}

describe("runtime uuid", () => {
  it("uses getRandomValues when randomUUID is missing (insecure http)", () => {
    const lk = loadRuntime({ getRandomValues: (b: Uint8Array) => webcrypto.getRandomValues(b) });
    const ids = new Set(Array.from({ length: 50 }, () => lk.uuid()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(V4);
  });

  it("still returns a v4 uuid with no crypto at all", () => {
    expect(loadRuntime(undefined).uuid()).toMatch(V4);
  });
});
