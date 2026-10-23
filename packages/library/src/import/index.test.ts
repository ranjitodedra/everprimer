import { describe, expect, it } from "vitest";
import { solarSystemManifest } from "@eco/contracts/testing";
import type { SupabaseClient } from "@supabase/supabase-js";
import { importArtifact } from "./index";
import { registerDraft } from "../catalog";

const ENTRY_HTML = `<!doctype html>
<html>
<head><meta name="viewport" content="width=device-width"></head>
<body>
  <h1>Solar System</h1>
  <script type="module">
    import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";
    try { localStorage.getItem("x"); } catch (e) {}
    const scene = new THREE.Scene();
    window.addEventListener("pointerdown", () => {
      ArtifactKit.emit("planet_selected", { planet: "earth" });
      ArtifactKit.emit("orbit_comparison_completed", { inner: "earth", outer: "mars", seconds: 2 });
    });
    // prefers-reduced-motion handling
  </script>
</body>
</html>`;

describe("importArtifact", () => {
  it("imports a well-formed HTML artifact and produces a bundle registerDraft can accept", async () => {
    const r = await importArtifact({ kind: "html", source: ENTRY_HTML }, { manifest: solarSystemManifest(), actor: null });
    if (!r.ok) {
      throw new Error(`unexpected errors: ${JSON.stringify(r.errors, null, 2)}`);
    }
    expect(r.normalized!.files.map((f) => f.path)).toEqual(["index.html"]);
    expect(r.normalized!.files[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.normalized!.bundleSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.normalized!.changes.some((c) => c.rule === "jsdelivr")).toBe(true);

    // Feed into registerDraft with a mocked client.
    const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const db = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return { data: 1, error: null };
      },
    } as unknown as SupabaseClient;
    const draft = await registerDraft(db, {
      manifest: r.normalized!.manifest,
      files: r.normalized!.files,
      bundleSha256: r.normalized!.bundleSha256,
      actor: null,
    });
    expect(draft).toEqual({ ok: true, artifactId: "solar-system-simulator", version: 1 });
    expect(rpcCalls[0]!.fn).toBe("library_register_draft");
  });

  it("produces the same bundleSha256 when the same input is imported twice", async () => {
    const a = await importArtifact({ kind: "html", source: ENTRY_HTML }, { manifest: solarSystemManifest(), actor: null });
    const b = await importArtifact({ kind: "html", source: ENTRY_HTML }, { manifest: solarSystemManifest(), actor: null });
    if (!a.ok || !b.ok) throw new Error("expected both to succeed");
    expect(a.normalized!.bundleSha256).toBe(b.normalized!.bundleSha256);
  });

  it("rejects a bundle that pulls in an unknown library", async () => {
    const html = `<!doctype html><html><body><script src="https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js"></script></body></html>`;
    const r = await importArtifact({ kind: "html", source: html }, { manifest: solarSystemManifest(), actor: null });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "unknown-library")).toBe(true);
  });

  it("rejects an invalid manifest without ever unpacking", async () => {
    const bad = { ...solarSystemManifest(), events: "nope" };
    const r = await importArtifact({ kind: "html", source: ENTRY_HTML }, { manifest: bad as unknown, actor: null });
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe("manifest-schema");
  });

  it("produces a warning (not an error) for stripped Google Fonts", async () => {
    const html = ENTRY_HTML.replace(
      "<head>",
      `<head><link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Nunito">`,
    );
    const r = await importArtifact({ kind: "html", source: html }, { manifest: solarSystemManifest(), actor: null });
    if (!r.ok) throw new Error(`unexpected errors: ${JSON.stringify(r.errors)}`);
    expect(r.warnings.some((w) => w.code === "google-fonts-stripped")).toBe(true);
  });
});
