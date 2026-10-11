"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GenerationProgress } from "./generation-progress";
import { Refresh, Wrench } from "./icons";

type Progress = { stage: string | null; stageAt: string | null; retrying: boolean };

/** Friendly wait screen that polls until the lesson is published. */
export function GeneratingState({
  topicId,
  emoji = "✨",
  stage: initialStage = null,
  stageAt: initialStageAt = null,
  retrying: initialRetrying = false,
  failed,
  retry,
}: {
  topicId: string;
  emoji?: string;
  stage?: string | null;
  stageAt?: string | null;
  retrying?: boolean;
  failed?: string | null;
  retry?: () => Promise<void>;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<Progress>({ stage: initialStage, stageAt: initialStageAt, retrying: initialRetrying });

  useEffect(() => {
    if (failed) return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/topics/${topicId}/artifact`, { cache: "no-store" });
        const data = (await res.json()) as { status?: string; stage?: string | null; stage_at?: string | null; error?: string | null };
        if (data.status === "published" || data.status === "failed" || data.status === "split") router.refresh();
        else if (data.status === "generating") {
          const next: Progress = { stage: data.stage ?? null, stageAt: data.stage_at ?? null, retrying: !!data.error };
          setProgress((prev) => (prev.stage === next.stage && prev.stageAt === next.stageAt && prev.retrying === next.retrying ? prev : next));
        }
      } catch {
        // try again next tick
      }
    }, 3000);
    return () => clearInterval(poll);
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
      <h2 className="text-2xl font-black">Building your lesson</h2>
      <GenerationProgress kind="artifact" stage={progress.stage} stageAt={progress.stageAt} retrying={progress.retrying} className="max-w-sm px-4 text-left" />
      <p className="text-xs text-ink-faint">This usually takes under a minute the first time.</p>
    </div>
  );
}
