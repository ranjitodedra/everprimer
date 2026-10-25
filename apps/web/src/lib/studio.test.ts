import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { solarSystemManifest } from "@eco/contracts/testing";
import type { LibraryArtifactVersionRow } from "@eco/db";
import { signDraftToken } from "./artifact-headers";
import {
  abandonPreview,
  draftPreviewUrl,
  publishPreview,
  isChildLogin,
  libraryListQuery,
  listForStudio,
  previewNewArtifact,
  sittingManifest,
  studioActor,
  studioGate,
  tagSuggestions,
} from "./studio";

describe("studioActor", () => {
  it("treats a missing user as signed out, and a child login as a child even if staff is also set", () => {
    expect(studioActor({ user: false, child: false, staff: false })).toBe("signed-out");
    expect(studioActor({ user: true, child: true, staff: true })).toBe("child");
    expect(studioActor({ user: true, child: false, staff: true })).toBe("staff");
    expect(studioActor({ user: true, child: false, staff: false })).toBe("parent");
  });

  it("treats a child login as a child even when the child id is missing", () => {
    expect(isChildLogin({ app_metadata: { account: "child" } })).toBe(true);
    expect(isChildLogin({ app_metadata: { account: "parent" } })).toBe(false);
    expect(isChildLogin(null)).toBe(false);
  });
});

describe("studioGate", () => {
  it("sends a signed-out person who opens the Artifact Studio to sign-in", () => {
    expect(studioGate("signed-out", "/studio")).toEqual({ type: "redirect", to: "/login?next=%2Fstudio" });
  });

  it("gives a parent or a child a 404 for the Artifact Studio", () => {
    expect(studioGate("parent", "/studio")).toEqual({ type: "not-found" });
    expect(studioGate("child", "/studio/staff")).toEqual({ type: "not-found" });
  });

  it("lets staff open the Artifact Studio", () => {
    expect(studioGate("staff", "/studio")).toEqual({ type: "allow" });
    expect(studioGate("staff", "/studio/new")).toEqual({ type: "allow" });
  });

  it("sends staff from the parent area, a learner page, sign-in, and the home page back to the Artifact Studio", () => {
    expect(studioGate("staff", "/parent")).toEqual({ type: "redirect", to: "/studio" });
    expect(studioGate("staff", "/parent/settings")).toEqual({ type: "redirect", to: "/studio" });
    expect(studioGate("staff", "/learn/child-1")).toEqual({ type: "redirect", to: "/studio" });
    expect(studioGate("staff", "/login")).toEqual({ type: "redirect", to: "/studio" });
    expect(studioGate("staff", "/")).toEqual({ type: "redirect", to: "/studio" });
  });

  it("leaves a parent on the parent area", () => {
    expect(studioGate("parent", "/parent")).toEqual({ type: "allow" });
    expect(studioGate("signed-out", "/")).toEqual({ type: "allow" });
  });
});

const draft = {
  artifact_id: "solar-system-simulator",
  version: 1,
  manifest: { title: "Solar System Simulator", ageRange: [8, 12], subjects: ["science"] },
  status: "draft",
  compliance_level: 3,
} as unknown as LibraryArtifactVersionRow;

function listDb(versions: LibraryArtifactVersionRow[]) {
  let calls = 0;
  const builder = {
    select: () => builder,
    eq: () => builder,
    contains: () => builder,
    ilike: () => builder,
    filter: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (resolve: (value: unknown) => unknown) => {
      calls += 1;
      return Promise.resolve({ data: versions, error: null }).then(resolve);
    },
  };
  return { db: { from: () => builder } as unknown as SupabaseClient, calls: () => calls };
}

describe("library list", () => {
  it("keeps a real title, id, status, subject, age, and compliance, and drops anything else", () => {
    expect(
      libraryListQuery({
        title: "  Solar ",
        id: "",
        status: "nope",
        subject: "science",
        age: "8",
        compliance: "3",
        usage: "desc",
      }),
    ).toEqual({ title: "Solar", subject: "science", age: 8, compliance: 3 });
  });

  it("refuses the list to a parent, a child, and a signed-out person", async () => {
    const parentDb = listDb([draft]);
    expect(await listForStudio("parent", parentDb.db, {})).toEqual({ type: "not-found" });
    expect(parentDb.calls()).toBe(0);
    expect(await listForStudio("child", listDb([draft]).db, {})).toEqual({ type: "not-found" });
    expect(await listForStudio("signed-out", listDb([draft]).db, {})).toEqual({ type: "redirect", to: "/login?next=%2Fstudio" });
  });

  it("returns catalog rows to staff, including a draft", async () => {
    const listed = await listForStudio("staff", listDb([draft]).db, { title: "solar" });
    expect(listed).toEqual({ type: "list", versions: [draft] });
  });
});

