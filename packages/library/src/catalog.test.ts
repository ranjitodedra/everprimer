import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LibraryArtifactRow, LibraryArtifactVersionRow, LibraryFileEntry, LibraryVersionStatus } from "@eco/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { solarSystemManifest } from "../../contracts/src/testing";
import {
  addVersion,
  checkVersionInput,
  getArtifact,
  listArtifacts,
  publishVersion,
  registerDraft,
  retireVersion,
  setStatus,
  type VersionInput,
} from "./catalog";
import { LIBRARY_BUCKET, bundleObjectPath, isSafeObjectPath, previewObjectPath } from "./paths";
import { LIBRARY_TRANSITIONS, canTransition, transitionProblem } from "./status";

const SHA = "a".repeat(64);
const ACTOR = "00000000-0000-4000-8000-000000000001";

function files(): LibraryFileEntry[] {
  return [
    { path: "index.html", size: 2_000, sha256: SHA, mime: "text/html" },
    { path: "js/main.js", size: 40_000, sha256: "b".repeat(64), mime: "text/javascript" },
  ];
}

function input(overrides: Partial<VersionInput> = {}): VersionInput {
  return { manifest: solarSystemManifest(), files: files(), bundleSha256: SHA, actor: ACTOR, ...overrides };
}

function versionRow(version: number, status: LibraryVersionStatus): LibraryArtifactVersionRow {
  return {
    artifact_id: "solar-system-simulator",
    version,
    manifest: { ...solarSystemManifest(), version } as unknown as Record<string, unknown>,
    entry_file: "index.html",
    files: files(),
    bundle_sha256: SHA,
    status,
    validation_report: null,
    compliance_level: 3,
    created_by: ACTOR,
    created_at: "2026-10-22T00:00:00Z",
    published_at: status === "published" || status === "retired" ? "2026-10-22T00:00:00Z" : null,
    published_by: null,
    retired_at: status === "retired" ? "2026-10-22T00:00:00Z" : null,
  };
}

function artifactRow(currentVersion: number | null): LibraryArtifactRow {
  return {
    id: "solar-system-simulator",
    title: "Solar System Simulator",
    owner: ACTOR,
    current_version: currentVersion,
    created_at: "2026-10-22T00:00:00Z",
    updated_at: "2026-10-22T00:00:00Z",
  };
}

type Filter = ["eq" | "contains", string, unknown];

/** Just enough of the PostgREST builder for the catalog: eq/contains filters over in-memory rows, and recorded RPC calls. */
function fakeDb(state: {
  artifacts?: LibraryArtifactRow[];
  versions?: LibraryArtifactVersionRow[];
  rpc?: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { message: string; code?: string } | null };
}) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const queries: { table: string; filters: Filter[]; limit?: number }[] = [];

  const matches = (row: Record<string, unknown>, [op, col, val]: Filter) => {
    if (op === "eq") return row[col] === val;
    const doc = row[col] as Record<string, unknown[]>;
    return Object.entries(val as Record<string, unknown[]>).every(([k, wanted]) => wanted.every((w) => doc[k]?.includes(w)));
  };

  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return state.rpc?.(fn, args) ?? { data: 1, error: null };
    },
    from(table: string) {
      const q: { table: string; filters: Filter[]; limit?: number } = { table, filters: [] };
      queries.push(q);
      const rows = () =>
        ((table === "library_artifacts" ? state.artifacts : state.versions) ?? []).filter((r) =>
          q.filters.every((f) => matches(r as unknown as Record<string, unknown>, f)),
        );
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => (q.filters.push(["eq", col, val]), builder),
        contains: (col: string, val: unknown) => (q.filters.push(["contains", col, val]), builder),
        order: () => builder,
        limit: (n: number) => ((q.limit = n), builder),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, rpcCalls, queries };
}

describe("checkVersionInput", () => {
  it("accepts the solar system fixture and computes its compliance level", () => {
    const out = checkVersionInput(input());
    expect(out).toMatchObject({ ok: true, compliance: 3 });
  });

  it("rejects a manifest that fails the schema", () => {
    const out = checkVersionInput(input({ manifest: { ...solarSystemManifest(), id: "Not Kebab" } }));
    expect(out.ok).toBe(false);
  });

  it("rejects a manifest that fails lint", () => {
    const out = checkVersionInput(input({ manifest: { ...solarSystemManifest(), ageRange: [12, 8] } }));
    expect(out.ok).toBe(false);
  });

  it("requires the entry file to be in the file list", () => {
    const out = checkVersionInput(input({ files: files().filter((f) => f.path !== "index.html") }));
    expect(out).toEqual({ ok: false, problems: ['entry "index.html" is not one of the files'] });
  });

  it("rejects unsafe, duplicate and badly hashed files", () => {
    const out = checkVersionInput(
      input({
        files: [
          ...files(),
          { path: "../escape.js", size: 1, sha256: SHA, mime: "text/javascript" },
          { path: "js/main.js", size: 1, sha256: "NOT-HEX", mime: "text/javascript" },
        ],
      }),
    );
    if (out.ok) throw new Error("expected problems");
    expect(out.problems).toEqual(
      expect.arrayContaining([
        'unsafe file path "../escape.js"',
        'duplicate file "js/main.js"',
        'file "js/main.js" needs a lowercase hex sha256',
      ]),
    );
  });

  it("enforces the manifest's own bundle size limit", () => {
    const big = [{ path: "index.html", size: 4001 * 1024, sha256: SHA, mime: "text/html" }];
    const out = checkVersionInput(input({ files: big }));
    expect(out).toEqual({ ok: false, problems: ["bundle is 4001 KB, over the 4000 KB limit"] });
  });

  it("requires a bundle hash", () => {
    expect(checkVersionInput(input({ bundleSha256: "abc" })).ok).toBe(false);
  });
});

