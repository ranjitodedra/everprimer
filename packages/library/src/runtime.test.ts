import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ARTIFACTKIT_INTERACTED_THROTTLE_MS,
  ARTIFACTKIT_PROTOCOL_VERSION,
  ARTIFACTKIT_RUNTIME_SOURCE,
} from "./runtime";

/**
 * The runtime is injected into a sandboxed iframe at run time; we exercise it
 * in Node by evaluating its source against stub `window` and `document`
 * objects and asserting on the posted messages.
 */

type Msg = Record<string, unknown>;
type Listener = (e: unknown) => void;

interface FakeArtifactKit {
  ready(): void;
  emit(name: string, data?: unknown): void;
  reportError(message: string, opts?: { fatal?: boolean }): void;
  params: Record<string, unknown>;
  reducedMotion: boolean;
}

interface Fake {
  posts: Msg[];
  win: Record<string, unknown> & {
    parent: unknown;
    ArtifactKit: FakeArtifactKit;
    requestAnimationFrame: (cb: FrameRequestCallback) => number;
  };
  html: { attrs: Record<string, string> };
  rafCalls: FrameRequestCallback[];
  domContentLoaded(): void;
  message(payload: Msg, fromParent?: boolean): void;
  interact(type: "pointerdown" | "keydown"): void;
  fire(type: "error" | "unhandledrejection", event: unknown): void;
}

