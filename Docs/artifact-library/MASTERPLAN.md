# Everprimer Artifact Library — Masterplan

Status: draft for review. Nothing here is implemented yet.
Owner: Ranjit. Last updated: 2026-10-20.

This is the long-term plan for adding a reusable, searchable library of
high-quality interactive artifacts to Everprimer. It is a master roadmap, not an
implementation plan. Each stage below gets its own detailed plan, written just
before that stage is built, so later plans can use what earlier stages taught us.

---

## 1. The idea in one paragraph

Today every lesson is built by a cheap model, and the only "interactive" parts
are six built-in visual types drawn by the lesson player. Those have become
repetitive. Instead, I will make high-quality 2D and 3D interactive experiences
outside the app (Three.js simulations, animations, manipulable models) using
the strongest models I have (Claude Opus 5.5, Gemini 4 Argon, and others). I
paste or upload that finished code into Everprimer. Everprimer stores, checks,
previews, versions, catalogs, and serves it. When a lesson needs an interaction,
the lesson pipeline first searches the library and reuses a matching artifact.
If nothing fits, the lesson keeps today's behaviour. Each artifact also carries
structured notes for the future live audio tutor. Over time the library grows
to thousands of artifacts, lesson quality goes up, and the library can be sold
to other developers through an API.

## 2. Non-negotiable rules

These come straight from the decisions in the planning conversation. Every stage
plan must respect them.

1. **The library never generates artifacts.** Everprimer does not call an AI
   model to create, repair, or redesign library artifacts. I make them outside
   the app with my own model credits and import the finished code.
2. **Lookup is cheap and charges no generation credits.** Searching, retrieving,
   and rendering a library artifact must not run model generation and must not
   touch the parent credit/refund ledger.
3. **No match keeps today's behaviour.** If the library has no good match, the
   lesson uses its existing built-in visual. The library never silently starts
   generating something.
4. **Prefer a good fallback over a bad match.** Start with a strict match
   threshold. Reusing a vaguely related artifact is worse than the built-in
   visual.
5. **Only reviewed artifacts get published.** Every version goes draft →
   testing → published (→ retired). Nothing reaches a child without passing
   validation and my review.
6. **Published versions never change.** A lesson pins `artifactId@version`.
   Editing an artifact creates a new version; old lessons keep the old one.
7. **Imported code is untrusted.** It runs only in a sandboxed iframe on a
   separate, cookie-less origin. It never gets the app's cookies, tokens,
   storage, network access, or privileged `postMessage` channels. Security is
   never weakened to make a demo work.
8. **One repo, one backend.** The library lives in the existing pnpm monorepo,
   Next.js app, and Supabase project. No new repository, microservices, or
   separate vector database unless a stage proves it is needed.
9. **Design for the API from day one, ship it last.** Lesson code calls a
   library service (`searchArtifacts`, `getArtifact`, and so on), never the
   tables directly, so the same service can later sit behind `/api/v1/...`. The
   public API, billing, and developer onboarding come only after the internal
   flow proves its value.
10. **Grow by demand, not by count.** Start with 10–30 excellent artifacts.
    Failed searches decide what to build next. Do not mass-produce to hit a
    number.
11. **Web and Capacitor stay compatible.** Everything works in the browser and
    in the Capacitor shell (which loads the hosted Next.js app).
12. **Rendering is not learning.** An artifact that loads and gets clicked is
    not proof that a child learned. Learning evidence comes from graded
    questions and, later, tutor observations.

## 3. What exists today (grounded in the repo)

| Area | Where | What it means for the library |
| --- | --- | --- |
| Lesson pipeline | `packages/ai/src/pipelines.ts` → `generateLesson` (plan → blueprint → fact-check → `renderBlueprintHtml`) | The natural place for an "artifact matching" step: after the blueprint passes fact-check, before the `building` stage. |
| Job runner | `apps/web/src/lib/jobs.ts` (calls `generateLesson`, stores `artifacts.html`) | Matching runs inside the existing artifact job, so it adds no new charge. |
| Blueprint schema | `packages/contracts/src/blueprint.ts` (v3 `GameBlueprint`, sessions of bites) | `explore` bites carry a `VisualSpec` with `kind` ∈ `comparison, sequence, parts, timeline, orbit, simulation`. A library reference would sit beside or replace this visual. |
| Visual selection rules | `packages/ai/src/prompts.ts` (`TOOLBOX_DOC`, `VISUAL_RULES`, `INTENT_RULES`) | The planner already reasons about why a visual is needed (`purpose`, objective intent). That is our search request. |
| Lesson player | `packages/learnkit/src/player.ts` (`renderVisual`), `html.ts` (`renderBlueprintHtml`, `ARTIFACT_CSP`) | The lesson is one `srcdoc` document. Its CSP is `default-src 'none'; frame-src 'none'; connect-src 'none'`, so it cannot embed or load anything external today. |
| Stored lesson HTML | `artifacts.html`; `refreshPlayerHtml` swaps only the player script/CSS | The CSP is baked into each stored lesson. Old lessons keep the old CSP, which is fine because they never reference library artifacts. |
| Host iframe | `apps/web/src/components/artifact-player.tsx` | `sandbox="allow-scripts"` (opaque origin), checks the message source window and a per-session nonce, batches events to `POST /api/events`. |
| Event contract | `packages/contracts/src/events.ts` | `LearningEventType` enum plus the `LearnKitMessage` envelope (protocol v1). Library artifacts need their own namespaced event type and a protocol bump. |
| Event ingestion | `apps/web/src/app/api/events/route.ts`, `apps/web/src/lib/progress.ts` | The server re-grades answers. Artifact interaction events are evidence for the tutor and analytics, not grades. |
| Static HTML validator | `validateArtifactHtml` in `packages/learnkit/src/html.ts` | Good starting rules (no external `src`, no `fetch`/XHR/WebSocket, no `window.top`, JS syntax check). Its lesson-specific rules (`question_answered`, `topic_completed`) do not apply to library artifacts. |
| Assets | `artifact_assets` table (base64 images, ≤3MB, per lesson) | Not suitable for library bundles (textures, GLTF, fonts, JS). Library files go to Supabase Storage. |
| Database | `packages/db/supabase/migrations/0001`–`0008`, pgTAP tests in `packages/db/supabase/tests/` | New tables come as migrations `0009+`, each with RLS and pgTAP tests. No storage bucket exists yet. |
| Roles | Parent / child / self accounts; no staff or admin role | Artifact Studio needs a new staff role. |
| App headers | `apps/web/next.config.ts` sets `X-Frame-Options: DENY` on `/(.*)` | Artifact-serving routes must be excluded and given their own frame policy. |
| Routing / auth gate | `apps/web/src/proxy.ts` | Can route the artifact hostname to artifact routes only, and gate `/studio` to staff. |
| Mobile | `apps/mobile/capacitor.config.ts` (`server.url` → hosted app) | The same web code runs in WKWebView and Android WebView. WebGL in nested iframes and memory on low-end Android must be tested. |
| Tutor | `parents.tutor_enabled` flag only; the live tutor is a `todo.md` item | Stage 10 defines the tutor data and event stream. Building the voice tutor itself is a separate project. |
| Tests | Vitest in each package; no browser test runner | Playwright gets added in Stage 6 as a dev dependency for the Studio and CI only. |
| Billing | `apps/web/src/lib/credits.ts`, `0004_billing.sql`, Stripe webhook | Unchanged by stages 1–12. Pricing for the API is designed separately in Stage 14. |

