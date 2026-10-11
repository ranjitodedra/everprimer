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
        className={`w-full overflow-hidden rounded-full bg-paper-deep ${compact ? "h-1.5" : "h-3"}`}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${label} ${pct}%`}
        aria-label={kind === "curriculum" ? "Preparing lessons" : "Building lesson"}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${retrying ? "animate-pulse bg-sun" : "bg-gradient-to-r from-brand to-sun"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={`flex items-center justify-between gap-3 ${compact ? "mt-1 text-xs" : "mt-2 text-sm"}`}>
        <span key={label} className={`animate-rise ${retrying ? "font-bold text-sun-deep" : "text-ink-soft"}`} aria-live="polite">
          {label}
        </span>
        <span className="shrink-0 font-extrabold tabular-nums text-ink-faint">{pct}%</span>
      </div>
    </div>
  );
}