function makeFake(readyState: "loading" | "complete" = "complete"): Fake {
  const posts: Msg[] = [];
  const winListeners: Record<string, Listener[]> = {};
  const docListeners: Record<string, Listener[]> = {};
  const parent = {
    postMessage(msg: Msg) {
      posts.push(msg);
    },
  };
  const rafCalls: FrameRequestCallback[] = [];
  const html = {
    attrs: {} as Record<string, string>,
    setAttribute(name: string, value: string) {
      this.attrs[name] = value;
    },
    removeAttribute(name: string) {
      delete this.attrs[name];
    },
  };
  const win: Fake["win"] = {
    parent,
    ArtifactKit: undefined as unknown as FakeArtifactKit,
    performance: { now: () => 123 },
    requestAnimationFrame: ((cb: FrameRequestCallback) => {
      rafCalls.push(cb);
      return rafCalls.length;
    }) as (cb: FrameRequestCallback) => number,
    addEventListener(type: string, fn: Listener) {
      (winListeners[type] ||= []).push(fn);
    },
  };
  const doc = {
    readyState,
    documentElement: html,
    addEventListener(type: string, fn: Listener) {
      (docListeners[type] ||= []).push(fn);
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function("window", "document", "Date", ARTIFACTKIT_RUNTIME_SOURCE);
  fn(win, doc, Date);
  return {
    posts,
    win,
    html,
    rafCalls,
    domContentLoaded() {
      for (const l of docListeners["DOMContentLoaded"] ?? []) l(undefined);
    },
    message(payload, fromParent = true) {
      const event = { data: payload, source: fromParent ? parent : {} };
      for (const l of winListeners["message"] ?? []) l(event);
    },
    interact(type) {
      for (const l of winListeners[type] ?? []) l({ type });
    },
    fire(type, event) {
      for (const l of winListeners[type] ?? []) l(event);
    },
  };
}

describe("ARTIFACTKIT_PROTOCOL_VERSION", () => {
  it("is 1", () => {
    expect(ARTIFACTKIT_PROTOCOL_VERSION).toBe(1);
  });
});

describe("ArtifactKit runtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000_000));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends exactly one ak-ready when the document is already loaded", () => {
    const f = makeFake("complete");
    const readyMsgs = f.posts.filter((p) => p.kind === "ak-ready");
    expect(readyMsgs).toHaveLength(1);
    expect(readyMsgs[0]).toMatchObject({ source: "artifactkit", v: 1 });
    f.win.ArtifactKit.ready();
    expect(f.posts.filter((p) => p.kind === "ak-ready")).toHaveLength(1);
  });

  it("waits for DOMContentLoaded when the document is still loading", () => {
    const f = makeFake("loading");
    expect(f.posts.filter((p) => p.kind === "ak-ready")).toHaveLength(0);
    f.domContentLoaded();
    expect(f.posts.filter((p) => p.kind === "ak-ready")).toHaveLength(1);
  });

  it("queues emitted events until ak-init supplies a nonce, then flushes with it", () => {
    const f = makeFake("complete");
    f.win.ArtifactKit.emit("planet_selected", { planet: "earth" });
    f.win.ArtifactKit.emit("planet_selected", { planet: "mars" });
    expect(f.posts.filter((p) => p.kind === "ak-event")).toHaveLength(0);

    f.message({ source: "artifactkit-host", kind: "ak-init", nonce: "N1" });

    const events = f.posts.filter((p) => p.kind === "ak-event");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ source: "artifactkit", v: 1, nonce: "N1", name: "planet_selected", data: { planet: "earth" } });
    expect(events[1]).toMatchObject({ name: "planet_selected", data: { planet: "mars" } });

    f.win.ArtifactKit.emit("planet_selected", { planet: "venus" });
    expect(f.posts.filter((p) => p.kind === "ak-event")).toHaveLength(3);
  });

  it("drops messages whose source isn't window.parent", () => {
    const f = makeFake("complete");
    f.win.ArtifactKit.emit("x");
    f.message({ source: "artifactkit-host", kind: "ak-init", nonce: "N1" }, false);
    expect(f.posts.filter((p) => p.kind === "ak-event")).toHaveLength(0);
  });

  it("ignores host messages with the wrong envelope", () => {
    const f = makeFake("complete");
    f.win.ArtifactKit.emit("x");
    f.message({ source: "learnkit-host", kind: "ak-init", nonce: "N1" });
    f.message({ source: "artifactkit-host", kind: "something-else", nonce: "N1" });
    expect(f.posts.filter((p) => p.kind === "ak-event")).toHaveLength(0);
  });

  it("auto-emits built-in `interacted` on pointerdown and keydown, throttled", () => {
    const f = makeFake("complete");
    f.message({ source: "artifactkit-host", kind: "ak-init", nonce: "N1" });
    f.interact("pointerdown");
    f.interact("pointerdown");
    f.interact("keydown");
    const first = f.posts.filter((p) => p.kind === "ak-event" && p.name === "interacted");
    expect(first).toHaveLength(1);
    vi.advanceTimersByTime(ARTIFACTKIT_INTERACTED_THROTTLE_MS + 1);
    f.interact("keydown");
    const second = f.posts.filter((p) => p.kind === "ak-event" && p.name === "interacted");
    expect(second).toHaveLength(2);
  });

  it("exposes frozen params and toggles reducedMotion on <html> after ak-init", () => {
    const f = makeFake("complete");
    f.message({
      source: "artifactkit-host",
      kind: "ak-init",
      nonce: "N1",
      params: { planet: "mars", speed: 2 },
      reducedMotion: true,
    });
    expect(f.win.ArtifactKit.params).toEqual({ planet: "mars", speed: 2 });
    expect(Object.isFrozen(f.win.ArtifactKit.params)).toBe(true);
    expect(f.win.ArtifactKit.reducedMotion).toBe(true);
    expect(f.html.attrs["data-reduced-motion"]).toBe("true");

    f.message({ source: "artifactkit-host", kind: "ak-init", nonce: "N2", params: {}, reducedMotion: false });
    expect(f.win.ArtifactKit.reducedMotion).toBe(false);
    expect(f.html.attrs["data-reduced-motion"]).toBeUndefined();
  });

  it("holds rAF callbacks while paused and runs them on resume", () => {
    const f = makeFake("complete");
    f.message({ source: "artifactkit-host", kind: "ak-init", nonce: "N1", params: {}, reducedMotion: false });

    f.message({ source: "artifactkit-host", kind: "ak-pause" });
    const seen: number[] = [];
    f.win.requestAnimationFrame((t) => seen.push(t));
    f.win.requestAnimationFrame((t) => seen.push(t));
    expect(f.rafCalls).toHaveLength(0);
    expect(seen).toEqual([]);

    f.message({ source: "artifactkit-host", kind: "ak-resume" });
    expect(seen).toEqual([123, 123]);

    f.win.requestAnimationFrame((t) => seen.push(t));
    expect(f.rafCalls).toHaveLength(1);
    expect(seen).toEqual([123, 123]);
  });

  it("reports uncaught errors as ak-error with the current nonce", () => {
    const f = makeFake("complete");
    f.message({ source: "artifactkit-host", kind: "ak-init", nonce: "N1", params: {}, reducedMotion: false });
    f.fire("error", { message: "boom" });
    const errs = f.posts.filter((p) => p.kind === "ak-error");
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ source: "artifactkit", v: 1, nonce: "N1", message: "boom", fatal: false });
  });

  it("reports errors before ak-init with a null nonce", () => {
    const f = makeFake("complete");
    f.win.ArtifactKit.reportError("early", { fatal: true });
    const errs = f.posts.filter((p) => p.kind === "ak-error");
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ nonce: null, message: "early", fatal: true });
  });

  it("truncates very long error messages to 500 characters", () => {
    const f = makeFake("complete");
    f.message({ source: "artifactkit-host", kind: "ak-init", nonce: "N1", params: {}, reducedMotion: false });
    const long = "x".repeat(800);
    f.win.ArtifactKit.reportError(long);
    const err = f.posts.find((p) => p.kind === "ak-error") as { message: string };
    expect(err.message).toHaveLength(500);
  });

  it("ignores non-string event names and non-object data", () => {
    const f = makeFake("complete");
    f.message({ source: "artifactkit-host", kind: "ak-init", nonce: "N1" });
    f.win.ArtifactKit.emit("", {});
    (f.win.ArtifactKit.emit as unknown as (n: unknown) => void)(42);
    f.win.ArtifactKit.emit("ok", "not-an-object");
    const events = f.posts.filter((p) => p.kind === "ak-event");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: "ok", data: {} });
  });
});
