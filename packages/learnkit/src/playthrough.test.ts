import { describe, expect, it } from "vitest";
import type { ArtifactBlueprint } from "@eco/contracts";
import { normalizeGeneratedHtml, renderBlueprintHtml } from "./html";
import { playThroughLesson } from "./playthrough";

const bp: ArtifactBlueprint = {
  schemaVersion: 1,
  topicSlug: "alphabet",
  title: "The Alphabet",
  audience: { age: 8, readingLevel: "developing" },
  theme: { primary: "#2E5CB8", accent: "#F39C12", background: "#F8F9FA", mood: "clear", emoji: "🔤" },
  learningObjectives: [
    { code: "lo1", text: "Count the letters in the alphabet" },
    { code: "lo2", text: "Tell vowels from consonants" },
  ],
  stages: ["discover", "practice"],
  sections: [
    { type: "intro", id: "s_intro", title: "Letters", stage: "discover", body: "Every word you read is built from a small set of letters.", hook: "How many letters are there?" },
    {
      type: "explore", id: "s_explore", title: "The English Alphabet", stage: "discover",
      lead: "Let's explore the building blocks of written English.",
      prompt: "Tap each part",
      visual: {
        kind: "parts", caption: "Parts of the alphabet",
        items: [
          { id: "count", label: "26 Letters", description: "The English alphabet has exactly 26 letters." },
          { id: "forms", label: "Two Forms", description: "Each letter has an uppercase and a lowercase form." },
          { id: "kinds", label: "Vowels and Consonants", description: "A, E, I, O and U are vowels." },
        ],
      },
    },
    { type: "quiz", id: "s_final", title: "Final Check", stage: "practice", role: "final_check", questions: [
      { kind: "mcq", id: "q_count", prompt: "How many letters are in the English alphabet?", options: [{ id: "a", text: "20 letters" }, { id: "b", text: "26 letters" }, { id: "c", text: "52 letters" }], correctOptionId: "b", explanation: "There are exactly 26 letters from A to Z.", difficulty: 1, objectiveCodes: ["lo1"] },
      { kind: "true_false", id: "q_vowel", prompt: "The letter E is a vowel.", answer: true, explanation: "A, E, I, O and U are the vowels.", difficulty: 1, objectiveCodes: ["lo2"] },
      { kind: "fill_blank", id: "q_blank", prompt: "Fill in the blank", text: "The letter B is a ___.", options: [{ id: "v", text: "vowel" }, { id: "c", text: "consonant" }], blanks: ["c"], explanation: "B is not one of A, E, I, O, U, so it is a consonant.", difficulty: 2, objectiveCodes: ["lo2"] },
      { kind: "short_answer", id: "q_first", prompt: "Which letter comes last in the alphabet?", acceptedAnswers: ["z"], explanation: "The alphabet ends with Z.", difficulty: 1, objectiveCodes: ["lo1"] },
      { kind: "matching", id: "q_match", prompt: "Match each letter to its kind", left: [{ id: "l1", text: "O" }, { id: "l2", text: "T" }], right: [{ id: "r1", text: "Vowel" }, { id: "r2", text: "Consonant" }], pairs: [{ left: "l1", right: "r1" }, { left: "l2", right: "r2" }], explanation: "O is a vowel and T is a consonant.", difficulty: 2, objectiveCodes: ["lo2"] },
      { kind: "ordering", id: "q_order", prompt: "Put these letters in alphabet order", items: [{ id: "x", text: "C" }, { id: "y", text: "A" }, { id: "z", text: "B" }], correctOrder: ["y", "z", "x"], explanation: "A comes before B, and B before C.", difficulty: 2, objectiveCodes: ["lo1"] },
    ] },
  ],
};

