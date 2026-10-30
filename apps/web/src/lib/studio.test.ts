import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { solarSystemManifest } from "@eco/contracts/testing";
import type { LibraryArtifactVersionRow } from "@eco/db";
import { signDraftToken } from "./artifact-headers";
import {
  abandonPreview,
  draftPreviewUrl,
  fieldsFromManifest,
  previewNextVersion,
  publishPreview,
  isChildLogin,
  libraryListQuery,
  listForStudio,
  grantStaff,
  historyForStudio,
  openDraftLink,
  listStaff,
  previewNewArtifact,
  removeStaff,
  retireForStudio,
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

function zipOf(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const crc32 = (data: Uint8Array) => {
    let c = ~0;
    for (const byte of data) {
      c ^= byte;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);
    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, centrals.length, true);
  endView.setUint16(10, centrals.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}
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

  it("opens a draft on the artifact host and stays closed when the host is unset", () => {
    const url = openDraftLink({
      origin: "http://artifacts.test",
      secret: "draft-secret",
      now: 1_700_000_000,
      artifactId: "solar-system",
      version: 1,
      entry: "index.html",
    });
    expect(url).toContain("http://artifacts.test/a/solar-system/1/index.html?t=");
    expect(url).toContain("&e=");
    expect(
      openDraftLink({ origin: null, secret: "draft-secret", now: 1, artifactId: "solar-system", version: 1, entry: "index.html" }),
    ).toBeNull();
    expect(
      openDraftLink({
        origin: "http://artifacts.test",
        secret: "",
        now: 1,
        artifactId: "solar-system",
        version: 1,
        entry: "index.html",
      }),
    ).toBeNull();
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

function passingStudioReport(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    bundleSha256: "b".repeat(64),
    webgl: true,
    params: {
      planets: ["mercury", "venus", "earth", "mars"],
      orbitSpeed: 1,
    },
    thumbnailPath: null,
    viewports: [],
    ...overrides,
  };
}

function publishDb(options: {
  manifestVersion?: number;
  failPublished?: boolean;
  report?: unknown;
  status?: "draft" | "testing" | "published";
} = {}) {
  const row = {
    artifact_id: "solar-system-simulator",
    version: 1,
    manifest: { ...solarSystemManifest(), version: options.manifestVersion ?? 1 },
    entry_file: "index.html",
    files: [{ path: "index.html", size: 20, sha256: "a".repeat(64), mime: "text/html" }],
    bundle_sha256: "b".repeat(64),
    status: (options.status ?? "draft") as "draft" | "testing" | "published",
    validation_report: ("report" in options ? options.report : passingStudioReport()) as typeof options.report,
    compliance_level: 3 as const,
    created_by: ACTOR,
    created_at: "2026-10-24T00:00:00Z",
    published_at: null,
    published_by: null,
    retired_at: null,
  };
  const calls: string[] = [];
  const db = {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        update: (patch: { validation_report?: unknown }) => (Object.assign(row, patch), builder),
        maybeSingle: async () => ({
          data:
            table === "library_artifacts"
              ? {
                  id: "solar-system-simulator",
                  title: "Solar System Simulator",
                  owner: ACTOR,
                  current_version: null,
                  created_at: "2026-10-24T00:00:00Z",
                  updated_at: "2026-10-24T00:00:00Z",
                }
              : { ...row },
          error: null,
        }),
        then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve, reject),
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
  return { db: db as unknown as SupabaseClient, calls, status: () => row.status, report: () => row.validation_report };
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

  it("publishes a ready draft that already has a matching browser report", async () => {
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

  it("refuses a ready draft whose browser report is missing", async () => {
    const staff = publishDb({ report: null });
    const out = await publishPreview("staff", { ...input, ready: true }, { db: staff.db });
    expect(out).toEqual({
      type: "unavailable",
      problems: ["solar-system-simulator@1: browser report is missing"],
    });
    expect(staff.calls).toEqual(["testing", "draft"]);
    expect(staff.status()).toBe("draft");
  });

  it("stores an injected browser check and its desktop thumbnail without launching Chromium", async () => {
    const staff = publishDb({ report: null });
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47);
    const uploads: { path: string; bytes: Uint8Array; mime: string }[] = [];
    const seen: { bundleSha256?: string } = {};
    const out = await publishPreview("staff", { ...input, ready: true }, {
      db: staff.db,
      browserCheck: async (check) => {
        seen.bundleSha256 = check.bundleSha256;
        return { report: passingStudioReport(), thumbnail: png };
      },
      upload: async (path, bytes, mime) => {
        uploads.push({ path, bytes, mime });
        return null;
      },
    });
    expect(out).toEqual({ type: "published", artifactId: "solar-system-simulator", version: 1 });
    expect(seen.bundleSha256).toBe("b".repeat(64));
    expect(uploads).toEqual([{ path: "previews/solar-system-simulator/1/thumb.png", bytes: png, mime: "image/png" }]);
    expect(staff.report()).toMatchObject({
      ok: true,
      bundleSha256: "b".repeat(64),
      thumbnailPath: "previews/solar-system-simulator/1/thumb.png",
    });
    expect(staff.status()).toBe("published");
  });

  it("does not store a new thumbnail for a published version", async () => {
    const staff = publishDb({ status: "published" });
    const uploads: string[] = [];
    const out = await publishPreview("staff", { ...input, ready: true }, {
      db: staff.db,
      browserCheck: async () => ({ report: passingStudioReport(), thumbnail: Uint8Array.of(1) }),
      upload: async (path) => {
        uploads.push(path);
        return null;
      },
    });
    expect(out).toEqual({
      type: "refused",
      problems: ["solar-system-simulator@1 is published and its browser report cannot change"],
    });
    expect(uploads).toEqual([]);
    expect(staff.calls).toEqual([]);
  });

  it("keeps the hosted publish action from running a browser check", () => {
    const source = readFileSync(new URL("../app/studio/new/actions.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/browserCheck|runBrowserCheck|playwright|browser-check/);
  });
});

function nextVersionDb() {
  const previous = { ...solarSystemManifest(), version: 1 };
  const uploads: string[] = [];
  const rpc: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        update: () => {
          throw new Error("the previous version must stay unchanged");
        },
        maybeSingle: async () => ({
          data:
            table === "library_artifacts"
              ? { id: "solar-system-simulator", title: previous.title, owner: ACTOR, current_version: 1, created_at: "", updated_at: "" }
              : {
                  artifact_id: "solar-system-simulator",
                  version: 1,
                  manifest: previous,
                  entry_file: "index.html",
                  files: [{ path: "index.html", size: 20, sha256: "a".repeat(64), mime: "text/html" }],
                  bundle_sha256: "b".repeat(64),
                  status: "published",
                  validation_report: null,
                  compliance_level: 3,
                  created_by: ACTOR,
                  created_at: "2026-10-24T00:00:00Z",
                  published_at: "2026-10-24T00:00:00Z",
                  published_by: ACTOR,
                  retired_at: null,
                },
          error: null,
        }),
      };
      return builder;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpc.push({ fn, args });
      return { data: 2, error: null };
    },
  };
  return {
    previous,
    uploads,
    rpc,
    deps: {
      db: db as unknown as SupabaseClient,
      origin: "http://artifacts.test",
      secret: "draft-secret",
      now: 1_700_000_000,
      upload: async (path: string) => {
        uploads.push(path);
        return null;
      },
      remove: async () => null,
    },
  };
}

describe("next version", () => {
  it("fills the form from the previous manifest and keeps its id", () => {
    const fields = fieldsFromManifest(solarSystemManifest());
    expect(fields.id).toBe("solar-system-simulator");
    expect(fields.title).toBe("Solar System Simulator");
    expect(fields.subjects).toBe("science");
    expect(fields.params).toContain("orbitSpeed");
  });

  it("refuses a parent, a changed id, and a sitting with no new files", async () => {
    const staff = nextVersionDb();
    const fields = fieldsFromManifest(staff.previous);
    expect(await previewNextVersion("parent", { artifactId: "solar-system-simulator", fields, html: PREVIEW_HTML, actorId: ACTOR }, staff.deps)).toEqual({
      type: "not-found",
    });
    expect(staff.rpc).toHaveLength(0);

    const changed = nextVersionDb();
    const mismatch = await previewNextVersion(
      "staff",
      { artifactId: "solar-system-simulator", fields: { ...fields, id: "lever-lab" }, html: PREVIEW_HTML, actorId: ACTOR },
      changed.deps,
    );
    expect(mismatch.type).toBe("refused");
    expect(changed.rpc).toHaveLength(0);

    const empty = nextVersionDb();
    const missing = await previewNextVersion("staff", { artifactId: "solar-system-simulator", fields, html: "", actorId: ACTOR }, empty.deps);
    expect(missing.type).toBe("invalid");
    expect(empty.rpc).toHaveLength(0);
    expect(empty.uploads).toHaveLength(0);
  });

  it("stores a new version from the previous manifest and leaves that version's files alone", async () => {
    const staff = nextVersionDb();
    const fields = { ...fieldsFromManifest(staff.previous), title: "Solar System Updated" };
    const out = await previewNextVersion("staff", { artifactId: "solar-system-simulator", fields, html: PREVIEW_HTML, actorId: ACTOR }, staff.deps);
    expect(out.type).toBe("preview");
    if (out.type !== "preview") return;
    expect(out.version).toBe(2);
    expect(staff.rpc.map((call) => call.fn)).toEqual(["library_add_version"]);
    const stored = staff.rpc[0]!.args.p_manifest as { title: string; id: string; format: string; entry: string; rendering: { tech: string[] } };
    expect(stored.id).toBe("solar-system-simulator");
    expect(stored.title).toBe("Solar System Updated");
    expect(stored.rendering.tech).toEqual(["three@0.170.0"]);
    expect(staff.uploads).toEqual(["bundles/solar-system-simulator/2/index.html"]);
    expect(stored.format).toBe("html");
    expect(stored.entry).toBe("index.html");
  });

  it("marks a ZIP as a bundle even when the published version is a single file", async () => {
    const staff = nextVersionDb();
    staff.previous.format = "html";
    staff.previous.entry = "index.html";
    const fields = fieldsFromManifest(staff.previous);
    const out = await previewNextVersion(
      "staff",
      { artifactId: "solar-system-simulator", fields, zip: zipOf({ "index.html": "<!doctype html><html></html>", "styles.css": "body{}" }), actorId: ACTOR },
      staff.deps,
    );
    expect(out.type).toBe("preview");
    const stored = staff.rpc[0]!.args.p_manifest as { format: string; entry: string };
    expect(stored.format).toBe("bundle");
    expect(stored.entry).toBe("index.html");
    expect(staff.uploads).toEqual(["bundles/solar-system-simulator/2/index.html", "bundles/solar-system-simulator/2/styles.css"]);
  });

  it("uses a cleared field instead of the published value", async () => {
    const kept = nextVersionDb();
    const keptFields = { ...fieldsFromManifest(kept.previous), tutorIntro: "", entry: "" };
    const preview = await previewNextVersion(
      "staff",
      { artifactId: "solar-system-simulator", fields: keptFields, html: PREVIEW_HTML, actorId: ACTOR },
      kept.deps,
    );
    expect(preview.type).toBe("preview");
    const stored = kept.rpc[0]!.args.p_manifest as { entry: string; tutorGuide: { intro?: string; steps: string[] } };
    expect(stored.entry).toBe("index.html");
    expect(stored.tutorGuide.intro).toBeUndefined();
    expect(stored.tutorGuide.steps.length).toBeGreaterThan(0);

    const cleared = nextVersionDb();
    const fields = { ...fieldsFromManifest(cleared.previous), objective: "" };
    const out = await previewNextVersion(
      "staff",
      { artifactId: "solar-system-simulator", fields, html: PREVIEW_HTML, actorId: ACTOR },
      cleared.deps,
    );
    expect(out.type).toBe("invalid");
    expect(cleared.rpc).toHaveLength(0);
  });

  it("starts the next version from the newest retired version when nothing is published", async () => {
    const previous = { ...solarSystemManifest(), version: 1 };
    const uploads: string[] = [];
    const rpc: { fn: string; args: Record<string, unknown> }[] = [];
    const retired = {
      artifact_id: "solar-system-simulator",
      version: 1,
      manifest: previous,
      entry_file: "index.html",
      files: [{ path: "index.html", size: 20, sha256: "a".repeat(64), mime: "text/html" }],
      bundle_sha256: "b".repeat(64),
      status: "retired" as const,
      validation_report: null,
      compliance_level: 3 as const,
      created_by: ACTOR,
      created_at: "2026-10-22T00:00:00Z",
      published_at: "2026-10-22T12:00:00Z",
      published_by: ACTOR,
      retired_at: "2026-10-23T00:00:00Z",
    };
    const db = {
      from(table: string) {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          update: () => {
            throw new Error("the previous version must stay unchanged");
          },
          maybeSingle: async () => ({
            data:
              table === "library_artifacts"
                ? { id: "solar-system-simulator", title: previous.title, owner: ACTOR, current_version: null, created_at: "", updated_at: "" }
                : null,
            error: null,
          }),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "library_artifact_versions" ? [retired] : [], error: null }).then(resolve),
        };
        return builder;
      },
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpc.push({ fn, args });
        return { data: 2, error: null };
      },
    };
    const fields = { ...fieldsFromManifest(previous), title: "Solar System Updated" };
    const out = await previewNextVersion(
      "staff",
      { artifactId: "solar-system-simulator", fields, html: PREVIEW_HTML, actorId: ACTOR },
      {
        db: db as unknown as SupabaseClient,
        origin: "http://artifacts.test",
        secret: "draft-secret",
        now: 1_700_000_000,
        upload: async (path: string) => {
          uploads.push(path);
          return null;
        },
        remove: async () => null,
      },
    );
    expect(out.type).toBe("preview");
    if (out.type !== "preview") return;
    expect(out.version).toBe(2);
    expect(rpc.map((call) => call.fn)).toEqual(["library_add_version"]);
    expect(uploads).toEqual(["bundles/solar-system-simulator/2/index.html"]);
    const stored = rpc[0]!.args.p_manifest as { id: string; title: string };
    expect(stored.id).toBe("solar-system-simulator");
    expect(stored.title).toBe("Solar System Updated");
  });
});