## 4. Target architecture

### 4.1 Components

```text
 External AI tools (Opus 5.5, Gemini 4 Argon, ...)   ← I generate code here, outside Everprimer
            │  paste HTML / upload ZIP
            ▼
 ┌──────────────────────── Everprimer (one Next.js app + Supabase) ─────────────────────────┐
 │                                                                                           │
 │  Artifact Studio (/studio, staff only)                                                    │
 │    import → static validation → browser validation → metadata → preview → publish        │
 │            │                                                                              │
 │            ▼                                                                              │
 │  Library service  (packages/library — pure TS, no UI, reusable by the future public API)  │
 │    catalog: registerDraft, addVersion, publish, retire, getArtifact                       │
 │    search:  searchArtifacts(request) → ranked candidates + reasons                        │
 │    logs:    search log, usage log, coverage gaps                                          │
 │            │                         │                                                    │
 │   Postgres (metadata, FTS,      Storage (private bucket: immutable bundles,               │
 │   versions, logs; pgvector       previews, thumbnails)                                    │
 │   later)                                                                                  │
 │            ▲                                                                              │
 │  Lesson pipeline (packages/ai) — new "match" step after fact-check:                       │
 │    explore bite → ArtifactNeed → searchArtifacts → accept (pin id@version + params)       │
 │                                                  → or keep built-in VisualSpec            │
 │            │                                                                              │
 │  Lesson player (learnkit, srcdoc iframe) ── nested iframe ──► Artifact host               │
 │            ▲  relays validated events                         (separate origin, e.g.      │
 │            │                                                   artifacts.everprimer.app)  │
 │  Host page (artifact-player.tsx) → /api/events → learning_events / tutor stream           │
 │                                                                                           │
 │  Later: /api/v1/* route handlers → same library service (API keys, quotas, metering)      │
 └───────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Key design decisions (proposed; Stage 0 confirms the risky ones)

**D1. Where artifacts run: a separate origin, embedded as a nested iframe.**
Library artifacts are often multi-file (Three.js, textures, GLTF models), so they
cannot be inlined into the lesson's `srcdoc`. They are served from a dedicated
hostname that has no auth cookies (for example `artifacts.everprimer.app`, the
same Vercel project on a second domain, with `proxy.ts` allowing only artifact
routes on that host). Inside the lesson, the player renders the `explore` bite
as a nested `<iframe sandbox="allow-scripts" src="https://artifacts…/a/{id}/{version}/index.html">`.
The lesson CSP adds only that origin to `frame-src`.

- Alternative A: the host page draws a second iframe over the lesson when it
  receives an `open_artifact` message. This leaves the lesson CSP untouched but
  splits the lesson flow across two frames and makes the layout harder. It is
  the fallback if nested iframes misbehave on iOS or Android.
- Alternative B: serve straight from public Supabase Storage URLs. Rejected as
  the default because we need full control of `Content-Type`, CSP, and
  `Cross-Origin-*` headers on every file. Storage stays private, and our route
  streams files with our own headers.

**D2. Artifact host headers.** Every served file gets
`Content-Security-Policy: sandbox allow-scripts; default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; form-action 'none'; base-uri 'none'`,
`frame-ancestors` limited to the app and lesson contexts (Stage 0 verifies how
opaque-origin `srcdoc` parents interact with `frame-ancestors`),
`Cross-Origin-Resource-Policy`, `X-Content-Type-Options: nosniff`, and long
immutable caching (versions never change). `connect-src 'self'` lets an
artifact load its own GLTF and textures with `fetch` while still blocking every
other host.

**D3. Third-party libraries are vendored, never loaded from CDNs.** Code from
other AIs usually loads `three` from unpkg, jsDelivr, or an import map. The
importer rewrites known CDN URLs to pinned, vendored copies served from the
artifact origin (an allowlist: `three` plus addons, `gsap`, `d3`, `p5`,
`matter-js`, `chart.js`, and so on, each with an exact version). Anything not on
the allowlist is rejected with a clear message. No `npm install` and no build
scripts ever run on uploaded projects.

**D4. A tiny artifact SDK ("ArtifactKit").** This is a small runtime, like
today's LearnKit runtime, that the host injects into every library artifact. It
handles the handshake, receives `params` and `reducedMotion`, handles
`pause`/`resume` (to save battery and memory when off screen), and sends events
to the parent with `ArtifactKit.emit(name, data)`. Artifacts declare their
events and parameters in the manifest; anything undeclared is dropped.

**D5. Compliance levels, so pasted code is still usable.**

| Level | What the artifact does | Can be used for |
| --- | --- | --- |
| L0 Display | Renders, no SDK calls. ArtifactKit auto-reports `ready` and generic `interacted` (pointer/keyboard activity). | Background animations, demos |
| L1 Basic | Calls `ArtifactKit.ready()` and emits at least one declared event | Lessons |
| L2 Configurable | Reads documented `params` (e.g. which planets, speed, labels) | Reuse across many lessons |
| L3 Tutor-ready | Emits meaningful declared events (`planet_selected`, `prediction_submitted`) mapped to the tutor guide and success criteria | Live tutor mode, learning evidence |

I keep an "authoring brief" in the repo (Stage 7). It is a prompt template I
paste into external AI tools so their output targets L2/L3 from the start.

**D6. Data model (sketch; Stage 2 finalizes it).**

- `library_artifacts`: one row per artifact. `id`, `slug`, `title`,
  `current_version`, `status`, `owner`, timestamps.
- `library_artifact_versions`: `artifact_id`, `version`, `manifest jsonb`,
  `bundle_path`, `entry_file`, `files jsonb` (path, size, sha256, mime),
  `bundle_sha256`, `status` (`draft | testing | published | retired`),
  `validation_report jsonb`, `compliance_level`, `search_tsv` (generated),
  `embedding vector` (added in Stage 12), `published_at`, `published_by`.
  A trigger blocks edits to published rows.
- `library_search_log`: each lookup with its request, candidates, scores,
  decision (`accepted | rejected_all | no_candidates`), and lesson/topic ids.
  This drives coverage-gap reports.
- `library_usage`: which lesson (artifact row) pinned which `artifact@version`,
  plus aggregate play counts.
- `staff_users` (or `app_metadata.role = 'staff'`) for Studio access.
- Storage bucket `library` (private): `bundles/{artifactId}/{version}/...`,
  `previews/{artifactId}/{version}/thumb.webp`.
- Later: `api_clients`, `api_keys` (hashed), `api_usage`.

**D7. Manifest (sketch; Stage 1 finalizes it as a Zod schema in `packages/contracts`).**

```jsonc
{
  "manifestVersion": 1,
  "id": "solar-system-simulator",
  "version": 3,
  "title": "Solar System Simulator",
  "description": "3D solar system with adjustable orbit speed and selectable planets.",
  "format": "html" | "bundle",
  "entry": "index.html",
  "rendering": { "dimension": "3d", "tech": ["three@0.170.0"], "webgl": true },
  "subjects": ["science"],
  "topics": ["astronomy", "solar system"],
  "concepts": ["planetary orbit", "orbital period"],
  "prerequisites": ["planets orbit the sun"],
  "learningObjectives": ["Explain why planets farther from the sun take longer to orbit"],
  "objectiveIntents": ["explain_process", "compare", "predict"],   // mirrors INTENT_RULES
  "visualKinds": ["orbit", "simulation"],                          // mirrors VisualKind
  "interactionTypes": ["select", "simulate", "compare", "predict"],
  "ageRange": [8, 12],
  "difficulty": 2,
  "durationSec": [60, 240],
  "params": [{ "key": "planets", "type": "string[]", "default": ["mercury","venus","earth","mars"], "description": "..." }],
  "events": [{ "name": "planet_selected", "data": { "planet": "string" }, "description": "..." }],
  "tutorGuide": {
    "intro": "...", "steps": ["..."], "observationPrompts": ["..."],
    "misconceptions": [{ "belief": "...", "response": "..." }],
    "hints": ["gentle", "stronger", "near-answer"],
    "successCriteria": [{ "description": "...", "evidence": ["orbit_comparison_completed"] }]
  },
  "accessibility": { "reducedMotion": true, "keyboard": true, "screenReaderSummary": "...", "colorSafe": true },
  "performance": { "maxBundleKB": 4000, "targetFps": 30, "mobileTested": true },
  "provenance": { "createdWith": ["claude-opus-5.5"], "createdAt": "...", "notes": "..." },
  "license": { "artifact": "proprietary", "thirdParty": [{ "name": "three", "license": "MIT" }], "attributions": [] }
}
```

**D8. How a lesson uses an artifact.** The `explore` bite gains an optional
`library: { artifactId, version, params }` next to its existing `visual`. The
built-in `visual` stays as a required fallback. If the frame fails to load,
times out, or the device cannot do WebGL, the player shows the built-in visual
instead. Old blueprints stay valid without migration.

**D9. Matching is deterministic first.** The default is hard filters (age,
status, `visualKinds`/`objectiveIntents` compatibility, required interactions,
WebGL capability), then Postgres full-text ranking, then a scored rule check
with an explicit threshold. An optional rerank by the lesson's existing model
over the top 3 manifests is allowed, behind a flag. It only selects, it never
generates, and it runs inside the already-paid lesson job. Vector search waits
until the catalog is big enough to need it (Stage 12).

## 5. Stages

How to read this: every stage has a goal, scope, the code areas it touches,
deliverables, tests, acceptance criteria, and dependencies. Stages are ordered
by dependency and risk. The first ones are small and verifiable. "Detailed plan"
means I ask for a focused implementation plan for that stage only, review it,
and then run it in Agent mode.

```text
 0 Spikes ─► 1 Contracts ─► 2 Storage+Catalog ─► 3 Import+Static validation ─► 4 Artifact host+Player
                                                                                    │
                     ┌──────────────────────────────────────────────────────────────┤
                     ▼                                                              ▼
              5 Artifact Studio ─► 6 Browser validation ─► 7 Seed library    8 Search service
                                                               │                    │
                                                               └────────┬───────────┘
                                                                        ▼
                                                     9 Lesson integration (feature-flagged)
                                                                        │
                                       ┌────────────────────────────────┼─────────────────────┐
                                       ▼                                ▼                     ▼
                              10 Tutor guide + events       11 Evaluation + analytics   12 Semantic search
                                                                        │
                                                                        ▼
                                                    13 Public API (private beta) ─► 14 Commercial launch
