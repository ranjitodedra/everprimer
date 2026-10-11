/**
 * Play-through driver, run by `playThroughLesson` in a sandboxed child Node
 * process (`node -e`). It loads a lesson document in jsdom, plays it the way a
 * child would using the blueprint's answer key, and prints a JSON report.
 *
 * Kept as plain CommonJS in a string, like the LearnKit runtime, so it needs no
 * build step and no file path at runtime. It must not contain backticks or a
 * dollar sign followed by a brace.
 */
export const PLAYTHROUGH_DRIVER_SOURCE = String.raw`
"use strict";
var JSDOM = require("jsdom").JSDOM;
var VirtualConsole = require("jsdom").VirtualConsole;

var input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", function (c) { input += c; });
process.stdin.on("end", function () {
  var job;
  try { job = JSON.parse(input); } catch (e) { return done({ status: "error", reason: "unreadable input" }); }
  run(job.html, job.blueprint).then(done, function (e) { done({ status: "error", reason: String((e && e.stack) || e) }); });
});
function done(report) { process.stdout.write(JSON.stringify(report), function () { process.exit(0); }); }

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function norm(s) {
  return String(s == null ? "" : s).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function hasWords(text, want) { return want !== "" && (" " + text + " ").indexOf(" " + want + " ") >= 0; }
/** The text is the choice itself, optionally behind a short key such as "a" or "2". */
function keyed(text, choice) {
  if (text === choice) return true;
  var key = text.length - choice.length - 1;
  return key >= 1 && key <= 2 && text.slice(-(choice.length + 1)) === " " + choice;
}

/** Absorbs any call, property read or construction. Stands in for canvas, audio and speech APIs jsdom lacks. */
function anything() {
  var store = {};
  var fn = function () {};
  return new Proxy(fn, {
    get: function (t, p) {
      if (p === Symbol.toPrimitive) return function () { return 0; };
      if (p === "then") return undefined;
      if (Object.prototype.hasOwnProperty.call(store, p)) return store[p];
      return anything();
    },
    set: function (t, p, v) { store[p] = v; return true; },
    apply: function () { return anything(); },
    construct: function () { return anything(); }
  });
}

function prepare(w, events, errors) {
  w.addEventListener("message", function (e) {
    var m = e.data;
    if (m && m.source === "learnkit" && m.kind === "event" && m.event) events.push(m.event);
  });
  w.addEventListener("error", function (e) {
    var msg = (e && (e.message || (e.error && e.error.message))) || "script error";
    errors.push(String(msg));
  });

  // Animations and feedback delays still run, just fast.
  var st = w.setTimeout, si = w.setInterval;
  w.setTimeout = function (fn, ms) {
    var rest = Array.prototype.slice.call(arguments, 2);
    return st.apply(w, [fn, Math.min(Number(ms) || 0, 40)].concat(rest));
  };
  w.setInterval = function (fn, ms) {
    var rest = Array.prototype.slice.call(arguments, 2);
    return si.apply(w, [fn, Math.max(20, Math.min(Number(ms) || 0, 80))].concat(rest));
  };

  w.matchMedia = function (q) {
    return { matches: /reduce/.test(String(q)), media: String(q), onchange: null,
      addListener: function () {}, removeListener: function () {}, addEventListener: function () {},
      removeEventListener: function () {}, dispatchEvent: function () { return false; } };
  };
  function Observer() {}
  Observer.prototype.observe = function () {};
  Observer.prototype.unobserve = function () {};
  Observer.prototype.disconnect = function () {};
  Observer.prototype.takeRecords = function () { return []; };
  if (!w.ResizeObserver) w.ResizeObserver = Observer;
  if (!w.IntersectionObserver) w.IntersectionObserver = Observer;

  var EP = w.Element.prototype;
  EP.scrollIntoView = function () {};
  EP.scrollTo = function () {};
  EP.scrollBy = function () {};
  EP.animate = function () { return anything(); };
  EP.getAnimations = function () { return []; };
  w.scrollTo = function () {};
  w.scrollBy = function () {};
  w.HTMLCanvasElement.prototype.getContext = function () { return anything(); };
  w.HTMLCanvasElement.prototype.toDataURL = function () { return "data:,"; };
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.load = function () {};
  w.AudioContext = function () { return anything(); };
  w.webkitAudioContext = w.AudioContext;
  w.speechSynthesis = anything();
  w.SpeechSynthesisUtterance = function () { return anything(); };
}

var CLICKABLE = "button, a[href], input, select, textarea, label, summary, [role=button], [role=radio], [role=option], [role=checkbox], [role=tab], [role=link], [role=switch], [role=menuitem], [tabindex], [onclick], [data-option-id], [data-option], [data-id], [data-item-id], [data-answer], [data-value], [data-choice]";
var NEXT_RE = /\b(next|continue|finish|done|results|complete|keep going|let s go|lets go|let s start|start|begin|got it|i m ready|ready|move on|see how|how i did|my score|summary|proceed|explore|enter|take the|quiz|final check|on to|onward)\b/;
var BLOCK_RE = /\b(back|previous|prev|hint|again|retry|restart|replay|reset|start over|skip|read aloud|listen|speak|sound|mute|unmute|close|menu|help|answer|reveal)\b/;
var FORWARD_ARROW_RE = /[\u2192\u203A\u00BB\u279C\u27A1\u25B6]|->/;
var BACK_ARROW_RE = /[\u2190\u2039\u00AB\u2B05\u25C0]|<-/;
var CHECK_RE = /^(check|submit|answer|done|confirm|lock|ok|enter|that s my answer|is it right)\b/;
var TRY_RE = /\b(try again|try it again|have another go|retry)\b/;
var REVEAL_RE = /\b(show( me)?( the)? answer|reveal)\b/;
var ACTIVATE_RE = /^(play|run|watch|animate|step|next step|start the|start animation|start simulation)\b/;

async function run(html, bp) {
  var events = [];
  var errors = [];
  var steps = [];
  var dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    beforeParse: function (w) { prepare(w, events, errors); }
  });
  var w = dom.window;
  var d = w.document;

  if (d.readyState !== "complete") {
    await Promise.race([new Promise(function (r) { w.addEventListener("load", r); }), sleep(3000)]);
  }
  w.postMessage({ source: "learnkit-host", kind: "init", nonce: "playthrough", topicId: "t", artifactId: "a", reducedMotion: true }, "*");
  await sleep(200);

  var questions = [];
  var exploreItems = [];
  function takeBite(s) {
    if (s.type === "quiz" || s.type === "apply") s.questions.forEach(function (q) { questions.push({ sectionId: s.id, q: q }); });
    if (s.visual && s.visual.items) s.visual.items.forEach(function (it) { exploreItems.push({ sectionId: s.id, label: it.label }); });
  }
  if (bp.sessions) {
    bp.sessions.forEach(function (sess) { sess.bites.forEach(takeBite); });
    if (bp.finalTest) bp.finalTest.questions.forEach(function (q) { questions.push({ sectionId: "final_test", q: q }); });
  } else {
    (bp.sections || []).forEach(takeBite);
  }

  var tries = {};
  var stuckOnUnoperable = null;
  // clicked resets whenever the page changes; everClicked caps, per label, plain buttons that never move the lesson on.
  var clicked = new WeakMap();
  var everClicked = new WeakMap();
  var exploredKeys = {};
  var memo = new Map();

  function shown(n) {
    if (!n || n.nodeType !== 1) return true;
    if (memo.has(n)) return memo.get(n);
    var ok = !n.hidden;
    if (ok) {
      var cs = w.getComputedStyle(n);
      ok = cs.display !== "none" && cs.visibility !== "hidden";
    }
    if (ok) ok = shown(n.parentElement);
    memo.set(n, ok);
    return ok;
  }
  function inactive(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.disabled === true || n.getAttribute("aria-disabled") === "true") return true;
    }
    if (w.getComputedStyle(el).pointerEvents === "none") return true;
    return /(^| )(disabled|is-disabled|locked)( |$)/.test(el.className && el.className.baseVal == null ? el.className : "");
  }
  function label(el) { return norm(el.getAttribute("aria-label") || el.textContent || el.value || ""); }
  function usable(el) { return shown(el) && !inactive(el); }
  function clickables(root) {
    return Array.prototype.filter.call((root || d.body).querySelectorAll(CLICKABLE), usable);
  }
  function target(el) {
    var c = el.closest(CLICKABLE);
    return c && c !== d.body ? c : el;
  }
  function click(el, why) {
    steps.push(why);
    clicked.set(el, (clicked.get(el) || 0) + 1);
    var counts = everClicked.get(el) || {};
    counts[label(el)] = (counts[label(el)] || 0) + 1;
    everClicked.set(el, counts);
    el.click();
  }
  function setValue(el, value) {
    el.value = value;
    el.dispatchEvent(new w.Event("input", { bubbles: true }));
    el.dispatchEvent(new w.Event("change", { bubbles: true }));
  }
  function textMatches(root, text) {
    var want = norm(text);
    if (!want) return [];
    var hits = [];
    var all = root.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (/^(SCRIPT|STYLE|OPTION|TEMPLATE|HEAD|TITLE)$/.test(el.tagName)) continue;
      if (hasWords(norm(el.textContent), want)) hits.push(el);
    }
    return hits.filter(function (el) { return !hits.some(function (o) { return o !== el && el.contains(o); }); }).filter(shown);
  }
  /** The best visible, usable control showing exactly this text. */
  function control(root, text) {
    var want = norm(text);
    var best = null, bestScore = 0, bestLen = Infinity;
    textMatches(root, text).forEach(function (leaf) {
      var el = target(leaf);
      if (!usable(el)) return;
      var t = norm(el.textContent);
      var score = t === want ? 3 : keyed(t, want) ? 2 : 1;
      if (el.matches(CLICKABLE)) score += 10;
      if (score > bestScore || (score === bestScore && t.length < bestLen)) { best = el; bestScore = score; bestLen = t.length; }
    });
    return best;
  }
  function climb(el, test) {
    for (var n = el, i = 0; n && n !== d.documentElement && i < 9; n = n.parentElement, i++) {
      if (test(n)) return n;
    }
    return null;
  }
  function answeredEvents(id) {
    return events.filter(function (e) { return e.type === "question_answered" && e.payload && e.payload.questionId === id; });
  }
  function correct(id) { return answeredEvents(id).some(function (e) { return e.payload.clientCorrect === true; }); }
  /** Answered correctly, or wrong twice so the lesson has revealed it. */
  function settled(id) { return correct(id) || answeredEvents(id).length >= 2; }
  function promptKey(q) {
    if (q.kind === "fill_blank") {
      var first = q.text.split("___").map(function (p) { return p.trim(); }).filter(Boolean)[0];
      if (first && norm(first).length >= 8) return first;
    }
    return q.prompt;
  }
  function choose(select, wantValue, wantText) {
    var opts = Array.prototype.slice.call(select.options);
    var hit = opts.filter(function (o) { return o.value === wantValue; })[0] ||
      opts.filter(function (o) { return norm(o.textContent) === norm(wantText); })[0];
    if (!hit) return false;
    setValue(select, hit.value);
    return true;
  }
  function inputs(scope) {
    return Array.prototype.filter.call(scope.querySelectorAll("input:not([type]), input[type=text], input[type=search], textarea"), usable);
  }
  function selects(scope) { return Array.prototype.filter.call(scope.querySelectorAll("select"), usable); }

  /** Put the right answer into the question's controls. Returns false when no control could be found. */
  function fill(q, scopeFrom) {
    var scope;
    if (q.kind === "mcq") {
      var opt = q.options.filter(function (o) { return o.id === q.correctOptionId; })[0];
      scope = climb(scopeFrom, function (s) { return !!control(s, opt.text); });
      if (!scope) return false;
      click(control(scope, opt.text), "answer " + q.id);
      return true;
    }
    if (q.kind === "true_false") {
      var yes = /^(true|yes|fact|right|correct)( |$)/, no = /^(false|no|myth|wrong|not true|incorrect)( |$)/;
      var want = q.answer ? yes : no;
      var pick = function (s) {
        return clickables(s).filter(function (el) {
          var v = el.getAttribute("data-answer") || el.getAttribute("data-value");
          return v === String(q.answer) || want.test(label(el));
        })[0];
      };
      scope = climb(scopeFrom, function (s) { return !!pick(s); });
      if (!scope) return false;
      click(pick(scope), "answer " + q.id);
      return true;
    }
    if (q.kind === "short_answer") {
      scope = climb(scopeFrom, function (s) { return inputs(s).length > 0; });
      if (!scope) return false;
      var box = inputs(scope)[0];
      steps.push("type " + q.id);
      setValue(box, q.acceptedAnswers[0]);
      ["keydown", "keypress", "keyup"].forEach(function (type) {
        box.dispatchEvent(new w.KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      });
      return true;
    }
    if (q.kind === "fill_blank") {
      var textOf = function (id) { return (q.options.filter(function (o) { return o.id === id; })[0] || {}).text; };
      scope = climb(scopeFrom, function (s) { return selects(s).length > 0 || !!control(s, textOf(q.blanks[0])); });
      if (!scope) return false;
      var sel = selects(scope);
      if (sel.length) {
        steps.push("fill " + q.id);
        q.blanks.forEach(function (id, i) { if (sel[i]) choose(sel[i], id, textOf(id)); });
      } else {
        q.blanks.forEach(function (id) { var c = control(scope, textOf(id)); if (c) click(c, "fill " + q.id); });
      }
      return true;
    }
    if (q.kind === "matching") {
      var rightText = function (leftId) {
        var pair = q.pairs.filter(function (p) { return p.left === leftId; })[0];
        var r = pair && q.right.filter(function (x) { return x.id === pair.right; })[0];
        return r ? { id: r.id, text: r.text } : null;
      };
      scope = climb(scopeFrom, function (s) { return selects(s).length > 0 || !!control(s, q.left[0].text); });
      if (!scope) return false;
      var pickers = selects(scope);
      if (pickers.length) {
        steps.push("match " + q.id);
        pickers.forEach(function (p) {
          var row = climb(p, function (n) { return q.left.some(function (l) { return hasWords(norm(n.textContent), norm(l.text)); }); });
          var left = row && q.left.filter(function (l) { return hasWords(norm(row.textContent), norm(l.text)); })[0];
          var right = left && rightText(left.id);
          if (right) choose(p, right.id, right.text);
        });
      } else {
        q.left.forEach(function (l) {
          var right = rightText(l.id);
          var a = control(scope, l.text);
          if (a) click(a, "match " + q.id);
          var b = right && control(scope, right.text);
          if (b) click(b, "match " + q.id);
        });
      }
      return true;
    }
    // ordering: submit whatever order is shown; a wrong answer twice reveals it.
    return !!climb(scopeFrom, function (s) { return clickables(s).some(function (el) { return CHECK_RE.test(label(el)); }); });
  }

  async function answer(entry) {
    var q = entry.q;
    var before = answeredEvents(q.id).length;
    var anchors = textMatches(d.body, promptKey(q));
    if (!anchors.length) return "hidden";
    tries[q.id] = (tries[q.id] || 0) + 1;
    if (!fill(q, anchors[0])) return "unoperable";
    await sleep(80);
    memo = new Map();
    if (answeredEvents(q.id).length > before) return "acted";
    var scope = climb(anchors[0], function (s) { return clickables(s).some(function (el) { return CHECK_RE.test(label(el)); }); });
    var check = scope && clickables(scope).filter(function (el) { return CHECK_RE.test(label(el)); })[0];
    if (check) click(check, "check " + q.id);
    return "acted";
  }

  var choiceTexts = [];
  questions.forEach(function (x) {
    var q = x.q;
    [q.options, q.items, q.left, q.right].forEach(function (list) {
      (list || []).forEach(function (c) { var t = norm(c.text); if (t) choiceTexts.push(t); });
    });
    if (q.kind === "true_false") choiceTexts.push("true", "false");
  });
  /** An answer option. Clicking one to move forward would answer a question at random. */
  function isChoice(el) {
    var t = label(el);
    return choiceTexts.some(function (c) { return keyed(t, c); });
  }

  /** How likely a control is to move the lesson forward: words, then an arrow, then any other plain button. */
  function forwardScore(el) {
    var t = label(el);
    var raw = el.getAttribute("aria-label") || el.textContent || "";
    if (BLOCK_RE.test(t) || BACK_ARROW_RE.test(raw)) return 0;
    if (/next question/.test(t)) return 5;
    if (NEXT_RE.test(t)) return 4;
    if (FORWARD_ARROW_RE.test(raw)) return 3;
    if (el.tagName === "BUTTON" || el.getAttribute("role") === "button") return 1;
    return 0;
  }

  function signature() { return events.length + "|" + d.body.innerHTML.length + "|" + d.body.querySelectorAll("[disabled]").length; }

  var idle = 0;
  var waits = 0;
  var status = null;
  for (var step = 0; step < 400 && !status; step++) {
    memo = new Map();
    if (events.some(function (e) { return e.type === "topic_completed"; })) break;
    var before = signature();
    var acted = false;
    stuckOnUnoperable = null;

    for (var i = 0; i < questions.length && !acted; i++) {
      var entry = questions[i];
      if (settled(entry.q.id) || (tries[entry.q.id] || 0) >= 3) continue;
      var r = await answer(entry);
      if (r === "acted") acted = true;
      else if (r === "unoperable") { stuckOnUnoperable = entry.q.id; tries[entry.q.id] = (tries[entry.q.id] || 1) - 1; }
    }

    var buttons = acted ? [] : clickables();
    if (!acted && stuckOnUnoperable) {
      var retry = buttons.filter(function (el) { return TRY_RE.test(label(el)); })[0];
      if (retry) { click(retry, "try again"); acted = true; }
    }
    if (!acted) {
      var reveal = buttons.filter(function (el) { return REVEAL_RE.test(label(el)) && !clicked.get(el); })[0];
      if (reveal) { click(reveal, "reveal"); acted = true; }
    }
    if (!acted) {
      for (var k = 0; k < exploreItems.length && !acted; k++) {
        var item = exploreItems[k];
        var key = item.sectionId + "|" + item.label;
        if (exploredKeys[key]) continue;
        var tile = control(d.body, item.label);
        if (tile) { exploredKeys[key] = true; click(tile, "explore " + item.label); acted = true; }
      }
    }
    if (!acted) {
      var play = buttons.filter(function (el) { return ACTIVATE_RE.test(label(el)) && (clicked.get(el) || 0) < 2; })[0];
      if (play) { click(play, "play"); acted = true; }
    }
    if (!acted) {
      var forward = buttons
        .filter(function (el) { return !isChoice(el); })
        .map(function (el) { return { el: el, score: forwardScore(el), clicks: clicked.get(el) || 0 }; })
        .filter(function (c) { return c.score > 0 && c.clicks < 3 && (c.score >= 3 || ((everClicked.get(c.el) || {})[label(c.el)] || 0) < 2); });
      forward.sort(function (a, b) { return b.score - a.score || a.clicks - b.clicks; });
      if (forward[0]) { click(forward[0].el, "forward: " + label(forward[0].el).slice(0, 40)); acted = true; }
    }

    if (!acted) {
      // The page may still be animating towards an unlocked Continue.
      if (++waits > 4) { status = "stuck"; break; }
      await sleep(250);
      continue;
    }
    waits = 0;
    await sleep(80);
    if (signature() === before) idle++;
    else { idle = 0; clicked = new WeakMap(); }
    if (idle >= 8) { status = "stuck"; break; }
  }

  memo = new Map();
  var answered = {};
  events.forEach(function (e) { if (e.type === "question_answered" && e.payload) answered[e.payload.questionId] = true; });
  var unanswered = questions.filter(function (x) { return !answered[x.q.id]; }).map(function (x) { return x.q.id; });
  var completed = events.some(function (e) { return e.type === "topic_completed"; });
  var viewed = events.filter(function (e) { return e.type === "section_viewed"; });
  var disabledControls = Array.prototype.filter.call(d.body.querySelectorAll(CLICKABLE), function (el) { return shown(el) && inactive(el); })
    .map(function (el) { return (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40); })
    .filter(Boolean).slice(0, 5);

  var visibleControls = clickables().map(function (el) {
    return el.tagName.toLowerCase() + ":" + (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
  }).slice(0, 8);

  // A question still on screen unanswered may be a control this driver cannot
  // operate rather than a broken lesson, so only a clear dead end counts.
  var open = questions.filter(function (x) { return !settled(x.q.id) && textMatches(d.body, promptKey(x.q)).length > 0; });
  if (open.length) stuckOnUnoperable = open[0].q.id;
  var outcome = completed && unanswered.length === 0 ? "passed" : (stuckOnUnoperable ? "inconclusive" : "failed");
  return {
    status: outcome,
    completed: completed,
    unanswered: unanswered,
    lastSection: viewed.length ? viewed[viewed.length - 1].sectionId || null : null,
    stuckOn: stuckOnUnoperable,
    disabledControls: disabledControls,
    visibleControls: visibleControls,
    scriptErrors: errors.slice(0, 3),
    steps: steps.slice(-12)
  };
}
`;
