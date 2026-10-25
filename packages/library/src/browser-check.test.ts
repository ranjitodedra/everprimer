import { describe, expect, it } from "vitest";
import type { ArtifactManifest } from "@eco/contracts";
import { solarSystemManifest } from "../../contracts/src/testing";
import { ARTIFACTKIT_RUNTIME_SOURCE } from "./runtime";
import { runBrowserCheck } from "./browser-check";

const HASH = "ab".repeat(32);

function manifest(webgl: boolean): ArtifactManifest {
  const base = solarSystemManifest();
  return {
    ...base,
    format: "html",
    entry: "index.html",
    rendering: webgl ? { dimension: "3d", tech: ["three@0.170.0"], webgl: true } : { dimension: "2d", tech: [], webgl: false },
    license: webgl ? base.license : { artifact: "proprietary", thirdParty: [], attributions: [] },
    params: [{ key: "speed", type: "number", default: 1, description: "How fast the demo runs." }],
  };
}

function page(extra = ""): { path: string; bytes: Uint8Array; mime: string }[] {
  const html = `<!doctype html><html><head></head><body><h1>Hello</h1><script>${ARTIFACTKIT_RUNTIME_SOURCE}</script>${extra}</body></html>`;
  return [{ path: "index.html", bytes: new TextEncoder().encode(html), mime: "text/html" }];
}

describe("runBrowserCheck", () => {
  it("passes a page that becomes ready and returns a desktop thumbnail", async () => {
    const result = await runBrowserCheck({
      manifest: manifest(false),
      bundleSha256: HASH,
      files: page(),
      readyTimeoutMs: 3000,
    });

    expect(result.report.ok).toBe(true);
    expect(result.report.bundleSha256).toBe(HASH);
    expect(result.report.webgl).toBe(false);
    expect(result.report.params).toEqual({ speed: 1 });
    expect(result.report.viewports.map((viewport) => viewport.name)).toEqual(["phone", "desktop"]);
    expect(result.report.thumbnailPath).toBeNull();
    if (!result.thumbnail) throw new Error("expected a desktop thumbnail");
    expect(Array.from(result.thumbnail.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }, 30_000);

  it("fails a page that throws", async () => {
    const result = await runBrowserCheck({
      manifest: manifest(false),
      bundleSha256: HASH,
      files: page(`<script>document.addEventListener("DOMContentLoaded", function () { throw new Error("boom"); });</script>`),
      readyTimeoutMs: 3000,
    });
    expect(result.report.ok).toBe(false);
    expect(codes(result, "desktop")).toContain("uncaught_exception");
  }, 30_000);

  it("fails a page that never becomes ready", async () => {
    const result = await runBrowserCheck({
      manifest: manifest(false),
      bundleSha256: HASH,
      files: page(`<script src="hold.js"></script>`),
      holdPaths: ["hold.js"],
      readyTimeoutMs: 400,
    });
    expect(result.report.ok).toBe(false);
    expect(codes(result, "phone")).toContain("ready_timeout");
    expect(result.thumbnail).toBeNull();
  }, 20_000);

  it("fails a request to another host", async () => {
    const result = await runBrowserCheck({
      manifest: manifest(false),
      bundleSha256: HASH,
      files: page(`<script>fetch("https://example.com/nope").catch(function () {});</script>`),
      readyTimeoutMs: 3000,
    });
    expect(result.report.ok).toBe(false);
    expect(codes(result, "desktop")).toContain("foreign_request");
  }, 30_000);

  it("fails a missing file the page asks for", async () => {
    const result = await runBrowserCheck({
      manifest: manifest(false),
      bundleSha256: HASH,
      files: page(`<script src="missing.js"></script>`),
      readyTimeoutMs: 3000,
    });
    expect(result.report.ok).toBe(false);
    expect(codes(result, "desktop")).toContain("failed_request");
  }, 30_000);

  it("fails when a WebGL manifest never creates a context", async () => {
    const result = await runBrowserCheck({
      manifest: manifest(true),
      bundleSha256: HASH,
      files: page(),
      readyTimeoutMs: 3000,
    });
    expect(result.report.ok).toBe(false);
    expect(codes(result, "desktop")).toContain("missing_webgl");
  }, 30_000);

  it("passes when WebGL is created while the page is becoming ready", async () => {
    const result = await runBrowserCheck({
      manifest: manifest(true),
      bundleSha256: HASH,
      files: page(
        `<canvas id="c"></canvas><script>document.addEventListener("DOMContentLoaded", function () { var canvas = document.getElementById("c"); canvas.getContext("webgl") || canvas.getContext("webgl2"); });</script>`,
      ),
      readyTimeoutMs: 3000,
    });
    expect(result.report.ok).toBe(true);
    expect(result.report.viewports.every((viewport) => viewport.webglCreated)).toBe(true);
  }, 30_000);

  it("fails a fatal error and keeps a non-fatal one", async () => {
    const fatal = await runBrowserCheck({
      manifest: manifest(false),
      bundleSha256: HASH,
      files: page(`<script>document.addEventListener("DOMContentLoaded", function () { window.ArtifactKit.reportError("broken", { fatal: true }); });</script>`),
      readyTimeoutMs: 3000,
    });
    expect(fatal.report.ok).toBe(false);
    expect(codes(fatal, "desktop")).toContain("fatal_error");

    const noticed = await runBrowserCheck({
      manifest: manifest(false),
      bundleSha256: HASH,
      files: page(`<script>document.addEventListener("DOMContentLoaded", function () { window.ArtifactKit.reportError("notice", { fatal: false }); });</script>`),
      readyTimeoutMs: 3000,
    });
    expect(noticed.report.ok).toBe(true);
    expect(codes(noticed, "desktop")).toContain("ak_error");
  }, 30_000);

  it("passes blocked autofocus and a missing favicon", async () => {
    const result = await runBrowserCheck({
      manifest: manifest(false),
      bundleSha256: HASH,
      files: page(`<button autofocus>Go</button><script>fetch("/favicon.ico").catch(function () {});</script>`),
      readyTimeoutMs: 3000,
    });
    expect(result.report.ok).toBe(true);
    expect(codes(result, "desktop")).toContain("autofocus");
    expect(codes(result, "desktop")).toContain("favicon");
  }, 30_000);

  it("records a phone failure separately from the desktop viewport", async () => {
    const result = await runBrowserCheck({
      manifest: manifest(false),
      bundleSha256: HASH,
      files: page("<script>if (window.innerWidth < 700) console.error('narrow');</script>"),
      readyTimeoutMs: 3000,
    });
    expect(result.report.ok).toBe(false);
    expect(codes(result, "phone")).toContain("console_error");
    expect(codes(result, "desktop")).not.toContain("console_error");
  }, 30_000);
});

function codes(result: Awaited<ReturnType<typeof runBrowserCheck>>, viewport: "phone" | "desktop"): string[] {
  return result.report.viewports.find((item) => item.name === viewport)?.findings.map((finding) => finding.code) ?? [];
}
