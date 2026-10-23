import { describe, expect, it } from "vitest";
import { solarSystemManifest } from "@eco/contracts/testing";
import { validateLibraryBundle } from "./validate";
import type { InMemoryFile } from "./types";

function fileOf(path: string, text: string): InMemoryFile {
  return { path, bytes: new TextEncoder().encode(text), mime: "text/html" };
}

describe("validateLibraryBundle", () => {
  const manifest = solarSystemManifest();
  const ok = `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><script>window.ArtifactKit && window.ArtifactKit.emit("planet_selected", { planet: "earth" });</script></body></html>`;

  it("passes a minimal valid bundle and reports callsEmit", () => {
    const r = validateLibraryBundle({ manifest, files: [fileOf("index.html", ok)], entryHtml: ok });
    expect(r.errors).toEqual([]);
    expect(r.callsEmit).toBe(true);
  });

  it("flags a missing entry file", () => {
    const r = validateLibraryBundle({ manifest, files: [fileOf("other.html", ok)], entryHtml: ok });
    expect(r.errors[0]?.code).toBe("missing-entry");
  });

  it("flags iframe, parent-window access, and bad syntax", () => {
    const bad = `<!doctype html><html><body><iframe src="/x"></iframe><script>window.top.location</script><script>var x = \`\${var(--y)}\`;</script></body></html>`;
    const r = validateLibraryBundle({ manifest, files: [fileOf(manifest.entry, bad)], entryHtml: bad });
    const codes = r.errors.map((e) => e.message);
    expect(codes.join(" ")).toMatch(/nested iframes/);
    expect(codes.join(" ")).toMatch(/host window/);
    expect(codes.join(" ")).toMatch(/syntax error/);
  });

  it("flags a reference to a file not in the bundle", () => {
    const html = `<!doctype html><html><body><img src="art/missing.png"></body></html>`;
    const r = validateLibraryBundle({ manifest, files: [fileOf(manifest.entry, html)], entryHtml: html });
    expect(r.errors.some((e) => e.code === "missing-local-file")).toBe(true);
  });

  it("accepts a reference to a vendored path and to a sibling bundle file", () => {
    const html = `<!doctype html><html><body><script src="/v/three@0.170.0/build/three.module.js"></script><img src="art/photo.png"></body></html>`;
    const r = validateLibraryBundle({
      manifest,
      files: [fileOf(manifest.entry, html), { path: "art/photo.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mime: "image/png" }],
      entryHtml: html,
    });
    expect(r.errors).toEqual([]);
  });

  it("flags window.open and eval", () => {
    const html = `<!doctype html><html><body><script>window.open('/x'); eval('x');</script></body></html>`;
    const r = validateLibraryBundle({ manifest, files: [fileOf(manifest.entry, html)], entryHtml: html });
    const messages = r.errors.map((e) => e.message).join(" ");
    expect(messages).toMatch(/window\.open/);
    expect(messages).toMatch(/eval/);
  });

  it("warns on unguarded localStorage access", () => {
    const html = `<!doctype html><html><body><script>var v = localStorage.getItem('x');</script></body></html>`;
    const r = validateLibraryBundle({ manifest, files: [fileOf(manifest.entry, html)], entryHtml: html });
    expect(r.warnings.some((w) => w.code === "unguarded-storage")).toBe(true);
  });

  it("does not warn when storage is wrapped in try/catch", () => {
    const html = `<!doctype html><html><body><script>try { localStorage.getItem('x'); } catch (e) {}</script></body></html>`;
    const r = validateLibraryBundle({ manifest, files: [fileOf(manifest.entry, html)], entryHtml: html });
    expect(r.warnings.some((w) => w.code === "unguarded-storage")).toBe(false);
  });
});
