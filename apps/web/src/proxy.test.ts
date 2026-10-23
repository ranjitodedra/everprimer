import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The proxy enforces host-based routing before any Supabase client is built.
 * We stub the Supabase SSR module so these tests can run without env vars and
 * so we can assert the artifact-host path never calls it.
 */

const createServerClient = vi.fn();
vi.mock("@supabase/ssr", () => ({ createServerClient }));

async function callProxy(url: string, host: string) {
  const { proxy } = await import("./proxy");
  const req = new Request(url, { headers: { host } });
  // Minimal NextRequest-ish shape proxy() uses: nextUrl + cookies + headers.
  const nextUrl = new URL(req.url);
  const request = {
    nextUrl,
    url: req.url,
    headers: req.headers,
    cookies: { getAll: () => [], has: () => false },
  } as unknown as Parameters<typeof proxy>[0];
  return proxy(request);
}

describe("proxy host-based routing", () => {
  const origin = process.env.ARTIFACT_ORIGIN;
  beforeEach(() => {
    process.env.ARTIFACT_ORIGIN = "http://127.0.0.1:3000";
    createServerClient.mockReset();
  });
  afterEach(() => {
    if (origin === undefined) delete process.env.ARTIFACT_ORIGIN;
    else process.env.ARTIFACT_ORIGIN = origin;
  });

  it("404s an app path on the artifact host without building a Supabase client", async () => {
    const res = await callProxy("http://127.0.0.1:3000/parent", "127.0.0.1:3000");
    expect(res.status).toBe(404);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("passes an artifact path through on the artifact host without building a Supabase client", async () => {
    const res = await callProxy("http://127.0.0.1:3000/a/x/1/index.html", "127.0.0.1:3000");
    expect(res.status).toBe(200);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("404s an artifact path on the app host without building a Supabase client", async () => {
    const res = await callProxy("http://localhost:3000/a/x/1/index.html", "localhost:3000");
    expect(res.status).toBe(404);
    expect(createServerClient).not.toHaveBeenCalled();
  });
});
