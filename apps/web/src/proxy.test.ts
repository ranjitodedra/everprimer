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
    nextUrl: Object.assign(nextUrl, { clone: () => new URL(nextUrl.toString()) }),
    url: req.url,
    headers: req.headers,
    cookies: { getAll: () => [], has: () => false, set: () => {} },
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

function supabaseUser(user: { id: string; app_metadata?: Record<string, string> } | null, staff: boolean) {
  createServerClient.mockImplementation((_url: string, _key: string, opts: { cookies: { setAll: (cookies: { name: string; value: string; options: object }[]) => void } }) => {
    opts.cookies.setAll([{ name: "sb-refresh", value: "rotated", options: {} }]);
    return {
      auth: { getUser: async () => ({ data: { user } }) },
      rpc: async () => ({ data: staff }),
    };
  });
}

describe("proxy Artifact Studio gate", () => {
  const origin = process.env.ARTIFACT_ORIGIN;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  beforeEach(() => {
    process.env.ARTIFACT_ORIGIN = "http://127.0.0.1:3000";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    createServerClient.mockReset();
  });
  afterEach(() => {
    if (origin === undefined) delete process.env.ARTIFACT_ORIGIN;
    else process.env.ARTIFACT_ORIGIN = origin;
    if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    if (anon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anon;
  });

  it("sends a signed-out person from the Artifact Studio to sign-in", async () => {
    supabaseUser(null, false);
    const res = await callProxy("http://localhost:3000/studio", "localhost:3000");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.headers.get("location")).toContain("next=%2Fstudio");
  });

  it("404s a parent and a child who open the Artifact Studio", async () => {
    supabaseUser({ id: "parent" }, false);
    const parent = await callProxy("http://localhost:3000/studio", "localhost:3000");
    expect(parent.status).toBe(404);

    supabaseUser({ id: "child", app_metadata: { account: "child", child_id: "c1" } }, false);
    const child = await callProxy("http://localhost:3000/studio", "localhost:3000");
    expect(child.status).toBe(404);
    expect(child.headers.get("set-cookie")).toContain("sb-refresh=rotated");
  });

  it("lets staff through to the Artifact Studio and sends them home from the parent area", async () => {
    supabaseUser({ id: "staff" }, true);
    const studio = await callProxy("http://localhost:3000/studio", "localhost:3000");
    expect(studio.status).toBe(200);
    const parent = await callProxy("http://localhost:3000/parent", "localhost:3000");
    expect(parent.status).toBe(307);
    expect(parent.headers.get("location")).toContain("/studio");
    const learn = await callProxy("http://localhost:3000/learn/child-1", "localhost:3000");
    expect(learn.status).toBe(307);
    expect(learn.headers.get("location")).toContain("/studio");
  });
});
