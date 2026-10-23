/**
 * Blueprint player: a dependency-free lesson renderer that runs inside the
 * sandbox. Given `window.__BLUEPRINT__` it renders every section type with
 * real interaction (tap-to-explore visuals, graded questions with teaching
 * feedback, hints, retries, review) and emits LearnKit events throughout.
 *
 * Used by the mock AI provider and as the fallback whenever generated code
 * fails validation (rules.md section 28).
 */
export const PLAYER_SOURCE = String.raw`
(function () {
  var BP = window.__BLUEPRINT__;
  var LK = window.LearnKit;
  var root = document.getElementById("app");
  if (!BP || !LK || !root) return;

  var sections = BP.schemaVersion === 3 ? [] : BP.sections.filter(function (s) { return s.type !== "flashcards"; });
  var state = { i: 0, started: false, act: {}, qres: {}, reachedEnd: false, totals: { correct: 0, answered: 0 }, screen: "map", si: 0, bi: 0, stars: 0, streak: 0, sessionStars: 0, doneSessions: {}, startSession: 0, finalQi: 0, finalResults: {}, celebrated: false };

  function el(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
        var v = props[k];
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
        else if (k.indexOf("on") === 0 && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) node.setAttribute(k, "");
        else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, String(v));
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) { for (var j = 0; j < c.length; j++) if (c[j]) node.appendChild(typeof c[j] === "string" ? document.createTextNode(c[j]) : c[j]); }
      else node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  // Phones get no automatic focus, and any tap outside a field or button closes
  // the keyboard. Buttons are skipped so the layout doesn't jump mid-tap.
  var finePointer = !!(window.matchMedia && window.matchMedia("(pointer: fine)").matches);
  function dismissKeyboard() {
    var a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) a.blur();
  }
  document.addEventListener("pointerdown", function (e) {
    var t = e.target;
    if (t && t.closest && t.closest("input, textarea, select, button, label")) return;
    dismissKeyboard();
  }, true);

  function seeded(seed) {
    var h = 2166136261;
    for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () { h += 0x6D2B79F5; var t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function shuffled(arr, seed) {
    var rnd = seeded(seed), a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  function grade(q, answer) {
    if (q.kind === "mcq") return answer === q.correctOptionId;
    if (q.kind === "true_false") return answer === q.answer;
    if (q.kind === "short_answer") { var n = LK.normalize(answer); if (!n) return false; for (var i = 0; i < q.acceptedAnswers.length; i++) if (LK.normalize(q.acceptedAnswers[i]) === n) return true; return false; }
    if (q.kind === "ordering") { if (!Array.isArray(answer) || answer.length !== q.correctOrder.length) return false; for (var k = 0; k < answer.length; k++) if (answer[k] !== q.correctOrder[k]) return false; return true; }
    if (q.kind === "fill_blank") { if (!Array.isArray(answer) || answer.length !== q.blanks.length) return false; for (var b = 0; b < answer.length; b++) if (answer[b] !== q.blanks[b]) return false; return true; }
    if (q.kind === "matching") {
      if (!Array.isArray(answer) || answer.length !== q.pairs.length) return false;
      var want = {}; q.pairs.forEach(function (p) { want[p.left] = p.right; });
      var seen = {};
      for (var mi = 0; mi < answer.length; mi++) {
        var parts = String(answer[mi]).split(":");
        if (parts.length !== 2 || seen[parts[0]] || want[parts[0]] !== parts[1]) return false;
        seen[parts[0]] = true;
      }
      return true;
    }
    return false;
  }
  function optionText(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].text; return id; }
  function correctAnswerText(q) {
    if (q.kind === "mcq") return optionText(q.options, q.correctOptionId);
    if (q.kind === "true_false") return q.answer ? "True" : "False";
    if (q.kind === "short_answer") return q.acceptedAnswers[0];
    if (q.kind === "ordering") return q.correctOrder.map(function (id) { return optionText(q.items, id); }).join(" → ");
    if (q.kind === "fill_blank") return q.blanks.map(function (id) { return optionText(q.options, id); }).join(", ");
    if (q.kind === "matching") return q.pairs.map(function (p) { return optionText(q.left, p.left) + " → " + optionText(q.right, p.right); }).join("; ");
    return "";
  }
  function assetUri(id) { var A = window.__ASSETS__ || {}; return id && typeof A[id] === "string" ? A[id] : null; }

  /* ---------- tutor character ---------- */
  // Every line the guide says is wrapped in a tutor line. Until the host sends
  // both poses (and they decode) the wrapper is a plain block, so the lesson
  // reads exactly as it always has. Art arrives later and upgrades the page in
  // place: no re-render, so answers and open feedback are untouched.
  function tutorLine(pose) {
    var text = el("div", { class: "lk-tutor-text" });
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) text.appendChild(arguments[i]);
    return el("div", { class: "lk-tutor", "data-pose": pose }, el("span", { class: "lk-tutor-figure", "aria-hidden": "true" }), text);
  }
  /* Marks the line that should get the character on its screen, ahead of an opener. */
  function primaryLine(line) { line.setAttribute("data-primary", ""); return line; }
  /* One character per screen: the primary line (or the first) speaks; every other line is plain text. */
  function settleTutors() {
    var list = root.querySelectorAll(".lk-tutor");
    var pick = root.querySelector(".lk-tutor[data-primary]") || list[0] || null;
    for (var i = 0; i < list.length; i++) list[i].classList.toggle("lk-tutor-plain", list[i] !== pick);
  }
  var TUTOR_URI = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/]+=*$/;
  function applyTutorArt(d) {
    if (!d || typeof d.talk !== "string" || typeof d.teach !== "string" || !TUTOR_URI.test(d.talk) || !TUTOR_URI.test(d.teach)) return;
    var pending = 2, ok = true;
    function settle(success) {
      ok = ok && success;
      if (--pending > 0 || !ok) return;
      var rs = document.documentElement.style;
      rs.setProperty("--lk-tutor-talk", 'url("' + d.talk + '")');
      rs.setProperty("--lk-tutor-teach", 'url("' + d.teach + '")');
      document.body.classList.toggle("lk-tutor-blend", d.cutout !== true);
      document.body.classList.add("lk-has-tutor");
    }
    [d.talk, d.teach].forEach(function (src) {
      var img = new Image();
      img.onload = function () { settle(img.naturalWidth > 0); };
      img.onerror = function () { settle(false); };
      img.src = src;
    });
  }
  function applyTutorState(d) {
    var s = d && d.state;
    if (s === "listening" || s === "thinking" || s === "speaking") document.body.setAttribute("data-tutor", s);
    else document.body.removeAttribute("data-tutor");
  }
  if (LK.onHost) {
    LK.onHost("tutor_art", applyTutorArt);
    LK.onHost("tutor_state", applyTutorState);
  }

  /* What is on screen, for the live tutor. Answers stay out until the learner has had their go. */
  function clip(s, n) { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function sendContext(c) { if (LK.tutorContext) LK.tutorContext(c); }
  function sectionText(s) {
    var parts = [];
    if (s.type === "intro") parts = [s.body, s.hook];
    else if (s.type === "explain") parts = s.paragraphs.concat([s.analogy]);
    else if (s.type === "simple_explain") parts = [s.simple, s.term + ": " + s.definition];
    else if (s.type === "analogy") parts = [s.familiar, s.bridge, s.limit];
    else if (s.type === "mnemonic") parts = [s.phrase].concat(s.lines.map(function (l) { return l.cue + " = " + l.text; }), [s.tip]);
    else if (s.type === "key_points") parts = [s.lead].concat(s.points);
    else if (s.type === "explore") parts = [s.lead, s.prompt].concat(s.visual.items.map(function (it) { return it.label + ": " + it.description; }));
    else if (s.type === "review") parts = s.bullets.concat([s.nextStep]);
    else if (s.type === "image") parts = [s.alt, s.caption];
    else if (s.type === "apply") parts = [s.scenario];
    else if (s.type === "quiz") parts = [s.intro];
    return clip(parts.filter(function (p) { return p; }).join(" "), 1400);
  }
  function questionOptions(q) {
    var list = q.kind === "mcq" || q.kind === "fill_blank" ? q.options : q.kind === "ordering" ? q.items : q.kind === "matching" ? q.left.concat(q.right) : null;
    if (q.kind === "true_false") return ["True", "False"];
    return list ? list.slice(0, 12).map(function (o) { return clip(o.text, 200); }) : undefined;
  }
  function roundProgress() { return BP.schemaVersion === 3 ? { round: Math.min(currentSessionIndex(), 50), rounds: Math.min(BP.sessions.length, 50) } : undefined; }
  function baseContext(screen, s) {
    var sess = BP.schemaVersion === 3 && (screen === "bite" || screen === "session_done") ? BP.sessions[state.si] : null;
    return { screen: screen, title: clip(s ? s.title : BP.title, 200), sessionTitle: sess ? clip(sess.title, 200) : undefined, biteType: s ? s.type : undefined, progress: roundProgress() };
  }
  function sectionContext(s) {
    var c = baseContext(BP.schemaVersion === 3 ? "bite" : "section", s);
    c.text = sectionText(s);
    return c;
  }
  function questionContext(s, q, status) {
    var c = baseContext(BP.schemaVersion === 3 ? "bite" : "section", s);
    c.text = clip((sectionText(s) + (status === "retry" ? " The first try was not right; the learner is trying again." : "")).trim(), 1400);
    c.question = { prompt: clip(q.prompt, 600), options: questionOptions(q), hint: q.hint ? clip(q.hint, 300) : undefined };
    c.answered = status === "correct" || status === "revealed";
    if (status) c.correct = status === "correct";
    if (c.answered) c.explanation = clip(q.explanation, 600);
    return c;
  }

  /* ---------- shell ---------- */

  function header() {
    var dots = el("ol", { class: "lk-dots", "aria-label": "Lesson progress" });
    sections.forEach(function (s, idx) {
      dots.appendChild(el("li", { class: "lk-dot" + (idx < state.i ? " done" : idx === state.i ? " current" : ""), "aria-current": idx === state.i ? "step" : null, title: s.title }));
    });
    return el("header", { class: "lk-header" },
      el("div", { class: "lk-brand" }, el("span", { class: "lk-emoji", "aria-hidden": "true", text: BP.theme.emoji || "✨" }), el("h1", { class: "lk-title", text: BP.title })),
      dots
    );
  }

  function nav(canContinue, label) {
    var back = el("button", { class: "lk-btn ghost", type: "button", disabled: state.i === 0, onClick: function () { go(state.i - 1); } }, "Back");
    var next = el("button", { class: "lk-btn primary", type: "button", disabled: !canContinue, onClick: function () { go(state.i + 1); } }, label || "Continue");
    next.id = "lk-next";
    return el("nav", { class: "lk-nav", "aria-label": "Section navigation" }, back, next);
  }
  function enableContinue() { var b = document.getElementById("lk-next"); if (b) b.disabled = false; }

  function go(i) {
    if (i < 0) return;
    var current = sections[state.i];
    if (current && current.type === "review" && i > state.i && !state.reviewed) {
      state.reviewed = true;
      LK.emit("review_completed", {}, { sectionId: current.id });
    }
    if (i >= sections.length) return finish();
    state.i = i;
    render();
  }

  function render() {
    root.innerHTML = "";
    var s = sections[state.i];
    if (!state.started) { state.started = true; LK.emit("lesson_started", { sections: sections.length, stages: BP.stages }); }
    root.appendChild(header());
    var main = el("main", { class: "lk-main", id: "lk-main" });
    var view = renderSection(s);
    main.appendChild(view.node);
    root.appendChild(main);
    var isLast = state.i === sections.length - 1;
    root.appendChild(nav(view.canContinue, isLast ? "See how I did" : view.label));
    LK.emit("section_viewed", { index: state.i, type: s.type, stage: s.stage }, { sectionId: s.id });
    if (s.type !== "quiz" && s.type !== "apply") sendContext(sectionContext(s));
    settleTutors();
    var heading = main.querySelector("h2");
    if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true }); }
    window.scrollTo(0, 0);
  }

  function renderSection(s) {
    if (s.type === "intro") return renderIntro(s);
    if (s.type === "explore") return renderExplore(s);
    if (s.type === "explain") return renderExplain(s);
    if (s.type === "quiz" || s.type === "apply") return renderQuiz(s);
    if (s.type === "review") return renderReview(s);
    if (s.type === "key_points") return renderKeyPoints(s);
    if (s.type === "image") return renderImage(s);
    if (s.type === "mnemonic") return renderMnemonic(s);
    if (s.type === "analogy") return renderAnalogy(s);
    if (s.type === "simple_explain") return renderSimpleExplain(s);
    return { node: el("section", {}, el("h2", { text: s.title })), canContinue: true };
  }

  /* ---------- teaching blocks ---------- */
  function renderKeyPoints(s) {
    var node = el("section", { class: "lk-section lk-points" }, stageTag(s), el("h2", { text: s.title }));
    if (s.lead) node.appendChild(tutorLine("teach", el("p", { class: "lk-lead", text: s.lead })));
    var ol = el("ol", { class: "lk-point-list" });
    s.points.forEach(function (p, idx) { ol.appendChild(el("li", {}, el("span", { class: "lk-step-n", "aria-hidden": "true", text: String(idx + 1) }), el("span", { text: p }))); });
    node.appendChild(ol);
    return { node: node, canContinue: true };
  }

  function renderImage(s) {
    var node = el("section", { class: "lk-section lk-image" }, stageTag(s), el("h2", { text: s.title }));
    var uri = assetUri(s.assetId);
    var fig = el("figure", { class: "lk-figure" });
    if (uri) fig.appendChild(el("img", { src: uri, alt: s.alt, loading: "eager", decoding: "async" }));
    else fig.appendChild(el("div", { class: "lk-image-missing", role: "img", "aria-label": s.alt }, el("span", { class: "lk-part-emoji", "aria-hidden": "true", text: "🖼️" }), el("p", { text: s.alt })));
    if (s.caption) fig.appendChild(el("figcaption", { text: s.caption }));
    node.appendChild(fig);
    return { node: node, canContinue: true };
  }

  function renderMnemonic(s) {
    var node = el("section", { class: "lk-section lk-mnemonic" }, stageTag(s), el("h2", { text: s.title }));
    node.appendChild(tutorLine("teach", el("p", { class: "lk-mnemonic-phrase", text: s.phrase })));
    var ul = el("ul", { class: "lk-mnemonic-lines" });
    s.lines.forEach(function (l) { ul.appendChild(el("li", {}, el("span", { class: "lk-cue", text: l.cue }), el("span", { text: l.text }))); });
    node.appendChild(ul);
    if (s.tip) node.appendChild(el("div", { class: "lk-callout" }, el("span", { class: "lk-callout-icon", "aria-hidden": "true", text: "🧠" }), el("p", { text: s.tip })));
    return { node: node, canContinue: true };
  }

  function renderAnalogy(s) {
    var node = el("section", { class: "lk-section lk-analogy" }, stageTag(s), el("h2", { text: s.title }));
    node.appendChild(el("div", { class: "lk-callout analogy" }, el("span", { class: "lk-callout-icon", "aria-hidden": "true", text: "💡" }), el("div", {}, el("strong", { text: "You know this from " + s.interest }), el("p", { text: s.familiar }))));
    node.appendChild(tutorLine("teach", el("p", { class: "lk-lead", text: s.bridge })));
    if (s.limit) node.appendChild(el("div", { class: "lk-callout limit" }, el("span", { class: "lk-callout-icon", "aria-hidden": "true", text: "✋" }), el("div", {}, el("strong", { text: "Where the comparison stops" }), el("p", { text: s.limit }))));
    return { node: node, canContinue: true };
  }

  function renderSimpleExplain(s) {
    var node = el("section", { class: "lk-section lk-simple" }, stageTag(s), el("h2", { text: s.title }));
    node.appendChild(tutorLine("teach", el("p", { class: "lk-lead", text: s.simple })));
    node.appendChild(el("div", { class: "lk-term-card" }, el("span", { class: "lk-term-label", text: "The real word" }), el("strong", { class: "lk-term", text: s.term }), el("p", { text: s.definition })));
    return { node: node, canContinue: true };
  }

  function stageTag(s) {
    if (BP.schemaVersion === 3) return el("span", { class: "lk-sr", text: "" });
    return el("span", { class: "lk-stage", text: s.stage });
  }

  /* ---------- intro ---------- */
  function renderIntro(s) {
    var node = el("section", { class: "lk-section lk-intro" },
      stageTag(s), el("h2", { text: s.title }), tutorLine("talk", el("p", { class: "lk-lead", text: s.body })),
      el("div", { class: "lk-callout hook" }, el("span", { class: "lk-callout-icon", "aria-hidden": "true", text: "🤔" }), el("p", { text: s.hook }))
    );
    return { node: node, canContinue: true, label: "Let's go" };
  }

  /* ---------- explain ---------- */
  function renderExplain(s) {
    var node = el("section", { class: "lk-section lk-explain" }, stageTag(s), el("h2", { text: s.title }));
    node.appendChild(tutorLine.apply(null, ["teach"].concat(s.paragraphs.map(function (p) { return el("p", { text: p }); }))));
    if (s.visual) node.appendChild(renderVisual(s.visual, s.id));
    if (s.analogy) node.appendChild(el("div", { class: "lk-callout analogy" }, el("span", { class: "lk-callout-icon", "aria-hidden": "true", text: "💡" }), el("p", { text: s.analogy })));
    return { node: node, canContinue: true };
  }

  function renderVisual(v, sectionId) {
    var wrap = el("figure", { class: "lk-visual kind-" + v.kind });
    var items = v.items;
    if (v.kind === "comparison") {
      var hasValues = items.every(function (it) { return typeof it.value === "number"; });
      var max = hasValues ? Math.max.apply(null, items.map(function (it) { return it.value; })) : 1;
      var list = el("ul", { class: "lk-bars" });
      items.forEach(function (it) {
        var pct = hasValues && max > 0 ? Math.max(4, Math.round((it.value / max) * 100)) : 100;
        var bar = el("div", { class: "lk-bar", role: "img", "aria-label": it.label + ": " + it.description });
        var fill = el("div", { class: "lk-bar-fill" });
        if (it.color) fill.style.background = it.color;
        bar.appendChild(fill);
        list.appendChild(el("li", { class: "lk-bar-row" }, el("div", { class: "lk-bar-label" }, it.emoji ? el("span", { "aria-hidden": "true", text: it.emoji + " " }) : null, el("strong", { text: it.label })), bar, el("div", { class: "lk-bar-desc", text: it.description })));
        requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.width = pct + "%"; }); });
      });
      wrap.appendChild(list);
      LK.emit("animation_started", { visual: v.kind }, { sectionId: sectionId });
      setTimeout(function () { LK.emit("animation_completed", { visual: v.kind }, { sectionId: sectionId }); }, LK.reducedMotion ? 0 : 1200);
    } else if (v.kind === "orbit") {
      wrap.appendChild(buildOrbit(items, null));
    } else if (v.kind === "simulation") {
      wrap.appendChild(buildSteps(items));
    } else if (v.kind === "sequence" || v.kind === "timeline") {
      var ol = el("ol", { class: "lk-steps" });
      items.forEach(function (it, idx) {
        ol.appendChild(el("li", { class: "lk-step" }, el("span", { class: "lk-step-n", "aria-hidden": "true", text: String(idx + 1) }), el("div", {}, el("strong", { text: (it.emoji ? it.emoji + " " : "") + it.label }), el("p", { text: it.description }))));
      });
      wrap.appendChild(ol);
    } else {
      var grid = el("ul", { class: "lk-grid" });
      items.forEach(function (it) {
        grid.appendChild(el("li", { class: "lk-card-part" }, el("span", { class: "lk-part-emoji", "aria-hidden": "true", text: it.emoji || "•" }), el("strong", { text: it.label }), el("p", { text: it.description })));
      });
      wrap.appendChild(grid);
    }
    if (v.caption) wrap.appendChild(el("figcaption", { text: v.caption }));
    return wrap;
  }

  function itemKey(it) { return it.id || it.label; }

  function buildOrbit(items, onPick) {
    var stage = el("div", { class: "lk-orbit", role: "group", "aria-label": "Interactive model" });
    var center = items[0];
    var others = items.slice(1);
    var sun = el("button", { class: "lk-orbit-center", type: "button", "aria-label": center.label },
      center.emoji ? el("span", { "aria-hidden": "true", text: center.emoji }) : null,
      el("span", { class: "lk-orbit-name", text: center.label }));
    if (center.color) sun.style.background = center.color;
    sun.addEventListener("click", function () { if (onPick) onPick(center); });
    stage.appendChild(sun);
    others.forEach(function (it, idx) {
      var step = others.length > 6 ? 16 : 26;
      var r = 48 + idx * step;
      var dur = 14 + idx * 5;
      var ring = el("div", { class: "lk-orbit-ring" });
      ring.style.setProperty("--r", r + "px");
      ring.style.setProperty("--dur", dur + "s");
      if (LK.reducedMotion) ring.className += " paused";
      var body = el("button", { class: "lk-orbit-body", type: "button", "aria-label": it.label });
      if (it.color) body.style.background = it.color;
      if (it.emoji) body.appendChild(el("span", { "aria-hidden": "true", text: it.emoji }));
      body.addEventListener("click", function () { if (onPick) onPick(it); });
      ring.appendChild(body);
      stage.appendChild(ring);
    });
    return stage;
  }

  function buildSteps(items) {
    var ol = el("ol", { class: "lk-steps" });
    items.forEach(function (it, idx) {
      ol.appendChild(el("li", { class: "lk-step" }, el("span", { class: "lk-step-n", "aria-hidden": "true", text: String(idx + 1) }), el("div", {}, el("strong", { text: (it.emoji ? it.emoji + " " : "") + it.label }), el("p", { text: it.description }))));
    });
    return ol;
  }

  /* ---------- library artifact embedding ---------- */
  // Nonce fresh per session: 128 random bits hex. We can't use process.env or
  // import crypto here because this runs in a sandboxed document.
  function randomNonce() {
    var out = "";
    if (window.crypto && window.crypto.getRandomValues) {
      var buf = new Uint8Array(16);
      window.crypto.getRandomValues(buf);
      for (var i = 0; i < buf.length; i++) { var h = buf[i].toString(16); if (h.length < 2) h = "0" + h; out += h; }
      return out;
    }
    return "n" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  // Minimal event validator: name must be declared or the built-in 'interacted',
  // and every data field must be in the manifest's declared field map. Loose on
  // types since the artifact-side runtime already coerced non-object data to {}.
  function validateArtifactEvent(manifest, name, data) {
    if (typeof name !== "string" || !name) return false;
    if (name === "interacted") return !data || typeof data !== "object" || Object.keys(data).length === 0;
    var events = (manifest && manifest.events) || [];
    var decl = null;
    for (var i = 0; i < events.length; i++) if (events[i].name === name) decl = events[i];
    if (!decl) return false;
    if (data == null) data = {};
    if (typeof data !== "object" || Array.isArray(data)) return false;
    for (var k in data) {
      if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
      if (!decl.data || !decl.data[k]) return false;
    }
    return true;
  }

  function hasWebGL() {
    try {
      var c = document.createElement("canvas");
      return !!(c.getContext && (c.getContext("webgl2") || c.getContext("webgl")));
    } catch (e) { return false; }
  }

  // Returns an { node, canContinue } for the library branch, or null when we
  // should fall through to the built-in visual (no origin, no manifest, no
  // WebGL, load timeout, bad event — anything that would hurt the lesson).
  function tryLibraryBranch(s) {
    var ref = s.library;
    var lib = window.__LIBRARY__;
    if (!ref || !lib || !lib.origin) return null;
    var key = ref.artifactId + "@" + ref.version;
    var manifest = lib.manifests ? lib.manifests[key] : null;
    if (!manifest) return null;
    if (!hasWebGL()) {
      LK.emit("artifact_fallback", { libraryArtifactId: ref.artifactId, version: ref.version, reason: "no_webgl" }, { sectionId: s.id, activityId: s.id });
      return null;
    }

    var a = state.act[s.id] || (state.act[s.id] = { seen: {}, started: false, done: false, anim: false });
    var nonce = randomNonce();
    var ready = false;
    var pausedByObserver = false;

    var node = el("section", { class: "lk-section lk-explore lk-explore-library" },
      el("h2", { text: s.title }),
      tutorLine("talk", el("p", { class: "lk-lead", text: s.lead }))
    );
    var stage = el("div", { class: "lk-explore-stage lk-library-stage" });
    var iframe = el("iframe", {
      class: "lk-library-frame",
      title: s.title,
      sandbox: "allow-scripts",
      referrerpolicy: "no-referrer",
      allow: "",
      src: lib.origin + "/a/" + encodeURIComponent(ref.artifactId) + "/" + ref.version + "/" + manifest.entry
    });
    iframe.style.width = "100%";
    iframe.style.height = "min(60vh, 480px)";
    iframe.style.border = "0";
    iframe.style.borderRadius = "20px";
    iframe.style.background = "var(--lk-tile)";
    stage.appendChild(iframe);
    node.appendChild(stage);
    if (s.prompt) node.appendChild(el("p", { class: "lk-muted center", text: s.prompt }));

    function post(msg) { try { iframe.contentWindow && iframe.contentWindow.postMessage(msg, "*"); } catch (e) {} }
    function sendInit() {
      post({ source: "artifactkit-host", v: 1, kind: "ak-init", nonce: nonce, params: ref.params || {}, reducedMotion: !!LK.reducedMotion });
    }
    function setPaused(next) {
      if (pausedByObserver === next) return;
      pausedByObserver = next;
      if (!ready) return;
      post({ source: "artifactkit-host", v: 1, kind: next ? "ak-pause" : "ak-resume" });
    }

    var onMessage = function (e) {
      // Origin check is useless here: both the artifact (sandboxed) and this
      // document are opaque origins. We rely on source-window identity plus
      // the per-session nonce. Mimics the LearnKit host guard.
      if (!e || !e.data || e.source !== iframe.contentWindow) return;
      var d = e.data;
      if (d.source !== "artifactkit" || d.v !== 1) return;
      if (d.kind === "ak-ready") {
        if (ready) return;
        ready = true;
        clearTimeout(timeoutId);
        sendInit();
        if (!a.started) { a.started = true; LK.emit("activity_started", { kind: "library", artifactId: ref.artifactId, version: ref.version }, { sectionId: s.id, activityId: s.id }); }
        if (pausedByObserver) post({ source: "artifactkit-host", v: 1, kind: "ak-pause" });
      } else if (d.kind === "ak-event") {
        if (!ready || d.nonce !== nonce) return;
        if (!validateArtifactEvent(manifest, d.name, d.data)) return;
        LK.emit("artifact_interaction", {
          libraryArtifactId: ref.artifactId,
          version: ref.version,
          name: d.name,
          data: d.data || {}
        }, { sectionId: s.id, activityId: s.id });
        if (!a.done) { a.done = true; enableContinue(); }
      } else if (d.kind === "ak-error") {
        LK.emit("artifact_error", { libraryArtifactId: ref.artifactId, version: ref.version, message: String(d.message || "").slice(0, 500), fatal: !!d.fatal }, { sectionId: s.id, activityId: s.id });
      }
    };
    window.addEventListener("message", onMessage);

    // 8s timeout: ADR-002. Falls back to the built-in visual by re-rendering
    // the section. We leave the iframe in place; subsequent messages are a
    // no-op because 'ready' never flips true.
    var timeoutId = setTimeout(function () {
      if (ready) return;
      window.removeEventListener("message", onMessage);
      LK.emit("artifact_fallback", { libraryArtifactId: ref.artifactId, version: ref.version, reason: "load_timeout" }, { sectionId: s.id, activityId: s.id });
      s.library = null; // one-shot: avoid an infinite re-render loop
      go(state.i);
    }, 8000);

    // Pause when the lesson tab is hidden or the frame scrolls off-screen.
    var onVisibility = function () { setPaused(document.hidden); };
    document.addEventListener("visibilitychange", onVisibility);
    var observer = null;
    try {
      if (typeof IntersectionObserver === "function") {
        observer = new IntersectionObserver(function (entries) {
          for (var i = 0; i < entries.length; i++) setPaused(!entries[i].isIntersecting);
        }, { threshold: 0.01 });
        observer.observe(iframe);
      }
    } catch (e) {}

    return { node: node, canContinue: a.done, label: "Next" };
  }

  /* ---------- explore ---------- */
  function renderExplore(s) {
    var lib = tryLibraryBranch(s);
    if (lib) return lib;
    var a = state.act[s.id] || (state.act[s.id] = { seen: {}, started: false, done: false, anim: false });
    var items = s.visual.items;
    var need = Math.max(2, Math.ceil(items.length / 2));
    var node = el("section", { class: "lk-section lk-explore" },
      el("h2", { text: s.title }),
      tutorLine("talk", el("p", { class: "lk-lead", text: s.lead }))
    );
    var reveal = el("div", { class: "lk-reveal", "aria-live": "polite" });
    var hint = el("p", { class: "lk-muted center", text: s.prompt });

    function mark(it) {
      var key = itemKey(it);
      if (!a.started) {
        a.started = true;
        LK.emit("activity_started", { kind: "explore", items: items.length }, { sectionId: s.id, activityId: s.id });
      }
      a.seen[key] = true;
      LK.emit("item_explored", { activityId: s.id, itemId: key }, { sectionId: s.id, activityId: s.id });
      reveal.innerHTML = "";
      reveal.appendChild(el("div", { class: "lk-reveal-card" },
        el("strong", { text: (it.emoji ? it.emoji + " " : "") + it.label }),
        el("p", { text: it.description })));
      if (!a.done && Object.keys(a.seen).length >= need) {
        a.done = true;
        LK.emit("activity_completed", { kind: "explore", seen: Object.keys(a.seen).length, total: items.length }, { sectionId: s.id, activityId: s.id });
        enableContinue();
      }
    }

    var stage = el("div", { class: "lk-explore-stage" });
    if (s.visual.kind === "orbit") {
      if (!a.anim) {
        a.anim = true;
        LK.emit("animation_started", { visual: "orbit" }, { sectionId: s.id });
      }
      stage.appendChild(buildOrbit(items, mark));
    } else if (s.visual.kind === "comparison") {
      var hasValues = items.every(function (it) { return typeof it.value === "number"; });
      var max = hasValues ? Math.max.apply(null, items.map(function (it) { return it.value; })) : 1;
      var row = el("div", { class: "lk-orbs", role: "group" });
      items.forEach(function (it) {
        var size = 56;
        if (hasValues && max > 0) {
          var ratio = Math.sqrt(Math.max(0, it.value / max));
          size = Math.max(24, Math.min(140, Math.round(ratio * 140)));
        }
        var orb = el("button", { class: "lk-orb", type: "button", "aria-label": it.label },
          it.emoji ? el("span", { "aria-hidden": "true", text: it.emoji }) : null,
          el("span", { text: it.label }));
        orb.style.width = size + "px";
        orb.style.height = size + "px";
        if (it.color) orb.style.background = it.color;
        orb.addEventListener("click", function () { mark(it); });
        row.appendChild(orb);
      });
      stage.appendChild(row);
      if (!a.anim) {
        a.anim = true;
        LK.emit("animation_started", { visual: "comparison" }, { sectionId: s.id });
        setTimeout(function () { LK.emit("animation_completed", { visual: "comparison" }, { sectionId: s.id }); }, LK.reducedMotion ? 0 : 800);
      }
    } else if (s.visual.kind === "simulation") {
      var playIdx = { n: -1 };
      var steps = el("ol", { class: "lk-sim" });
      items.forEach(function (it, idx) {
        var li = el("li", { class: "lk-sim-step", "data-i": String(idx) },
          el("button", { class: "lk-sim-btn", type: "button", onClick: function () { mark(it); highlight(idx); } },
            el("span", { class: "lk-step-n", "aria-hidden": "true", text: String(idx + 1) }),
            el("strong", { text: (it.emoji ? it.emoji + " " : "") + it.label })));
        steps.appendChild(li);
      });
      function highlight(i) {
        var kids = steps.children;
        for (var k = 0; k < kids.length; k++) kids[k].classList.toggle("on", k === i);
      }
      var play = el("button", { class: "lk-btn primary", type: "button" }, LK.reducedMotion ? "Show each step" : "Play");
      play.addEventListener("click", function () {
        if (!a.anim) {
          a.anim = true;
          LK.emit("animation_started", { visual: "simulation" }, { sectionId: s.id });
        }
        playIdx.n = (playIdx.n + 1) % items.length;
        highlight(playIdx.n);
        mark(items[playIdx.n]);
        if (playIdx.n === items.length - 1) LK.emit("animation_completed", { visual: "simulation" }, { sectionId: s.id });
      });
      stage.appendChild(steps);
      stage.appendChild(el("div", { class: "lk-row center-row" }, play));
    } else {
      var grid = el("ul", { class: "lk-grid tap" });
      items.forEach(function (it) {
        var btn = el("button", { class: "lk-card-part tap", type: "button" },
          el("span", { class: "lk-part-emoji", "aria-hidden": "true", text: it.emoji || "•" }),
          el("strong", { text: it.label }));
        if (it.color) btn.style.borderColor = it.color;
        btn.addEventListener("click", function () { mark(it); });
        grid.appendChild(el("li", {}, btn));
      });
      stage.appendChild(grid);
    }

    node.appendChild(stage);
    node.appendChild(hint);
    node.appendChild(reveal);
    if (s.visual.caption) node.appendChild(el("p", { class: "lk-caption", text: s.visual.caption }));
    if (a.done) {
      var lastKey = Object.keys(a.seen).pop();
      var last = items.filter(function (it) { return itemKey(it) === lastKey; })[0];
      if (last) {
        reveal.appendChild(el("div", { class: "lk-reveal-card" },
          el("strong", { text: (last.emoji ? last.emoji + " " : "") + last.label }),
          el("p", { text: last.description })));
      }
    }
    return { node: node, canContinue: a.done, label: "Next" };
  }

  /* ---------- quiz / apply ---------- */
  function renderQuiz(s) {
    var a = state.act[s.id] || (state.act[s.id] = { qi: 0, attempts: {}, hints: {}, results: {}, done: false, started: false, selected: null });
    var node = el("section", { class: "lk-section lk-quiz" }, stageTag(s), el("h2", { text: s.title }));
    if (s.type === "apply") node.appendChild(el("div", { class: "lk-callout scenario" }, el("span", { class: "lk-callout-icon", "aria-hidden": "true", text: "🧭" }), el("p", { text: s.scenario })));
    else if (s.intro) node.appendChild(el("p", { class: "lk-muted", text: s.intro }));
    var holder = el("div", { class: "lk-quiz-holder" });
    var live = el("div", { class: "lk-live", "aria-live": "polite" });
    node.appendChild(holder); node.appendChild(live);

    function draw() {
      holder.innerHTML = ""; live.textContent = "";
      if (a.done) {
        var total = s.questions.length, correct = 0;
        for (var id in a.results) if (a.results[id]) correct++;
        holder.appendChild(el("div", { class: "lk-result" }, el("p", { class: "lk-big", text: "You answered " + correct + " of " + total + " correctly." }), el("p", { class: "lk-muted", text: correct === total ? "That's every single one. Great thinking!" : "Every mistake you fixed is something you now understand better." })));
        return;
      }
      if (!a.started) { a.started = true; LK.emit("quiz_started", { activityId: s.id, questions: s.questions.length, kind: s.type }, { sectionId: s.id, activityId: s.id }); }
      var q = s.questions[a.qi];
      var attempt = (a.attempts[q.id] || 0) + 1;
      var qWrap = el("div", { class: "lk-question", "data-kind": q.kind });
      qWrap.appendChild(el("p", { class: "lk-counter", text: "Question " + (a.qi + 1) + " of " + s.questions.length + (attempt > 1 ? " · try " + attempt : "") }));
      qWrap.appendChild(primaryLine(tutorLine("talk", el("p", { class: "lk-prompt", text: q.prompt }))));
      var answerBox = el("div", { class: "lk-answer" });
      qWrap.appendChild(answerBox);
      var getAnswer = renderInput(q, answerBox, submit);
      var actions = el("div", { class: "lk-row" });
      if (q.hint) {
        actions.appendChild(el("button", { class: "lk-btn ghost", type: "button", onClick: function () {
          a.hints[q.id] = (a.hints[q.id] || 0) + 1;
          LK.emit("hint_requested", { activityId: s.id, questionId: q.id }, { sectionId: s.id, activityId: s.id });
          live.textContent = "Hint: " + q.hint;
          feedback(el("div", { class: "lk-feedback hint" }, el("strong", { text: "Hint" }), el("p", { text: q.hint })));
        } }, "Hint"));
      }
      if (q.kind !== "true_false") actions.appendChild(el("button", { class: "lk-btn primary", type: "button", onClick: function () { submit(getAnswer()); } }, "Check"));
      qWrap.appendChild(actions);
      var fb = el("div", { class: "lk-feedback-slot" });
      qWrap.appendChild(fb);
      holder.appendChild(qWrap);
      sendContext(questionContext(s, q, attempt > 1 ? "retry" : null));
      settleTutors();

      function feedback(elm) { fb.innerHTML = ""; fb.appendChild(elm); }

      function submit(answer) {
        if (answer === null || answer === undefined || answer === "" ) { live.textContent = "Choose or type an answer first."; return; }
        dismissKeyboard();
        var ok = grade(q, answer);
        a.attempts[q.id] = attempt;
        LK.emit("question_answered", { activityId: s.id, questionId: q.id, answer: answer, attempt: attempt, hintsUsed: a.hints[q.id] || 0, clientCorrect: ok }, { sectionId: s.id, activityId: s.id });
        if (ok) {
          a.results[q.id] = true;
          state.qres[q.id] = { ok: true, first: attempt === 1 };
          state.totals.correct++; state.totals.answered++;
          if (BP.schemaVersion === 3 && attempt === 1) { state.stars++; state.sessionStars++; state.streak++; }
          live.textContent = "Correct. " + q.explanation;
          feedback(el("div", { class: "lk-feedback ok" }, el("strong", { text: BP.schemaVersion === 3 ? "Nice!" : "Yes! That's right." }), el("p", { text: q.explanation }), nextBtn()));
          disableInputs();
          sendContext(questionContext(s, q, "correct"));
        } else if (attempt < 2) {
          if (BP.schemaVersion === 3) state.streak = 0;
          live.textContent = "Not quite. Try again.";
          feedback(el("div", { class: "lk-feedback retry" }, el("strong", { text: "Not quite." }), el("p", { text: q.hint ? q.hint : "Have another look and try again." }), el("button", { class: "lk-btn soft", type: "button", onClick: function () { draw(); } }, "Try again")));
          disableInputs();
          sendContext(questionContext(s, q, "retry"));
        } else {
          a.results[q.id] = false;
          state.qres[q.id] = { ok: false, first: false };
          state.totals.answered++;
          if (BP.schemaVersion === 3) state.streak = 0;
          LK.emit("answer_revealed", { activityId: s.id, questionId: q.id }, { sectionId: s.id, activityId: s.id });
          live.textContent = "The answer is " + correctAnswerText(q) + ". " + q.explanation;
          feedback(el("div", { class: "lk-feedback reveal" }, el("strong", { text: "Here's the answer: " + correctAnswerText(q) }), el("p", { text: q.explanation }), nextBtn()));
          disableInputs();
          sendContext(questionContext(s, q, "revealed"));
        }
      }
      function disableInputs() { var ctrls = answerBox.querySelectorAll("button, input, select"); for (var i = 0; i < ctrls.length; i++) ctrls[i].disabled = true; var acts = actions.querySelectorAll("button"); for (var j = 0; j < acts.length; j++) acts[j].disabled = true; }
      function finishQuiz() {
        a.done = true;
        var total = s.questions.length, correct = 0; for (var id in a.results) if (a.results[id]) correct++;
        LK.emit("quiz_completed", { activityId: s.id, correct: correct, total: total, kind: s.type }, { sectionId: s.id, activityId: s.id });
        enableContinue();
      }
      function nextBtn() {
        var last = a.qi + 1 >= s.questions.length;
        if (last && BP.schemaVersion === 3) {
          finishQuiz();
          return el("span", {});
        }
        return el("button", { class: "lk-btn primary", type: "button", onClick: function () {
          if (last) finishQuiz();
          else a.qi++;
          draw();
        } }, last ? "See results" : "Next question");
      }
    }
    draw();
    return { node: node, canContinue: a.done };
  }

  function renderInput(q, box, submit) {
    if (q.kind === "mcq") {
      var chosen = null;
      var list = el("div", { class: "lk-options", role: "radiogroup", "aria-label": "Answer options" });
      q.options.forEach(function (o, idx) {
        var b = el("button", { class: "lk-option", type: "button", role: "radio", "aria-checked": "false" }, el("span", { class: "lk-option-key", "aria-hidden": "true", text: String.fromCharCode(65 + idx) }), el("span", { text: o.text }));
        b.addEventListener("click", function () {
          chosen = o.id;
          var all = list.querySelectorAll(".lk-option");
          for (var i = 0; i < all.length; i++) { all[i].classList.remove("selected"); all[i].setAttribute("aria-checked", "false"); }
          b.classList.add("selected"); b.setAttribute("aria-checked", "true");
        });
        list.appendChild(b);
      });
      box.appendChild(list);
      return function () { return chosen; };
    }
    if (q.kind === "true_false") {
      box.appendChild(el("div", { class: "lk-row" },
        el("button", { class: "lk-btn big", type: "button", onClick: function () { submit(true); } }, "True"),
        el("button", { class: "lk-btn big", type: "button", onClick: function () { submit(false); } }, "False")));
      return function () { return null; };
    }
    if (q.kind === "short_answer") {
      var input = el("input", { class: "lk-input", type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", enterkeyhint: "done", "aria-label": "Your answer", placeholder: "Type your answer" });
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); input.blur(); submit(input.value); } });
      box.appendChild(input);
      if (finePointer) setTimeout(function () { input.focus(); }, 50);
      return function () { return input.value; };
    }
    if (q.kind === "ordering") {
      var order = shuffled(q.items.map(function (i) { return i.id; }), q.id);
      var same = order.every(function (id, i) { return id === q.correctOrder[i]; });
      if (same) order.reverse();
      var byId = {}; q.items.forEach(function (i) { byId[i.id] = i.text; });
      var list2 = el("ol", { class: "lk-order", "aria-label": "Put these in the right order" });
      function drawOrder() {
        list2.innerHTML = "";
        order.forEach(function (id, idx) {
          list2.appendChild(el("li", { class: "lk-order-item" },
            el("span", { class: "lk-order-text", text: byId[id] }),
            el("span", { class: "lk-order-ctrls" },
              el("button", { class: "lk-mini", type: "button", "aria-label": "Move " + byId[id] + " up", disabled: idx === 0, onClick: function () { var t = order[idx - 1]; order[idx - 1] = order[idx]; order[idx] = t; drawOrder(); } }, "▲"),
              el("button", { class: "lk-mini", type: "button", "aria-label": "Move " + byId[id] + " down", disabled: idx === order.length - 1, onClick: function () { var t = order[idx + 1]; order[idx + 1] = order[idx]; order[idx] = t; drawOrder(); } }, "▼"))));
        });
      }
      drawOrder();
      box.appendChild(el("p", { class: "lk-muted", text: "Use the arrows to move items until the order is right." }));
      box.appendChild(list2);
      return function () { return order.slice(); };
    }
    if (q.kind === "fill_blank") {
      var pieces = q.text.split("___");
      var selects = [];
      var sentence = el("p", { class: "lk-blank-text" });
      pieces.forEach(function (piece, idx) {
        if (piece) sentence.appendChild(document.createTextNode(piece));
        if (idx < pieces.length - 1 && selects.length < q.blanks.length) {
          var sel = el("select", { class: "lk-select", "aria-label": "Blank " + (selects.length + 1) });
          sel.appendChild(el("option", { value: "", text: "choose…" }));
          q.options.forEach(function (o) { sel.appendChild(el("option", { value: o.id, text: o.text })); });
          selects.push(sel);
          sentence.appendChild(sel);
        }
      });
      box.appendChild(sentence);
      return function () {
        var out = selects.map(function (sel) { return sel.value; });
        return out.length && out.every(function (v) { return v; }) ? out : null;
      };
    }
    if (q.kind === "matching") {
      var rows = el("div", { class: "lk-match", role: "group", "aria-label": "Match each item" });
      var pickers = [];
      q.left.forEach(function (l) {
        var sel = el("select", { class: "lk-select", "aria-label": "Match for " + l.text });
        sel.appendChild(el("option", { value: "", text: "choose…" }));
        shuffled(q.right, q.id + l.id).forEach(function (r) { sel.appendChild(el("option", { value: r.id, text: r.text })); });
        pickers.push({ left: l.id, sel: sel });
        rows.appendChild(el("label", { class: "lk-match-row" }, el("strong", { text: l.text }), el("span", { class: "lk-match-arrow", "aria-hidden": "true", text: "→" }), sel));
      });
      box.appendChild(rows);
      return function () {
        var out = pickers.map(function (p) { return p.sel.value ? p.left + ":" + p.sel.value : ""; });
        return out.every(function (v) { return v; }) ? out : null;
      };
    }
    return function () { return null; };
  }

  /* ---------- review ---------- */
  function renderReview(s) {
    var node = el("section", { class: "lk-section lk-review" }, stageTag(s), el("h2", { text: s.title }));
    var ul = el("ul", { class: "lk-bullets" });
    s.bullets.forEach(function (b) { ul.appendChild(el("li", {}, el("span", { class: "lk-check", "aria-hidden": "true", text: "✓" }), el("span", { text: b }))); });
    node.appendChild(ul);
    if (s.nextStep) node.appendChild(el("div", { class: "lk-callout next" }, el("span", { class: "lk-callout-icon", "aria-hidden": "true", text: "➡️" }), el("p", { text: s.nextStep })));
    return { node: node, canContinue: true, label: "Finish lesson" };
  }

  function finish() {
    if (!state.reachedEnd) {
      state.reachedEnd = true;
      if (!state.reviewed) {
        var review = null;
        for (var ri = 0; ri < sections.length; ri++) if (sections[ri].type === "review") review = sections[ri];
        if (review) LK.emit("review_completed", {}, { sectionId: review.id });
      }
      LK.emit("topic_completed", { answered: state.totals.answered, correct: state.totals.correct });
    }
    root.innerHTML = "";
    root.appendChild(header());
    var done = el("section", { class: "lk-section lk-done" },
      el("div", { class: "lk-done-emoji", "aria-hidden": "true", text: BP.theme.emoji || "🎉" }),
      tutorLine("talk", el("h2", { text: "Lesson complete" }), el("p", { class: "lk-lead", text: "Here is how you did in " + BP.title + "." })));
    var fb = feedbackRows();
    if (fb.rows.length) {
      var list = el("ul", { class: "lk-feedback-list" });
      fb.rows.forEach(function (r) {
        list.appendChild(el("li", { class: "lk-fb-row " + r.status },
          el("span", { class: "lk-fb-icon", "aria-hidden": "true", text: r.status === "strong" ? "🌟" : r.status === "growing" ? "🌱" : "🔁" }),
          el("div", {}, el("strong", { text: r.text }), el("p", { text: r.label }))));
      });
      done.appendChild(list);
    }
    if (fb.recall) done.appendChild(el("p", { class: "lk-muted", text: "You also revisited " + fb.recall + " idea" + (fb.recall === 1 ? "" : "s") + " from earlier lessons." }));
    done.appendChild(el("p", { class: "lk-muted", text: fb.practise ? "Anything marked to practise will come back in a later lesson. Your grown-up can see this summary too." : "Your grown-up can see this summary too." }));
    done.appendChild(el("button", { class: "lk-btn ghost", type: "button", onClick: function () { state.i = 0; render(); } }, "Start over"));
    root.appendChild(el("main", { class: "lk-main" }, done));
    settleTutors();
    sendContext({ screen: "score", title: clip(BP.title, 200), text: "The learner reached the end of the lesson: " + state.totals.correct + " of " + state.totals.answered + " answers right." });
  }

  /* Per-objective summary from this session's answers. The server keeps the authoritative record. */
  function feedbackRows() {
    var byCode = {}, recall = 0;
    sections.forEach(function (s) {
      if (s.type !== "quiz" && s.type !== "apply") return;
      s.questions.forEach(function (q) {
        if (q.recallObjectiveId) { if (state.qres[q.id]) recall++; return; }
        (q.objectiveCodes || []).forEach(function (c) { (byCode[c] = byCode[c] || []).push(state.qres[q.id]); });
      });
    });
    var practise = 0;
    var rows = BP.learningObjectives.map(function (o) {
      var res = (byCode[o.code] || []).filter(function (r) { return r; });
      if (!res.length) return null;
      var first = res.filter(function (r) { return r.ok && r.first; }).length;
      var ok = res.filter(function (r) { return r.ok; }).length;
      var status = first === res.length ? "strong" : ok * 2 >= res.length ? "growing" : "practise";
      if (status === "practise") practise++;
      var label = status === "strong" ? "You've got this." : status === "growing" ? "Nearly there. A little more practice will lock it in." : "Let's practise this again soon.";
      return { text: o.text, status: status, label: label };
    }).filter(function (r) { return r; });
    return { rows: rows, recall: recall, practise: practise };
  }

  /* ---------- game lesson (schema v3) ---------- */
  function applyStartSession(n) {
    state.startSession = Math.max(0, Math.floor(n));
    state.doneSessions = {};
    for (var i = 0; i < Math.min(state.startSession, BP.sessions.length); i++) state.doneSessions[i] = true;
  }
  function currentSessionIndex() {
    for (var i = 0; i < BP.sessions.length; i++) if (!state.doneSessions[i]) return i;
    return BP.sessions.length;
  }
  function gameHud(sess) {
    var strip = el("div", { class: "lk-strip", "aria-label": "Progress" });
    if (sess) {
      sess.bites.forEach(function (_b, idx) {
        strip.appendChild(el("span", { class: "lk-pip" + (idx < state.bi ? " done" : idx === state.bi ? " current" : "") }));
      });
    }
    return el("header", { class: "lk-header lk-game-hud" },
      el("div", { class: "lk-brand" },
        el("span", { class: "lk-emoji", "aria-hidden": "true", text: (sess && sess.emoji) || BP.theme.emoji || "✨" }),
        el("h1", { class: "lk-title", text: sess ? sess.title : BP.title })
      ),
      el("div", { class: "lk-hud-stats" },
        el("span", { class: "lk-star", "aria-label": state.stars + " stars", text: "★ " + state.stars }),
        el("span", { class: "lk-streak", "aria-label": "streak " + state.streak, text: state.streak > 1 ? "🔥 " + state.streak : "" })
      ),
      strip
    );
  }
  function gameNav(can, label, onNext) {
    var next = el("button", { class: "lk-btn primary", type: "button", id: "lk-next", disabled: !can, onClick: onNext }, label || "Next");
    return el("nav", { class: "lk-nav", "aria-label": "Next" }, el("span", {}), next);
  }
  function openSession(i) {
    state.si = i;
    state.bi = 0;
    state.sessionStars = 0;
    state.screen = "bite";
    drawGame();
  }
  function nextBite() {
    var sess = BP.sessions[state.si];
    if (state.bi + 1 >= sess.bites.length) {
      state.screen = "session_done";
    } else {
      state.bi++;
    }
    drawGame();
  }
  function drawMap() {
    var cur = currentSessionIndex();
    var nodeList = el("ol", { class: "lk-map", "aria-label": "Rounds" });
    BP.sessions.forEach(function (sess, idx) {
      var done = !!state.doneSessions[idx];
      var current = idx === cur;
      var btn = el("button", {
        class: "lk-node" + (done ? " done" : "") + (current ? " current" : ""),
        type: "button",
        "data-id": sess.id,
        "aria-label": done ? sess.title + " replay" : current ? "Start" : sess.title,
        disabled: !done && !current,
        onClick: function () { openSession(idx); }
      },
        el("span", { class: "lk-node-emoji", "aria-hidden": "true", text: done ? "✓" : sess.emoji }),
        el("strong", { text: sess.title }),
        done ? el("span", { class: "lk-node-go", text: "Replay" }) : current ? el("span", { class: "lk-node-go", text: "Start" }) : null
      );
      nodeList.appendChild(el("li", {}, btn));
    });
    var finalReady = cur >= BP.sessions.length;
    var finalBtn = el("button", {
      class: "lk-node lk-node-final" + (finalReady ? " current" : ""),
      type: "button",
      "data-id": "final_test",
      "aria-label": finalReady ? "Start" : "Big challenge",
      disabled: !finalReady,
      onClick: function () { state.screen = "final"; state.finalQi = 0; state.finalResults = {}; drawGame(); }
    },
      el("span", { class: "lk-node-emoji", "aria-hidden": "true", text: "🏆" }),
      el("strong", { text: "Big challenge" }),
      finalReady ? el("span", { class: "lk-node-go", text: "Start" }) : null
    );
    nodeList.appendChild(el("li", {}, finalBtn));
    root.appendChild(gameHud(null));
    root.appendChild(el("main", { class: "lk-main" }, el("section", { class: "lk-section" },
      el("h2", { text: BP.title }),
      nodeList
    )));
    var c = baseContext("map", null);
    c.text = cur >= BP.sessions.length ? "All rounds are done; the big challenge is unlocked." : "Next round: " + clip(BP.sessions[cur].title, 120) + ".";
    sendContext(c);
  }
  function drawBite() {
    var sess = BP.sessions[state.si];
    var bite = sess.bites[state.bi];
    if (state.bi === 0 && !state.celebrated) {
      /* opener once per session start */
    }
    root.appendChild(gameHud(sess));
    var main = el("main", { class: "lk-main", id: "lk-main" });
    if (state.bi === 0) main.appendChild(tutorLine("talk", el("p", { class: "lk-lead", text: sess.opener })));
    var view = renderSection(bite);
    main.appendChild(view.node);
    root.appendChild(main);
    root.appendChild(gameNav(view.canContinue, "Next", nextBite));
    LK.emit("section_viewed", { index: state.bi, type: bite.type, stage: bite.stage, sessionId: sess.id }, { sectionId: bite.id });
    if (bite.type !== "quiz" && bite.type !== "apply") {
      var c = sectionContext(bite);
      if (state.bi === 0) c.text = clip(sess.opener + " " + c.text, 1400);
      sendContext(c);
    }
  }
  function drawSessionDone() {
    var sess = BP.sessions[state.si];
    if (!state.doneSessions[state.si]) {
      state.doneSessions[state.si] = true;
      LK.emit("session_completed", { sessionId: sess.id, index: state.si }, { sectionId: sess.id });
    }
    root.appendChild(gameHud(sess));
    root.appendChild(el("main", { class: "lk-main" }, el("section", { class: "lk-section lk-done" },
      el("div", { class: "lk-done-emoji", "aria-hidden": "true", text: sess.emoji || "🌟" }),
      tutorLine("talk", el("h2", { text: "Nice work" }), el("p", { class: "lk-lead", text: "★ " + state.sessionStars }))
    )));
    root.appendChild(gameNav(true, "Next", function () { state.screen = "map"; drawGame(); }));
    var c = baseContext("session_done", null);
    c.text = "The learner just finished the round " + clip(sess.title, 120) + " with " + state.sessionStars + " stars.";
    sendContext(c);
  }
  function drawFinal() {
    var qs = BP.finalTest.questions;
    var q = qs[state.finalQi];
    root.appendChild(gameHud(null));
    var main = el("main", { class: "lk-main" });
    var node = el("section", { class: "lk-section lk-quiz", "data-id": "final_test" });
    if (state.finalQi === 0) node.appendChild(tutorLine("talk", el("p", { class: "lk-lead", text: BP.finalTest.intro })));
    node.appendChild(el("p", { class: "lk-counter", text: (state.finalQi + 1) + " / " + qs.length }));
    node.appendChild(primaryLine(tutorLine("talk", el("p", { class: "lk-prompt", text: q.prompt }))));
    var fc = baseContext("final", null);
    fc.title = "Big challenge";
    fc.text = "This is the final challenge, question " + (state.finalQi + 1) + " of " + qs.length + ". It is a test: do not give hints or answers, only encourage.";
    fc.question = { prompt: clip(q.prompt, 600), options: questionOptions(q) };
    fc.answered = false;
    sendContext(fc);
    var answerBox = el("div", { class: "lk-answer" });
    node.appendChild(answerBox);
    var locked = false;
    function submit(answer) {
      if (locked) return;
      if (answer === null || answer === undefined || answer === "") return;
      dismissKeyboard();
      locked = true;
      var ok = grade(q, answer);
      state.finalResults[q.id] = ok;
      LK.emit("question_answered", { activityId: "final_test", questionId: q.id, answer: answer, attempt: 1, hintsUsed: 0, clientCorrect: ok }, { sectionId: "final_test", activityId: "final_test" });
      if (state.finalQi + 1 >= qs.length) {
        state.screen = "score";
      } else {
        state.finalQi++;
      }
      drawGame();
    }
    var getAnswer = renderInput(q, answerBox, submit);
    if (q.kind !== "true_false") {
      node.appendChild(el("div", { class: "lk-row" }, el("button", { class: "lk-btn primary", type: "button", onClick: function () { submit(getAnswer()); } }, "Check")));
    }
    main.appendChild(node);
    root.appendChild(main);
    LK.emit("section_viewed", { index: state.finalQi, type: "final_test" }, { sectionId: "final_test" });
  }
  function drawScore() {
    var qs = BP.finalTest.questions;
    var correct = 0;
    qs.forEach(function (q) { if (state.finalResults[q.id]) correct++; });
    var pass = qs.length > 0 && correct / qs.length >= 0.7;
    if (!state.reachedEnd) {
      state.reachedEnd = true;
      LK.emit("final_test_completed", { correct: correct, total: qs.length }, { sectionId: "final_test" });
      if (pass) LK.emit("topic_completed", { answered: qs.length, correct: correct });
    }
    root.appendChild(gameHud(null));
    var again = el("button", { class: "lk-btn primary", type: "button", onClick: function () {
      state.reachedEnd = false;
      state.finalQi = 0;
      state.finalResults = {};
      state.screen = "final";
      drawGame();
    } }, "Try again");
    root.appendChild(el("main", { class: "lk-main" }, el("section", { class: "lk-section lk-done" },
      el("div", { class: "lk-done-emoji", "aria-hidden": "true", text: pass ? "🎉" : "💪" }),
      tutorLine("talk", el("h2", { text: pass ? "You did it" : "Almost" }), el("p", { class: "lk-lead", text: correct + " / " + qs.length })),
      pass ? null : again
    )));
    var c = baseContext("score", null);
    c.text = "Final challenge finished: " + correct + " of " + qs.length + " right. " + (pass ? "The lesson is complete." : "Not passed yet; the learner can try again.");
    sendContext(c);
  }
  function drawGame() {
    root.innerHTML = "";
    if (!state.started) { state.started = true; LK.emit("lesson_started", { sessions: BP.sessions.length, stages: BP.stages }); }
    if (state.screen === "bite") drawBite();
    else if (state.screen === "session_done") drawSessionDone();
    else if (state.screen === "final") drawFinal();
    else if (state.screen === "score") drawScore();
    else drawMap();
    settleTutors();
    window.scrollTo(0, 0);
  }
  function playGame() {
    applyStartSession(LK.context && LK.context.startSession ? LK.context.startSession : 0);
    window.addEventListener("message", function (e) {
      var d = e.data;
      if (!d || d.source !== "learnkit-host" || d.kind !== "init") return;
      if (typeof d.startSession === "number") applyStartSession(d.startSession);
      if (state.screen === "map") drawGame();
    });
    drawGame();
  }

  if (BP.schemaVersion === 3) playGame();
  else render();
})();
`;