const PREVIEW_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><h1>Solar System</h1></body></html>`;
const ACTOR = "00000000-0000-4000-8000-000000000001";

function previewDeps(uploadError: string | null = null) {
  const uploads: string[] = [];
  const removed: string[][] = [];
  const rpc: string[] = [];
  const db = {
    rpc: async (fn: string) => {
      rpc.push(fn);
      return { data: 1, error: null };
    },
    from: () => {
      throw new Error("preview must not read the catalog");
    },
  } as unknown as SupabaseClient;
  return {
    uploads,
    removed,
    rpc,
    deps: {
      db,
      origin: "http://artifacts.test",
      secret: "draft-secret",
      now: 1_700_000_000,
      upload: async (path: string) => {
        uploads.push(path);
        return uploadError;
      },
      remove: async (paths: string[]) => {
        removed.push(paths);
        return null;
      },
    },
  };
}

describe("new artifact preview", () => {
  it("builds a manifest whose compliance is calculated, and suggests tags already in the library", () => {
    const manifest = sittingManifest({
      id: "lever-lab",
      title: "Lever Lab",
      description: "A lever with a movable fulcrum for ages six to eight.",
      subjects: "physics, science",
      topics: "forces",
      concepts: "fulcrum",
      params: "",
      events: "",
      entry: "",
      ageYoungest: "6",
      ageOldest: "8",
      objective: "Explain how moving the fulcrum changes the lift",
      summary: "A bar pivots on a fulcrum and lifts a load.",
      tutorIntro: "",
    });
    expect(manifest).toMatchObject({ id: "lever-lab", subjects: ["physics", "science"], ageRange: [6, 8] });
    expect(manifest).not.toHaveProperty("compliance");
    expect(tagSuggestions([{ manifest: { subjects: ["science"], topics: ["astronomy"], concepts: ["orbit"] } }, { manifest }])).toEqual({
      subjects: ["physics", "science"],
      topics: ["astronomy", "forces"],
      concepts: ["fulcrum", "orbit"],
    });
  });

  it("signs a draft preview url for the artifact host", () => {
    const token = signDraftToken("solar-system-simulator", 1, 1_700_001_800, "draft-secret");
    expect(draftPreviewUrl("http://artifacts.test", "solar-system-simulator", 1, "index.html", token)).toBe(
      `http://artifacts.test/a/solar-system-simulator/1/index.html?t=${token.signature}&e=1700001800`,
    );
  });

  it("refuses a parent and does not store a draft when the import has errors", async () => {
    const parent = previewDeps();
    expect(
      await previewNewArtifact("parent", { html: PREVIEW_HTML, manifest: solarSystemManifest(), actorId: ACTOR }, parent.deps),
    ).toEqual({ type: "not-found" });
    expect(parent.rpc).toHaveLength(0);
    expect(parent.uploads).toHaveLength(0);

    const staff = previewDeps();
    const invalid = await previewNewArtifact("staff", { html: "", manifest: solarSystemManifest(), actorId: ACTOR }, staff.deps);
    expect(invalid.type).toBe("invalid");
    expect(staff.rpc).toHaveLength(0);
    expect(staff.uploads).toHaveLength(0);
  });

  it("stores a draft and returns a signed preview url, with publish still off", async () => {
    const staff = previewDeps();
    const out = await previewNewArtifact("staff", { html: PREVIEW_HTML, manifest: solarSystemManifest(), actorId: ACTOR }, staff.deps);
    expect(out.type).toBe("preview");
    if (out.type !== "preview") return;
    expect(staff.rpc).toEqual(["library_register_draft"]);
    expect(staff.uploads).toEqual(["bundles/solar-system-simulator/1/index.html"]);
    expect(out.url).toContain("http://artifacts.test/a/solar-system-simulator/1/index.html?t=");
    expect(out.compliance).toBe(3);
    expect(out.publish).toBe("off");
  });

  it("deletes a draft when staff leave, and refuses anyone else", async () => {
    const versions = [
      {
        artifact_id: "solar-system-simulator",
        version: 1,
        status: "draft",
        files: [{ path: "index.html", size: 10, sha256: "a".repeat(64), mime: "text/html" }],
      },
    ];
    let removed: string[] = [];
    const db = {
      from(table: string) {
        const filters: [string, unknown][] = [];
        const builder = {
          select: () => builder,
          delete: () => builder,
          eq: (col: string, val: unknown) => (filters.push([col, val]), builder),
          maybeSingle: async () => ({ data: versions[0] ?? null, error: null }),
          then: (resolve: (value: unknown) => unknown) => {
            if (builder.deleting) {
              const version = filters.find(([col]) => col === "version")?.[1];
              const idx = versions.findIndex((row) => row.version === version);
              if (idx >= 0) versions.splice(idx, 1);
            }
            return Promise.resolve({ data: table === "library_artifact_versions" ? versions : [], error: null }).then(resolve);
          },
          deleting: false,
        };
        const del = builder.delete;
        builder.delete = () => ((builder.deleting = true), builder);
        void del;
        return builder;
      },
    } as unknown as SupabaseClient;
    const deps = {
      db,
      origin: "http://artifacts.test",
      secret: "draft-secret",
      now: 0,
      upload: async () => null,
      remove: async (paths: string[]) => {
        removed = paths;
        return null;
      },
    };
    expect(await abandonPreview("staff", "solar-system-simulator", 1, deps)).toEqual({ type: "deleted" });
    expect(removed).toEqual(["bundles/solar-system-simulator/1/index.html"]);
    expect(versions).toHaveLength(0);

    const published = await abandonPreview("parent", "solar-system-simulator", 1, deps);
    expect(published).toEqual({ type: "not-found" });
  });
});