function historyRow(version: number, status: "draft" | "testing" | "published" | "retired"): LibraryArtifactVersionRow {
  return {
    artifact_id: "solar-system-simulator",
    version,
    manifest: { id: "solar-system-simulator", title: "Solar System Simulator", version },
    entry_file: "index.html",
    files: [{ path: version === 2 ? "scene.html" : "index.html", size: 20, sha256: "a".repeat(64), mime: "text/html" }],
    bundle_sha256: "b".repeat(64),
    status,
    validation_report: null,
    compliance_level: 3,
    created_by: ACTOR,
    created_at: "2026-10-22T00:00:00Z",
    published_at: status === "published" || status === "retired" ? "2026-10-22T12:00:00Z" : null,
    published_by: null,
    retired_at: status === "retired" ? "2026-10-23T00:00:00Z" : null,
  };
}

function retireDb(rows: LibraryArtifactVersionRow[], currentVersion: number | null) {
  const rpc: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return builder;
        },
        maybeSingle: async () => {
          if (table !== "library_artifact_versions") return { data: null, error: null };
          const version = filters.find(([col]) => col === "version")?.[1];
          const id = filters.find(([col]) => col === "artifact_id")?.[1];
          return { data: rows.find((row) => row.artifact_id === id && row.version === version) ?? null, error: null };
        },
      };
      return builder;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpc.push({ fn, args });
      return { data: { status: "retired", current_version: currentVersion }, error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, rpc };
}

