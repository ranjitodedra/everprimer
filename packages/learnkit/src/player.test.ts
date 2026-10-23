import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { ArtifactBlueprint, Question } from "@eco/contracts";
import { renderBlueprintHtml } from "./html";

type Dom = { window: Window & typeof globalThis };
type JsdomOptions = { runScripts: "dangerously"; pretendToBeVisual: boolean; beforeParse: (win: Window & typeof globalThis) => void };
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string, opts: JsdomOptions) => Dom };

const MCQ: Question = { kind: "mcq", id: "q1", prompt: "Which planet is largest?", options: [{ id: "opt1", text: "Jupiter" }, { id: "opt2", text: "Mars" }, { id: "opt3", text: "Venus" }], correctOptionId: "opt1", explanation: "Jupiter is the largest.", difficulty: 1, objectiveCodes: ["lo1"] };
const SHORT: Question = { kind: "short_answer", id: "q2", prompt: "Which planet do we live on?", acceptedAnswers: ["earth"], explanation: "We live on Earth.", difficulty: 1, objectiveCodes: ["lo1"] };

function blueprintWith(question: Question): ArtifactBlueprint {
  return {
    schemaVersion: 1,
    topicSlug: "planets",
    title: "Planets",
    audience: { age: 8, readingLevel: "developing" },
    theme: { primary: "#2E5CB8", accent: "#F39C12", background: "#F8F9FA", mood: "clear", emoji: "🪐" },
    learningObjectives: [{ code: "lo1", text: "Name the planets" }],
    stages: ["practice"],
    sections: [{ type: "quiz", id: "s_quiz", title: "Check", stage: "practice", role: "final_check", questions: [question] }],
  };
}

/** jsdom does not decode images; this one "loads" any data URI except ones carrying "QkFE" ("BAD"). */
function stubImages(win: Window & typeof globalThis) {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    set src(value: string) {
      setTimeout(() => {
        if (value.includes("QkFE")) this.onerror?.();
        else {
          this.naturalWidth = 1;
          this.onload?.();
        }
      }, 0);
    }
  }
  (win as unknown as { Image: unknown }).Image = FakeImage;
}

function bootWindow(question: Question | ArtifactBlueprint): Window & typeof globalThis {
  const blueprint = "schemaVersion" in question ? question : blueprintWith(question);
  const dom = new JSDOM(renderBlueprintHtml(blueprint), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse: (win) => {
      win.scrollTo = () => {};
      stubImages(win);
    },
  });
  return dom.window;
}

