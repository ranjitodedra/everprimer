/**
 * ArtifactKit runtime, inlined into every library artifact by the importer.
 *
 * Runs inside a sandboxed, cookie-less nested iframe on the artifact origin
 * and talks to the lesson player through `postMessage`. The lesson player then
 * relays declared events to the app as a LearnKit v1 `artifact_interaction`
 * event (see `packages/contracts/src/library.ts`).
 *
 * Stage 3 shipped the minimum surface. Stage 4 extends it with:
 *   - `ak-init { params, reducedMotion, nonce }` from the host.
 *     `params` are frozen onto `window.ArtifactKit.params`.
 *     `reducedMotion` toggles `data-reduced-motion` on `<html>` and sets
 *     `window.ArtifactKit.reducedMotion` so artifact code can branch.
 *   - `ak-pause` / `ak-resume` from the host: the runtime wraps
 *     `requestAnimationFrame`, deferring frame callbacks while paused and
 *     flushing them on resume. That is enough to make a Three.js render
 *     loop sleep off-screen without the artifact knowing.
 *   - `window.ArtifactKit.reportError(message, { fatal? })` sends `ak-error`.
 *     Uncaught errors and unhandled rejections also report automatically.
 *
 * Kept as plain ES5-ish JavaScript in a string so no build step is needed
 * and the importer can embed it verbatim.
 */

export const ARTIFACTKIT_PROTOCOL_VERSION = 1 as const;

/** Reserved event name auto-emitted by the runtime; mirrors `ARTIFACTKIT_BUILTIN_EVENTS` in @eco/contracts. */
export const ARTIFACTKIT_BUILTIN_INTERACTED = "interacted" as const;

/** Minimum ms between auto `interacted` emissions, to avoid flooding the host. */
export const ARTIFACTKIT_INTERACTED_THROTTLE_MS = 1000;

export const ARTIFACTKIT_RUNTIME_SOURCE = String.raw`
(function () {
  if (window.ArtifactKit) return;
  var SOURCE = "artifactkit";
  var V = 1;
  var nonce = null;
  var queue = [];
  var ready = false;
  var paused = false;
  var pendingFrames = [];

  function post(msg) { try { window.parent.postMessage(msg, "*"); } catch (e) {} }
  function sendReady() { post({ source: SOURCE, v: V, kind: "ak-ready" }); }
  function sendEvent(ev) { post({ source: SOURCE, v: V, kind: "ak-event", nonce: nonce, name: ev.name, data: ev.data }); }
  function sendError(message, opts) {
    var fatal = !!(opts && opts.fatal);
    var text = String(message == null ? "" : message).slice(0, 500);
    post({ source: SOURCE, v: V, kind: "ak-error", nonce: nonce, message: text, fatal: fatal });
  }
  function flush() {
    var q = queue; queue = [];
    for (var i = 0; i < q.length; i++) sendEvent(q[i]);
  }

  function emit(name, data) {
    if (typeof name !== "string" || !name) return;
    var ev = { name: name, data: (data && typeof data === "object") ? data : {} };
    if (nonce === null) queue.push(ev); else sendEvent(ev);
  }

  // Freeze a shallow copy so artifact code cannot mutate what the host sent.
  // Nested arrays and plain objects stay mutable, which is fine; this only
  // guards against name-collision tampering with the top-level fields.
  function freezeParams(obj) {
    var out = {};
    if (obj && typeof obj === "object") {
      for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
    }
    try { Object.freeze(out); } catch (e) {}
    return out;
  }

  function applyInit(data) {
    nonce = data.nonce;
    window.ArtifactKit.params = freezeParams(data.params);
    window.ArtifactKit.reducedMotion = !!data.reducedMotion;
    try {
      if (document.documentElement) {
        if (window.ArtifactKit.reducedMotion) document.documentElement.setAttribute("data-reduced-motion", "true");
        else document.documentElement.removeAttribute("data-reduced-motion");
      }
    } catch (e) {}
    flush();
  }

  function setPaused(next) {
    if (paused === next) return;
    paused = next;
    if (!paused && pendingFrames.length) {
      var toRun = pendingFrames; pendingFrames = [];
      var now = (window.performance && window.performance.now) ? window.performance.now() : Date.now();
      for (var i = 0; i < toRun.length; i++) {
        try { toRun[i](now); } catch (e) { sendError(e && e.message ? e.message : String(e)); }
      }
    }
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.source !== "artifactkit-host") return;
    if (e.source !== window.parent) return;
    if (d.kind === "ak-init" && typeof d.nonce === "string") applyInit(d);
    else if (d.kind === "ak-pause") setPaused(true);
    else if (d.kind === "ak-resume") setPaused(false);
  });

  // Wrap requestAnimationFrame so render loops sleep while the host says pause.
  // We fall back to a setTimeout stub when the host rAF is missing (unlikely in a browser).
  var hostRaf = typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : function (cb) { return setTimeout(function () { cb(Date.now()); }, 16); };
  window.requestAnimationFrame = function (cb) {
    if (typeof cb !== "function") return 0;
    if (!paused) return hostRaf(cb);
    pendingFrames.push(cb);
    return 0;
  };

  // Catch unhandled errors so the host sees why an artifact froze.
  window.addEventListener("error", function (ev) {
    sendError(ev && ev.message ? ev.message : "error", { fatal: false });
  });
  window.addEventListener("unhandledrejection", function (ev) {
    var reason = ev && ev.reason;
    var text = reason && reason.message ? reason.message : String(reason);
    sendError(text, { fatal: false });
  });

  var lastInteracted = 0;
  function autoInteracted() {
    var now = Date.now();
    if (now - lastInteracted < ${ARTIFACTKIT_INTERACTED_THROTTLE_MS}) return;
    lastInteracted = now;
    emit("${ARTIFACTKIT_BUILTIN_INTERACTED}", {});
  }

  function wireInteractions() {
    try {
      window.addEventListener("pointerdown", autoInteracted, { passive: true });
      window.addEventListener("keydown", autoInteracted, { passive: true });
    } catch (e) {
      // Older WebViews reject the options object. Fall back to the two-arg form.
      try { window.addEventListener("pointerdown", autoInteracted); } catch (e2) {}
      try { window.addEventListener("keydown", autoInteracted); } catch (e2) {}
    }
  }

  window.ArtifactKit = {
    ready: function () { if (ready) return; ready = true; sendReady(); },
    emit: emit,
    reportError: sendError,
    params: {},
    reducedMotion: false
  };

  function boot() { wireInteractions(); window.ArtifactKit.ready(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
`;