describe("version history", () => {
  it("shows a parent nothing and returns every version to staff, oldest first", async () => {
    const rows = [historyRow(3, "draft"), historyRow(1, "retired"), historyRow(2, "published")];
    const parent = listDb(rows);
    expect(await historyForStudio("parent", parent.db, "solar-system-simulator")).toEqual({ type: "not-found" });
    expect(parent.calls()).toBe(0);

    const staff = await historyForStudio("staff", listDb(rows).db, "solar-system-simulator");
    expect(staff.type).toBe("history");
    if (staff.type !== "history") return;
    expect(staff.versions.map((row) => [row.version, row.status, row.published_at, row.manifest, row.files.map((file) => file.path)])).toEqual([
      [1, "retired", "2026-10-22T12:00:00Z", rows[1]!.manifest, ["index.html"]],
      [2, "published", "2026-10-22T12:00:00Z", rows[2]!.manifest, ["scene.html"]],
      [3, "draft", null, rows[0]!.manifest, ["index.html"]],
    ]);
    expect(await historyForStudio("staff", listDb([]).db, "missing-artifact")).toEqual({ type: "not-found" });
  });

  it("retires a published version and leaves the newest remaining published version offered", async () => {
    const staff = retireDb([historyRow(1, "published"), historyRow(2, "published")], 1);
    expect(await retireForStudio("staff", staff.db, "solar-system-simulator", 2, ACTOR)).toEqual({
      type: "retired",
      artifactId: "solar-system-simulator",
      version: 2,
      currentVersion: 1,
    });
    expect(staff.rpc).toEqual([
      {
        fn: "library_set_status",
        args: { p_artifact_id: "solar-system-simulator", p_version: 2, p_status: "retired", p_actor: ACTOR },
      },
    ]);

    const only = retireDb([historyRow(1, "published")], null);
    expect(await retireForStudio("staff", only.db, "solar-system-simulator", 1, ACTOR)).toEqual({
      type: "retired",
      artifactId: "solar-system-simulator",
      version: 1,
      currentVersion: null,
    });
  });

  it("refuses a parent, a draft, and a version that is already retired", async () => {
    const parent = retireDb([historyRow(1, "published")], null);
    expect(await retireForStudio("parent", parent.db, "solar-system-simulator", 1, ACTOR)).toEqual({ type: "not-found" });
    expect(parent.rpc).toHaveLength(0);

    const draft = retireDb([historyRow(1, "draft")], null);
    const refused = await retireForStudio("staff", draft.db, "solar-system-simulator", 1, ACTOR);
    expect(refused.type).toBe("refused");
    expect(draft.rpc).toHaveLength(0);

    const retired = retireDb([historyRow(1, "retired")], null);
    expect((await retireForStudio("staff", retired.db, "solar-system-simulator", 1, ACTOR)).type).toBe("refused");
    expect(retired.rpc).toHaveLength(0);
  });
});

