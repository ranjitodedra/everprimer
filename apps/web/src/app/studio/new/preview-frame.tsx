"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ParamField = {
  key: string;
  type: string;
  description?: string;
  default?: unknown;
  min?: number;
  max?: number;
  options?: string[];
};

type PreviewManifest = {
  params?: ParamField[];
  events?: { name: string }[];
};

const FRAMES = { phone: 390, tablet: 768, desktop: 1100 } as const;

function declaredNames(key: string): Set<string> {
  return new Set([...key.split("\n").filter(Boolean), "interacted"]);
}

function initialParams(manifest: PreviewManifest): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const param of manifest.params ?? []) params[param.key] = param.default ?? "";
  return params;
}

/** Sandboxed preview. Messages are accepted only from this iframe, and events must carry the current nonce. */
export function PreviewFrame({ url, manifest }: { url: string; manifest: PreviewManifest }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const nonceRef = useRef("");
  const [frame, setFrame] = useState<keyof typeof FRAMES>("desktop");
  const [params, setParams] = useState(() => initialParams(manifest));
  const [reducedMotion, setReducedMotion] = useState(false);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [events, setEvents] = useState<{ name: string; data: unknown; declared: boolean }[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const declaredKey = (manifest.events ?? []).map((event) => event.name).join("\n");
  const names = useMemo(() => declaredNames(declaredKey), [declaredKey]);

  function send(message: Record<string, unknown>) {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    target.postMessage({ source: "artifactkit-host", v: 1, ...message }, "*");
  }

  function sendInit(nextParams: Record<string, unknown>, nextMotion: boolean) {
    const nonce = crypto.randomUUID();
    nonceRef.current = nonce;
    send({ kind: "ak-init", nonce, params: nextParams, reducedMotion: nextMotion });
  }

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { source?: string; v?: number; kind?: string; nonce?: string; name?: string; data?: unknown; message?: string } | null;
      if (!data || data.source !== "artifactkit" || data.v !== 1) return;
      if (data.kind === "ak-ready") {
        setReady(true);
        return;
      }
      if (data.kind === "ak-event" && data.name && data.nonce && data.nonce === nonceRef.current) {
        setEvents((prev) => [...prev, { name: data.name!, data: data.data ?? {}, declared: names.has(data.name!) }]);
      }
      if (data.kind === "ak-error" && data.message) setErrors((prev) => [...prev, data.message!]);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [names, url]);

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap gap-2">
        {(Object.keys(FRAMES) as (keyof typeof FRAMES)[]).map((name) => (
          <button key={name} type="button" className={frame === name ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setFrame(name)}>
            {name}
          </button>
        ))}
        <label className="inline-flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={reducedMotion} onChange={(event) => { setReducedMotion(event.target.checked); sendInit(params, event.target.checked); }} />
          Reduced motion
        </label>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => {
            const next = !paused;
            setPaused(next);
            send({ kind: next ? "ak-pause" : "ak-resume" });
          }}
        >
          {paused ? "Resume" : "Pause"}
        </button>
        <span className="text-sm text-ink-soft">{ready ? "Preview ready" : "Waiting for the preview"}</span>
      </div>

      <div className="overflow-auto rounded-2xl border border-ink/10 bg-ink/5 p-4">
        <iframe
          ref={iframeRef}
          title="Artifact preview"
          src={url}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          onLoad={() => sendInit(params, reducedMotion)}
          style={{ width: FRAMES[frame], height: 640 }}
          className="mx-auto block bg-white"
        />
      </div>

      {(manifest.params ?? []).length > 0 ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(manifest.params ?? []).map((param) => (
            <label key={param.key} className="block text-sm font-semibold">
              {param.key}
              {param.type === "boolean" ? (
                <input
                  type="checkbox"
                  className="ml-2"
                  checked={Boolean(params[param.key])}
                  onChange={(event) => {
                    const next = { ...params, [param.key]: event.target.checked };
                    setParams(next);
                    sendInit(next, reducedMotion);
                  }}
                />
              ) : (
                <input
                  className="input mt-1"
                  value={String(params[param.key] ?? "")}
                  onChange={(event) => {
                    const raw = event.target.value;
                    const value = param.type === "number" ? Number(raw) : param.type.endsWith("[]") ? raw.split(",").map((part) => part.trim()).filter(Boolean) : raw;
                    const next = { ...params, [param.key]: param.type === "number[]" ? (value as string[]).map(Number) : value };
                    setParams(next);
                    sendInit(next, reducedMotion);
                  }}
                />
              )}
            </label>
          ))}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold">Events</h2>
          {events.length === 0 ? <p className="text-sm text-ink-soft">None yet.</p> : (
            <ul className="mt-2 space-y-1 text-sm">
              {events.map((event, index) => (
                <li key={`${event.name}-${index}`}>
                  {event.name} · {event.declared ? "declared" : "not declared"}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2 className="text-sm font-semibold">Errors</h2>
          {errors.length === 0 ? <p className="text-sm text-ink-soft">None.</p> : (
            <ul className="mt-2 space-y-1 text-sm text-berry">
              {errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
