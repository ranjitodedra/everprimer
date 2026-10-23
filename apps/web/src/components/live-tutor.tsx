"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveServerMessage, Session } from "@google/genai";
import type { TutorContext, TutorVoiceState } from "@eco/contracts";
import { Mic, MicOff } from "@/components/icons";
import {
  EXPLAIN_SCREEN,
  INPUT_RATE,
  OUTPUT_RATE,
  addLiveUsage,
  base64ToBytes,
  emptyLiveUsage,
  encodeMicBlock,
  formatTutorContext,
  pcm16ToFloat,
  rms,
  tutorSlideKey,
  type LiveUsage,
} from "@/lib/live-audio";

interface Props {
  /** The open lesson session; the server checks it belongs to this learner. */
  sessionId: string;
  /** Latest screen from the lesson, forwarded to the tutor while it is on. */
  context: TutorContext | null;
  onState: (state: TutorVoiceState) => void;
}

interface Grant {
  token: string;
  model: string;
  apiVersion: string;
  expiresAt: string;
  tutorSessionId: string;
}

interface Live {
  session: Session | null;
  stream: MediaStream;
  ctx: AudioContext;
  node: AudioWorkletNode | null;
  sources: Set<AudioBufferSourceNode>;
  playEnd: number;
  tutorSessionId: string | null;
  startedAt: number;
  /** When the current token stops working (ms since epoch). */
  tokenExpiresAt: number;
  /** Latest Gemini handle for picking the same conversation back up after a reconnect. */
  handle: string | null;
  /** Bumped on every connection, so callbacks from a replaced connection are ignored. */
  connection: number;
  connectedAt: number;
  reconnecting: boolean;
  failures: number;
  usage: LiveUsage;
  lastVoiceAt: number;
  lastActivityAt: number;
  awaitingReply: boolean;
  /** The learner spoke and the tutor has not finished its reply. */
  answeringLearner: boolean;
  /** The current tutor turn is a slide walk-through, which a newer slide may cut short. */
  explaining: boolean;
  /** A new slide arrived mid-conversation; explain it once things go quiet. */
  pendingExplain: boolean;
  closed: boolean;
  timer: ReturnType<typeof setInterval> | null;
  meter: ReturnType<typeof setInterval> | null;
}

type Phase = "off" | "connecting" | "live";

const VOICE_LEVEL = 0.02;
const VOICE_HOLD_MS = 600;
const LEARNER_QUIET_MS = 1200;
const CONTEXT_DEBOUNCE_MS = 900;
/** With nobody talking for this long, the tutor stops so a walked-away learner doesn't use up credits. */
const IDLE_MS = 2 * 60_000;
const TICK_MS = 60_000;
/** Reconnect this long before the token expires. */
const RENEW_BEFORE_MS = 60_000;
/** A connection that drops this soon after opening is not resumable; start the next one fresh. */
const FAST_DROP_MS = 5_000;
const MAX_FAILURES = 3;
const GREET = "(The learner just turned on the voice tutor. Say hi in a few words first.)";

function flushPlayback(live: Live) {
  live.sources.forEach((s) => {
    try {
      s.stop();
    } catch {}
  });
  live.sources.clear();
  live.playEnd = 0;
}

/** Nothing playing, no reply on the way, and the learner has been quiet for a moment. */
function isQuiet(live: Live): boolean {
  return (
    !live.awaitingReply &&
    !live.answeringLearner &&
    live.playEnd <= live.ctx.currentTime &&
    performance.now() - live.lastVoiceAt > LEARNER_QUIET_MS
  );
}

const ERRORS: Record<string, string> = {
  plan: "The voice tutor comes with the Max plan.",
  disabled: "A grown-up has turned the voice tutor off.",
  credits: "Out of credits for this month.",
  busy: "The tutor is already on somewhere else.",
  unavailable: "The tutor can't talk right now. Try again later.",
  mic: "Allow the microphone to talk with the tutor.",
  dropped: "The tutor got disconnected.",
  idle: "The tutor took a break. Tap to talk again.",
};