```

Stages 5 and 8 can run in parallel once 4 is done. Stages 10, 11, and 12 can
run in parallel after 9.

---

### Stage 0 — Technical spikes and decisions (throwaway code only)

**Goal:** Prove or disprove the assumptions in D1–D4 before building anything
permanent.

**Scope**
- Prototype a nested sandboxed iframe from the lesson `srcdoc` to a second
  origin running a Three.js scene. Test it in desktop Chrome, Safari, and
  Firefox, the iOS Capacitor app (WKWebView), and the Android Capacitor app.
- Check how `frame-ancestors`, `X-Frame-Options`, and the CSP `sandbox`
  directive behave when the parent is an opaque-origin `srcdoc`.
- Check the `postMessage` relay chain: artifact → lesson player → host, with
  source-window checks at each hop.
- Measure memory and FPS of one heavy WebGL scene on a low-end Android device,
  and check that `pause` really stops the render loop.
- Decide the artifact hostname and how it works locally (for example
  `localhost:3000` for the app and `127.0.0.1:3000` as the artifact origin, or a
  second dev port).
- Collect 5 real outputs from Opus 5.5 and Gemini 4 Argon (single HTML and
  multi-file). Record how they load libraries (CDN script tags, import maps, ES
  modules) to define the D3 allowlist and rewrite rules.

**Code areas:** a scratch branch only. Nothing merged except docs.

**Deliverables:** `Docs/artifact-library/decisions/ADR-001-artifact-origin.md`,
`ADR-002-embedding.md`, `ADR-003-vendored-libraries.md`, and a short findings
section appended to this file.

**Acceptance criteria:** The embedding approach (nested iframe or host overlay)
is chosen with evidence from web, iOS, and Android. The vendored-library
approach is confirmed against real AI output.

**Depends on:** nothing.

---

### Stage 1 — Contracts: manifest, ArtifactKit protocol, events

**Goal:** Define the shared language every later stage uses. Types only, no
storage or UI.

**Scope**
- `ArtifactManifest` Zod schema (D7) in `packages/contracts/src/library.ts`,
  with `parseManifest` and `lintManifest` (age range sane, every declared event
  referenced by success criteria exists, params have defaults, license present,
  and so on).
- `ArtifactKit` message protocol: `ak-ready`, `ak-init {params, reducedMotion, nonce}`,
  `ak-event {name, data}`, `ak-pause`, `ak-resume`, `ak-error`. Add a new
  `LEARNKIT_PROTOCOL_VERSION` 2 path that keeps v1 lessons working.
- A new `LearningEventType` value, `artifact_interaction`, with payload
  `{ libraryArtifactId, version, name, data }`. Ingestion stores it but does not
  grade it.
- `ArtifactNeed` (search request) and `ArtifactMatch` (search result) types
  derived from today's `explore` bite and `VisualSpec`.
- An optional `library` reference on `ExploreSection` (D8), so old blueprints
  still parse.
- Compliance levels (D5) as a computed property.

**Code areas:** `packages/contracts/src/{library.ts,events.ts,blueprint.ts,index.ts}`.

**Tests:** Vitest for valid and invalid manifests, protocol message parsing,
blueprint backward compatibility (every existing fixture in `blueprint.test.ts`
still parses), and `lintManifest` rules.

**Acceptance criteria:** `pnpm test` and `pnpm typecheck` pass. All existing
blueprints and events are unchanged in behaviour.

**Depends on:** Stage 0 (protocol shape follows the embedding decision).

---

### Stage 2 — Storage and catalog service

**Goal:** A place to keep artifacts and versions, with immutability and access
control, behind a service API.

**Scope**
- Migration `0009_artifact_library.sql`: the tables in D6, generated
  `search_tsv`, indexes, an immutability trigger on published versions, RLS
  (learners can read only published manifests; writes only by service role and
  staff), and the staff role.
- Private Storage bucket `library` with policies. Paths are content-addressed
  per version.
- New package `packages/library` (`@eco/library`): `registerDraft`,
  `addVersion`, `getArtifact(id, version?)`, `listArtifacts(filters)`,
  `setStatus`, `publishVersion`, `retireVersion`. It takes a Supabase client as
  a dependency, has no Next.js imports, and does not depend on `packages/ai`.
- `packages/db/src/types.ts` row types.

**Code areas:** `packages/db/supabase/migrations/`, `packages/db/supabase/tests/`,
`packages/db/src/types.ts`, `packages/library/` (new), `apps/web/next.config.ts`
(`transpilePackages`).

**Tests:** pgTAP for RLS, the immutability trigger, status transitions, and
"learner cannot see drafts". Vitest for the service with a mocked client:
version numbering, publish rules, and invalid transitions.

**Acceptance criteria:** A published version cannot be modified by any role. A
draft is invisible to learners. Existing migrations and tests are untouched and
pass.

**Depends on:** Stage 1.

---

### Stage 3 — Import formats and static validation

**Goal:** Turn pasted code or an uploaded ZIP into a safe, normalized,
versioned bundle. No AI involved.

**Scope**
- Supported input v1: (a) one self-contained HTML file (pasted or uploaded),
  (b) a ZIP with `index.html` plus local JS, CSS, images (png, jpg, webp, svg),
  models (glb, gltf + bin), fonts (woff2), and audio (mp3, ogg). Explicitly not
  supported in v1: projects that need `npm install` or a build step (Vite/React
  sources), server code, or WASM (revisit later).
- Bundle safety: size caps (per file and total), file-count cap, zip-slip and
  absolute-path rejection, a mime/extension allowlist, no symlinks, and sha256
  for every file.
- D3 vendoring: detect CDN script tags, import maps, and bare imports; rewrite
  them to allowlisted vendored copies; reject anything unknown with an
  actionable message ("`cannon-es` is not on the allowlist; bundle it locally or
  request it be added").
- `validateLibraryArtifact(bundle)`: reuse the network, `window.top`, nested
  iframe, and syntax rules from `validateArtifactHtml`, minus the
  lesson-specific ones. Add the manifest cross-check (declared entry file
  exists, referenced local files exist) and a compliance-level estimate.
- ArtifactKit injection into the entry HTML, as `normalizeGeneratedHtml` does
  today for LearnKit.

**Code areas:** `packages/library/src/import/*`, a shared validator module
(extract the common rules from `packages/learnkit/src/html.ts` without
changing its behaviour), `packages/library/vendor/` (pinned library files plus
a lock list with versions and licenses).

**Tests:** fixture bundles (good single HTML, good Three.js ZIP, CDN-import
HTML that gets rewritten, zip-slip, oversized, unknown library, `fetch` to an
external host, `window.parent.document` access). The existing `html.test.ts`
must stay green.

**Acceptance criteria:** Each real AI output collected in Stage 0 either imports
cleanly or fails with a clear, specific reason.

**Depends on:** Stages 1 and 2.

---

### Stage 4 — Artifact host and player embedding

**Goal:** A published (or previewed) artifact renders safely in the web app and
the Capacitor app, inside a lesson bite and standalone.

**Scope**
- Artifact-serving route (for example
  `apps/web/src/app/a/[artifactId]/[version]/[...path]/route.ts`) that streams
  files from private Storage with D2 headers. It answers only on the artifact
  hostname. `proxy.ts` blocks app routes on that host and blocks artifact
  routes on the app host. `next.config.ts` excludes these routes from
  `X-Frame-Options: DENY`.
- Signed, short-lived preview URLs for draft versions (Studio only). Published
  versions are cacheable and public-by-id (they hold no learner data).
- The ArtifactKit runtime (`packages/library/src/runtime.ts` or in learnkit):
  handshake, params, pause/resume via `IntersectionObserver`, an error report,
  and a load-timeout signal.
- Lesson player: `renderVisual` handles a bite with `library`. It renders the
  nested iframe, relays only declared `ak-event`s as `artifact_interaction`
  LearningEvents, and falls back to the built-in `VisualSpec` on load failure,
  timeout, or missing WebGL. `renderBlueprintHtml` adds the artifact origin to
  `frame-src` only when the blueprint has a library bite.
- `artifact-player.tsx` and `/api/events` accept `artifact_interaction` and
  validate it against the pinned manifest (name declared, data shape, size
  limits).

**Code areas:** `apps/web/src/app/a/...`, `apps/web/src/proxy.ts`,
`apps/web/next.config.ts`, `packages/learnkit/src/{player.ts,html.ts,runtime.ts}`,
`apps/web/src/components/artifact-player.tsx`, `apps/web/src/app/api/events/route.ts`,
`apps/web/src/lib/progress.ts`, `apps/web/.env.example` (`ARTIFACT_ORIGIN`).

**Tests:** Vitest for headers, path traversal on the serving route, version
pinning, the event relay filter (undeclared events dropped, wrong source window
dropped), and CSP generation. A manual check on web, iOS, and Android with the
Stage 0 Three.js scene, recorded as a walkthrough video.

**Acceptance criteria:** The artifact cannot read app cookies or storage, reach
the network beyond its own origin, or send events that are not declared. The
fallback visual shows when the artifact origin is unreachable. Existing lessons
render the same as before.

**Depends on:** Stages 2 and 3.

---

### Stage 5 — Artifact Studio (internal)

**Goal:** My workspace for importing, describing, previewing, and publishing
artifacts without touching files or SQL by hand.

**Scope**
- `/studio` routes gated to staff (in `proxy.ts` and server-side checks).
- Library list: search, filter by status, subject, age, and compliance level,
  and sort by usage.
- New artifact / new version: paste HTML or upload a ZIP, see the static
  validation report, then fill in the manifest form (all D7 fields, with
  autocomplete for existing concepts and topics). Metadata is entered by hand.
  AI-suggested metadata is not a dependency.
- Live preview in the same sandbox as production, with phone, tablet, and
  desktop frame sizes, a params editor, an event console that shows emitted
  events against the declared ones, and reduced-motion and pause toggles.
- Version history with diffs of the manifest and file list, status changes
  (draft → testing → published → retired), and a publish confirmation that
  shows the checklist.
- A "duplicate as new version" action for edits, since published versions are
  immutable.

**Code areas:** `apps/web/src/app/studio/**`, server actions calling
`@eco/library`, and reused UI components from `apps/web/src/components/`.

**Tests:** access control (parent and child accounts get 404 or redirect),
server-action input validation, and an end-to-end happy path (import → preview
→ publish) once Stage 6 adds Playwright.

**Acceptance criteria:** I can take one Opus-made Three.js ZIP from upload to
published in under 10 minutes without leaving the Studio.

**Depends on:** Stage 4. Can run in parallel with Stage 8.

---

### Stage 6 — Automated browser validation and publish gate

**Goal:** Catch broken artifacts automatically. "The model said it works" is
not evidence.

**Scope**
- Add Playwright (dev dependency) with a harness that loads a version from the
  artifact origin at phone and desktop viewports. It records console errors,
  uncaught exceptions, blocked network requests, the time to `ready`, a WebGL
  context check, frames rendered, memory, and screenshots (stored as the
  thumbnail and preview).
- Scripted smoke interaction: random taps and drags, plus declared-event
  probes. The manifest may include an optional `testScript` of simple steps,
  such as "click `[data-planet=earth]` and expect event `planet_selected`".
- Results go to `validation_report`. Publishing is blocked on errors; warnings
  need my acknowledgement.
- Runs from the Studio (a job) and in CI for every published version when the
  ArtifactKit or player changes. This is a regression guard.

**Code areas:** `packages/library/test-harness/` (or `apps/web/e2e/`), the
Studio publish flow, and a CI workflow.

**Tests:** the harness's own fixtures: a known-good artifact passes, and
artifacts with a thrown error, an infinite loop, a blank canvas, or a network
call fail.

**Acceptance criteria:** A broken artifact cannot be published. Every published
artifact has a thumbnail and a passing report.

**Depends on:** Stage 5.

---

### Stage 7 — Seed library (content production)

**Goal:** 10–20 excellent artifacts that set the quality bar. This stage is
mostly my work outside the app, plus light tooling.

**Scope**
- An authoring brief (`Docs/artifact-library/AUTHORING_BRIEF.md`): a
  copy-paste prompt for external AIs covering the ArtifactKit API, allowed
  libraries and versions, mobile and performance budgets, accessibility,
  reduced motion, the required manifest stub, and the event naming rules.
- A review checklist: scientific accuracy, age fit, does it teach the
  objective, interaction quality, mobile feel, and tutor guide completeness.
- First set, mixing general-purpose and topic-specific artifacts:
  - General: cause-and-effect / chain-reaction (domino) simulator, cycle and
    process explorer (water, rock, and life cycles via params), spatial
    manipulation toolkit (rotate and compare 2D/3D shapes), comparison and
    manipulation toolkit (fractions, ratios, quantities, before/after), and a
    timeline or sequence builder.
  - Topic-specific: solar system / orbits, simple electric circuits, plant or
    animal cell, forces and motion, simple machines, states of matter, and the
    human heart.
- Track per artifact which built-in `VisualKind`s and `objectiveIntents` it can
  replace.

**Acceptance criteria:** Every seed artifact is at least L2 (most L3), passes
Stage 6, has a complete tutor guide, and has been reviewed by me in the
Capacitor app.

**Depends on:** Stage 6. Content can be drafted from Stage 3 onward.

---

### Stage 8 — Search service (keyword and filters)

**Goal:** Given an `ArtifactNeed`, return a small ranked list of suitable
published artifacts with reasons. Fast and deterministic.

**Scope**
- `searchArtifacts(need, options)` in `@eco/library`: hard filters (published
  only, age overlap, compatible `visualKinds`/`objectiveIntents`, required
  interactions, WebGL allowed), Postgres FTS over title, description,
  concepts, objectives, and topics with weighted fields, and a rule score
  (objective alignment, interaction coverage, age centre, difficulty, quality
  and usage signals). Returns `ArtifactMatch[]` with a score breakdown.
- `acceptMatch(need, candidates, threshold)`: an explicit, configurable
  threshold. It returns `none` rather than a weak match.
- Every call writes `library_search_log`.
- A Studio "search playground": type a need (or paste a real lesson's bite)
  and see candidates and scores. This is how thresholds get tuned.

**Code areas:** `packages/library/src/search/*`, a migration for indexes or a
search RPC if needed, and a Studio page.

**Tests:** a golden set of 30–50 needs taken from real Everprimer lesson plans,
with the expected artifact (or "none"). Precision matters more than recall.
Plus performance (p95 under 100 ms on the seed catalog).

**Acceptance criteria:** On the golden set, accepted matches are at least 90%
correct (judged by me), and "none" is returned whenever no seed artifact fits.

**Depends on:** Stage 2 (and seed data from Stage 7 for tuning). Can run in
parallel with Stages 5–7.

---

### Stage 9 — Lesson pipeline integration (behind a feature flag)

**Goal:** Real lessons use library artifacts where they genuinely fit, with no
change in cost or reliability.

**Scope**
- A new step in `generateLesson` (`packages/ai/src/pipelines.ts`) after
  fact-check and before `building`. For each `explore` bite (and optionally
  `explain` bites with a visual), build an `ArtifactNeed` from the bite's
  `VisualSpec.kind`, `purpose`, objective codes and intents, and learner age.
  Call `searchArtifacts`, and attach `library: { artifactId, version, params }`
  when accepted. The built-in `visual` is always kept as the fallback.
- Optional: an LLM rerank of the top 3 using the lesson's existing model (D9).
  It selects only and is off by default.
- Params mapping: fill artifact params from bite items where the manifest
  declares a mapping (for example orbit `items` → `planets`).
- Prompt updates in `prompts.ts` so the planner states the interaction it
  needs (purpose and required actions) more precisely. This makes search
  better and does not ask the model to write code.
- `jobs.ts`: record `library_usage`, and show a "used library artifact"
  stage in generation progress.
- Feature flag (env and per-tier) plus a kill switch. With the flag off,
  output is byte-for-byte what it is today.
- Credits: no new RPC, no change to `spend_credit`/`refund_credit`. A lookup
  failure never fails the lesson; it just falls back.

**Code areas:** `packages/ai/src/{pipelines.ts,prompts.ts}`, `packages/ai`
depending on `@eco/library` through an injected `search` function (keeps `ai`
testable with mocks), `apps/web/src/lib/jobs.ts`, `packages/learnkit/src/player.ts`.

**Tests:** pipeline tests with a mocked search (accepted, none, search throws,
and timeout), a blueprint lint for library bites, a playthrough test
(`playthrough.test.ts`) with a library bite and with the fallback, and a
regression test that lesson output with the flag off is unchanged. Plus
credit-ledger pgTAP tests unchanged and green.

**Acceptance criteria:** On 30 real lesson generations, the share of explore
bites that use a library artifact is reported, every one of them is judged
appropriate, there is no increase in failed lessons, and no measurable increase
in cost or latency (over 300 ms p95 means rework).

**Depends on:** Stages 4 and 8, plus Stage 7 content.

---

### Stage 10 — Tutor guide and interaction-event stream

**Goal:** Make library artifacts ready for the future live audio tutor, so it
reacts to what the child actually does instead of narrating the screen.

**Scope**
- Finalize the `tutorGuide` structure (intro, guided steps, observation
  prompts, misconceptions with responses, tiered hints, success criteria
  mapped to events) and have the Studio enforce completeness for L3.
- A server-side read model: for a session, the ordered `artifact_interaction`
  events plus derived "success criteria met" flags.
- A host-side live event stream (in-page, from `artifact-player.tsx`) that a
  tutor component can subscribe to. It is read-only and contains no learner PII
  beyond the session.
- A tutor context builder: given the current bite, it returns the manifest
  tutor guide, lesson objectives, and recent events. This is what the voice
  tutor will consume.
- Parent report hook (optional): "explored the solar system simulation;
  compared orbits" from success criteria.
- Out of scope: the voice tutor itself (speech, LLM dialogue, `tutor_enabled`
  gating, and pricing). That is its own project and uses this stage's outputs.

**Code areas:** `packages/contracts/src/library.ts`, `apps/web/src/lib/progress.ts`
(or a new `tutor-context.ts`), `apps/web/src/components/artifact-player.tsx`,
and the Studio manifest form.

**Tests:** success-criteria evaluation from event sequences, the context
builder output shape, and checks that undeclared events never reach the
stream.

**Acceptance criteria:** For each L3 seed artifact, a scripted play-through
produces the expected success-criteria flags and a tutor context a reviewer
finds useful.

**Depends on:** Stage 9. Can run in parallel with Stages 11 and 12.

---

### Stage 11 — Evaluation, analytics, and demand-driven growth

**Goal:** Prove the library improves lessons, and let real demand decide what to
build next.

**Scope**
- A comparison run: the same 30 lesson requests generated with the flag off and
  on, reviewed blind with a rubric (interaction quality, objective alignment,
  age fit, engagement potential).
- Metrics in the Studio dashboard: the match rate, the accepted-match rate
  (judged), the fallback rate, the load failure and fallback-render rate by
  device, average time in artifact, and success-criteria completion.
- Learning outcomes, kept separate: first-attempt correctness on the
  questions that follow a library bite compared with a built-in visual bite,
  for the same objectives over time (from `responses`).
- A coverage-gap report from `library_search_log`: the most frequent
  needs with no or rejected candidates, grouped by concept, intent, and age.
  This is my production queue for the next artifacts.
- Retirement signals: artifacts with high fallback rates or poor follow-up
  question performance get flagged for review.

**Code areas:** SQL views or RPCs in a new migration, `apps/web/src/app/studio/analytics/**`,
and an evaluation script in `packages/library/scripts/` (offline, no runtime
model calls).

**Acceptance criteria:** A written evaluation report in
`Docs/artifact-library/evaluations/`. The decision to widen the rollout (all
tiers, more bite types) is based on it.

**Depends on:** Stage 9.

---

### Stage 12 — Semantic and hybrid search

**Goal:** Better recall when the catalog grows past what keyword search handles
well (roughly 100–200 artifacts, or when the gap report shows synonym misses).

**Scope**
- A `pgvector` column on versions. Embeddings come from the manifest text
  (computed once per published version at publish time, offline or in the
  Studio, so there are no child-facing calls). Query embeddings come from the
  `ArtifactNeed` and are cached by need hash.
- Hybrid ranking (reciprocal rank fusion of FTS and vector) inside
  `searchArtifacts`. Consumers do not change.
- Re-run the Stage 8 golden set. Ship only if precision holds and recall
  improves.

**Note on rule 2:** Embedding a search query is a small model call, but it is
not generation. It must be cheap, cached, and never billed to parents. If that
is unacceptable, keep FTS plus synonyms instead.

**Depends on:** Stages 8 and 11 (evidence that it is needed).

---

### Stage 13 — Public developer API (private beta)

**Goal:** External educational apps can search the catalog and embed approved
artifacts, using the same library service.

**Scope**
- Data: `api_clients`, `api_keys` (hashed, scoped, rotatable), `api_usage`
  (per request and per artifact session).
- Route handlers under `apps/web/src/app/api/v1/`:
  `POST /v1/artifacts/search`, `GET /v1/artifacts/{id}`,
  `GET /v1/artifacts/{id}/versions/{version}`, and
  `POST /v1/artifacts/{id}/sessions` (returns a signed embed URL plus a
  session token for receiving events).
- Delivery: hosted embed only (iframe from the artifact origin plus a small JS
  embed SDK that relays ArtifactKit events to the client app). Source download
  is not offered in the beta. Assume anything delivered to a browser can be
  copied. Hosting controls access and versions, not secrecy.
- Rate limiting and quotas per key, version guarantees (pinned versions stay
  available for a defined period after retirement), a deprecation policy, and
  an OpenAPI spec.
- A minimal developer page in the Studio to issue keys to beta partners by
  hand.
- Licensing review first: the terms of service of each AI provider used to
  create artifacts (commercial redistribution of outputs), third-party library
  licenses (in the vendor lock list), and asset licenses (textures and models;
  `license.attributions` in the manifest).

**Acceptance criteria:** One partner app (or my own test app on another domain)
searches, embeds, and receives events with an API key. Keys can be revoked
instantly. Usage is metered accurately.

**Depends on:** Stage 11 showing the library is valuable for Everprimer itself.

---

### Stage 14 — Commercial launch

**Goal:** Turn the API into a product.

**Scope:** pricing model (per embed session, per active learner, or tiered
plans, designed separately from parent credits), Stripe usage-based billing
(the existing Stripe integration can be reused for the customer object and
webhooks), self-serve developer signup and dashboard, public docs and examples,
terms and licence agreement, SLA and status page, abuse handling, and
catalog-browsing pages for developers.

**Depends on:** Stage 13 beta feedback.

---

## 6. Risk register

| Risk | Impact | Mitigation | Stage |
| --- | --- | --- | --- |
| Nested iframes or WebGL misbehave in WKWebView or Android WebView | Artifacts unusable on mobile | Spike first, fall back to the host overlay (D1-A), and always keep the built-in visual fallback | 0, 4 |
| Imported code escapes the sandbox or abuses the parent | Security incident involving children's data | Separate cookie-less origin, `sandbox` without `allow-same-origin`, strict CSP, source-window and nonce checks, declared-event allowlist, and size limits | 3, 4 |
| AI output depends on CDNs or build tools | Import failures, slow production | Vendored allowlist and rewriting, a clear rejection message, and an authoring brief that targets the supported format | 0, 3, 7 |
| Heavy 3D scenes drain memory and battery, or crash low-end phones | Bad child experience, app crashes | Performance budgets, pause when off screen, Playwright memory and FPS checks, a WebGL capability check, and fallback | 4, 6 |
| Weak matches make lessons worse | Lower lesson quality, lost trust | Strict threshold, accepted-match rate as the key metric, golden set, built-in fallback, and the flag | 8, 9, 11 |
| Published artifact changes under existing lessons | Broken or inconsistent lessons | Immutable versions (trigger plus content hashes) and pinned `id@version` | 2 |
| Library lookup accidentally adds cost or charges | Breaks the credit model | Lookup runs inside the existing job, no new ledger calls, optional rerank off by default, and credit tests unchanged | 9 |
| Old lessons break when the player changes | Regressions for existing users | `library` is optional, CSP is changed only for new lessons with library bites, and the flag-off output stays byte-identical in tests | 1, 4, 9 |
| Scientific inaccuracy in a beautiful artifact | Children learn wrong things | Review checklist, an accuracy sign-off field in the Studio, and retirement signals from follow-up question performance | 5, 7, 11 |
| Library grows with inconsistent quality | Maintenance burden | Publish gate, compliance levels, demand-driven production, and retirement | 6, 7, 11 |
| Licensing of AI outputs and third-party assets | Legal exposure when selling the API | License and provenance fields required at publish, vendor lock list with licenses, and legal review before Stage 13 | 1, 3, 13 |
| Copying of delivered artifact code by API customers | Value leakage | Hosted embed only, terms, watermark or provenance, and accepting that browser code is inspectable | 13 |

## 7. Validation strategy (all stages)

- Every stage keeps `pnpm test`, `pnpm typecheck`, and `pnpm lint` green, and
  adds tests for its own code. Existing tests are never deleted or weakened.
- Database stages add pgTAP tests next to the existing ones in
  `packages/db/supabase/tests/`.
- From Stage 6 on, Playwright guards both individual artifacts and the
  embedding path.
- Every stage that touches the player gets a manual check on web, iOS, and
  Android (Capacitor), recorded as a short video.
- The feature flag keeps the lesson pipeline reversible until Stage 11 says
  otherwise.

## 8. Open questions

Blocking (need an answer before the stage starts):

1. Artifact hostname and DNS: a subdomain of the production domain or a fully
   separate domain? Decide in Stage 0, needed by Stage 4.
2. Who besides me gets Studio access? (Affects the staff-role design in
   Stage 2.)
3. Does a lesson that uses library artifacts cost the parent the same credit as
   today? (It still generates the lesson text.) The proposed default is "yes,
   same price; the library is a quality upgrade". Needed by Stage 9.

Non-blocking (reasonable defaults chosen):

4. ZIP size limits. Default: 15 MB per bundle, 5 MB per file, 300 files.
5. Initial vendored libraries. Default: `three` (plus examples/addons), `gsap`,
   `d3`, `p5`, `matter-js`, `chart.js`, `tone` (audio). Exact versions are
   pinned in Stage 3.
6. Which bite types can use library artifacts first. Default: `explore` only,
   then `explain` with a visual.
7. Whether children can open artifacts outside lessons (a "playground" or
   explore mode). Default: not in this plan; revisit after Stage 11.
8. Offline support in Capacitor (caching bundles on device). Default: not in
   v1. The fallback visual covers offline.

## 9. What changed during planning

So that nobody re-introduces dropped ideas:

- Early drafts had the library generating new artifacts with strong models
  inside Everprimer, and a "generate a demo artifact" first step. **Dropped.**
  All library artifacts are made outside the app and imported (rule 1).
- Early drafts said "fall back to generating a new artifact" when there is no
  match. **Changed:** fall back to the lesson's existing built-in visual
  (rule 3).
- The public API was first framed as "later, maybe". **Changed:** it is an
  explicit product goal (Stages 13–14), but it still ships only after the
  internal flow proves itself.

## 10. How we work through this plan

1. Pick the next stage.
2. Ask for a detailed plan for **that stage only**: re-inspect the repo, then
   list exact files, steps, tests, acceptance criteria, and regressions to
   watch. No code yet.
3. Review and correct the plan, then run it in Agent mode.
4. Check the result, run the tests, and update this file: mark the stage done
   and record anything that changed the later stages.

| Stage | Status |
| --- | --- |
| 0 Spikes | not started |
| 1 Contracts | not started |
| 2 Storage + catalog | not started |
| 3 Import + static validation | not started |
| 4 Artifact host + player | not started |
| 5 Artifact Studio | not started |
| 6 Browser validation | not started |
| 7 Seed library | not started |
| 8 Search service | not started |
| 9 Lesson integration | not started |
| 10 Tutor guide + events | not started |
| 11 Evaluation + analytics | not started |
| 12 Semantic search | not started |
| 13 Public API beta | not started |
| 14 Commercial launch | not started |
