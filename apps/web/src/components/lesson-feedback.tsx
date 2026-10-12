import type { LessonFeedbackRow } from "@eco/db";
import { StatusBadge } from "@/components/ui";

/** The end-of-lesson summary for grown-ups: what landed and what will come back. */
export function LessonFeedback({ feedback, title, compact = false }: { feedback: LessonFeedbackRow; title?: string; compact?: boolean }) {
  return (
    <div className="rounded-2xl bg-paper px-4 py-4">
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <p className="text-pretty">{feedback.parent}</p>
      {compact ? null : (
        <ul className="mt-3 divide-y divide-line">
          {feedback.objectives.map((o) => (
            <li key={o.code} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span>{o.text}</span>
              <StatusBadge status={o.status} />
            </li>
          ))}
        </ul>
      )}
      {feedback.practice.length ? (
        <p className="mt-3 text-sm text-ink-soft">Coming back later: {feedback.practice.join(", ")}</p>
      ) : null}
    </div>
  );
}
