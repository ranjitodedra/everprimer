# ADR-002: How a lesson embeds a library artifact

Status: accepted. Date: 2026-10-21.
Evidence: [evidence/stage-0/](evidence/stage-0/) (screenshots, `desktop-matrix.json`, `device-reports.json`).

## Context

A lesson is one sandboxed `srcdoc` document (`sandbox="allow-scripts"`, CSP
`ARTIFACT_CSP`). D1 proposed that the lesson renders a library artifact as a
**nested** sandboxed iframe from the artifact origin, with alternative A as the
fallback: the host page draws an **overlay** iframe above the lesson. Stage 0
built both on a throwaway branch (`spike/artifact-library`) and ran the same
scripted sequence everywhere:

1. Load the artifact.
2. Handshake: `ak-ready`, then `ak-init` with a nonce.
3. Relay events from artifact to lesson to host.
4. A rogue frame sends forged messages to both the lesson and the host.
5. Pause and resume by button.
6. Scroll the artifact out of view (an `IntersectionObserver` sends `ak-pause`), then back.

The only change to the lesson CSP was `frame-src 'none'`, which became `frame-src {AO}`.

## Decision

**Use the nested iframe (D1).** Keep the host overlay as a documented fallback,
but don't build it in Stage 4.

## Results

| Platform | Renders (WebGL2) | Isolation probes | Relay to host | Forged messages dropped | Pause stops rAF | Scroll-away pause | Resume |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Chromium 156 (Playwright, macOS) | yes, 60 fps | pass | yes | yes, at both hops | yes (0 fps, frame count frozen) | yes | yes |
| WebKit 27.2 (Playwright, macOS, Safari engine) | yes, 30 fps headless | pass | yes | yes | yes | yes | yes |
| iOS 27 Safari (simulator) | yes | pass | yes | yes | yes | yes | yes |
| iOS Capacitor app, WKWebView (simulator) | yes, about 30 fps | pass | yes | yes | yes | yes | yes |
| Android 16 Capacitor app, WebView Chrome 133 (emulator) | yes, about 35 fps | pass | yes | yes | yes | yes | yes |
| App on LAN IP, artifact on `<ip>.nip.io` (Chromium, WebKit) | yes | `fetch` to own origin ok | yes | not re-run | not re-run | not re-run | not re-run |
| Firefox | **not run**: the Playwright Firefox build would not launch in this environment | | | | | | |

"Isolation probes" are the ADR-001 table: no cookies, no storage, no parent or
top access, no external network, no popups.

The overlay variant also loaded and sent `ak-ready` to the host in Chromium and
WebKit, including with `frame-ancestors` set to the app origin. That makes it a
working fallback if a future WebView breaks nesting.

## Why nested over overlay

- It worked on every platform tested, with the lesson CSP widened by one origin.
- The lesson keeps owning layout, scrolling, and the bite flow. The overlay
  would make the host track the lesson's scroll position and size the overlay
  on every frame.
- Events pass through the lesson player, which already knows the current bite.
  It can drop events from bites that aren't on screen before they reach the host.

## Constraints Stage 4 must keep

- **The lesson player must not use `frame-ancestors` on artifact responses** (see ADR-001).
- **The player owns pause.** An `IntersectionObserver` inside the sandboxed
  `srcdoc` worked everywhere, and so did `visibilitychange`. Pausing stopped
  `requestAnimationFrame` completely (0 frames) on every platform.
- **Load timeout and fallback.** The spike used 8 seconds before showing the
  built-in visual. AI-made artifacts without the SDK (compliance level L0)
  never send `ak-ready`. All five Stage 0 samples were L0. So the injected
  ArtifactKit must send `ready` itself on `DOMContentLoaded`. That confirms D4.
- **Frame size.** Every sample was designed full-viewport. In a 340 px tall
  frame some layouts were cramped (the cell explorer's info panel covered the
  scene). The authoring brief (Stage 7) must say "fill the iframe and adapt
  down to 320 × 320", and the manifest should declare an aspect ratio.
- **Harmless console noise.** `autofocus` is blocked in cross-origin subframes
  ("Blocked autofocusing…"). Validators should not count it as an error.

## Still to verify on real hardware (Ranjit)

| Check | Why it matters | How |
| --- | --- | --- |
| Low-end Android phone (2–3 GB RAM): memory and FPS of the spike scene and the cell sample | Emulator numbers (21 MB JS heap, about 35 fps) say nothing about a cheap phone's GPU | `chrome://inspect` → Performance monitor while running `/spike/lesson?auto=1` |
| One physical iPhone | Simulator WebGL runs on the Mac's GPU | Run the spike over LAN with `<ip>.nip.io` |
| Firefox desktop | Not covered here | Open `/spike/lesson?cors=corsx&rogue=1&auto=1` and read the log panel |

To rerun the spike: `git worktree add ../startup-eco-spike spike/artifact-library`.
Then run `SPIKE_APP_ORIGIN=http://localhost:3100 pnpm --filter web exec next dev -p 3100 -H 0.0.0.0`
and open `http://localhost:3100/spike/lesson?cors=corsx&rogue=1&auto=1`.
