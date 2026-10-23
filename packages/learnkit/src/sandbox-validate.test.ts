import { describe, expect, it } from "vitest";
import {
  checkInlineScriptSyntax,
  checkSandboxBasics,
  extractInlineScripts,
  scriptSyntaxError,
} from "./sandbox-validate";

describe("extractInlineScripts", () => {
  it("skips scripts with src and returns bodies", () => {
    const html = `<script src="/a.js"></script><script>var a=1;</script><script>  </script>`;
    expect(extractInlineScripts(html)).toEqual(["var a=1;"]);
  });

  it("strips declared sources before extracting", () => {
    const runtime = "/*rt*/";
    const html = `<script>${runtime}var a=1;</script>`;
    expect(extractInlineScripts(html, [runtime])).toEqual(["var a=1;"]);
  });
});

describe("scriptSyntaxError", () => {
  it("returns null for valid JS", () => {
    expect(scriptSyntaxError("var a=1;")).toBeNull();
  });
  it("returns a message for a syntax error", () => {
    expect(scriptSyntaxError('var x = `${var(--y)}`;')).toMatch(/./);
  });
});

describe("checkSandboxBasics", () => {
  it("accepts a complete minimal document", () => {
    const errors: string[] = [];
    checkSandboxBasics(`<!doctype html><html><head></head><body></body></html>`, errors);
    expect(errors).toEqual([]);
  });

  it("flags missing html wrapper", () => {
    const errors: string[] = [];
    checkSandboxBasics(`<body>hi</body>`, errors);
    expect(errors.join(" ")).toMatch(/complete <html>/);
  });

  it("flags external resources, iframes, and parent access", () => {
    const errors: string[] = [];
    const html = `<html><body><iframe src="/x"></iframe><img src="https://x/y.png"><script>window.top.location</script></body></html>`;
    checkSandboxBasics(html, errors);
    expect(errors.join(" ")).toMatch(/external resources/);
    expect(errors.join(" ")).toMatch(/nested iframes/);
    expect(errors.join(" ")).toMatch(/host window/);
  });

  it("options turn individual checks off", () => {
    const errors: string[] = [];
    checkSandboxBasics(`<img src="https://x/y.png">`, errors, {
      requireFullDocument: false,
      rejectExternalResources: false,
    });
    expect(errors).toEqual([]);
  });
});

describe("checkInlineScriptSyntax", () => {
  it("records a numbered error per bad script", () => {
    const errors: string[] = [];
    checkInlineScriptSyntax(`<script>var a=1;</script><script>var x = \`\${var(--y)}\`;</script>`, errors);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/authored script 2 has a JavaScript syntax error/);
  });
});
