import { describe, expect, it } from "vitest";
import { ARTIFACTKIT_RUNTIME_SOURCE } from "../runtime";
import { injectArtifactKit } from "./inject";

describe("injectArtifactKit", () => {
  it("ensures doctype, html, head, viewport, and the runtime", () => {
    const out = injectArtifactKit(`<body><h1>hi</h1></body>`);
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain("<html");
    expect(out).toContain("<head");
    expect(out).toContain('name="viewport"');
    expect(out).toContain(ARTIFACTKIT_RUNTIME_SOURCE);
  });

  it("places the runtime as the first script", () => {
    const out = injectArtifactKit(`<!doctype html><html><head></head><body><script>console.log(1)</script></body></html>`);
    const runtimeAt = out.indexOf(ARTIFACTKIT_RUNTIME_SOURCE);
    const consoleAt = out.indexOf("console.log(1)");
    expect(runtimeAt).toBeGreaterThanOrEqual(0);
    expect(runtimeAt).toBeLessThan(consoleAt);
  });

  it("strips author-written CSP metas", () => {
    const out = injectArtifactKit(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'"></head><body></body></html>`);
    expect(out).not.toContain("Content-Security-Policy");
  });

  it("strips author-written artifactkit script tags before injecting the real runtime", () => {
    const out = injectArtifactKit(`<!doctype html><html><head><script src="/artifactkit.js"></script></head><body></body></html>`);
    expect(out).not.toContain(`src="/artifactkit.js"`);
    expect(out).toContain(ARTIFACTKIT_RUNTIME_SOURCE);
  });

  it("keeps an author-provided viewport", () => {
    const out = injectArtifactKit(`<!doctype html><html><head><meta name="viewport" content="width=device-width,user-scalable=no"></head><body></body></html>`);
    expect(out).toContain("user-scalable=no");
    expect(out.match(/name=["']viewport["']/g)).toHaveLength(1);
  });

  it("is idempotent", () => {
    const once = injectArtifactKit(`<body></body>`);
    const twice = injectArtifactKit(once);
    expect(twice).toBe(once);
  });
});
