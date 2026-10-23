/**
 * Negative fixtures: known-bad inputs the importer must reject with a specific,
 * actionable message. Keeps the regression surface honest: if the error text
 * changes, authors notice before Studio users do.
 */

import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { solarSystemManifest } from "@eco/contracts/testing";
import { importArtifact } from "./index";
import { MAX_FILE_COUNT, MAX_FILE_KB } from "./unpack";

function manifest(entry = "index.html") {
  return { ...solarSystemManifest(), entry };
}

function pngBytes(size = 10): Uint8Array {
  const b = new Uint8Array(size);
  b[0] = 0x89;
  b[1] = 0x50;
  b[2] = 0x4e;
  b[3] = 0x47;
  return b;
}

describe("negative fixtures", () => {
  it("zip-slip path is rejected", async () => {
    const bytes = zipSync({ "../evil.html": new TextEncoder().encode("<html></html>") });
    const r = await importArtifact({ kind: "zip", bytes }, { manifest: manifest() });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "unsafe-path")).toBe(true);
  });

  it("per-file cap is enforced", async () => {
    const big = pngBytes(MAX_FILE_KB * 1024 + 1);
    const bytes = zipSync({ "big.png": big });
    const r = await importArtifact({ kind: "zip", bytes }, { manifest: manifest() });
    expect(r.errors.some((e) => e.code === "file-too-big")).toBe(true);
  });

  it("too many files is rejected", async () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i <= MAX_FILE_COUNT; i++) entries[`a${i}.js`] = new TextEncoder().encode("var x=1;");
    const bytes = zipSync(entries);
    const r = await importArtifact({ kind: "zip", bytes }, { manifest: manifest() });
    expect(r.errors.some((e) => e.code === "too-many-files")).toBe(true);
  });

  it("disallowed extension is rejected", async () => {
    const bytes = zipSync({
      "index.html": new TextEncoder().encode("<html></html>"),
      "evil.exe": new Uint8Array([0x4d, 0x5a, 0, 0]),
    });
    const r = await importArtifact({ kind: "zip", bytes }, { manifest: manifest() });
    expect(r.errors.some((e) => e.code === "bad-mime")).toBe(true);
  });

  it("@latest import is rejected", async () => {
    const html = `<script src="https://cdn.jsdelivr.net/npm/three@latest/build/three.module.js"></script>`;
    const r = await importArtifact({ kind: "html", source: html }, { manifest: manifest() });
    expect(r.errors.some((e) => e.code === "forbidden-cdn")).toBe(true);
  });

  it("bare `import three` without an import map is rejected", async () => {
    const html = `<!doctype html><html><body><script type="module">import * as T from "three";</script></body></html>`;
    const r = await importArtifact({ kind: "html", source: html }, { manifest: manifest() });
    expect(r.errors.some((e) => e.code === "bare-import")).toBe(true);
  });

  it("fetch to an external host is rejected", async () => {
    const html = `<!doctype html><html><body><img src="https://evil.example.com/x.png"></body></html>`;
    const r = await importArtifact({ kind: "html", source: html }, { manifest: manifest() });
    expect(r.errors.some((e) => e.message.includes("external resources"))).toBe(true);
  });

  it("window.top access is rejected", async () => {
    const html = `<!doctype html><html><body><script>window.top.location = "/x";</script></body></html>`;
    const r = await importArtifact({ kind: "html", source: html }, { manifest: manifest() });
    expect(r.errors.some((e) => e.message.includes("host window"))).toBe(true);
  });

  it("eval() is rejected", async () => {
    const html = `<!doctype html><html><body><script>eval("1 + 1");</script></body></html>`;
    const r = await importArtifact({ kind: "html", source: html }, { manifest: manifest() });
    expect(r.errors.some((e) => e.message.includes("eval"))).toBe(true);
  });

  it("missing entry file is rejected", async () => {
    const html = `<!doctype html><html><body></body></html>`;
    const r = await importArtifact({ kind: "html", source: html }, { manifest: manifest("other.html") });
    expect(r.errors.some((e) => e.code === "missing-entry")).toBe(true);
  });

  it("malformed manifest never reaches unpack", async () => {
    const r = await importArtifact({ kind: "html", source: `<html></html>` }, { manifest: {} });
    expect(r.errors[0]?.code).toBe("manifest-schema");
  });
});