function boot(question: Question): Document {
  return bootWindow(question).document;
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const BAD = "data:image/png;base64,QkFE";

/** Top-level jsdom window: its parent is itself, which the runtime requires as the sender. */
function host(win: Window & typeof globalThis, msg: Record<string, unknown>) {
  win.dispatchEvent(new win.MessageEvent("message", { data: { source: "learnkit-host", v: 1, ...msg }, source: win }));
}

describe("tutor character", () => {
  it("renders lines as plain text until art arrives", () => {
    const doc = boot(MCQ);
    expect(doc.body.classList.contains("lk-has-tutor")).toBe(false);
    const line = doc.querySelector(".lk-tutor[data-pose='talk']");
    expect(line?.textContent).toBe(MCQ.prompt);
    expect(line?.querySelector(".lk-tutor-figure")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("upgrades in place once both poses decode", async () => {
    const win = bootWindow(MCQ);
    const prompt = win.document.querySelector(".lk-prompt");
    host(win, { kind: "tutor_art", talk: PNG, teach: PNG });
    await tick();
    expect(win.document.body.classList.contains("lk-has-tutor")).toBe(true);
    expect(win.document.documentElement.style.getPropertyValue("--lk-tutor-talk")).toContain(PNG);
    expect(win.document.querySelector(".lk-prompt")).toBe(prompt);
  });

  it("blends the background away only for art that was not cut out", async () => {
    const old = bootWindow(MCQ);
    host(old, { kind: "tutor_art", talk: PNG, teach: PNG });
    await tick();
    expect(old.document.body.classList.contains("lk-tutor-blend")).toBe(true);

    const cut = bootWindow(MCQ);
    host(cut, { kind: "tutor_art", talk: PNG, teach: PNG, cutout: true });
    await tick();
    expect(cut.document.body.classList.contains("lk-has-tutor")).toBe(true);
    expect(cut.document.body.classList.contains("lk-tutor-blend")).toBe(false);
  });

  it("stays plain when a pose fails to decode", async () => {
    const win = bootWindow(MCQ);
    host(win, { kind: "tutor_art", talk: PNG, teach: BAD });
    await tick();
    expect(win.document.body.classList.contains("lk-has-tutor")).toBe(false);
  });

  it("ignores anything that is not an inline raster image", async () => {
    const win = bootWindow(MCQ);
    host(win, { kind: "tutor_art", talk: "https://example.com/a.png", teach: PNG });
    host(win, { kind: "tutor_art", talk: 'data:image/png;base64,AA");}body{x:url("', teach: PNG });
    await tick();
    expect(win.document.body.classList.contains("lk-has-tutor")).toBe(false);
    expect(win.document.documentElement.style.getPropertyValue("--lk-tutor-talk")).toBe("");
  });

  it("keeps hints and feedback as plain text with the character still on the question", async () => {
    const win = bootWindow({ ...MCQ, hint: "It is a gas giant." });
    const doc = win.document;
    host(win, { kind: "tutor_art", talk: PNG, teach: PNG });
    await tick();
    const hint = [...doc.querySelectorAll("button")].find((b) => b.textContent === "Hint")!;
    hint.click();
    expect(doc.querySelector(".lk-feedback.hint")?.textContent).toContain("gas giant");
    expect(doc.querySelector(".lk-feedback .lk-tutor")).toBeNull();
    [...doc.querySelectorAll(".lk-option")][1]!.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    [...doc.querySelectorAll("button")].find((b) => b.textContent === "Check")!.click();
    expect(doc.querySelector(".lk-feedback.retry")).not.toBeNull();
    expect(doc.querySelector(".lk-feedback .lk-tutor")).toBeNull();
    expect(doc.querySelectorAll(".lk-tutor:not(.lk-tutor-plain)")).toHaveLength(1);
  });

  it("shows one character per screen, on the question rather than the opener", async () => {
    const { rockyGameBlueprint } = await import("../../contracts/src/testing");
    const game = rockyGameBlueprint();
    const bites = game.sessions[0]!.bites;
    const quiz = bites.find((b) => b.type === "quiz")!;
    game.sessions[0]!.bites = [quiz, ...bites.filter((b) => b !== quiz)];
    const win = bootWindow(game as unknown as ArtifactBlueprint);
    const doc = win.document;
    host(win, { kind: "tutor_art", talk: PNG, teach: PNG });
    await tick();
    doc.querySelector<HTMLButtonElement>(".lk-node.current")!.click();
    const lines = [...doc.querySelectorAll(".lk-tutor")];
    expect(lines.length).toBeGreaterThan(1);
    const speaking = doc.querySelectorAll(".lk-tutor:not(.lk-tutor-plain)");
    expect(speaking).toHaveLength(1);
    expect(speaking[0]!.querySelector(".lk-prompt")).not.toBeNull();
    expect(doc.querySelector(".lk-tutor.lk-tutor-plain")?.textContent).toBe(game.sessions[0]!.opener);
  });

  it("reflects the live tutor state for the glow", async () => {
    const win = bootWindow(MCQ);
    host(win, { kind: "tutor_state", state: "speaking" });
    await tick();
    expect(win.document.body.getAttribute("data-tutor")).toBe("speaking");
    host(win, { kind: "tutor_state", state: "idle" });
    await tick();
    expect(win.document.body.hasAttribute("data-tutor")).toBe(false);
  });
});

describe("tutor context", () => {
  it("describes the question without the answer until the learner has answered", async () => {
    const win = bootWindow(MCQ);
    const seen: Array<{ question?: { prompt: string; options?: string[] }; answered?: boolean; correct?: boolean; explanation?: string }> = [];
    win.addEventListener("message", (e: MessageEvent) => {
      if (e.data?.source === "learnkit" && e.data.kind === "context") seen.push(e.data.context);
    });
    host(win, { kind: "init", nonce: "n", topicId: "t", artifactId: "a", reducedMotion: true });
    await tick();
    expect(seen[0]?.question?.prompt).toBe(MCQ.prompt);
    expect(seen[0]?.question?.options).toEqual(["Jupiter", "Mars", "Venus"]);
    expect(seen[0]?.answered).toBe(false);
    expect(seen[0]?.explanation).toBeUndefined();

    const doc = win.document;
    [...doc.querySelectorAll(".lk-option")][0]!.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    [...doc.querySelectorAll("button")].find((b) => b.textContent === "Check")!.click();
    await tick();
    const last = seen[seen.length - 1]!;
    expect(last.answered).toBe(true);
    expect(last.correct).toBe(true);
    expect(last.explanation).toBe(MCQ.explanation);
  });
});

describe("player inputs", () => {
  it("labels options by position, never by their id", () => {
    const doc = boot(MCQ);
    const keys = [...doc.querySelectorAll(".lk-option-key")].map((k) => k.textContent);
    expect(keys).toEqual(["A", "B", "C"]);
    expect(doc.body.textContent).not.toMatch(/OPT\d/);
  });

  it("gives short answers a Done key and no automatic focus on touch screens", async () => {
    const doc = boot(SHORT);
    const input = doc.querySelector(".lk-input");
    expect(input?.getAttribute("enterkeyhint")).toBe("done");
    await new Promise((r) => setTimeout(r, 80));
    expect(doc.activeElement).not.toBe(input);
  });
});
