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

  var sections = BP.sections.filter(function (s) { return s.type !== "flashcards"; });
  var state = { i: 0, started: false, act: {}, reachedEnd: false, totals: { correct: 0, answered: 0 } };

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
    return false;
  }
  function correctAnswerText(q) {
    if (q.kind === "mcq") { for (var i = 0; i < q.options.length; i++) if (q.options[i].id === q.correctOptionId) return q.options[i].text; }
    if (q.kind === "true_false") return q.answer ? "True" : "False";
    if (q.kind === "short_answer") return q.acceptedAnswers[0];
    if (q.kind === "ordering") { var m = {}; q.items.forEach(function (it) { m[it.id] = it.text; }); return q.correctOrder.map(function (id) { return m[id]; }).join(" → "); }
    return "";
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
    root.appendChild(nav(view.canContinue, view.label));
    LK.emit("section_viewed", { index: state.i, type: s.type, stage: s.stage }, { sectionId: s.id });
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
    return { node: el("section", {}, el("h2", { text: s.title })), canContinue: true };
  }

  function stageTag(s) { return el("span", { class: "lk-stage", text: s.stage }); }

  /* ---------- intro ---------- */
  function renderIntro(s) {
    var node = el("section", { class: "lk-section lk-intro" },
      stageTag(s), el("h2", { text: s.title }), el("p", { class: "lk-lead", text: s.body }),
      el("div", { class: "lk-callout hook" }, el("span", { class: "lk-callout-icon", "aria-hidden": "true", text: "🤔" }), el("p", { text: s.hook }))
    );
    return { node: node, canContinue: true, label: "Let's go" };
  }

  /* ---------- explain ---------- */
  function renderExplain(s) {
    var node = el("section", { class: "lk-section lk-explain" }, stageTag(s), el("h2", { text: s.title }));
    s.paragraphs.forEach(function (p) { node.appendChild(el("p", { text: p })); });
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

  /* ---------- explore ---------- */
  function renderExplore(s) {
    var a = state.act[s.id] || (state.act[s.id] = { seen: {}, started: false, done: false, anim: false });
    var items = s.visual.items;
    var need = Math.max(2, Math.ceil(items.length / 2));
    var node = el("section", { class: "lk-section lk-explore" },
      el("h2", { text: s.title }),
      el("p", { class: "lk-lead", text: s.lead })
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
      qWrap.appendChild(el("p", { class: "lk-prompt", text: q.prompt }));
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

      function feedback(elm) { fb.innerHTML = ""; fb.appendChild(elm); }

      function submit(answer) {
        if (answer === null || answer === undefined || answer === "" ) { live.textContent = "Choose or type an answer first."; return; }
        var ok = grade(q, answer);
        a.attempts[q.id] = attempt;
        LK.emit("question_answered", { activityId: s.id, questionId: q.id, answer: answer, attempt: attempt, hintsUsed: a.hints[q.id] || 0, clientCorrect: ok }, { sectionId: s.id, activityId: s.id });
        if (ok) {
          a.results[q.id] = attempt === 1 && !(a.hints[q.id] > 0) ? true : true;
          state.totals.correct++; state.totals.answered++;
          live.textContent = "Correct. " + q.explanation;
          feedback(el("div", { class: "lk-feedback ok" }, el("strong", { text: "Yes! That's right." }), el("p", { text: q.explanation }), nextBtn()));
          disableInputs();
        } else if (attempt < 2) {
          live.textContent = "Not quite. Try again.";
          feedback(el("div", { class: "lk-feedback retry" }, el("strong", { text: "Not quite." }), el("p", { text: q.hint ? "Have another go. Hint: " + q.hint : "Have another look and try again." }), el("button", { class: "lk-btn soft", type: "button", onClick: function () { draw(); } }, "Try again")));
          disableInputs();
        } else {
          a.results[q.id] = false;
          state.totals.answered++;
          LK.emit("answer_revealed", { activityId: s.id, questionId: q.id }, { sectionId: s.id, activityId: s.id });
          live.textContent = "The answer is " + correctAnswerText(q) + ". " + q.explanation;
          feedback(el("div", { class: "lk-feedback reveal" }, el("strong", { text: "Here's the answer: " + correctAnswerText(q) }), el("p", { text: q.explanation }), nextBtn()));
          disableInputs();
        }
      }
      function disableInputs() { var ctrls = answerBox.querySelectorAll("button, input"); for (var i = 0; i < ctrls.length; i++) ctrls[i].disabled = true; var acts = actions.querySelectorAll("button"); for (var j = 0; j < acts.length; j++) acts[j].disabled = true; }
      function nextBtn() {
        return el("button", { class: "lk-btn primary", type: "button", onClick: function () {
          if (a.qi + 1 >= s.questions.length) {
            a.done = true;
            var total = s.questions.length, correct = 0; for (var id in a.results) if (a.results[id]) correct++;
            LK.emit("quiz_completed", { activityId: s.id, correct: correct, total: total, kind: s.type }, { sectionId: s.id, activityId: s.id });
            enableContinue();
          } else a.qi++;
          draw();
        } }, a.qi + 1 >= s.questions.length ? "See results" : "Next question");
      }
    }
    draw();
    return { node: node, canContinue: a.done };
  }

  function renderInput(q, box, submit) {
    if (q.kind === "mcq") {
      var chosen = null;
      var list = el("div", { class: "lk-options", role: "radiogroup", "aria-label": "Answer options" });
      q.options.forEach(function (o) {
        var b = el("button", { class: "lk-option", type: "button", role: "radio", "aria-checked": "false" }, el("span", { class: "lk-option-key", "aria-hidden": "true", text: o.id.toUpperCase() }), el("span", { text: o.text }));
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
      var input = el("input", { class: "lk-input", type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "Your answer", placeholder: "Type your answer" });
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(input.value); });
      box.appendChild(input);
      setTimeout(function () { input.focus(); }, 50);
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
    root.appendChild(el("main", { class: "lk-main" }, el("section", { class: "lk-section lk-done" },
      el("div", { class: "lk-done-emoji", "aria-hidden": "true", text: BP.theme.emoji || "🎉" }),
      el("h2", { text: "Lesson complete" }),
      el("p", { class: "lk-lead", text: "You explored " + BP.title + ". You can come back any time to practise again." }),
      el("button", { class: "lk-btn ghost", type: "button", onClick: function () { state.i = 0; render(); } }, "Start over"))));
  }

  render();
})();
`;

export const PLAYER_CSS = String.raw`
:root { --lk-primary: #15803d; --lk-accent: #f59e0b; --lk-bg: #f8f5ee; --lk-ink: #1f2a24; --lk-muted: #5f6b64; --lk-card: #ffffff; --lk-line: #e5dfd2; --lk-ok: #15803d; --lk-warn: #b45309; --lk-radius: 22px; --lk-shade: color-mix(in srgb, var(--lk-primary) 72%, black); }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: "Nunito", ui-rounded, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background: var(--lk-bg); color: var(--lk-ink); line-height: 1.55; font-size: 18px; -webkit-font-smoothing: antialiased; touch-action: manipulation; }
html { touch-action: manipulation; }
button, a, input, select, textarea, label, summary, [role="button"] { touch-action: manipulation; }
#app { max-width: 720px; margin: 0 auto; padding: 16px 16px 40px; }
.lk-header { display: flex; flex-direction: column; gap: 14px; padding: 8px 0 16px; }
.lk-brand { display: flex; align-items: center; gap: 12px; }
.lk-emoji { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 14px; font-size: 26px; background: var(--lk-card); box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
.lk-title { font-size: 22px; margin: 0; font-weight: 900; letter-spacing: -0.015em; line-height: 1.2; }
.lk-dots { list-style: none; display: flex; gap: 6px; padding: 0; margin: 0; }
.lk-dot { flex: 1; height: 10px; border-radius: 999px; background: color-mix(in srgb, var(--lk-ink) 10%, transparent); transition: background 300ms, transform 300ms; }
.lk-dot.done { background: var(--lk-primary); opacity: 0.5; }
.lk-dot.current { background: var(--lk-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--lk-primary) 18%, transparent); }
.lk-main { background: var(--lk-card); border-radius: var(--lk-radius); padding: 22px 20px; border: 1px solid var(--lk-line); box-shadow: 0 1px 0 rgba(0,0,0,0.03), 0 14px 36px -16px rgba(0,0,0,0.18); }
.lk-section { animation: lk-rise 380ms cubic-bezier(.2,.8,.2,1) both; }
@keyframes lk-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.lk-section h2 { font-size: 26px; margin: 8px 0 14px; letter-spacing: -0.02em; line-height: 1.2; outline: none; font-weight: 900; text-wrap: balance; }
.lk-section p { margin: 0 0 14px; }
.lk-stage { display: inline-block; font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 900; color: var(--lk-primary); background: color-mix(in srgb, var(--lk-primary) 12%, white); padding: 4px 10px; border-radius: 999px; }
.lk-lead { font-size: 20px; }
.lk-muted { color: var(--lk-muted); font-size: 16px; }
.lk-muted.center { text-align: center; }
.lk-callout { display: flex; gap: 12px; align-items: flex-start; border-radius: 16px; padding: 14px 16px; margin: 16px 0; background: color-mix(in srgb, var(--lk-accent) 14%, white); border-left: 5px solid var(--lk-accent); }
.lk-callout p { margin: 0; }
.lk-callout.analogy { background: color-mix(in srgb, var(--lk-primary) 9%, white); border-left-color: var(--lk-primary); }
.lk-callout.scenario { background: #f0fdf4; border-left-color: #16a34a; }
.lk-callout-icon { font-size: 22px; line-height: 1.2; }
.lk-nav { display: flex; justify-content: space-between; gap: 12px; padding-top: 18px; }
.lk-btn { min-height: 50px; padding: 10px 22px; font-size: 17px; font-weight: 800; font-family: inherit; border-radius: 999px; border: 2px solid transparent; cursor: pointer; background: color-mix(in srgb, var(--lk-ink) 6%, var(--lk-card)); color: var(--lk-ink); transition: transform 120ms, background 160ms, box-shadow 160ms, border-color 160ms; }
.lk-btn:hover:not(:disabled) { transform: translateY(-1px); }
.lk-btn:active:not(:disabled) { transform: translateY(1px); }
.lk-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.lk-btn.primary { background: var(--lk-primary); color: #fff; box-shadow: 0 3px 0 var(--lk-shade); }
.lk-btn.primary:hover:not(:disabled) { box-shadow: 0 4px 0 var(--lk-shade); }
.lk-btn.primary:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 1px 0 var(--lk-shade); }
.lk-btn.soft { background: color-mix(in srgb, var(--lk-primary) 12%, white); color: var(--lk-primary); }
.lk-btn.ghost { background: transparent; border-color: var(--lk-line); }
.lk-btn.big { flex: 1; min-height: 66px; font-size: 20px; background: var(--lk-card); border-color: var(--lk-line); box-shadow: 0 2px 0 var(--lk-line); }
.lk-btn.big:hover:not(:disabled) { border-color: var(--lk-primary); }
.lk-row { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
.lk-counter { font-size: 13px; font-weight: 900; color: var(--lk-muted); text-transform: uppercase; letter-spacing: 0.1em; }
.lk-prompt { font-size: 21px; font-weight: 800; margin-bottom: 16px !important; }
.lk-options { display: grid; gap: 10px; }
.lk-option { display: flex; align-items: center; gap: 12px; text-align: left; min-height: 58px; padding: 12px 14px; border-radius: 16px; border: 2px solid var(--lk-line); background: var(--lk-card); font-size: 17px; font-family: inherit; color: inherit; cursor: pointer; box-shadow: 0 2px 0 var(--lk-line); transition: transform 120ms, border-color 140ms, background 140ms, box-shadow 140ms; }
.lk-option:hover:not(:disabled) { border-color: var(--lk-primary); transform: translateY(-1px); }
.lk-option:active:not(:disabled) { transform: translateY(1px); box-shadow: none; }
.lk-option.selected { border-color: var(--lk-primary); background: color-mix(in srgb, var(--lk-primary) 8%, white); box-shadow: 0 2px 0 var(--lk-primary); }
.lk-option.selected .lk-option-key { background: var(--lk-primary); color: #fff; }
.lk-option-key { display: inline-grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: color-mix(in srgb, var(--lk-ink) 6%, var(--lk-card)); font-weight: 900; font-size: 13px; flex: none; transition: background 140ms, color 140ms; }
.lk-input { width: 100%; min-height: 58px; font-size: 20px; padding: 12px 16px; border-radius: 16px; border: 2px solid var(--lk-line); font-family: inherit; color: inherit; background: var(--lk-card); }
.lk-input:focus { border-color: var(--lk-primary); outline: none; box-shadow: 0 0 0 4px color-mix(in srgb, var(--lk-primary) 20%, transparent); }
.lk-feedback { border-radius: 16px; padding: 14px 16px; margin-top: 14px; animation: lk-rise 300ms cubic-bezier(.2,.8,.2,1) both; }
.lk-feedback strong { display: block; margin-bottom: 4px; font-size: 18px; }
.lk-feedback p { margin: 0 0 10px; }
.lk-feedback.ok { background: #f0fdf4; border: 2px solid #86efac; }
.lk-feedback.retry { background: #fffbeb; border: 2px solid #fcd34d; }
.lk-feedback.reveal { background: #eff6ff; border: 2px solid #93c5fd; }
.lk-feedback.hint { background: #faf5ff; border: 2px solid #d8b4fe; }
.lk-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.lk-result { text-align: center; padding: 20px 0; }
.lk-big { font-size: 22px; font-weight: 800; }
.lk-explore-stage { margin: 8px 0 12px; }
.lk-orbit { position: relative; width: min(100%, 420px); aspect-ratio: 1; margin: 0 auto; border-radius: 50%; background: radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--lk-primary) 16%, transparent), transparent 58%); }
.lk-orbit-center { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 72px; height: 72px; border-radius: 50%; border: 0; background: var(--lk-accent); color: #fff; font: inherit; font-size: 12px; font-weight: 800; z-index: 3; box-shadow: 0 0 28px color-mix(in srgb, var(--lk-accent) 55%, transparent); cursor: pointer; display: grid; place-items: center; line-height: 1.1; }
.lk-orbit-name { display: block; font-size: 11px; }
.lk-orbit-ring { position: absolute; left: 50%; top: 50%; width: calc(var(--r) * 2); height: calc(var(--r) * 2); margin: calc(var(--r) * -1) 0 0 calc(var(--r) * -1); border: 1px solid color-mix(in srgb, var(--lk-ink) 14%, transparent); border-radius: 50%; animation: lk-spin var(--dur) linear infinite; }
.lk-orbit-ring.paused { animation: none; }
.lk-orbit-body { position: absolute; left: 50%; top: 0; transform: translate(-50%, -50%); width: 26px; height: 26px; border-radius: 50%; border: 0; background: var(--lk-primary); cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.18); font-size: 11px; }
@keyframes lk-spin { to { transform: rotate(360deg); } }
.lk-orbs { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: center; gap: 16px; padding: 16px 0; }
.lk-orb { border: 0; border-radius: 50%; background: var(--lk-primary); color: #fff; font: inherit; font-size: 12px; font-weight: 800; cursor: pointer; display: grid; place-items: center; box-shadow: 0 6px 16px color-mix(in srgb, var(--lk-primary) 30%, transparent); transition: transform 160ms; }
.lk-orb:hover { transform: scale(1.06); }
.lk-reveal { min-height: 72px; margin-top: 8px; }
.lk-reveal-card { border-radius: 16px; padding: 14px 16px; background: color-mix(in srgb, var(--lk-primary) 8%, var(--lk-card)); border: 2px solid color-mix(in srgb, var(--lk-primary) 28%, transparent); }
.lk-reveal-card p { margin: 4px 0 0; font-size: 16px; }
.lk-caption { text-align: center; font-size: 13px; color: var(--lk-muted); }
.lk-sim { list-style: none; padding: 0; margin: 0 0 12px; display: grid; gap: 8px; }
.lk-sim-step { border-radius: 16px; border: 2px solid var(--lk-line); overflow: hidden; transition: border-color 140ms, background 140ms; }
.lk-sim-step.on { border-color: var(--lk-primary); background: color-mix(in srgb, var(--lk-primary) 8%, white); }
.lk-sim-btn { width: 100%; display: flex; align-items: center; gap: 12px; text-align: left; min-height: 52px; padding: 10px 12px; border: 0; background: transparent; font: inherit; color: inherit; cursor: pointer; }
.lk-card-part.tap { width: 100%; border: 2px solid var(--lk-line); background: var(--lk-card); color: inherit; cursor: pointer; font: inherit; text-align: center; box-shadow: 0 2px 0 var(--lk-line); transition: transform 120ms, border-color 140ms; }
.lk-card-part.tap:hover { border-color: var(--lk-primary); transform: translateY(-1px); }
.lk-grid.tap { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
.lk-center-row, .center-row { justify-content: center; }
.lk-bars { list-style: none; padding: 0; margin: 12px 0; display: grid; gap: 12px; }
.lk-bar-row { display: grid; gap: 4px; }
.lk-bar { height: 22px; background: color-mix(in srgb, var(--lk-ink) 7%, var(--lk-card)); border-radius: 999px; overflow: hidden; }
.lk-bar-fill { height: 100%; width: 0; background: linear-gradient(90deg, var(--lk-primary), var(--lk-accent)); border-radius: 999px; transition: width 1000ms cubic-bezier(.2,.8,.2,1); }
.lk-bar-desc { font-size: 15px; color: var(--lk-muted); }
.lk-steps { list-style: none; padding: 0; margin: 12px 0; display: grid; gap: 10px; }
.lk-step { display: flex; gap: 12px; align-items: flex-start; }
.lk-step-n { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--lk-primary); color: #fff; font-weight: 800; }
.lk-step p { margin: 2px 0 0; font-size: 16px; color: var(--lk-muted); }
.lk-grid { list-style: none; padding: 0; margin: 12px 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.lk-card-part { background: color-mix(in srgb, var(--lk-ink) 4%, var(--lk-card)); border-radius: 16px; padding: 12px; }
.lk-card-part p { font-size: 15px; color: var(--lk-muted); margin: 4px 0 0; }
.lk-part-emoji { font-size: 28px; display: block; }
.lk-visual figcaption { font-size: 14px; color: var(--lk-muted); text-align: center; margin-top: 8px; }
.lk-order { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.lk-order-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: var(--lk-card); border: 2px solid var(--lk-line); border-radius: 14px; padding: 10px 12px; }
.lk-order-ctrls { display: flex; gap: 6px; }
.lk-mini { width: 44px; height: 44px; border-radius: 12px; border: 2px solid var(--lk-line); background: var(--lk-card); color: inherit; font-size: 16px; cursor: pointer; box-shadow: 0 2px 0 var(--lk-line); }
.lk-mini:hover:not(:disabled) { border-color: var(--lk-primary); }
.lk-mini:disabled { opacity: 0.3; }
.lk-bullets { list-style: none; padding: 0; margin: 0 0 12px; display: grid; gap: 10px; }
.lk-bullets li { display: flex; gap: 10px; align-items: flex-start; font-size: 18px; }
.lk-check { color: var(--lk-ok); font-weight: 900; }
.lk-done { text-align: center; padding: 30px 0; }
.lk-done-emoji { font-size: 64px; display: inline-block; animation: lk-pop 500ms cubic-bezier(.2,.9,.3,1.3) both; }
@keyframes lk-pop { from { transform: scale(.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
:focus-visible { outline: 3px solid var(--lk-accent); outline-offset: 3px; }
@media (max-width: 420px) { #app { padding: 12px 12px 32px; } .lk-main { padding: 18px 14px; border-radius: 18px; } .lk-section h2 { font-size: 22px; margin: 6px 0 10px; } .lk-lead { font-size: 18px; } .lk-prompt { font-size: 19px; margin-bottom: 12px !important; } .lk-btn { min-height: 46px; padding: 8px 16px; font-size: 16px; } .lk-btn.big { min-height: 56px; font-size: 18px; } .lk-nav { gap: 8px; padding-top: 14px; } .lk-option { min-height: 54px; padding: 10px 12px; font-size: 16px; } .lk-input { min-height: 52px; font-size: 18px; padding: 10px 14px; } .lk-callout { padding: 12px 14px; border-radius: 14px; } .lk-emoji { width: 40px; height: 40px; font-size: 24px; } .lk-title { font-size: 20px; } }
@media (min-width: 640px) { body { font-size: 19px; } #app { padding: 28px 24px 60px; } .lk-main { padding: 30px 32px; } .lk-section h2 { font-size: 30px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } .lk-bar-fill { transition: none; } }
.lk-reduced-motion *, .lk-reduced-motion *::before, .lk-reduced-motion *::after { transition: none !important; animation: none !important; }
.lk-dark .lk-main, .lk-dark .lk-option, .lk-dark .lk-input, .lk-dark .lk-order-item, .lk-dark .lk-card-part, .lk-dark .lk-card-part.tap, .lk-dark .lk-reveal-card, .lk-dark .lk-sim-step { background: var(--lk-card); border-color: var(--lk-line); color: var(--lk-ink); }
.lk-dark .lk-btn { background: color-mix(in srgb, var(--lk-card) 80%, white); color: var(--lk-ink); }
.lk-dark .lk-btn.ghost { border-color: var(--lk-line); }
.lk-dark .lk-btn.soft { background: color-mix(in srgb, var(--lk-primary) 22%, var(--lk-card)); }
.lk-dark .lk-option.selected { background: color-mix(in srgb, var(--lk-primary) 22%, var(--lk-card)); }
.lk-dark .lk-callout { background: color-mix(in srgb, var(--lk-accent) 18%, var(--lk-card)); color: var(--lk-ink); }
.lk-dark .lk-callout.analogy { background: color-mix(in srgb, var(--lk-primary) 18%, var(--lk-card)); }
.lk-dark .lk-stage { background: color-mix(in srgb, var(--lk-primary) 22%, var(--lk-card)); }
.lk-dark .lk-feedback.ok { background: #14532d; border-color: #166534; color: #bbf7d0; }
.lk-dark .lk-feedback.retry { background: #713f12; border-color: #a16207; color: #fde68a; }
.lk-dark .lk-feedback.reveal { background: #1e3a5f; border-color: #1d4ed8; color: #bfdbfe; }
`;
