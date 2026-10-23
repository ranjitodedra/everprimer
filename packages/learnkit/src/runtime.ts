/**
 * LearnKit runtime, inlined into every artifact.
 *
 * Runs inside a sandboxed iframe with an opaque origin, so it can only talk to
 * the host through postMessage. Events emitted before the host sends `init`
 * are queued and flushed once the nonce arrives.
 *
 * Kept as plain ES5-ish JavaScript in a string so it needs no build step and
 * can be embedded verbatim by the generator and the fallback player.
 */
export const LEARNKIT_RUNTIME_SOURCE = String.raw`
(function () {
  if (window.LearnKit) return;
  var SOURCE = "learnkit";
  var V = 1;
  var nonce = null;
  var queue = [];
  var ctx = { topicId: null, artifactId: null, startSession: 0 };
  var reducedMotion = false;
  try { reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    if (window.crypto && window.crypto.getRandomValues) {
      var b = new Uint8Array(16);
      window.crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      var h = "";
      for (var i = 0; i < 16; i++) h += (b[i] < 16 ? "0" : "") + b[i].toString(16);
      return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
    }
    var d = new Date().getTime();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (d + Math.random() * 16) % 16 | 0; d = Math.floor(d / 16);
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  function post(msg) { try { window.parent.postMessage(msg, "*"); } catch (e) {} }
  function send(ev) { post({ source: SOURCE, v: V, kind: "event", nonce: nonce, event: ev }); }
  function flush() { var q = queue; queue = []; for (var i = 0; i < q.length; i++) send(q[i]); }

  function emit(type, payload, meta) {
    var ev = {
      clientEventId: uuid(),
      type: String(type),
      occurredAt: new Date().toISOString(),
      payload: payload || {}
    };
    if (meta && meta.sectionId) ev.sectionId = String(meta.sectionId);
    if (meta && meta.activityId) ev.activityId = String(meta.activityId);
    if (nonce === null) queue.push(ev); else send(ev);
    return ev;
  }

  function applyMotion() {
    try { document.documentElement.classList.toggle("lk-reduced-motion", !!reducedMotion); } catch (e) {}
  }

  // Tutor context is a snapshot, not a log: only the latest one matters.
  var pendingContext = null;
  function sendContext(c) { post({ source: SOURCE, v: V, kind: "context", nonce: nonce, context: c }); }
  function tutorContext(c) {
    if (!c || typeof c !== "object") return;
    if (nonce === null) pendingContext = c; else sendContext(c);
  }

  var hostHandlers = {};
  function onHost(kind, fn) {
    if (kind === "init" || typeof fn !== "function") return;
    (hostHandlers[kind] || (hostHandlers[kind] = [])).push(fn);
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.source !== "learnkit-host") return;
    if (d.kind === "init") {
      nonce = String(d.nonce);
      ctx.topicId = d.topicId; ctx.artifactId = d.artifactId;
      if (typeof d.startSession === "number" && d.startSession >= 0) ctx.startSession = Math.floor(d.startSession);
      reducedMotion = reducedMotion || !!d.reducedMotion;
      applyMotion();
      flush();
      if (pendingContext) { sendContext(pendingContext); pendingContext = null; }
      reportHeight();
      return;
    }
    if (e.source !== window.parent) return;
    var fns = hostHandlers[d.kind];
    if (!fns) return;
    for (var i = 0; i < fns.length; i++) { try { fns[i](d); } catch (err) {} }
  });

  var lastH = 0;
  function unstretch() {
    // The host sizes the iframe from what we report, so any 100vh stretch here
    // would feed back into the next measurement and grow the frame forever.
    try {
      var s = document.createElement("style");
      s.textContent = "html,body{min-height:0 !important;height:auto !important}";
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  }
  function contentHeight() {
    var b = document.body;
    if (!b) return 0;
    var cs = window.getComputedStyle(b);
    var margins = (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    return Math.ceil(Math.max(b.scrollHeight, b.getBoundingClientRect().height) + margins);
  }
  function reportHeight() {
    var h = contentHeight();
    if (h > 0 && Math.abs(h - lastH) > 4) { lastH = h; post({ source: SOURCE, v: V, kind: "resize", height: h }); }
  }
  function watchHeight() {
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { reportHeight(); });
      if (document.body) ro.observe(document.body);
    }
    setInterval(reportHeight, 1000);
  }

  function normalize(s) {
    return String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\b(the|a|an)\b/g, " ").replace(/\s+/g, " ").trim();
  }

  window.LearnKit = {
    emit: emit,
    tutorContext: tutorContext,
    onHost: onHost,
    normalize: normalize,
    uuid: uuid,
    get reducedMotion() { return reducedMotion; },
    get context() { return ctx; },
    ready: function () { post({ source: SOURCE, v: V, kind: "ready" }); }
  };

  function boot() { applyMotion(); unstretch(); watchHeight(); window.LearnKit.ready(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
`;