describe("registerDraft and addVersion", () => {
  it("never calls the database for an invalid manifest", async () => {
    const { db, rpcCalls } = fakeDb({});
    const out = await registerDraft(db, input({ manifest: { ...solarSystemManifest(), events: "nope" } }));
    expect(out.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("registers version 1 under the manifest id", async () => {
    const { db, rpcCalls } = fakeDb({ rpc: () => ({ data: 1, error: null }) });
    const out = await registerDraft(db, input());
    expect(out).toEqual({ ok: true, artifactId: "solar-system-simulator", version: 1 });
    expect(rpcCalls).toEqual([
      {
        fn: "library_register_draft",
        args: expect.objectContaining({ p_artifact_id: "solar-system-simulator", p_compliance: 3, p_bundle_sha256: SHA, p_actor: ACTOR }),
      },
    ]);
  });

  it("reports an existing artifact as a problem", async () => {
    const { db } = fakeDb({ rpc: () => ({ data: null, error: { message: "duplicate key", code: "23505" } }) });
    expect(await registerDraft(db, input())).toEqual({ ok: false, problems: ['artifact "solar-system-simulator": already exists'] });
  });

  it("returns the version number the database assigned", async () => {
    const { db, rpcCalls } = fakeDb({ rpc: () => ({ data: 4, error: null }) });
    expect(await addVersion(db, "solar-system-simulator", input())).toEqual({ ok: true, artifactId: "solar-system-simulator", version: 4 });
    expect(rpcCalls[0]?.fn).toBe("library_add_version");
  });

  it("refuses a manifest for a different artifact", async () => {
    const { db, rpcCalls } = fakeDb({});
    const out = await addVersion(db, "lever-lab", input());
    expect(out.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("getArtifact and listArtifacts", () => {
  it("returns the current published version when no version is given", async () => {
    const { db } = fakeDb({ artifacts: [artifactRow(2)], versions: [versionRow(1, "retired"), versionRow(2, "published"), versionRow(3, "draft")] });
    const out = await getArtifact(db, "solar-system-simulator");
    if (!out.ok) throw new Error(out.problems.join("; "));
    expect(out.version.version).toBe(2);
  });

  it("returns a specific version when asked", async () => {
    const { db } = fakeDb({ artifacts: [artifactRow(2)], versions: [versionRow(1, "retired"), versionRow(2, "published")] });
    const out = await getArtifact(db, "solar-system-simulator", 1);
    expect(out.ok && out.version.status).toBe("retired");
  });

  it("explains a missing artifact or an unpublished one", async () => {
    expect(await getArtifact(fakeDb({}).db, "nope-nope")).toEqual({ ok: false, problems: ['artifact "nope-nope" not found'] });
    const { db } = fakeDb({ artifacts: [artifactRow(null)], versions: [versionRow(1, "draft")] });
    expect(await getArtifact(db, "solar-system-simulator")).toEqual({
      ok: false,
      problems: ['artifact "solar-system-simulator" has no published version'],
    });
  });

  it("lists published versions by default and filters by manifest tags", async () => {
    const { db, queries } = fakeDb({ versions: [versionRow(1, "retired"), versionRow(2, "published"), versionRow(3, "draft")] });
    const all = await listArtifacts(db);
    expect(all.ok && all.versions.map((v) => v.version)).toEqual([2]);

    const science = await listArtifacts(db, { subject: "science", visualKind: "orbit", limit: 1000 });
    expect(science.ok && science.versions).toHaveLength(1);
    expect(queries.at(-1)?.limit).toBe(200);

    const none = await listArtifacts(db, { subject: "history" });
    expect(none.ok && none.versions).toHaveLength(0);
  });
});

describe("status changes", () => {
  it("refuses to publish a draft without calling the database", async () => {
    const { db, rpcCalls } = fakeDb({ versions: [versionRow(1, "draft")] });
    const out = await publishVersion(db, "solar-system-simulator", 1, ACTOR);
    expect(out).toEqual({ ok: false, problems: ["solar-system-simulator@1: a draft version can only move to testing, not published"] });
    expect(rpcCalls).toHaveLength(0);
  });

  it("publishes a version in testing", async () => {
    const { db, rpcCalls } = fakeDb({
      versions: [versionRow(1, "testing")],
      rpc: () => ({ data: { status: "published", current_version: 1 }, error: null }),
    });
    expect(await publishVersion(db, "solar-system-simulator", 1, ACTOR)).toEqual({ ok: true, status: "published", currentVersion: 1 });
    expect(rpcCalls).toEqual([
      { fn: "library_set_status", args: { p_artifact_id: "solar-system-simulator", p_version: 1, p_status: "published", p_actor: ACTOR } },
    ]);
  });

  it("re-checks the stored manifest before publishing", async () => {
    const row = versionRow(1, "testing");
    row.manifest = { ...row.manifest, ageRange: [12, 8] };
    const { db, rpcCalls } = fakeDb({ versions: [row] });
    expect((await publishVersion(db, "solar-system-simulator", 1, ACTOR)).ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("refuses to publish a row whose manifest names another version", async () => {
    const row = versionRow(2, "testing");
    row.manifest = { ...row.manifest, version: 1 };
    const { db } = fakeDb({ versions: [row] });
    expect(await publishVersion(db, "solar-system-simulator", 2, ACTOR)).toEqual({
      ok: false,
      problems: ["solar-system-simulator@2: manifest says solar-system-simulator@1"],
    });
  });

  it("only retires published versions", async () => {
    const { db, rpcCalls } = fakeDb({ versions: [versionRow(1, "testing"), versionRow(2, "retired")] });
    expect((await retireVersion(db, "solar-system-simulator", 1, ACTOR)).ok).toBe(false);
    expect(await retireVersion(db, "solar-system-simulator", 2, ACTOR)).toEqual({
      ok: false,
      problems: ["solar-system-simulator@2: version is already retired"],
    });
    expect(rpcCalls).toHaveLength(0);
  });

  it("moves drafts into testing and back", async () => {
    const { db, rpcCalls } = fakeDb({ versions: [versionRow(1, "draft")], rpc: () => ({ data: { status: "testing", current_version: null }, error: null }) });
    expect(await setStatus(db, "solar-system-simulator", 1, "testing", ACTOR)).toEqual({ ok: true, status: "testing", currentVersion: null });
    expect(rpcCalls).toHaveLength(1);
  });

  it("reports a missing version", async () => {
    expect(await setStatus(fakeDb({}).db, "solar-system-simulator", 9, "testing", ACTOR)).toEqual({
      ok: false,
      problems: ["solar-system-simulator@9 not found"],
    });
  });
});

describe("transition table", () => {
  it("matches the pairs guard_library_version() allows", () => {
    const sql = readFileSync(new URL("../../db/supabase/migrations/0011_artifact_library.sql", import.meta.url), "utf8");
    const block = sql.match(/new\.status <> old\.status and \(old\.status, new\.status\) not in \(([\s\S]*?)\) then/)?.[1];
    if (!block) throw new Error("transition list not found in the migration");
    const fromSql = [...block.matchAll(/\('(\w+)', '(\w+)'\)/g)].map((m) => `${m[1]}->${m[2]}`).sort();
    const fromTs = Object.entries(LIBRARY_TRANSITIONS)
      .flatMap(([from, tos]) => tos.map((to) => `${from}->${to}`))
      .sort();
    expect(fromTs).toEqual(fromSql);
  });

  it("explains refused moves", () => {
    expect(canTransition("testing", "published")).toBe(true);
    expect(canTransition("published", "draft")).toBe(false);
    expect(transitionProblem("retired", "published")).toBe("a retired version cannot change");
    expect(transitionProblem("draft", "testing")).toBeNull();
  });
});

describe("storage paths", () => {
  it("builds per-version paths in the library bucket", () => {
    expect(LIBRARY_BUCKET).toBe("library");
    expect(bundleObjectPath("solar-system-simulator", 3, "js/main.js")).toBe("bundles/solar-system-simulator/3/js/main.js");
    expect(previewObjectPath("solar-system-simulator", 3)).toBe("previews/solar-system-simulator/3/thumb.webp");
  });

  it("rejects unsafe paths, ids and versions", () => {
    for (const bad of ["../x.js", "a/../b.js", "/abs.js", "a//b.js", "./a.js", "a\\b.js", "https://cdn.test/x.js", "a\u0000.js", ""]) {
      expect(isSafeObjectPath(bad), bad).toBe(false);
    }
    expect(() => bundleObjectPath("solar-system-simulator", 1, "../x.js")).toThrow();
    expect(() => bundleObjectPath("Bad Id", 1, "index.html")).toThrow();
    expect(() => previewObjectPath("solar-system-simulator", 0)).toThrow();
  });
});
