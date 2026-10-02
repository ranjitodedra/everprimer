"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Refresh, Wrench } from "./icons";

const MESSAGES = [
  "Picking the best way to explain this…",
  "Choosing pictures and comparisons…",
  "Writing questions that make you think…",
  "Checking every fact twice…",
  "Almost ready…",
];

/** Friendly wait screen that polls until the lesson is published. */
export function GeneratingState({
  topicId,
  emoji = "✨",
  failed,
  retry,
}: {
  topicId: string;
  emoji?: string;
  failed?: string | null;
  retry?: () => Promise<void>;
}) {
  const router = useRouter();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (failed) return;
    const rotate = setInterval(() => setI((n) => (n + 1) % MESSAGES.length), 3500);
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/topics/${topicId}/artifact`, { cache: "no-store" });
        const data = (await res.json()) as { status?: string };
        if (data.status === "published" || data.status === "failed") router.refresh();
      } catch {
        // try again next tick
      }
    }, 3000);
    return () => {
      clearInterval(rotate);
      clearInterval(poll);
    };
  }, [topicId, router, failed]);

  if (failed) {
    return (
      <div className="card flex flex-col items-center gap-4 py-14 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-sun-soft text-sun-deep" aria-hidden>
          <Wrench size={28} />
        </div>
        <div>
          <h2 className="text-2xl font-black">This lesson needs a little more time</h2>
          <p className="mx-auto mt-1 max-w-md text-ink-soft">We could not finish building it just now. You can try again, or pick another topic and come back later.</p>
        </div>
        {retry ? (
          <form action={retry}>
            <button type="submit" className="btn-primary btn-lg">
              <Refresh size={16} />
              Try again
            </button>
          </form>
        ) : (
          <button type="button" className="btn-primary btn-lg" onClick={() => router.refresh()}>
            <Refresh size={16} />
            Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card dotted-bg flex flex-col items-center gap-5 py-16 text-center" role="status" aria-live="polite">
      <div className="relative grid h-24 w-24 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-brand/15 [animation-duration:2.2s]" aria-hidden />
        <span className="absolute inset-3 animate-ping rounded-full bg-sun/20 [animation-delay:0.6s] [animation-duration:2.2s]" aria-hidden />
        <span className="animate-float relative grid h-16 w-16 place-items-center rounded-2xl bg-card text-4xl shadow-card">{emoji}</span>
      </div>
      <div>
        <h2 className="text-2xl font-black">Building your lesson</h2>
        <p key={i} className="animate-rise mx-auto mt-1 max-w-sm text-ink-soft">{MESSAGES[i]}</p>
      </div>
      <div className="flex gap-1.5" aria-hidden>
        {MESSAGES.map((_, n) => (
          <span key={n} className={`h-1.5 w-6 rounded-full transition ${n <= i ? "bg-brand" : "bg-paper-deep"}`} />
        ))}
      </div>
      <p className="text-xs text-ink-faint">This usually takes under a minute the first time.</p>
    </div>
  );
}