export const PLAYER_CSS = String.raw`
:root { --lk-primary: #177c3f; --lk-accent: #f29908; --lk-bg: #ffffff; --lk-ink: #143d27; --lk-muted: #5e7366; --lk-card: #ffffff; --lk-line: #e3e8e0; --lk-ok: #177c3f; --lk-warn: #9a5b00; --lk-radius: 22px; --lk-tile: color-mix(in srgb, var(--lk-ink) 7%, var(--lk-bg)); --lk-ease: cubic-bezier(0.23, 1, 0.32, 1); --lk-drawer: cubic-bezier(0.32, 0.72, 0, 1); --lk-safe: env(safe-area-inset-bottom, 0px); }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background: var(--lk-bg); color: var(--lk-ink); line-height: 1.5; font-size: 18px; -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: transparent; touch-action: manipulation; overscroll-behavior: none; }
html { touch-action: manipulation; }
button, a, input, select, textarea, label, summary, [role="button"] { touch-action: manipulation; }
button { -webkit-user-select: none; user-select: none; }
#app { max-width: 640px; margin: 0 auto; padding: 4px 20px calc(120px + var(--lk-safe)); }
body:has(.lk-feedback) #app { padding-bottom: 60vh; }

/* Header and HUD */
.lk-header { display: flex; flex-direction: column; gap: 14px; padding: 4px 0 24px; }
.lk-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.lk-emoji { flex: none; font-size: 28px; line-height: 1; }
.lk-title { font-size: 17px; margin: 0; font-weight: 700; line-height: 1.25; color: var(--lk-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lk-dots, .lk-strip { list-style: none; display: flex; gap: 5px; padding: 0; margin: 0; }
.lk-dot, .lk-pip { flex: 1; height: 8px; border-radius: 999px; background: color-mix(in srgb, var(--lk-ink) 10%, transparent); transition: background 300ms var(--lk-ease); }
.lk-dot.done, .lk-pip.done { background: var(--lk-primary); }
.lk-dot.current, .lk-pip.current { background: color-mix(in srgb, var(--lk-primary) 45%, transparent); }
.lk-game-hud { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px 16px; }
.lk-game-hud .lk-strip { grid-column: 1 / -1; }
.lk-game-hud .lk-strip:empty { display: none; }
.lk-game-hud:has(.lk-strip:empty) .lk-brand { visibility: hidden; }
.lk-hud-stats { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 16px; font-variant-numeric: tabular-nums; }
.lk-star, .lk-streak { display: inline-flex; align-items: center; min-height: 34px; padding: 0 12px; border-radius: 999px; background: #fff1d6; color: #9a5b00; }
.lk-streak { background: #ffe4d6; color: #9a3a00; }
.lk-streak:empty { display: none; }

/* Page */
.lk-main { background: transparent; border: 0; padding: 0; box-shadow: none; }
/* Opacity only: a transform here would trap the fixed action bar and feedback panel. */
/* backwards, not both: a filling animation keeps a stacking context that would stop the tutor art blending. */
.lk-section { animation: lk-fade 320ms var(--lk-ease) backwards; }
@keyframes lk-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes lk-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.lk-section h2 { font-size: 30px; margin: 6px 0 16px; letter-spacing: -0.025em; line-height: 1.1; outline: none; font-weight: 800; text-wrap: balance; }
.lk-section p { margin: 0 0 14px; }
.lk-stage { display: inline-block; font-size: 14px; font-weight: 700; color: var(--lk-primary); background: color-mix(in srgb, var(--lk-primary) 12%, var(--lk-card)); padding: 4px 12px; border-radius: 999px; }
.lk-lead { font-size: 21px; line-height: 1.4; }
.lk-muted { color: var(--lk-muted); font-size: 16px; }
.lk-muted.center { text-align: center; }
.lk-callout { display: flex; gap: 12px; align-items: flex-start; border-radius: 20px; padding: 16px 18px; margin: 18px 0; background: color-mix(in srgb, var(--lk-accent) 16%, var(--lk-card)); }
.lk-callout p { margin: 0; }
.lk-callout strong { display: block; margin-bottom: 2px; }
.lk-callout.analogy { background: color-mix(in srgb, var(--lk-primary) 10%, var(--lk-card)); }
.lk-callout.scenario { background: color-mix(in srgb, #177c3f 10%, var(--lk-card)); }
.lk-callout.limit { background: var(--lk-tile); }
.lk-callout-icon { font-size: 22px; line-height: 1.2; }

/* Buttons. The nav is pinned to the bottom of the frame. */
.lk-nav { position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; display: flex; justify-content: space-between; gap: 10px; padding: 12px max(20px, calc((100% - 600px) / 2)) max(16px, var(--lk-safe)); background: color-mix(in srgb, var(--lk-bg) 92%, transparent); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
.lk-nav > span:empty { display: none; }
.lk-nav .lk-btn.primary { flex: 1; min-height: 58px; font-size: 19px; }
body:has(.lk-feedback) .lk-nav { background: transparent; -webkit-backdrop-filter: none; backdrop-filter: none; }
body:has(.lk-feedback .lk-btn) .lk-nav { display: none; }
body:has(.lk-question):not(:has(.lk-feedback)) .lk-nav:has(#lk-next:disabled) { display: none; }
.lk-question > .lk-row, .lk-quiz > .lk-row { position: fixed; left: 0; right: 0; bottom: 0; z-index: 5; margin: 0; flex-wrap: nowrap; padding: 12px max(20px, calc((100% - 600px) / 2)) max(16px, var(--lk-safe)); background: color-mix(in srgb, var(--lk-bg) 92%, transparent); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
.lk-question > .lk-row .lk-btn.primary, .lk-quiz > .lk-row .lk-btn.primary { min-height: 58px; font-size: 19px; }
.lk-btn { min-height: 50px; padding: 10px 22px; font-size: 17px; font-weight: 800; font-family: inherit; border-radius: 999px; border: 0; cursor: pointer; background: var(--lk-tile); color: var(--lk-ink); transition: transform 160ms var(--lk-ease), background 200ms var(--lk-ease), opacity 200ms; }
.lk-btn:active:not(:disabled) { transform: scale(0.97); }
.lk-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.lk-btn.primary { background: var(--lk-primary); color: #fff; }
.lk-btn.soft { background: color-mix(in srgb, currentColor 12%, transparent); color: inherit; }
.lk-btn.ghost { background: transparent; }
.lk-btn.big { flex: 1; min-height: 84px; font-size: 22px; background: var(--lk-tile); }
.lk-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px; }
.lk-row .lk-btn.primary { flex: 1 1 auto; min-height: 56px; }
.lk-counter { font-size: 15px; font-weight: 700; color: var(--lk-muted); font-variant-numeric: tabular-nums; }

/* Questions */
.lk-prompt { font-size: 25px; font-weight: 800; line-height: 1.25; letter-spacing: -0.015em; margin-bottom: 20px !important; text-wrap: balance; }
.lk-options { display: grid; gap: 10px; }
.lk-option { display: flex; align-items: center; gap: 14px; text-align: left; min-height: 64px; padding: 12px 16px; border-radius: 20px; border: 0; background: var(--lk-tile); font-size: 18px; font-weight: 600; font-family: inherit; color: inherit; cursor: pointer; transition: transform 160ms var(--lk-ease), background 200ms var(--lk-ease), box-shadow 200ms var(--lk-ease); }
.lk-option:active:not(:disabled) { transform: scale(0.98); }
.lk-option:disabled { cursor: default; }
.lk-option.selected { background: color-mix(in srgb, var(--lk-primary) 14%, var(--lk-card)); box-shadow: inset 0 0 0 3px var(--lk-primary); }
.lk-option.selected .lk-option-key { background: var(--lk-primary); color: #fff; }
.lk-option-key { display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--lk-bg); font-weight: 800; font-size: 14px; flex: none; transition: background 200ms, color 200ms; }
.lk-input { width: 100%; min-height: 62px; font-size: 22px; padding: 12px 18px; border-radius: 20px; border: 0; font-family: inherit; color: inherit; background: var(--lk-tile); }
.lk-input:focus { outline: none; box-shadow: inset 0 0 0 3px var(--lk-primary); }
.lk-select { min-height: 48px; font-size: 18px; font-family: inherit; padding: 6px 12px; margin: 0 4px; border-radius: 14px; border: 0; background: var(--lk-tile); color: inherit; }
.lk-select:focus { outline: none; box-shadow: inset 0 0 0 3px var(--lk-primary); }
.lk-blank-text { font-size: 21px; line-height: 2.3; }
.lk-match { display: grid; gap: 10px; }
.lk-match-row { display: grid; grid-template-columns: 1fr auto 1.4fr; gap: 10px; align-items: center; }
.lk-match-arrow { color: var(--lk-muted); }
.lk-order { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.lk-order-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: var(--lk-tile); border-radius: 18px; padding: 8px 8px 8px 16px; font-weight: 600; }
.lk-order-ctrls { display: flex; gap: 6px; }
.lk-mini { width: 44px; height: 44px; border-radius: 50%; border: 0; background: var(--lk-card); color: inherit; font-size: 14px; cursor: pointer; transition: transform 160ms var(--lk-ease); }
.lk-mini:active:not(:disabled) { transform: scale(0.94); }
.lk-mini:disabled { opacity: 0.3; }

/* Feedback rises from the bottom, coloured by result. */
.lk-feedback { position: fixed; left: 0; right: 0; bottom: 0; z-index: 10; margin: 0; max-height: 70vh; overflow: auto; border-radius: 28px 28px 0 0; padding: 24px max(24px, calc((100% - 592px) / 2)) calc(100px + var(--lk-safe)); animation: lk-sheet 380ms var(--lk-drawer) both; background: #ddf3d0; color: #1b4d2b; }
.lk-feedback:has(> .lk-btn) { padding-bottom: max(20px, var(--lk-safe)); }
.lk-feedback strong { display: block; margin-bottom: 4px; font-size: 22px; font-weight: 800; letter-spacing: -0.01em; }
.lk-feedback p { margin: 0 0 16px; font-size: 17px; }
.lk-feedback > .lk-btn { width: 100%; min-height: 56px; font-size: 18px; }
.lk-feedback.ok > .lk-btn.primary { background: #1b4d2b; color: #ddf3d0; }
.lk-feedback.retry { background: #ffe7a3; color: #6a4300; }
.lk-feedback.retry > .lk-btn { background: #6a4300; color: #ffe7a3; }
.lk-feedback.reveal { background: #d3e9ff; color: #123f70; }
.lk-feedback.reveal > .lk-btn.primary { background: #123f70; color: #d3e9ff; }
.lk-feedback.hint { background: #e6deff; color: #3b2b86; }
@keyframes lk-sheet { from { transform: translateY(100%); } to { transform: none; } }
.lk-live, .lk-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.lk-result { text-align: center; padding: 24px 0; }
.lk-big { font-size: 24px; font-weight: 800; }

/* Teaching blocks */
.lk-explore-stage { margin: 8px 0 12px; }
.lk-orbit { position: relative; width: min(100%, 420px); aspect-ratio: 1; margin: 0 auto; border-radius: 50%; background: radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--lk-primary) 16%, transparent), transparent 58%); }
.lk-orbit-center { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 72px; height: 72px; border-radius: 50%; border: 0; background: var(--lk-accent); color: #fff; font: inherit; font-size: 12px; font-weight: 800; z-index: 3; cursor: pointer; display: grid; place-items: center; line-height: 1.1; }
.lk-orbit-name { display: block; font-size: 11px; }
.lk-orbit-ring { position: absolute; left: 50%; top: 50%; width: calc(var(--r) * 2); height: calc(var(--r) * 2); margin: calc(var(--r) * -1) 0 0 calc(var(--r) * -1); border: 1px solid color-mix(in srgb, var(--lk-ink) 14%, transparent); border-radius: 50%; animation: lk-spin var(--dur) linear infinite; }
.lk-orbit-ring.paused { animation: none; }
.lk-orbit-body { position: absolute; left: 50%; top: 0; transform: translate(-50%, -50%); width: 28px; height: 28px; border-radius: 50%; border: 0; background: var(--lk-primary); cursor: pointer; font-size: 11px; }
@keyframes lk-spin { to { transform: rotate(360deg); } }
.lk-orbs { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: center; gap: 16px; padding: 16px 0; }
.lk-orb { border: 0; border-radius: 50%; background: var(--lk-primary); color: #fff; font: inherit; font-size: 12px; font-weight: 800; cursor: pointer; display: grid; place-items: center; transition: transform 200ms var(--lk-ease); }
.lk-orb:active { transform: scale(0.94); }
.lk-reveal { min-height: 72px; margin-top: 8px; }
.lk-reveal-card, .lk-term-card { border-radius: 20px; padding: 16px 18px; background: color-mix(in srgb, var(--lk-primary) 10%, var(--lk-card)); animation: lk-rise 320ms var(--lk-ease) both; }
.lk-reveal-card p { margin: 4px 0 0; font-size: 16px; }
.lk-term-card p { margin: 6px 0 0; }
.lk-term-label { display: block; font-size: 14px; font-weight: 700; color: var(--lk-primary); }
.lk-term { font-size: 24px; }
.lk-caption { text-align: center; font-size: 14px; color: var(--lk-muted); }
.lk-sim { list-style: none; padding: 0; margin: 0 0 12px; display: grid; gap: 8px; }
.lk-sim-step { border-radius: 20px; background: var(--lk-tile); overflow: hidden; transition: background 200ms var(--lk-ease), box-shadow 200ms var(--lk-ease); }
.lk-sim-step.on { background: color-mix(in srgb, var(--lk-primary) 12%, var(--lk-card)); box-shadow: inset 0 0 0 3px var(--lk-primary); }
.lk-sim-btn { width: 100%; display: flex; align-items: center; gap: 12px; text-align: left; min-height: 56px; padding: 10px 14px; border: 0; background: transparent; font: inherit; color: inherit; cursor: pointer; }
.lk-grid { list-style: none; padding: 0; margin: 12px 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.lk-grid.tap { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); }
.lk-card-part { background: var(--lk-tile); border-radius: 20px; padding: 14px; }
.lk-card-part p { font-size: 15px; color: var(--lk-muted); margin: 4px 0 0; }
.lk-card-part.tap { width: 100%; border: 0; color: inherit; cursor: pointer; font: inherit; text-align: center; transition: transform 160ms var(--lk-ease), background 200ms; }
.lk-card-part.tap:active { transform: scale(0.97); }
.lk-part-emoji { font-size: 32px; display: block; }
.lk-center-row, .center-row { justify-content: center; }
.lk-bars { list-style: none; padding: 0; margin: 12px 0; display: grid; gap: 14px; }
.lk-bar-row { display: grid; gap: 4px; }
.lk-bar { height: 16px; background: var(--lk-tile); border-radius: 999px; overflow: hidden; }
.lk-bar-fill { height: 100%; width: 0; background: var(--lk-primary); border-radius: 999px; transition: width 1000ms var(--lk-ease); }
.lk-bar-desc { font-size: 15px; color: var(--lk-muted); }
.lk-steps, .lk-point-list, .lk-bullets { list-style: none; padding: 0; margin: 12px 0; display: grid; gap: 12px; }
.lk-step, .lk-point-list li, .lk-bullets li { display: flex; gap: 12px; align-items: flex-start; }
.lk-step-n { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--lk-primary); color: #fff; font-weight: 800; font-size: 16px; }
.lk-step p { margin: 2px 0 0; font-size: 16px; color: var(--lk-muted); }
.lk-check { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: color-mix(in srgb, var(--lk-ok) 14%, var(--lk-card)); color: var(--lk-ok); font-weight: 900; font-size: 15px; }
.lk-visual figcaption, .lk-figure figcaption { font-size: 14px; color: var(--lk-muted); text-align: center; margin-top: 8px; }
.lk-figure { margin: 8px 0; }
.lk-figure img { display: block; width: 100%; height: auto; border-radius: 22px; }
.lk-image-missing { border-radius: 22px; background: var(--lk-tile); padding: 24px; text-align: center; color: var(--lk-muted); }
.lk-mnemonic-phrase { font-size: 34px; font-weight: 900; letter-spacing: 0.02em; text-align: center; color: var(--lk-primary); margin: 8px 0 18px !important; }
.lk-mnemonic-lines { list-style: none; padding: 0; margin: 0 0 12px; display: grid; gap: 8px; }
.lk-mnemonic-lines li { display: flex; gap: 12px; align-items: center; }
.lk-cue { flex: none; min-width: 44px; padding: 6px 10px; border-radius: 14px; text-align: center; font-weight: 900; background: color-mix(in srgb, var(--lk-accent) 22%, var(--lk-card)); }

/* Endings */
.lk-done { text-align: center; padding: 32px 0 8px; }
.lk-done h2 { font-size: 36px; }
.lk-done .lk-lead { font-weight: 800; }
.lk-done-emoji { font-size: 88px; line-height: 1; display: inline-block; animation: lk-pop 560ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
@keyframes lk-pop { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.lk-feedback-list { list-style: none; padding: 0; margin: 16px 0; display: grid; gap: 8px; text-align: left; }
.lk-fb-row { display: flex; gap: 12px; align-items: flex-start; border-radius: 20px; padding: 14px 16px; background: var(--lk-tile); }
.lk-fb-row p { margin: 2px 0 0; font-size: 15px; opacity: 0.8; }
.lk-fb-row.strong { background: #ddf3d0; color: #1b4d2b; }
.lk-fb-row.growing { background: #ffe7a3; color: #6a4300; }
.lk-fb-row.practise { background: #d3e9ff; color: #123f70; }
.lk-fb-icon { font-size: 22px; line-height: 1.2; }

/* Game map: a winding path of round stops. */
.lk-section:has(> .lk-map) h2 { text-align: center; font-size: 34px; }
.lk-map { list-style: none; padding: 0; margin: 28px 0 0; display: flex; flex-direction: column; align-items: center; gap: 26px; }
.lk-map > li:nth-child(4n + 2) { transform: translateX(56px); }
.lk-map > li:nth-child(4n) { transform: translateX(-56px); }
.lk-node { display: flex; flex-direction: column; align-items: center; gap: 8px; width: auto; max-width: 13rem; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: center; cursor: pointer; transition: transform 160ms var(--lk-ease); }
.lk-node:active:not(:disabled) { transform: scale(0.96); }
.lk-node:disabled { cursor: not-allowed; }
.lk-node:disabled .lk-node-emoji { opacity: 0.45; }
.lk-node strong { font-size: 15px; line-height: 1.25; font-weight: 700; }
.lk-node:disabled strong { color: var(--lk-muted); }
.lk-node-emoji { display: grid; place-items: center; width: 80px; height: 80px; border-radius: 50%; font-size: 36px; background: var(--lk-tile); transition: transform 200ms var(--lk-ease); }
.lk-node.done .lk-node-emoji { background: var(--lk-primary); color: #fff; font-size: 32px; font-weight: 900; }
.lk-node.current .lk-node-emoji { width: 104px; height: 104px; font-size: 46px; background: var(--lk-card); box-shadow: inset 0 0 0 4px var(--lk-primary), 0 0 0 10px color-mix(in srgb, var(--lk-primary) 16%, transparent); animation: lk-pulse 2.4s ease-in-out infinite; }
.lk-node.current strong { font-size: 18px; font-weight: 800; }
.lk-node-go { display: none; }
.lk-node.current .lk-node-go { display: inline-flex; align-items: center; min-height: 40px; padding: 0 20px; margin-top: 2px; border-radius: 999px; background: var(--lk-primary); color: #fff; font-weight: 800; }
.lk-node-final .lk-node-emoji { background: color-mix(in srgb, var(--lk-accent) 22%, var(--lk-card)); }
@keyframes lk-pulse { 50% { transform: scale(1.05); } }

/* Tutor character. Without art a tutor line is a plain block. With art, one line per screen becomes
   the character and a speech bubble; the others (.lk-tutor-plain) stay plain text. */
.lk-tutor-figure { --lk-glow: color-mix(in srgb, var(--lk-ink) 22%, transparent); display: none; }
.lk-has-tutor .lk-tutor:not(.lk-tutor-plain) { display: flex; align-items: center; gap: 14px; margin: 0 0 20px; }
/* No z-index or isolation here: older art without a cutout must blend with the page so its white background drops out. */
.lk-has-tutor .lk-tutor:not(.lk-tutor-plain) .lk-tutor-figure { display: block; position: relative; flex: none; width: 128px; height: 128px; }
.lk-has-tutor .lk-tutor-figure::before { content: ""; position: absolute; inset: 0; z-index: 1; background: center / contain no-repeat; }
.lk-has-tutor .lk-tutor[data-pose="talk"] .lk-tutor-figure::before { background-image: var(--lk-tutor-talk); }
.lk-has-tutor .lk-tutor[data-pose="teach"] .lk-tutor-figure::before { background-image: var(--lk-tutor-teach); }
.lk-tutor-blend .lk-tutor-figure::before { mix-blend-mode: multiply; }
.lk-dark.lk-tutor-blend .lk-tutor-figure::before { mix-blend-mode: normal; border-radius: 28px; background-color: color-mix(in srgb, #fff 92%, var(--lk-bg)); }
/* The halo the character stands on: a soft floor shadow at rest, the live tutor's colour while it talks. */
.lk-has-tutor .lk-tutor-figure::after { content: ""; position: absolute; left: 14%; right: 14%; bottom: 4%; height: 16px; border-radius: 50%; background: radial-gradient(closest-side, var(--lk-glow), transparent); transition: background 240ms var(--lk-ease), opacity 240ms var(--lk-ease); }
.lk-tutor-blend .lk-tutor-figure::after { bottom: 2px; }
.lk-has-tutor .lk-tutor:not(.lk-tutor-plain) .lk-tutor-text { position: relative; flex: 1 1 auto; min-width: 0; padding: 14px 18px; border-radius: 22px; background: #fff; box-shadow: 0 0 0 1px var(--lk-line), 0 8px 20px -14px color-mix(in srgb, var(--lk-ink) 40%, transparent); animation: lk-rise 320ms var(--lk-ease) both; }
.lk-has-tutor .lk-tutor:not(.lk-tutor-plain) .lk-tutor-text::before { content: ""; position: absolute; left: -7px; top: 50%; width: 14px; height: 14px; margin-top: -7px; background: inherit; transform: rotate(45deg); box-shadow: -1px 1px 0 0 var(--lk-line); }
.lk-dark.lk-has-tutor .lk-tutor:not(.lk-tutor-plain) .lk-tutor-text { background: var(--lk-card); }
.lk-has-tutor .lk-tutor:not(.lk-tutor-plain) .lk-tutor-text > :last-child { margin-bottom: 0 !important; }
.lk-has-tutor .lk-done .lk-tutor:not(.lk-tutor-plain) { justify-content: center; text-align: left; }
.lk-has-tutor .lk-done .lk-tutor:not(.lk-tutor-plain) .lk-tutor-text { flex: 0 1 auto; }
.lk-has-tutor .lk-done .lk-tutor-text h2 { margin: 0 0 4px; }
body[data-tutor="listening"] .lk-tutor-figure { --lk-glow: var(--lk-primary); }
body[data-tutor="thinking"] .lk-tutor-figure { --lk-glow: #8b7cf6; }
body[data-tutor="speaking"] .lk-tutor-figure { --lk-glow: var(--lk-accent); }
body[data-tutor] .lk-tutor-figure::after { left: 6%; right: 6%; height: 22px; bottom: calc(4% - 3px); background: radial-gradient(closest-side, color-mix(in srgb, var(--lk-glow) 85%, transparent), color-mix(in srgb, var(--lk-glow) 30%, transparent) 60%, transparent); }
body[data-tutor="thinking"] .lk-tutor-figure::after { animation: lk-halo 1.6s ease-in-out infinite; }
body[data-tutor="speaking"] .lk-tutor-figure::after { animation: lk-halo 1s ease-in-out infinite; }
@keyframes lk-halo { 50% { transform: scaleX(0.8); opacity: 0.6; } }

:focus-visible { outline: 3px solid var(--lk-primary); outline-offset: 3px; }
@media (max-width: 420px) { .lk-has-tutor .lk-tutor:not(.lk-tutor-plain) { gap: 12px; } .lk-has-tutor .lk-tutor:not(.lk-tutor-plain) .lk-tutor-figure { width: 104px; height: 104px; } .lk-has-tutor .lk-tutor:not(.lk-tutor-plain) .lk-tutor-text { padding: 12px 15px; } }
@media (max-width: 420px) { #app { padding-left: 16px; padding-right: 16px; } .lk-section h2 { font-size: 26px; } .lk-lead { font-size: 19px; } .lk-prompt { font-size: 22px; } .lk-option { min-height: 58px; font-size: 17px; } .lk-match-row { grid-template-columns: 1fr; gap: 4px; } .lk-match-arrow { display: none; } .lk-map > li:nth-child(4n + 2) { transform: translateX(40px); } .lk-map > li:nth-child(4n) { transform: translateX(-40px); } }
@media (min-width: 640px) { body { font-size: 19px; } #app { padding-top: 16px; } .lk-section h2 { font-size: 36px; } .lk-prompt { font-size: 28px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: 1ms !important; animation-duration: 1ms !important; animation-iteration-count: 1 !important; } }
.lk-reduced-motion *, .lk-reduced-motion *::before, .lk-reduced-motion *::after { transition-duration: 1ms !important; animation-duration: 1ms !important; animation-iteration-count: 1 !important; }
.lk-dark .lk-mini, .lk-dark .lk-node.current .lk-node-emoji { background: var(--lk-card); color: var(--lk-ink); }
.lk-dark .lk-option, .lk-dark .lk-input, .lk-dark .lk-select, .lk-dark .lk-btn { color: var(--lk-ink); }
.lk-dark .lk-btn.primary { color: #fff; }
.lk-dark .lk-stage, .lk-dark .lk-term-label { color: color-mix(in srgb, var(--lk-primary) 55%, white); }
`;
