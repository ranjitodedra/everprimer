import type { LessonFeedbackRow } from "@eco/db";
import { StatusBadge } from "@/components/ui";

/** The end-of-lesson summary for grown-ups: what landed and what will come back. */
export function LessonFeedback({ feedback, title, compact = false }: { feedback: LessonFeedbackRow; title?: string; compact?: boolean }) {
  return (
    <div className="rounded-xl bg-paper p-3">
      {title ? <p className="mb-1 text-sm font-extrabold">{title}</p> : null}
      <p className="text-sm">{feedback.parent}</p>
      {compact ? null : (
        <ul className="mt-2 space-y-1.5">
          {feedback.objectives.map((o) => (
            <li key={o.code} className="flex items-center justify-between gap-3 text-sm">
              <span>{o.text}</span>
              <StatusBadge status={o.status} />
            </li>
          ))}
        </ul>
      )}
      {feedback.practice.length ? (
        <p className="mt-2 text-xs text-ink-soft">
          <span className="font-bold">Comes back in later lessons:</span> {feedback.practice.join("; ")}
        </p>
      ) : null}
    </div>
  );
}
