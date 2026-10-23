"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  LEARNKIT_PROTOCOL_VERSION,
  LearnKitMessage,
  TutorImageDataUri,
  type HostInitMessage,
  type HostTutorArtMessage,
  type HostTutorStateMessage,
  type LearningEvent,
  type TutorContext,
  type TutorVoiceState,
} from "@eco/contracts";
import { Star, X } from "@/components/icons";
import { LiveTutor } from "@/components/live-tutor";
import { SheetPanel, closeSheet, openSheet } from "@/components/sheet";
import type { CharacterStatus } from "@/lib/lesson-art";
import { newId } from "@/lib/uuid";

interface Props {
  html: string;
  sessionId: string;
  nonce: string;
  topicId: string;
  artifactId: string;
  title: string;
  backHref: string;
  startSession?: number;
  background?: string;
  dark?: boolean;
  /** The lesson's tutor character; the lesson stays plain text until both poses load. */
  character?: CharacterStatus;
  /** Offer the voice tutor. The server re-checks plan, switch and limits on start. */
  liveTutor?: boolean;
}

const FLUSH_MS = 2000;
const FLUSH_AT = 25;
/** Longest a learner waits on the way out for the last progress to save. */
const LEAVE_WAIT_MS = 4000;
const CHARACTER_POLL_MS = 5000;
const CHARACTER_POLL_FOR_MS = 3 * 60_000;
const CHARACTER_MAX_BYTES = 4 * 1024 * 1024;

type CharacterArt = { talk: string; teach: string; cutout: boolean };

async function poseDataUri(url: string, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const blob = await res.blob();
  if (!/^image\/(png|jpeg|webp)$/.test(blob.type) || blob.size === 0 || blob.size > CHARACTER_MAX_BYTES) return null;
  const uri = await new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
  return uri && TutorImageDataUri.safeParse(uri).success ? uri : null;
}

/**
 * Both poses of the lesson's character as data URIs (the lesson frame's CSP allows no network),
 * or null while they are drawn, if they fail, or when art is off. Waits a few minutes for a new drawing.
 */
function useLessonCharacter(topicId: string, initial: CharacterStatus | undefined): CharacterArt | null {
  const [art, setArt] = useState<CharacterArt | null>(null);
  const initialStatus = initial?.status ?? "off";
  const initialVersion = initial?.version ?? null;
  const initialCutout = initial?.cutout ?? false;
  useEffect(() => {
    if (initialStatus === "off" || initialStatus === "failed") return;
    const ctrl = new AbortController();
    void (async () => {
      let status: CharacterStatus = { status: initialStatus, version: initialVersion, cutout: initialCutout };
      const until = Date.now() + CHARACTER_POLL_FOR_MS;
      while ((status.status === "queued" || status.status === "running") && Date.now() < until) {
        await new Promise((r) => setTimeout(r, CHARACTER_POLL_MS));
        if (ctrl.signal.aborted) return;
        const res = await fetch(`/api/topics/${topicId}/character`, { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) return;
        status = (await res.json()) as CharacterStatus;
      }
      if (status.status !== "ready" || !status.version) return;
      const v = encodeURIComponent(status.version);
      const [talk, teach] = await Promise.all(
        (["talk", "teach"] as const).map((pose) => poseDataUri(`/api/topics/${topicId}/character/${pose}?v=${v}`, ctrl.signal)),
      );
      if (talk && teach && !ctrl.signal.aborted) setArt({ talk, teach, cutout: status.cutout === true });
    })().catch(() => {});
    return () => ctrl.abort();
  }, [topicId, initialStatus, initialVersion, initialCutout]);
  return art;
}

/**
 * Height of the area above the on-screen keyboard, or null while it is closed.
 * Web uses the visual viewport; the native app reports the keyboard height.
 */
function useKeyboardFreeHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    let keyboard = 0;
    let shownAt = window.innerHeight;
    const update = () => {
      const base = keyboard ? shownAt : window.innerHeight;
      const free = Math.min(vv?.height ?? base, window.innerHeight, base - keyboard);
      setHeight(base - free > 80 ? Math.round(free) : null);
      // iOS scrolls the page to reveal a field inside the frame; the frame already sits above the keyboard.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);

    let cancelled = false;
    const removers: Array<() => void> = [];
    void (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform() || cancelled) return;
      const { Keyboard } = await import("@capacitor/keyboard");
      const show = await Keyboard.addListener("keyboardWillShow", (info) => {
        shownAt = window.innerHeight;
        keyboard = info.keyboardHeight;
        update();
      });
      const hide = await Keyboard.addListener("keyboardWillHide", () => {
        keyboard = 0;
        update();
      });
      removers.push(() => void show.remove(), () => void hide.remove());
      if (cancelled) removers.forEach((r) => r());
    })();

    return () => {
      cancelled = true;
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      removers.forEach((r) => r());
    };
  }, []);
  return height;
}

