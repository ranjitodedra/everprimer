"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LEARNKIT_PROTOCOL_VERSION, LearnKitMessage, type HostInitMessage, type LearningEvent } from "@eco/contracts";
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
}

const FLUSH_MS = 2000;
const FLUSH_AT = 25;

/**
 * Hosts a generated lesson in a sandboxed iframe and relays its LearnKit
 * events to /api/events in idempotent batches.
 *
 * Security model: `sandbox="allow-scripts"` without allow-same-origin gives
 * the document an opaque origin, so it cannot read cookies or storage and
 * cannot make same-origin requests. We accept messages only from this exact
 * iframe window and only when they carry the per-session nonce.
 */
export function ArtifactPlayer({ html, sessionId, nonce, topicId, artifactId, title, backHref, startSession = 0 }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const queueRef = useRef<Map<string, LearningEvent>>(new Map());
  const inFlightRef = useRef(false);
  const followRef = useRef(false);
  const followKeepaliveRef = useRef(false);
  const [height, setHeight] = useState(720);
  const [completed, setCompleted] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");

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
    [sessionId],
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

  const sendInit = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const msg: HostInitMessage = {
      source: "learnkit-host",
      v: LEARNKIT_PROTOCOL_VERSION,
      kind: "init",
      nonce,
      topicId,
      artifactId,
      reducedMotion: typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      startSession,
    };
    win.postMessage(msg, "*");
  }, [nonce, topicId, artifactId, startSession]);

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
      if (msg.kind === "ready") sendInit();
      else if (msg.kind === "resize") {
        // No slack: the artifact measures its own content, and anything we add
        // here is re-measured on the next tick and grows the frame forever.
        const next = Math.max(480, Math.min(4000, Math.ceil(msg.height)));
        setHeight((prev) => (Math.abs(prev - next) > 4 ? next : prev));
      }
      else if (msg.kind === "event") {
        if (msg.nonce !== nonce) return;
        enqueue(msg.event);
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
  }, [artifactId, enqueue, flush, nonce, sendInit]);

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-lift">
        <iframe
          ref={iframeRef}
          title={title}
          srcDoc={html}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          loading="eager"
          onLoad={sendInit}
          style={{ height }}
          className="block w-full border-0"
        />
      </div>
      <div className="flex items-center justify-between gap-3 px-1 text-xs font-bold text-ink-soft" aria-live="polite">
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${saveState === "saving" ? "animate-pulse bg-sun" : saveState === "error" ? "bg-berry" : "bg-brand"}`} aria-hidden />
          {saveState === "saving" ? "Saving progress…" : saveState === "error" ? "Progress will save when you're back online." : "Progress saves automatically."}
        </span>
        {completed ? (
          <Link href={backHref} className="btn-primary animate-pop">
            Back to path
          </Link>
        ) : null}
      </div>
    </div>
  );
}