const LABEL: Record<TutorVoiceState, string> = { idle: "Starting", listening: "Listening", thinking: "Thinking", speaking: "Talking" };
const DOT: Record<TutorVoiceState, string> = {
  idle: "bg-current/40",
  listening: "bg-leaf",
  thinking: "bg-[#8b7cf6] motion-safe:animate-pulse",
  speaking: "bg-spark motion-safe:animate-pulse",
};

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

function isGrant(d: Record<string, unknown>): d is Record<string, unknown> & Grant {
  return typeof d.token === "string" && typeof d.tutorSessionId === "string" && typeof d.model === "string" && typeof d.expiresAt === "string";
}

/**
 * Optional voice chat with the lesson's tutor over Gemini Live. There is no time
 * cap: it runs until the learner ends it, goes quiet, or the account runs out of
 * credits. The server hands out ephemeral tokens and charges by the minute;
 * audio streams straight between the browser and Google and is never recorded
 * or stored by us.
 */
export function LiveTutor({ sessionId, context, onState }: Props) {
  const [phase, setPhase] = useState<Phase>("off");
  const [voice, setVoice] = useState<TutorVoiceState>("idle");
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const liveRef = useRef<Live | null>(null);
  const mutedRef = useRef(false);
  const contextRef = useRef<TutorContext | null>(null);
  const sentContextRef = useRef("");
  const explainedKeyRef = useRef("");
  const stateRef = useRef<TutorVoiceState>("idle");
  const onStateRef = useRef(onState);

  useEffect(() => {
    onStateRef.current = onState;
  }, [onState]);

  const publish = useCallback((s: TutorVoiceState) => {
    if (stateRef.current === s) return;
    stateRef.current = s;
    setVoice(s);
    onStateRef.current(s);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  const stop = useCallback(
    (reason?: keyof typeof ERRORS) => {
      const live = liveRef.current;
      liveRef.current = null;
      if (live && !live.closed) {
        live.closed = true;
        if (live.timer) clearInterval(live.timer);
        if (live.meter) clearInterval(live.meter);
        try {
          live.session?.close();
        } catch {}
        live.node?.port.close();
        live.node?.disconnect();
        live.stream.getTracks().forEach((t) => t.stop());
        live.sources.forEach((s) => {
          try {
            s.stop();
          } catch {}
        });
        void live.ctx.close().catch(() => {});
        if (live.tutorSessionId) {
          const url = `/api/tutor/live/${live.tutorSessionId}/end`;
          const body = JSON.stringify({ usage: live.usage });
          const sent = navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }));
          if (!sent) void fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
        }
      }
      setPhase("off");
      setMuted(false);
      mutedRef.current = false;
      publish("idle");
      if (reason) setNotice(ERRORS[reason] ?? ERRORS.unavailable!);
    },
    [publish],
  );

  const play = useCallback((live: Live, b64: string) => {
    const samples = pcm16ToFloat(base64ToBytes(b64));
    if (samples.length === 0) return;
    const buf = live.ctx.createBuffer(1, samples.length, OUTPUT_RATE);
    buf.copyToChannel(samples, 0);
    const src = live.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(live.ctx.destination);
    const at = Math.max(live.ctx.currentTime + 0.03, live.playEnd);
    src.start(at);
    live.playEnd = at + buf.duration;
    live.sources.add(src);
    src.onended = () => live.sources.delete(src);
  }, []);

  const sendContext = useCallback((live: Live, extra?: string) => {
    const c = contextRef.current;
    const text = [c ? formatTutorContext(c) : "", extra ?? ""].filter(Boolean).join("\n\n");
    if (!live.session || !text || (!extra && text === sentContextRef.current)) return;
    sentContextRef.current = c ? formatTutorContext(c) : "";
    live.session.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete: !!extra });
  }, []);

  /** Asks for one spoken walk-through of the current slide; the tutor then waits for the learner. */
  const explain = useCallback(
    (live: Live, greet = false) => {
      const c = contextRef.current;
      if (c) explainedKeyRef.current = tutorSlideKey(c);
      live.pendingExplain = false;
      const ask = [greet ? GREET : "", c ? EXPLAIN_SCREEN : ""].filter(Boolean).join("\n\n");
      if (!ask) return;
      live.explaining = !!c;
      live.answeringLearner = false;
      live.awaitingReply = true;
      sendContext(live, ask);
    },
    [sendContext],
  );

  // Assigned below; lets a connection's callbacks start the next one.
  const reconnectRef = useRef<(live: Live) => void>(() => {});

  const onMessage = useCallback(
    (live: Live, msg: LiveServerMessage) => {
      if (msg.usageMetadata) live.usage = addLiveUsage(live.usage, msg.usageMetadata);
      const resume = msg.sessionResumptionUpdate;
      if (resume?.resumable && resume.newHandle) live.handle = resume.newHandle;
      if (msg.goAway) reconnectRef.current(live);
      const sc = msg.serverContent;
      if (!sc) return;
      if (sc.interrupted) {
        // The tutor was cut off (the learner talked, or a new slide asked for a fresh walk-through):
        // drop what is queued so it stops at once.
        flushPlayback(live);
        live.awaitingReply = true;
      }
      if (sc.inputTranscription?.text) {
        live.awaitingReply = true;
        live.answeringLearner = true;
        live.explaining = false;
      }
      for (const part of sc.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) {
          live.awaitingReply = false;
          play(live, part.inlineData.data);
        }
      }
      if (sc.turnComplete) {
        live.awaitingReply = false;
        live.answeringLearner = false;
      }
    },
    [play],
  );

  /** Opens a Gemini connection with this token, resuming the conversation when a handle is given. */
  const connect = useCallback(
    async (live: Live, grant: Grant, handle: string | null): Promise<void> => {
      const { GoogleGenAI, Modality } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: grant.token, httpOptions: { apiVersion: grant.apiVersion } });
      const id = ++live.connection;
      const session = await ai.live.connect({
        model: grant.model,
        config: { responseModalities: [Modality.AUDIO], sessionResumption: handle ? { handle } : {} },
        callbacks: {
          onmessage: (m) => {
            if (id === live.connection) onMessage(live, m);
          },
          onerror: () => {
            if (id === live.connection && !live.closed) reconnectRef.current(live);
          },
          onclose: () => {
            if (id !== live.connection || live.closed) return;
            if (Date.now() - live.connectedAt < FAST_DROP_MS) live.handle = null;
            reconnectRef.current(live);
          },
        },
      });
      if (live.closed || id !== live.connection) {
        session.close();
        return;
      }
      live.session = session;
      live.connectedAt = Date.now();
      live.tokenExpiresAt = Date.parse(grant.expiresAt) || Date.now() + 25 * 60_000;
    },
    [onMessage],
  );

  // Gemini moves long conversations to a new connection every few minutes, and tokens
  // expire: fetch a fresh token and pick the conversation back up with the latest handle.
  // If it can't be resumed, start fresh and tell the tutor what is on screen.
  const reconnect = useCallback(
    async (live: Live) => {
      if (live.closed || live.reconnecting || !live.tutorSessionId) return;
      live.reconnecting = true;
      const old = live.session;
      live.session = null;
      live.connection++;
      try {
        old?.close();
      } catch {}
      try {
        const renewed = await postJson(`/api/tutor/live/${live.tutorSessionId}/renew`);
        if (live.closed) return;
        if (!renewed.ok || !isGrant(renewed.data)) {
          const error = typeof renewed.data.error === "string" ? renewed.data.error : "";
          return stop(error === "credits" || error === "disabled" || error === "plan" ? error : "dropped");
        }
        const handle = live.handle;
        try {
          await connect(live, renewed.data, handle);
        } catch (err) {
          if (!handle) throw err;
          live.handle = null;
          await connect(live, renewed.data, null);
        }
        if (live.closed) return;
        if (!handle || !live.handle) {
          sentContextRef.current = "";
          sendContext(live);
        }
        live.failures = 0;
      } catch (err) {
        console.error("[live-tutor] reconnect", err instanceof Error ? err.message : err);
        if (live.closed) return;
        live.failures++;
        if (live.failures >= MAX_FAILURES) return stop("dropped");
        setTimeout(() => {
          live.reconnecting = false;
          void reconnectRef.current(live);
        }, 1000 * live.failures);
        return;
      } finally {
        if (live.failures === 0) live.reconnecting = false;
      }
    },
    [connect, sendContext, stop],
  );

  useEffect(() => {
    reconnectRef.current = (live) => void reconnect(live);
  }, [reconnect]);

  /** Reports time and token use; the server charges credits and says when they have run out. */
  const meter = useCallback(
    async (live: Live) => {
      if (live.closed || !live.tutorSessionId) return;
      try {
        const res = await postJson(`/api/tutor/live/${live.tutorSessionId}/tick`, { usage: live.usage });
        if (live.closed) return;
        if (res.data.stop === "credits") stop("credits");
        else if (res.data.stop === "ended") stop();
      } catch {}
    },
    [stop],
  );

  const start = useCallback(async () => {
    if (liveRef.current) return;
    setNotice(null);
    setPhase("connecting");
    explainedKeyRef.current = "";
    sentContextRef.current = "";

    if (!navigator.mediaDevices?.getUserMedia) return stop("mic");
    // Created inside the tap so iOS lets it play sound.
    const ctx = new AudioContext();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      void ctx.close().catch(() => {});
      return stop("mic");
    }
    const live: Live = {
      session: null,
      stream,
      ctx,
      node: null,
      sources: new Set(),
      playEnd: 0,
      tutorSessionId: null,
      startedAt: Date.now(),
      tokenExpiresAt: 0,
      handle: null,
      connection: 0,
      connectedAt: 0,
      reconnecting: false,
      failures: 0,
      usage: emptyLiveUsage(),
      lastVoiceAt: 0,
      lastActivityAt: performance.now(),
      awaitingReply: true,
      answeringLearner: false,
      explaining: false,
      pendingExplain: false,
      closed: false,
      timer: null,
      meter: null,
    };
    liveRef.current = live;
    publish("thinking");

    try {
      await ctx.resume();
      const res = await postJson("/api/tutor/live", { sessionId });
      if (live.closed) return;
      if (!res.ok || !isGrant(res.data)) {
        const error = typeof res.data.error === "string" && res.data.error in ERRORS ? res.data.error : "unavailable";
        return stop(error);
      }
      live.tutorSessionId = res.data.tutorSessionId;
      await connect(live, res.data, null);
      if (live.closed) return;

      await ctx.audioWorklet.addModule("/worklets/pcm-capture.js");
      if (live.closed) return;
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "pcm-capture");
      const sink = ctx.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink).connect(ctx.destination);
      live.node = node;
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (live.closed || !live.session) return;
        if (mutedRef.current) return;
        if (rms(e.data) > VOICE_LEVEL) live.lastVoiceAt = performance.now();
        live.session.sendRealtimeInput({ audio: { data: encodeMicBlock(e.data, ctx.sampleRate), mimeType: `audio/pcm;rate=${INPUT_RATE}` } });
      };

      live.startedAt = Date.now();
      live.lastActivityAt = performance.now();
      explain(live, true);
      setElapsed(0);
      setPhase("live");

      live.meter = setInterval(() => void meter(live), TICK_MS);
      live.timer = setInterval(() => {
        if (live.closed) return;
        setElapsed((Date.now() - live.startedAt) / 1000);
        const now = performance.now();
        const playing = live.playEnd > ctx.currentTime;
        if (playing || live.awaitingReply || now - live.lastVoiceAt < VOICE_HOLD_MS) live.lastActivityAt = now;
        if (now - live.lastActivityAt > IDLE_MS) return stop("idle");
        if (!live.reconnecting && live.tokenExpiresAt && Date.now() > live.tokenExpiresAt - RENEW_BEFORE_MS) reconnectRef.current(live);
        if (live.pendingExplain && live.session && isQuiet(live)) explain(live);
        if (playing) publish("speaking");
        else if (!mutedRef.current && now - live.lastVoiceAt < VOICE_HOLD_MS) publish("listening");
        else publish(live.awaitingReply ? "thinking" : "listening");
      }, 200);
    } catch (err) {
      console.error("[live-tutor]", err instanceof Error ? err.message : err);
      if (!live.closed) stop("unavailable");
    }
  }, [connect, explain, meter, publish, sessionId, stop]);

  // Forward screen changes while the tutor is on, settled so quick taps send one update.
  // Each new slide is explained once: right away if the tutor is idle or still walking
  // through the previous slide, otherwise after it finishes with the learner.
  useEffect(() => {
    contextRef.current = context;
    const live = liveRef.current;
    if (phase !== "live" || !live) return;
    const t = setTimeout(() => {
      if (live.closed || !live.session) return;
      live.lastActivityAt = performance.now();
      if (!context || tutorSlideKey(context) === explainedKeyRef.current) return sendContext(live);
      const playing = live.playEnd > live.ctx.currentTime;
      const stillExplaining = live.explaining && (live.awaitingReply || playing) && !live.answeringLearner;
      if (isQuiet(live) || stillExplaining) {
        flushPlayback(live);
        explain(live);
      } else {
        explainedKeyRef.current = tutorSlideKey(context);
        sendContext(live);
        live.pendingExplain = true;
      }
    }, CONTEXT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [context, explain, phase, sendContext]);

  // Hiding the app or leaving the lesson ends the session; nothing keeps listening in the background.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") stop();
    };
    const onPageHide = () => stop();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      stop();
    };
  }, [stop]);

  const toggleMute = () => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    const live = liveRef.current;
    live?.stream.getAudioTracks().forEach((t) => (t.enabled = !next));
    if (next) live?.session?.sendRealtimeInput({ audioStreamEnd: true });
  };

  return (
    <>
      {phase === "off" ? (
        <button
          type="button"
          onClick={() => void start()}
          className="press flex h-11 items-center gap-2 rounded-full bg-current/10 pr-4 pl-3.5 text-[15px] font-semibold"
        >
          <Mic size={18} />
          Live tutor
        </button>
      ) : (
        <div className="flex h-11 items-center gap-1 rounded-full bg-current/10 py-1 pr-1 pl-3.5" role="group" aria-label="Live tutor">
          <span className={`h-2 w-2 shrink-0 rounded-full ${phase === "connecting" ? DOT.idle : muted ? "bg-current/40" : DOT[voice]}`} aria-hidden />
          <span className="min-w-[4.6rem] pl-1 text-[15px] font-semibold" aria-live="polite">
            {phase === "connecting" ? "Starting" : muted ? "Muted" : LABEL[voice]}
          </span>
          {phase === "live" ? (
            <span className="pr-1 text-sm tabular-nums opacity-60" aria-label={`Talking for ${clock(elapsed)}`}>
              {clock(elapsed)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={toggleMute}
            disabled={phase !== "live"}
            aria-pressed={muted}
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
            className="press grid h-9 w-9 place-items-center rounded-full disabled:opacity-40"
          >
            {muted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button type="button" onClick={() => stop()} className="press h-9 rounded-full bg-ink px-3.5 text-sm font-semibold text-white">
            End
          </button>
        </div>
      )}
      <div className="pointer-events-none fixed inset-x-0 top-[calc(max(0.5rem,env(safe-area-inset-top,0px))+3.5rem)] z-10 flex justify-center px-4" aria-live="polite">
        {notice ? <p className="animate-rise rounded-full bg-ink px-4 py-2 text-center text-sm font-semibold text-white">{notice}</p> : null}
      </div>
    </>
  );
}
