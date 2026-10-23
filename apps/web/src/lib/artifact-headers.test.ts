import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allowHtmlEntry,
  buildArtifactHeaders,
  buildCsp,
  parseDraftTokenFromQuery,
  signDraftToken,
  verifyDraftToken,
} from "./artifact-headers";

const ORIGIN = "http://127.0.0.1:3000";

function req(headers: Record<string, string>): Request {
  return new Request("http://127.0.0.1:3000/a/x/1/index.html", { headers });
}

describe("buildCsp", () => {
  it("names the origin explicitly and omits frame-ancestors", () => {
    const csp = buildCsp(ORIGIN);
    expect(csp).toContain(`default-src ${ORIGIN}`);
    expect(csp).toContain(`script-src ${ORIGIN} 'unsafe-inline'`);
    expect(csp).toContain(`connect-src ${ORIGIN}`);
    expect(csp).toContain("frame-src 'none'");
    expect(csp).not.toContain("frame-ancestors");
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("'self'");
  });
});

describe("buildArtifactHeaders", () => {
  it("sets the ADR-001 header set for a published file", () => {
    const h = buildArtifactHeaders(ORIGIN, {
      contentType: "application/javascript",
      contentLength: 1024,
      immutable: true,
    });
    expect(h.get("Access-Control-Allow-Origin")).toBe("*");
    expect(h.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("Referrer-Policy")).toBe("no-referrer");
    expect(h.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(h.get("Content-Type")).toBe("application/javascript");
    expect(h.get("Content-Length")).toBe("1024");
  });

  it("uses private, no-store for a draft", () => {
    const h = buildArtifactHeaders(ORIGIN, {
      contentType: "text/html; charset=utf-8",
      contentLength: 42,
      immutable: false,
    });
    expect(h.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("allowHtmlEntry", () => {
  it("allows iframe and frame destinations and absent header", () => {
    expect(allowHtmlEntry(req({ "sec-fetch-dest": "iframe" }))).toBe(true);
    expect(allowHtmlEntry(req({ "sec-fetch-dest": "frame" }))).toBe(true);
    expect(allowHtmlEntry(req({}))).toBe(true);
  });

  it("rejects top-level document, image, and script destinations", () => {
    expect(allowHtmlEntry(req({ "sec-fetch-dest": "document" }))).toBe(false);
    expect(allowHtmlEntry(req({ "sec-fetch-dest": "image" }))).toBe(false);
    expect(allowHtmlEntry(req({ "sec-fetch-dest": "script" }))).toBe(false);
  });
});

describe("draft tokens", () => {
  const originalSecret = process.env.ARTIFACT_DRAFT_SECRET;
  beforeEach(() => {
    process.env.ARTIFACT_DRAFT_SECRET = "a".repeat(64);
  });
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.ARTIFACT_DRAFT_SECRET;
    else process.env.ARTIFACT_DRAFT_SECRET = originalSecret;
  });

  it("round-trips a valid token", () => {
    const expiry = Math.floor(Date.now() / 1000) + 600;
    const t = signDraftToken("org/thing", 1, expiry, process.env.ARTIFACT_DRAFT_SECRET!);
    expect(verifyDraftToken("org/thing", 1, t)).toBe(true);
  });

  it("rejects an expired token", () => {
    const expiry = Math.floor(Date.now() / 1000) - 1;
    const t = signDraftToken("org/thing", 1, expiry, process.env.ARTIFACT_DRAFT_SECRET!);
    expect(verifyDraftToken("org/thing", 1, t)).toBe(false);
  });

  it("rejects a tampered id, version, or signature", () => {
    const expiry = Math.floor(Date.now() / 1000) + 600;
    const t = signDraftToken("org/thing", 1, expiry, process.env.ARTIFACT_DRAFT_SECRET!);
    expect(verifyDraftToken("org/other", 1, t)).toBe(false);
    expect(verifyDraftToken("org/thing", 2, t)).toBe(false);
    const flipped = t.signature.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    expect(verifyDraftToken("org/thing", 1, { ...t, signature: flipped })).toBe(false);
  });

  it("rejects a token when the secret is unset", () => {
    const expiry = Math.floor(Date.now() / 1000) + 600;
    const t = signDraftToken("org/thing", 1, expiry, process.env.ARTIFACT_DRAFT_SECRET!);
    delete process.env.ARTIFACT_DRAFT_SECRET;
    expect(verifyDraftToken("org/thing", 1, t)).toBe(false);
  });

  it("rejects a non-hex or wrong-length signature without throwing", () => {
    const expiry = Math.floor(Date.now() / 1000) + 600;
    expect(verifyDraftToken("org/thing", 1, { expiry, signature: "zzz" })).toBe(false);
    expect(verifyDraftToken("org/thing", 1, { expiry, signature: "ab".repeat(10) })).toBe(false);
  });

  it("parses tokens from query strings", () => {
    const s = new URLSearchParams();
    s.set("t", "ab".repeat(32));
    s.set("e", "123456");
    const parsed = parseDraftTokenFromQuery(s);
    expect(parsed).toEqual({ expiry: 123456, signature: "ab".repeat(32) });
    expect(parseDraftTokenFromQuery(new URLSearchParams())).toBeNull();
  });
});