/**
 * Hosts a generated lesson in a sandboxed iframe and relays its LearnKit
 * events to /api/events in idempotent batches.
 *
 * Security model: `sandbox="allow-scripts"` without allow-same-origin gives
 * the document an opaque origin, so it cannot read cookies or storage and
 * cannot make same-origin requests. We accept messages only from this exact
 * iframe window and only when they carry the per-session nonce.
 */
export function ArtifactPlayer({ html, sessionId, nonce, topicId, artifactId, title, backHref, startSession = 0, background, dark, character, liveTutor = false }: Props) {
  const router = useRouter();
  const keyboardFree = useKeyboardFreeHeight();
  const art = useLessonCharacter(topicId, character);
  const artRef = useRef<CharacterArt | null>(null);
  const [lessonContext, setLessonContext] = useState<TutorContext | null>(null);
  const [leaving, setLeaving] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const queueRef = useRef<Map<string, LearningEvent>>(new Map());
  const inFlightRef = useRef(false);
  const followRef = useRef(false);
  const followKeepaliveRef = useRef(false);
  const [completed, setCompleted] = useState(false);
  const [saveState, setSaveStateValue] = useState<"idle" | "saving" | "error">("idle");
  const saveStateRef = useRef(saveState);
  const setSaveState = useCallback((s: "idle" | "saving" | "error") => {
    saveStateRef.current = s;
    setSaveStateValue(s);
  }, []);
  const done = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!completed) return;
    // Let the lesson's own score screen land before offering the way out.
    const t = setTimeout(() => openSheet(done), 1800);
    return () => clearTimeout(t);
  }, [completed]);

  const flush = useCallback(
    // Recursive self-call after a follow-up batch; the compiler cannot memoize it.
    // eslint-disable-next-line react-hooks/preserve-manual-memoization -- flush re-enters itself
    async (opts: { keepalive?: boolean } = {}) => {
      if (queueRef.current.size === 0) return;
      // A leave or a completion can arrive while a batch is already on the wire.
      // Remember it and send the remainder when this request finishes. Event ids
      // are deduped, so the follow-up cannot double-count.
      if (inFlightRef.current) {
        followRef.current = true;
        if (opts.keepalive) followKeepaliveRef.current = true;
        return;
      }
      const events = [...queueRef.current.values()].slice(0, 200);
      inFlightRef.current = true;
      followRef.current = false;
      setSaveState("saving");
      let ok = false;
      try {
        const res = await fetch("/api/events", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, events }),
          keepalive: opts.keepalive ?? false,
        });
        if (!res.ok) throw new Error(`events ${res.status}`);
        for (const e of events) queueRef.current.delete(e.clientEventId);
        ok = true;
        setSaveState("idle");
      } catch {
        setSaveState("error"); // kept in queue; retried on the next tick or the follow-up
      } finally {
        inFlightRef.current = false;
        const keepalive = followKeepaliveRef.current;
        const again = queueRef.current.size > 0 && (followRef.current || ok);
        followRef.current = false;
        followKeepaliveRef.current = false;
        if (again) void flush({ keepalive });
      }
    },
    [sessionId, setSaveState],
  );

  const enqueue = useCallback(
    (event: LearningEvent) => {
      queueRef.current.set(event.clientEventId, event);
      if (event.type === "topic_completed") {
        setCompleted(true);
        void flush();
        return;
      }
      if (queueRef.current.size >= FLUSH_AT) void flush();
    },
    [flush],
  );

  /** Sends whatever is queued and waits for it, so the next page reads saved progress. */
  const leave = useCallback(async () => {
    setLeaving(true);
    const drain = async () => {
      while (queueRef.current.size > 0 || inFlightRef.current) {
        if (inFlightRef.current) await new Promise((r) => setTimeout(r, 100));
        else await flush();
        if (saveStateRef.current === "error") return;
      }
    };
    await Promise.race([drain(), new Promise((r) => setTimeout(r, LEAVE_WAIT_MS))]);
    router.push(backHref);
  }, [backHref, flush, router]);

  const postToFrame = useCallback((msg: HostInitMessage | HostTutorArtMessage | HostTutorStateMessage) => {
    iframeRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  const sendArt = useCallback(() => {
    const a = artRef.current;
    if (a) postToFrame({ source: "learnkit-host", v: LEARNKIT_PROTOCOL_VERSION, kind: "tutor_art", talk: a.talk, teach: a.teach, cutout: a.cutout });
  }, [postToFrame]);

  useEffect(() => {
    artRef.current = art;
    sendArt();
  }, [art, sendArt]);

  const sendInit = useCallback(() => {
    postToFrame({
      source: "learnkit-host",
      v: LEARNKIT_PROTOCOL_VERSION,
      kind: "init",
      nonce,
      topicId,
      artifactId,
      reducedMotion: typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      startSession,
    });
    // A reloaded frame starts plain, so it gets the character again.
    sendArt();
  }, [postToFrame, nonce, topicId, artifactId, startSession, sendArt]);

  const sendTutorState = useCallback(
    (state: TutorVoiceState) => postToFrame({ source: "learnkit-host", v: LEARNKIT_PROTOCOL_VERSION, kind: "tutor_state", state }),
    [postToFrame],
  );

  useEffect(() => {
    // The host records the open; the artifact records everything after.
    const opened: LearningEvent = { clientEventId: newId(), type: "topic_opened", occurredAt: new Date().toISOString(), payload: { artifactId } };
    queueRef.current.set(opened.clientEventId, opened);
    const initialFlush = setTimeout(() => void flush(), 0);

    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const parsed = LearnKitMessage.safeParse(e.data);
      if (!parsed.success) return;
      const msg = parsed.data;
      // The frame fills the screen and the lesson scrolls inside it, so resize messages are ignored.
      if (msg.kind === "ready") sendInit();
      else if (msg.kind === "event") {
        if (msg.nonce !== nonce) return;
        enqueue(msg.event);
      } else if (msg.kind === "context") {
        if (msg.nonce !== nonce || !liveTutor) return;
        setLessonContext(msg.context);
      }
    };
    window.addEventListener("message", onMessage);

    const timer = setInterval(() => void flush(), FLUSH_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush({ keepalive: true });
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      clearTimeout(initialFlush);
      clearInterval(timer);
      void flush({ keepalive: true });
    };
  }, [artifactId, enqueue, flush, liveTutor, nonce, sendInit]);

  return (
    <div
      className={`flex h-dvh flex-col overflow-hidden ${dark ? "text-white" : ""}`}
      style={{ background, height: keyboardFree ?? undefined }}
    >
      <div className="flex shrink-0 items-center px-3 pt-[max(0.5rem,env(safe-area-inset-top,0px))]">
        <button type="button" onClick={() => void leave()} disabled={leaving} className="press grid h-11 w-11 place-items-center rounded-full bg-current/10" aria-label="Close lesson">
          <X size={20} />
        </button>
        {liveTutor ? (
          <div className="ml-auto">
            <LiveTutor sessionId={sessionId} context={lessonContext} onState={sendTutorState} />
          </div>
        ) : null}
      </div>
      <div className={`relative min-h-0 flex-1 ${keyboardFree ? "" : "pb-[env(safe-area-inset-bottom,0px)]"}`}>
        <iframe
          ref={iframeRef}
          title={title}
          srcDoc={html}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          loading="eager"
          onLoad={sendInit}
          className="block h-full w-full border-0"
        />
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center px-4" aria-live="polite">
          {saveState === "error" ? (
            <p className="animate-rise rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white">Not saved yet. Still trying.</p>
          ) : null}
        </div>
      </div>

      <SheetPanel ref={done} title="Lesson done">
        <div className="flex flex-col items-center pb-2 text-center">
          <span className="animate-pop grid h-24 w-24 place-items-center rounded-full bg-spark-soft text-spark" aria-hidden>
            <Star size={48} />
          </span>
          <p className="mt-5 text-lg text-ink-soft">That one is in the bag.</p>
          <button type="button" onClick={() => void leave()} disabled={leaving} className="btn-primary btn-lg mt-7 w-full">
            {leaving ? "Saving…" : "Back to path"}
          </button>
          <button type="button" onClick={() => closeSheet(done)} className="btn-ghost mt-2 w-full">Stay here</button>
        </div>
      </SheetPanel>
    </div>
  );
}