const OTHER = "00000000-0000-4000-8000-000000000002";
const NEW_STAFF = "00000000-0000-4000-8000-000000000003";

function staffDirectory(people: { userId: string; email: string }[]) {
  const created: { email: string; password: string; emailConfirm: true }[] = [];
  const deletedSignIns: string[] = [];
  const inserted: string[] = [];
  const removed: string[] = [];
  let createError: string | null = null;
  let insertError: string | null = null;
  const deps = {
    list: async () => ({ ok: true as const, staff: people.map((person) => ({ ...person })) }),
    createSignIn: async (input: { email: string; password: string; emailConfirm: true }) => {
      created.push(input);
      return createError ? { ok: false as const, message: createError } : { ok: true as const, userId: NEW_STAFF };
    },
    deleteSignIn: async (userId: string) => {
      deletedSignIns.push(userId);
    },
    insertStaff: async (userId: string) => {
      inserted.push(userId);
      if (insertError) return { ok: false as const, message: insertError };
      return { ok: true as const };
    },
    deleteStaff: async (userId: string) => {
      removed.push(userId);
      return { ok: true as const, removed: true };
    },
  };
  return {
    deps,
    created,
    deletedSignIns,
    inserted,
    removed,
    failCreate: (message: string) => {
      createError = message;
    },
    failInsert: (message: string) => {
      insertError = message;
    },
  };
}

