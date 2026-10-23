import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getArtifactHost, getArtifactOrigin, isArtifactHost, isArtifactRoutePath } from "./artifact-host";

function headers(host: string | null): { headers: Pick<Headers, "get"> } {
  return { headers: new Headers(host ? { host } : {}) };
}

describe("artifact host", () => {
  const original = process.env.ARTIFACT_ORIGIN;
  beforeEach(() => {
    process.env.ARTIFACT_ORIGIN = "http://127.0.0.1:3000";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.ARTIFACT_ORIGIN;
    else process.env.ARTIFACT_ORIGIN = original;
  });

  it("parses the origin and host from ARTIFACT_ORIGIN", () => {
    expect(getArtifactOrigin()).toBe("http://127.0.0.1:3000");
    expect(getArtifactHost()).toBe("127.0.0.1:3000");
  });

  it("isArtifactHost matches the configured host case-insensitively", () => {
    expect(isArtifactHost(headers("127.0.0.1:3000"))).toBe(true);
    expect(isArtifactHost(headers("127.0.0.1:3000".toUpperCase()))).toBe(true);
    expect(isArtifactHost(headers("localhost:3000"))).toBe(false);
    expect(isArtifactHost(headers("everprimer.app"))).toBe(false);
    expect(isArtifactHost(headers(null))).toBe(false);
  });

  it("is disabled when ARTIFACT_ORIGIN is unset", () => {
    delete process.env.ARTIFACT_ORIGIN;
    expect(getArtifactOrigin()).toBeNull();
    expect(getArtifactHost()).toBeNull();
    expect(isArtifactHost(headers("anything"))).toBe(false);
  });

  it("returns null for a malformed ARTIFACT_ORIGIN rather than throwing", () => {
    process.env.ARTIFACT_ORIGIN = "not-a-url";
    expect(getArtifactOrigin()).toBeNull();
    expect(isArtifactHost(headers("not-a-url"))).toBe(false);
  });

  it("isArtifactRoutePath matches only /a and its descendants", () => {
    expect(isArtifactRoutePath("/a")).toBe(true);
    expect(isArtifactRoutePath("/a/x/1/index.html")).toBe(true);
    expect(isArtifactRoutePath("/api/events")).toBe(false);
    expect(isArtifactRoutePath("/apple")).toBe(false);
    expect(isArtifactRoutePath("/parent")).toBe(false);
  });
});
