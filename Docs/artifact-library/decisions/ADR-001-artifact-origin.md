# ADR-001: Artifact origin, local setup, and response headers

Status: accepted (production domain name still to be registered). Date: 2026-10-21.
Evidence: [evidence/stage-0/](evidence/stage-0/) (`desktop-matrix.json`, `device-reports.json`).

## Context

Library artifacts are untrusted code (masterplan rule 7). They need an origin
that holds no Everprimer cookies or storage, and response headers we control on
every file (D1, D2). Stage 0 served a Three.js scene from a second origin and
probed it from Chromium 156, WebKit 27.2, iOS 27 Safari, the iOS Capacitor app
(WKWebView), and the Android Capacitor app (Android 16 WebView, Chrome 133).

## Decision

### 1. Production: a separate registrable domain

Serve artifacts from their own registrable domain, the way
`githubusercontent.com` and `googleusercontent.com` work. Do not use a
subdomain of the app domain. Example: `everprimer-artifacts.app`. Ranjit
registers the name; code reads it from `ARTIFACT_ORIGIN`.

A subdomain would have worked in the spike. Supabase's auth cookies are
host-only, so they never reached the artifact host. A separate domain still
wins for three reasons:

- One future `Domain=.everprimer.app` cookie (analytics, A/B testing, a
  marketing tool) would silently leak to every artifact on a subdomain.
- Browsers treat a subdomain as the same site as the app, so it shares the
  app's `SameSite` cookie and storage-partitioning context.
- Stage 13 sells embeds to other companies, which wants a neutral domain anyway.

### 2. Local development

| Setup | App origin | Artifact origin | Verified |
| --- | --- | --- | --- |
| Desktop browser | `http://localhost:3000` | `http://127.0.0.1:3000` (same server, different origin) | Chromium, WebKit |
| iOS simulator (Safari or Capacitor) | `http://localhost:3000` | `http://127.0.0.1:3000` (the simulator shares the Mac's loopback) | yes |
| Android emulator or USB phone (Capacitor) | `http://localhost:3000` | `http://127.0.0.1:3000`, after `adb reverse tcp:3000 tcp:3000` | yes |
| Physical phone on Wi-Fi | `http://<LAN-IP>:3000` | `http://<LAN-IP>.nip.io:3000` (wildcard DNS, needs internet) | Chromium, WebKit desktop against LAN IP |

`proxy.ts` decides which routes answer on which host from the request `Host`
header, so a single `next dev` serves both origins.

### 3. Response headers for every artifact file

```text
Content-Security-Policy: sandbox allow-scripts; default-src {AO}; script-src {AO} 'unsafe-inline';
  style-src {AO} 'unsafe-inline'; img-src {AO} data: blob:; media-src {AO} data: blob:;
  font-src {AO} data:; connect-src {AO}; frame-src 'none'; form-action 'none'; base-uri 'none'
Access-Control-Allow-Origin: *
Cross-Origin-Resource-Policy: cross-origin
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cache-Control: public, max-age=31536000, immutable      (published versions)
Cache-Control: private, no-store                          (draft previews)
```

`{AO}` is the artifact origin itself, for example `https://everprimer-artifacts.app`.
This changes D2 in three places:

1. **The artifact origin is named explicitly instead of `'self'`.** The
   artifact document is sandboxed, so its origin is opaque (`"null"`). WebKit
   then matches `'self'` against nothing, and an artifact's `fetch` of its own
   `data.json` failed in WebKit and iOS. Chromium matched `'self'` against the
   URL's origin. Naming the origin worked in both engines. That matters because
   iOS is WebKit-only.
2. **`Access-Control-Allow-Origin: *` is required on every file.** From an
   opaque origin, `<script type="module">`, `import`, and `fetch` all go out in
   CORS mode with `Origin: null`. Without the header, `three.module.js` was
   blocked in every engine. This is safe because published files are public by
   id and hold no learner data.
3. **No `frame-ancestors` at all.** When the embedding lesson is a sandboxed
   `srcdoc` (also an opaque origin), every `frame-ancestors` value blocked the
   frame in Chromium and WebKit: `'none'`, the app origin, and `*`. Chromium's
   message: "Note that '*' matches only URLs with network schemes". Embedding
   is therefore not access control. Instead:
   - Artifact URLs are public by id and version, and drafts use short-lived signed URLs (Stage 4).
   - The route serves HTML entry files only when `Sec-Fetch-Dest` is `iframe`
     (or the header is absent), so the domain cannot be used for top-level phishing pages.
   - If the host-overlay fallback (ADR-002) is ever used, its parent is the
     app page, a real origin, and `frame-ancestors {APP_ORIGIN}` does work there.

The artifact host also follows these rules:

- It never sets cookies. `proxy.ts` must skip the Supabase session refresh on
  the artifact host, and app routes must 404 there.
- It is excluded from the app's `X-Frame-Options: DENY` header in `next.config.ts`.
- The route checks path traversal itself. Next resolved `%2e%2e` dot segments
  before routing in the spike, but the handler must not rely on that.

### 4. Messaging rules this forces

- `postMessage` to an artifact must use target origin `"*"`, because the
  artifact's origin is `"null"` (`e.origin` of `ak-ready` was `"null"` everywhere).
- Every hop's security therefore rests on two checks: that `e.source` is the
  expected child window, and that the message carries the per-session nonce.
  In the spike, forged messages from a rogue sibling frame were dropped at both
  hops on every platform.

## Isolation results (all platforms tested)

| Probe from inside the artifact | Result |
| --- | --- |
| `self.origin` | `"null"` |
| `document.cookie` | `SecurityError` |
| `localStorage` | `SecurityError` |
| `window.parent.document` | `SecurityError` |
| `window.top.location.href` | `SecurityError` |
| `fetch` to its own origin (explicit `{AO}` CSP) | ok |
| `fetch("https://example.com", {mode: "no-cors"})` | blocked by `connect-src` |
| `window.open` | blocked (no `allow-popups`) |
| Cookies on requests to the artifact host | none sent. A `SameSite=Lax` cookie set on the artifact host was not sent either, because sandboxed frames count as cross-site (`Sec-Fetch-Site: cross-site`) |

## Consequences

- Stage 4 builds the route with exactly these headers and adds `ARTIFACT_ORIGIN` to `.env.example`.
- Stage 6's harness checks for `Access-Control-Allow-Origin` and the explicit-origin CSP.
- Still open: registering the production domain, and setting up its TLS on Vercel.