describe("staff", () => {
  it("shows the staff screen to staff only", async () => {
    const directory = staffDirectory([{ userId: ACTOR, email: "ada@example.com" }]);
    expect(await listStaff("parent", directory.deps)).toEqual({ type: "not-found" });
    expect(await listStaff("child", directory.deps)).toEqual({ type: "not-found" });
    expect(await listStaff("signed-out", directory.deps)).toEqual({ type: "redirect", to: "/login?next=%2Fstudio%2Fstaff" });
    expect(await grantStaff("parent", { email: "new@example.com", password: "long-enough" }, directory.deps)).toEqual({ type: "not-found" });
    expect(await removeStaff("child", ACTOR, directory.deps)).toEqual({ type: "not-found" });
    expect(directory.created).toEqual([]);
    expect(directory.removed).toEqual([]);
    expect(await listStaff("staff", directory.deps)).toEqual({ type: "list", staff: [{ userId: ACTOR, email: "ada@example.com" }] });
  });

  it("creates a sign-in with no learner and no child login, then records staff", async () => {
    const directory = staffDirectory([{ userId: ACTOR, email: "ada@example.com" }]);
    expect(await grantStaff("staff", { email: "  new@example.com ", password: "long-enough" }, directory.deps)).toEqual({
      type: "granted",
      userId: NEW_STAFF,
      email: "new@example.com",
    });
    expect(directory.created).toEqual([{ email: "new@example.com", password: "long-enough", emailConfirm: true }]);
    expect(directory.inserted).toEqual([NEW_STAFF]);
    expect(directory.deletedSignIns).toEqual([]);

    const invalid = staffDirectory([]);
    expect((await grantStaff("staff", { email: "not-an-email", password: "long-enough" }, invalid.deps)).type).toBe("refused");
    expect((await grantStaff("staff", { email: "new@example.com", password: "short" }, invalid.deps)).type).toBe("refused");
    expect(invalid.created).toEqual([]);

    const taken = staffDirectory([]);
    taken.failCreate("A user with this email address has already been registered");
    expect(await grantStaff("staff", { email: "ada@example.com", password: "long-enough" }, taken.deps)).toEqual({
      type: "refused",
      problems: ["A user with this email address has already been registered"],
    });
    expect(taken.inserted).toEqual([]);

    const rollback = staffDirectory([]);
    rollback.failInsert("staff row was not saved");
    expect(await grantStaff("staff", { email: "new@example.com", password: "long-enough" }, rollback.deps)).toEqual({
      type: "unavailable",
      problems: ["staff row was not saved"],
    });
    expect(rollback.deletedSignIns).toEqual([NEW_STAFF]);
  });

  it("removes a staff member and refuses to remove the last one", async () => {
    const two = staffDirectory([
      { userId: ACTOR, email: "ada@example.com" },
      { userId: OTHER, email: "grace@example.com" },
    ]);
    expect(await removeStaff("staff", OTHER, two.deps)).toEqual({ type: "removed", userId: OTHER });
    expect(two.removed).toEqual([OTHER]);

    const last = staffDirectory([{ userId: ACTOR, email: "ada@example.com" }]);
    expect(await removeStaff("staff", ACTOR, last.deps)).toEqual({
      type: "refused",
      problems: ["The last staff member cannot be removed."],
    });
    expect(last.removed).toEqual([]);

    const stranger = staffDirectory([{ userId: ACTOR, email: "ada@example.com" }, { userId: OTHER, email: "grace@example.com" }]);
    expect(await removeStaff("staff", NEW_STAFF, stranger.deps)).toEqual({
      type: "refused",
      problems: ["That person is not staff."],
    });
    expect(stranger.removed).toEqual([]);

    const lost = staffDirectory([
      { userId: ACTOR, email: "ada@example.com" },
      { userId: OTHER, email: "grace@example.com" },
    ]);
    lost.deps.deleteStaff = async (userId: string) => {
      lost.removed.push(userId);
      return { ok: true, removed: false };
    };
    expect(await removeStaff("staff", OTHER, lost.deps)).toEqual({
      type: "refused",
      problems: ["The last staff member cannot be removed."],
    });
    expect(lost.removed).toEqual([OTHER]);
  });
});
