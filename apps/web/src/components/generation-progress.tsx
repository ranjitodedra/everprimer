"use client";

import { estimateProgress, stageMeta, type GenerationKind } from "@eco/contracts";
import { useEffect, useState } from "react";

/**
 * Progress bar for a curriculum or lesson that is still generating. The
 * server reports the step; between reports the bar eases forward on its own
 * and never moves backwards while mounted.
 */
export function GenerationProgress({
  kind,
  stage,
  stageAt,
  size = "full",
  retrying = false,
  className = "",
}: {
  kind: GenerationKind;
  stage: string | null | undefined;
  stageAt: string | null | undefined;
  size?: "full" | "compact";
  /** The last attempt failed and another one is queued. */
  retrying?: boolean;
  className?: string;
}) {
  const meta = stageMeta(kind, stage);
  const label = retrying ? "Having trouble, trying again…" : meta.label;
  // Starts at the band floor so server and client render the same width.
  const [value, setValue] = useState(meta.from);

  useEffect(() => {
    const tick = () => setValue((prev) => Math.max(prev, estimateProgress(kind, stage, stageAt)));
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 500);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [kind, stage, stageAt]);

  const pct = Math.round(Math.max(value, meta.from) * 100);
  const compact = size === "compact";

  return (
    <div className={`w-full ${className}`}>
      <div
        className={`w-full overflow-hidden rounded-full bg-current/15 ${compact ? "h-1" : "h-1.5"}`}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${label} ${pct}%`}
        aria-label={kind === "curriculum" ? "Preparing lessons" : "Building lesson"}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${retrying ? "animate-pulse bg-spark" : "bg-current"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p key={label} className={`animate-swap ${compact ? "mt-1.5 text-xs" : "mt-3 text-sm"} ${retrying ? "font-semibold text-spark-deep" : "opacity-70"}`} aria-live="polite">
        {label}
      </p>
    </div>
  );
}