/** A generated page in the shape of the broken alphabet lesson: only the first question of a section is ever shown. */
function firstQuestionOnlyPage(): string {
  return normalizeGeneratedHtml(`<!doctype html><html><head><style>.section{display:none}.section.active{display:block}</style></head><body>
<div id="app"></div>
<script>
(function () {
  var sections = [
    { id: "s_explore", items: ["26 Letters", "Two Forms", "Vowels and Consonants"] },
    { id: "s_final", questions: [
      { id: "q_count", prompt: "How many letters are in the English alphabet?", options: ["20 letters", "26 letters", "52 letters"], correct: 1 },
      { id: "q_vowel", prompt: "The letter E is a vowel." },
      { id: "q_blank", prompt: "The letter B is a ___." }
    ] }
  ];
  var app = document.getElementById("app");
  var explored = 0, idx = 0;
  function show(i) {
    idx = i;
    var nodes = document.querySelectorAll(".section");
    for (var n = 0; n < nodes.length; n++) nodes[n].classList.toggle("active", n === i);
    LearnKit.emit("section_viewed", { index: i }, { sectionId: sections[i].id });
  }
  var ex = document.createElement("div"); ex.className = "section";
  sections[0].items.forEach(function (label) {
    var b = document.createElement("button"); b.textContent = label;
    b.onclick = function () { if (!b.dataset.seen) { b.dataset.seen = "1"; explored++; } if (explored >= 2) next0.disabled = false; };
    ex.appendChild(b);
  });
  var next0 = document.createElement("button"); next0.textContent = "Continue"; next0.disabled = true;
  next0.onclick = function () { show(1); };
  ex.appendChild(next0); app.appendChild(ex);

  var quiz = document.createElement("div"); quiz.className = "section";
  var q = sections[1].questions[0];
  var p = document.createElement("p"); p.textContent = q.prompt; quiz.appendChild(p);
  q.options.forEach(function (text, i) {
    var o = document.createElement("button"); o.textContent = text;
    o.onclick = function () {
      LearnKit.emit("question_answered", { questionId: q.id, clientCorrect: i === q.correct }, { sectionId: "s_final" });
    };
    quiz.appendChild(o);
  });
  var next1 = document.createElement("button"); next1.textContent = "Continue"; next1.disabled = true;
  quiz.appendChild(next1); app.appendChild(quiz);
  show(0);
})();
</script></body></html>`);
}

describe("playThroughLesson", () => {
  it("finishes the built-in player for every question kind", async () => {
    const result = await playThroughLesson(renderBlueprintHtml(bp), bp);
    expect(result.status, result.detail).toBe("passed");
  }, 40_000);

  it("fails a lesson whose later questions can never be reached", async () => {
    const result = await playThroughLesson(firstQuestionOnlyPage(), bp);
    expect(result.status, result.detail).toBe("failed");
    const text = result.problems.join(" ");
    expect(text).toMatch(/stuck on section s_final/);
    expect(text).toMatch(/q_vowel, q_blank/);
    expect(text).toMatch(/still disabled: Continue/);
  }, 40_000);

  it("fails a lesson that throws while booting", async () => {
    const html = normalizeGeneratedHtml(`<!doctype html><html><head></head><body><script>
      LearnKit.emit("question_answered", {}); LearnKit.emit("topic_completed", {});
      document.body.appendChild(document.createElement("div")).textContent = "Loading";
      undefinedLessonBoot();
    </script></body></html>`);
    const result = await playThroughLesson(html, bp);
    expect(result.status).toBe("failed");
    expect(result.problems.join(" ")).toMatch(/JavaScript error/);
  }, 40_000);
});

describe("library bite fallback", () => {
  // The lesson model may pin a library artifact on an explore bite. In this
  // test the host does not supply `library` to `renderBlueprintHtml`, so
  // `collectLibraryRefs` yields the ref but `window.__LIBRARY__` is unset.
  // The player's `tryLibraryBranch` must return null and fall through to the
  // built-in parts visual, keeping the lesson finishable. A real-device test
  // of the embedded path is listed in the Stage 4 completion notes.
  it("falls back to the built-in visual when no library host options are supplied", async () => {
    const libraryBp = JSON.parse(JSON.stringify(bp)) as typeof bp & { sections: Array<{ type: string; library?: unknown }> };
    const explore = libraryBp.sections.find((s) => s.type === "explore")!;
    explore.library = { artifactId: "solar-system", version: 1, params: {} };
    const html = renderBlueprintHtml(libraryBp);
    const result = await playThroughLesson(html, libraryBp);
    expect(result.status, result.detail).toBe("passed");
  }, 40_000);
});

describe("v3 game player", () => {
  it("plays a session lesson through to topic_completed", async () => {
    const { rockyGameBlueprint } = await import("../../contracts/src/testing");
    const game = rockyGameBlueprint();
    const html = renderBlueprintHtml(game);
    const result = await playThroughLesson(html, game, { timeoutMs: 60_000 });
    expect(result.status, result.detail).toBe("passed");
  }, 70_000);
});
