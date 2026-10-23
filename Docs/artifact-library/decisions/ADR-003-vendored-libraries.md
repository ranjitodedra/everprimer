# ADR-003: Vendored third-party libraries and CDN rewriting

Status: accepted. Date: 2026-10-21.
Evidence: [evidence/stage-0/samples/](evidence/stage-0/samples/) (original AI output),
[scan-samples.mjs](evidence/stage-0/scan-samples.mjs), [rewrite-samples.mjs](evidence/stage-0/rewrite-samples.mjs).

## Context

D3 says artifacts never load code from CDNs. Instead, the importer rewrites
known CDN URLs to pinned copies served from the artifact origin. To learn what
real output looks like, Stage 0 collected five artifacts from Claude Opus 5.5
and Gemini 4 Argon. Each model ran as a Cursor subagent with a plain request a
user would paste ("build an interactive 3D solar system for kids… as a single
HTML file"), with no hint about our rules. The prompts are in the appendix.
Ranjit should add outputs from his own chat tools to `samples/` and rerun
`node scan-samples.mjs`.

## What the models produced

| Sample | Model | Files | How libraries load | Other external requests |
| --- | --- | --- | --- | --- |
| `opus-solar-single` | Opus 5.5 | 1 HTML, 68 KB | import map: `three` → jsDelivr `three@0.160.0/build/three.module.js`, `three/addons/` → `…/examples/jsm/` | Google Fonts |
| `gemini-solar-single` | Gemini 4 Argon | 1 HTML, 50 KB | the same import map, `three@0.160.0` | Google Fonts |
| `gemini-cell-multi` | Gemini 4 Argon | 5 files (HTML, CSS, 3 ES modules) | import map to jsDelivr `three@0.170.0` plus addons; local `./js/*.js` modules | Google Fonts |
| `gemini-lever-single` | Gemini 4 Argon | 1 HTML, 42 KB | classic `<script src>`: cdnjs `matter-js/0.19.0/matter.min.js`, cdnjs `gsap/3.12.5/gsap.min.js`, jsDelivr `canvas-confetti@1.9.2/dist/confetti.browser.min.js` | Google Fonts |
| `opus-circuit-multi` | Opus 5.5 | 7 files | no libraries: local `<script defer>` files, SVG, Web Audio | none |

What the five samples had in common:

- Every library URL was pinned to an exact version. Nothing used `@latest`,
  an unversioned URL, `esm.sh`, or `skypack`.
- Two versions of `three` showed up (`0.160.0` and `0.170.0`).
- None used `fetch`, XHR, WebSocket, `eval`, or `window.parent` or `window.top`.
- One used `localStorage`, always inside `try`. It survives the sandbox's
  `SecurityError`; unwrapped access would crash.
- Four of five loaded Google Fonts. D3 did not cover this case.

## Rewrite test

`rewrite-samples.mjs` applied the rules below to all five samples. Every
sample then ran inside the real sandbox (nested frame, ADR-001 headers) in
Chromium and WebKit **with zero errors**. The only console line was a blocked
`autofocus` in the circuit sample, which is harmless. See
`sample-gemini-cell-webkit.png` and `sample-gemini-lever-chromium.png`.

## Decision

### Layout on the artifact origin

`/v/{package}@{exact-version}/{path}` uses **the npm package's own file
layout**. jsDelivr and unpkg URLs then map one-to-one, and the vendored copy
can be checked against the npm tarball's integrity hash.

### Rewrite rules (Stage 3 importer)

| Input | Rewrite |
| --- | --- |
| `https://cdn.jsdelivr.net/npm/{pkg}@{x.y.z}/{path}` | `/v/{pkg}@{x.y.z}/{path}` |
| `https://unpkg.com/{pkg}@{x.y.z}/{path}` | `/v/{pkg}@{x.y.z}/{path}` |
| `https://cdnjs.cloudflare.com/ajax/libs/{pkg}/{x.y.z}/{file}` | per-library file map, because cdnjs does not mirror npm layout (`matter.min.js` → `build/matter.min.js`, `gsap.min.js` → `dist/gsap.min.js`) |
| Import map values | the same rules, applied to each value (prefix mappings like `three/addons/` included) |
| A bare `import "three"` with no import map | inject an import map that points at the allowlisted version, then warn |
| `{file}.min.js` missing from the package | serve `{file}.js`. jsDelivr minifies on the fly, so `canvas-confetti@1.9.2/dist/confetti.browser.min.js` does not exist in the tarball |
| Google Fonts `<link>` / `@import` (`fonts.googleapis.com`, `fonts.gstatic.com`) | remove and **warn**. Text falls back to the CSS stack. Later, vendor a few OFL families under `/v/fonts/` (Fredoka, Nunito, and Plus Jakarta Sans appeared) and rewrite to them |
| Anything else external: other hosts, `@latest`, a missing or partial version, `esm.sh`, `skypack` | **reject** with an actionable message, for example: "`cannon-es@0.20.0` is not on the allowlist; bundle it locally or request it be added" |

### First allowlist

Only versions seen in real output, plus the masterplan defaults pinned the
first time they appear.

| Package | Version(s) | Files vendored | License |
| --- | --- | --- | --- |
| `three` | 0.160.0, 0.170.0 | `build/three.module.js` (plus `three.core.js` when present), `examples/jsm/**` | MIT |
| `matter-js` | 0.19.0 | `build/*` | MIT |
| `gsap` | 3.12.5 | `dist/*` | **GSAP "Standard No Charge" license, not MIT.** Needs legal review before Stage 13, which sells artifacts to other developers. GSAP's license terms changed in later releases; check before pinning a newer one. |
| `canvas-confetti` | 1.9.2 | `dist/*` | ISC |
| `d3`, `p5`, `chart.js`, `tone` | pin on first use | | check each |

About 1.4 MB per `three` version (the module build plus controls). Several
versions are fine, because files are content-addressed and cached immutably.

### Lock list

Stage 3 keeps `packages/library/vendor/lock.json` with one entry per
`{package, version, license, tarball integrity, files[]}`. The manifest's
`rendering.tech` uses the same `{package}@{x.y.z}` strings. That is why the
Stage 1 manifest schema requires exact versions.

## Consequences for later stages

- Stage 1: `rendering.tech` entries must be `name@x.y.z`, and every one needs
  a `license.thirdParty` entry.
- Stage 3: implement the rules above. The five samples in
  `evidence/stage-0/samples/` are the first import fixtures. All five must
  import cleanly (with font warnings).
- Stage 3 validator: warn on `localStorage`, `sessionStorage`, or `indexedDB`
  access outside a `try`. Don't count blocked `autofocus` as an error.
- Stage 7 authoring brief: ask for no web fonts (or only the vendored ones),
  exact library versions from the allowlist, storage wrapped in `try`, and a
  layout that fills the iframe.

## Appendix: prompts used

1. Solar system, single file (Opus 5.5 and Gemini 4 Argon): "Build an
   interactive 3D solar system simulator for kids aged 8-12 using Three.js, as
   a single self-contained HTML file I can open in a browser. Kids should be
   able to rotate the view, tap a planet to see facts about it, and change the
   orbit speed with a slider. Make it look polished and work on phones."
2. Circuit, multi-file (Opus 5.5): "Make a simple electric circuit simulator
   for kids aged 8-11 as a small web project with separate files (index.html,
   a CSS file, and JavaScript files). Kids drag a battery, wires, a switch and
   bulbs onto a board; when the circuit is closed the bulbs light up and
   electrons flow along the wire. Use whatever libraries you think are best.
   It must work on tablets with touch."
3. Cell explorer, multi-file (Gemini 4 Argon): "Create a 3D animal cell
   explorer for kids aged 10-13 as a small web project with multiple files
   (HTML, CSS, JS modules). Kids can orbit around a 3D cell, tap organelles
   (nucleus, mitochondria, ribosomes, cell membrane, etc.) to highlight them
   and read what they do, and toggle labels. Use Three.js and any helpers you
   like. Make it look great and run smoothly on phones."
4. Lever, single file (Gemini 4 Argon): "Make an interactive 2D physics
   playground that teaches levers to kids aged 8-11, as a single HTML file.
   Kids can move the fulcrum, drop weights of different sizes on either side
   of a see-saw plank, and see it balance or tip, with a readout that explains
   why. Use a physics library and animations so it feels fun. Must work on
   phones."
