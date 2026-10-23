import { describe, expect, it } from "vitest";
import { VENDOR_PATH_PREFIX, rewriteSource } from "./rewrite";

describe("rewriteSource — jsdelivr/unpkg", () => {
  it("rewrites allowlisted jsdelivr script URLs", () => {
    const html = `<script type="module">import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";</script>`;
    const r = rewriteSource("index.html", html);
    expect(r.errors).toEqual([]);
    expect(r.text).toContain(`${VENDOR_PATH_PREFIX}/three@0.170.0/build/three.module.js`);
    expect(r.changes[0]!.rule).toBe("jsdelivr");
  });

  it("rewrites allowlisted unpkg URLs", () => {
    const html = `<script src="https://unpkg.com/matter-js@0.19.0/build/matter.min.js"></script>`;
    const r = rewriteSource("index.html", html);
    expect(r.errors).toEqual([]);
    expect(r.text).toContain(`${VENDOR_PATH_PREFIX}/matter-js@0.19.0/build/matter.min.js`);
  });

  it("rejects a package not on the allowlist", () => {
    const html = `<script src="https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js"></script>`;
    const r = rewriteSource("index.html", html);
    expect(r.errors[0]?.code).toBe("unknown-library");
    expect(r.errors[0]?.message).toMatch(/cannon-es@0\.20\.0 is not on the allowlist/);
  });

  it("falls back to a non-min sibling when the min file isn't vendored", () => {
    // canvas-confetti@1.9.2 lists both files; prove the alias mechanism works for a case jsDelivr minifies.
    const html = `<script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js"></script>`;
    const r = rewriteSource("index.html", html);
    expect(r.errors).toEqual([]);
    expect(r.text).toContain(`${VENDOR_PATH_PREFIX}/canvas-confetti@1.9.2/dist/confetti.browser.min.js`);
  });
});

describe("rewriteSource — cdnjs", () => {
  it("maps cdnjs paths back to the npm layout", () => {
    const html = `<script src="https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js"></script><script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>`;
    const r = rewriteSource("index.html", html);
    expect(r.errors).toEqual([]);
    expect(r.text).toContain(`${VENDOR_PATH_PREFIX}/matter-js@0.19.0/build/matter.min.js`);
    expect(r.text).toContain(`${VENDOR_PATH_PREFIX}/gsap@3.12.5/dist/gsap.min.js`);
  });

  it("rejects a cdnjs file that isn't mapped", () => {
    const html = `<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/mystery.js"></script>`;
    const r = rewriteSource("index.html", html);
    expect(r.errors[0]?.code).toBe("unknown-library-file");
  });
});

describe("rewriteSource — import maps", () => {
  it("rewrites values inside an importmap", () => {
    const html = `<script type="importmap">{
      "imports": {
        "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
        "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
      }
    }</script>`;
    const r = rewriteSource("index.html", html);
    expect(r.errors).toEqual([]);
    expect(r.text).toContain(`${VENDOR_PATH_PREFIX}/three@0.170.0/build/three.module.js`);
    expect(r.text).toContain(`${VENDOR_PATH_PREFIX}/three@0.170.0/examples/jsm/`);
  });

  it("satisfies a bare import when the import map covers it", () => {
    const html = `<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"}}</script><script type="module">import * as T from "three";</script>`;
    const r = rewriteSource("index.html", html);
    expect(r.errors).toEqual([]);
  });

  it("rejects a bare import that has no import map", () => {
    const html = `<script type="module">import * as T from "three";</script>`;
    const r = rewriteSource("index.html", html);
    expect(r.errors.some((e) => e.code === "bare-import")).toBe(true);
  });
});

describe("rewriteSource — google fonts and forbidden CDNs", () => {
  it("strips google fonts links, preconnects, and @import, and warns", () => {
    const html = `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css?family=Nunito" rel="stylesheet"><style>@import url("https://fonts.googleapis.com/css?family=Fredoka");</style>`;
    const r = rewriteSource("index.html", html);
    expect(r.text).not.toContain("fonts.googleapis.com");
    expect(r.warnings.some((w) => w.code === "google-fonts-stripped")).toBe(true);
  });

  it("rejects @latest, partial versions, and other CDN hosts", () => {
    const html1 = `<script src="https://cdn.jsdelivr.net/npm/three@latest/build/three.module.js"></script>`;
    const html2 = `<script src="https://unpkg.com/three@0/build/three.module.js"></script>`;
    const html3 = `<script type="module">import * as t from "https://esm.sh/three@0.170.0";</script>`;
    expect(rewriteSource("a.html", html1).errors.some((e) => e.code === "forbidden-cdn")).toBe(true);
    expect(rewriteSource("b.html", html2).errors.some((e) => e.code === "forbidden-cdn")).toBe(true);
    expect(rewriteSource("c.html", html3).errors.some((e) => e.code === "forbidden-cdn")).toBe(true);
  });
});
