import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests exercise the full handler, mocking only the service client. The library
 * catalog uses the mock through its SupabaseClient-shaped API, and the storage
 * download returns a Blob built from a plain string.
 */

const downloadMock = vi.fn();
const fromMock = vi.fn(() => ({
  select: () => ({
    eq: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: VERSION_ROW, error: null }),
      }),
      maybeSingle: async () => ({ data: ARTIFACT_ROW, error: null }),
    }),
  }),
}));

const service = {
  from: fromMock,
  storage: { from: () => ({ download: downloadMock }) },
};

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => service,
}));

const ARTIFACT_ROW = {
  id: "solar-system",
  title: "Solar system",
  owner: "team",
  current_version: 1,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

const PUBLISHED_FILES = [
  { path: "index.html", size: 10, sha256: "a".repeat(64), mime: "text/html; charset=utf-8" },
  { path: "app.js", size: 10, sha256: "b".repeat(64), mime: "application/javascript" },
];

const VERSION_ROW: Record<string, unknown> = {
  artifact_id: "solar-system",
  version: 1,
  manifest: { id: "solar-system", version: 1 },
  entry_file: "index.html",
  files: PUBLISHED_FILES,
  bundle_sha256: "c".repeat(64),
  status: "published",
  validation_report: null,
  compliance_level: 1,
  created_by: null,
  created_at: new Date(0).toISOString(),
  published_at: new Date(0).toISOString(),
  published_by: null,
  retired_at: null,
};

function setVersion(fields: Record<string, unknown>) {
  Object.assign(VERSION_ROW, fields);
}

function call(url: string, headers: Record<string, string> = {}, params?: Partial<{ artifactId: string; version: string; path: string[] }>) {
  const u = new URL(url);
  const defaultParams = {
    artifactId: "solar-system",
    version: "1",
    path: u.pathname.replace(/^\/a\/[^/]+\/[^/]+\//, "").split("/"),
  };
  return import("./route").then(({ GET }) =>
    GET(new Request(url, { headers: { host: "127.0.0.1:3000", ...headers } }), {
      params: Promise.resolve({ ...defaultParams, ...params }),
    }),
  );
}

describe("GET /a/[artifactId]/[version]/[...path]", () => {
  const origin = process.env.ARTIFACT_ORIGIN;
  const draftSecret = process.env.ARTIFACT_DRAFT_SECRET;

  beforeEach(() => {
    process.env.ARTIFACT_ORIGIN = "http://127.0.0.1:3000";
    process.env.ARTIFACT_DRAFT_SECRET = "a".repeat(64);
    downloadMock.mockReset();
    downloadMock.mockResolvedValue({ data: new Blob(["<html></html>"]), error: null });
    setVersion({ status: "published", files: PUBLISHED_FILES });
  });
  afterEach(() => {
    if (origin === undefined) delete process.env.ARTIFACT_ORIGIN;
    else process.env.ARTIFACT_ORIGIN = origin;
    if (draftSecret === undefined) delete process.env.ARTIFACT_DRAFT_SECRET;
    else process.env.ARTIFACT_DRAFT_SECRET = draftSecret;
  });

  it("serves a published JS file with ADR-001 headers and immutable cache", async () => {
    downloadMock.mockResolvedValue({ data: new Blob(["console.log(1);"]), error: null });
    const res = await call("http://127.0.0.1:3000/a/solar-system/1/app.js", { "sec-fetch-dest": "script" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/javascript");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const csp = res.headers.get("Content-Security-Policy")!;
    expect(csp).toContain("default-src http://127.0.0.1:3000");
    expect(csp).not.toContain("frame-ancestors");
  });

  it("serves an HTML entry only when Sec-Fetch-Dest is iframe or absent", async () => {
    const iframeRes = await call("http://127.0.0.1:3000/a/solar-system/1/index.html", { "sec-fetch-dest": "iframe" });
    expect(iframeRes.status).toBe(200);
    expect(iframeRes.headers.get("Content-Type")).toBe("text/html; charset=utf-8");

    const absentRes = await call("http://127.0.0.1:3000/a/solar-system/1/index.html");
    expect(absentRes.status).toBe(200);

    const topLevelRes = await call("http://127.0.0.1:3000/a/solar-system/1/index.html", { "sec-fetch-dest": "document" });
    expect(topLevelRes.status).toBe(404);
  });

  it("404s a path with .. or backslash before touching storage", async () => {
    const res = await call("http://127.0.0.1:3000/a/solar-system/1/x", {}, { path: ["..", "secret"] });
    expect(res.status).toBe(404);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("404s a file not listed in the version manifest", async () => {
    const res = await call("http://127.0.0.1:3000/a/solar-system/1/other.js");
    expect(res.status).toBe(404);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("404s an invalid artifactId or non-integer version", async () => {
    const badId = await call("http://127.0.0.1:3000/a/BAD_ID/1/app.js", {}, { artifactId: "BAD_ID" });
    expect(badId.status).toBe(404);
    const badVersion = await call("http://127.0.0.1:3000/a/solar-system/x/app.js", {}, { version: "x" });
    expect(badVersion.status).toBe(404);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("404s a request made on the wrong host", async () => {
    const res = await call("http://localhost:3000/a/solar-system/1/app.js", { host: "localhost:3000" });
    expect(res.status).toBe(404);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("404s a draft without a valid signed token and serves one with it, no-store", async () => {
    setVersion({ status: "draft" });
    const unsigned = await call("http://127.0.0.1:3000/a/solar-system/1/app.js");
    expect(unsigned.status).toBe(404);

    const { signDraftToken } = await import("@/lib/artifact-headers");
    const expiry = Math.floor(Date.now() / 1000) + 600;
    const token = signDraftToken("solar-system", 1, expiry, process.env.ARTIFACT_DRAFT_SECRET!);
    const url = `http://127.0.0.1:3000/a/solar-system/1/app.js?t=${token.signature}&e=${expiry}`;
    const signed = await call(url);
    expect(signed.status).toBe(200);
    expect(signed.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
