"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GenerationProgress } from "./generation-progress";
import { Refresh } from "./icons";

type Progress = { stage: string | null; stageAt: string | null; retrying: boolean };

/** Calm wait screen that polls until the lesson is published. */
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
      <div className="flex flex-col items-center px-6 text-center">
        <span className="text-7xl" aria-hidden>🛠️</span>
        <h2 className="display mt-6 text-4xl">This one needs more time</h2>
        <p className="mt-3 max-w-xs opacity-75">Try again, or pick another lesson and come back later.</p>
        {retry ? (
          <form action={retry} className="mt-8">
            <button type="submit" className="btn-primary btn-lg">
              <Refresh size={18} />
              Try again
            </button>
          </form>
        ) : (
          <button type="button" className="btn-primary btn-lg mt-8" onClick={() => router.refresh()}>
            <Refresh size={18} />
            Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center px-6 text-center" role="status" aria-live="polite">
      <span className="grid h-36 w-36 place-items-center rounded-full bg-paper/60" aria-hidden>
        <span className="animate-breathe text-7xl">{emoji}</span>
      </span>
      <h2 className="display mt-8 text-4xl">Making your lesson</h2>
      <GenerationProgress kind="artifact" stage={progress.stage} stageAt={progress.stageAt} retrying={progress.retrying} className="mt-6 max-w-64" />
    </div>
  );
}