function publishDb(options: { manifestVersion?: number; failPublished?: boolean } = {}) {
  const row = {
    artifact_id: "solar-system-simulator",
    version: 1,
    manifest: { ...solarSystemManifest(), version: options.manifestVersion ?? 1 },
    entry_file: "index.html",
    files: [{ path: "index.html", size: 20, sha256: "a".repeat(64), mime: "text/html" }],
    bundle_sha256: "b".repeat(64),
    status: "draft" as "draft" | "testing" | "published",
    validation_report: null,
    compliance_level: 3 as const,
    created_by: ACTOR,
    created_at: "2026-10-24T00:00:00Z",
    published_at: null,
    published_by: null,
    retired_at: null,
  };
  const calls: string[] = [];
  const db = {
    from() {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: { ...row }, error: null }),
      };
      return builder;
    },
    rpc: async (_fn: string, args: { p_status: string }) => {
      calls.push(args.p_status);
      if (options.failPublished && args.p_status === "published") return { data: null, error: { message: "publish failed" } };
      row.status = args.p_status as typeof row.status;
      return { data: { status: args.p_status, current_version: args.p_status === "published" ? 1 : null }, error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, calls, status: () => row.status };
}

describe("publish preview", () => {
  const input = { artifactId: "solar-system-simulator", version: 1, actorId: ACTOR };

  it("refuses a parent and a preview that is not ready, without changing the draft", async () => {
    const parent = publishDb();
    expect(await publishPreview("parent", { ...input, ready: true }, { db: parent.db })).toEqual({ type: "not-found" });
    expect(parent.calls).toEqual([]);

    const early = publishDb();
    expect(await publishPreview("staff", { ...input, ready: false }, { db: early.db })).toEqual({
      type: "refused",
      problems: ["Publish stays off until the preview is ready."],
    });
    expect(early.calls).toEqual([]);
    expect(early.status()).toBe("draft");
  });

  it("publishes a ready draft by moving it through testing in one action", async () => {
    const staff = publishDb();
    expect(await publishPreview("staff", { ...input, ready: true }, { db: staff.db })).toEqual({
      type: "published",
      artifactId: "solar-system-simulator",
      version: 1,
    });
    expect(staff.calls).toEqual(["testing", "published"]);
    expect(staff.status()).toBe("published");
  });

  it("leaves a draft in place when publish fails or the stored manifest has errors", async () => {
    const failed = publishDb({ failPublished: true });
    const out = await publishPreview("staff", { ...input, ready: true }, { db: failed.db });
    expect(out.type).toBe("unavailable");
    expect(failed.calls).toEqual(["testing", "published", "draft"]);
    expect(failed.status()).toBe("draft");

    const invalid = publishDb({ manifestVersion: 9 });
    const refused = await publishPreview("staff", { ...input, ready: true }, { db: invalid.db });
    expect(refused.type).toBe("unavailable");
    expect(invalid.calls).toEqual(["testing", "draft"]);
    expect(invalid.status()).toBe("draft");
  });
});
