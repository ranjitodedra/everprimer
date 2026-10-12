import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ChevronRight } from "./icons";

/* ---------- Fields ---------- */

export const FIELDS = ["meadow", "sky", "sun", "bloom", "lilac"] as const;
export type Field = (typeof FIELDS)[number];

/** Stable field class for an id, so a topic or learner keeps its colour everywhere. */
export function fieldFor(id: string): `f-${Field}` {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return `f-${FIELDS[Math.abs(h) % FIELDS.length]}`;
}

/* ---------- Status ---------- */

const STATUS: Record<string, { label: string; text: string; dot: string }> = {
  not_started: { label: "Not started", text: "text-ink-soft", dot: "bg-ink-faint" },
  locked: { label: "Locked", text: "text-ink-soft", dot: "bg-ink-faint" },
  in_progress: { label: "In progress", text: "text-sky-ink", dot: "bg-sky-ink" },
  needs_review: { label: "Needs review", text: "text-spark-deep", dot: "bg-spark" },
  completed: { label: "Done", text: "text-leaf", dot: "bg-leaf" },
  generating: { label: "Preparing", text: "text-lilac-ink", dot: "bg-lilac-ink animate-pulse" },
  ready: { label: "Ready", text: "text-leaf", dot: "bg-leaf" },
  published: { label: "Ready", text: "text-leaf", dot: "bg-leaf" },
  failed: { label: "Failed", text: "text-berry", dot: "bg-berry" },
  unknown: { label: "No data yet", text: "text-ink-faint", dot: "bg-ink-faint" },
  developing: { label: "Developing", text: "text-spark-deep", dot: "bg-spark" },
  proficient: { label: "Proficient", text: "text-sky-ink", dot: "bg-sky-ink" },
  mastered: { label: "Mastered", text: "text-leaf", dot: "bg-leaf" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, text: "text-ink-soft", dot: "bg-ink-faint" };
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold whitespace-nowrap ${s.text}`}>
      <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}

/* ---------- Progress ---------- */

/** Thin progress line in the current text colour. `value` is 0..1. */
export function ProgressLine({ value, className = "", label }: { value: number; className?: string; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full bg-current/15 ${className}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? `${pct}% complete`}
    >
      <div className="h-full rounded-full bg-current transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** One bead per lesson, filled when done. Counts children can read at a glance. */
export function Beads({ done, total, size = "md", className = "" }: { done: number; total: number; size?: "sm" | "md"; className?: string }) {
  const dot = size === "sm" ? "h-2 w-2" : "h-3 w-3";
  return (
    <span className={`flex flex-wrap gap-1.5 ${className}`} role="img" aria-label={`${done} of ${total} lessons done`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`${dot} rounded-full ${i < done ? "bg-current" : "bg-current/20"}`} />
      ))}
    </span>
  );
}

/* ---------- Identity ---------- */

/** Emoji avatar on the learner's own field. */
export function Avatar({ emoji, id, size = "md", className = "" }: { emoji: string; id?: string; size?: "sm" | "md" | "lg" | "xl"; className?: string }) {
  const sizes = {
    sm: "h-10 w-10 text-xl",
    md: "h-12 w-12 text-2xl",
    lg: "h-16 w-16 text-4xl",
    xl: "h-28 w-28 text-6xl",
  };
  return (
    <span className={`field grid shrink-0 place-items-center rounded-full ${id ? fieldFor(id) : "f-meadow"} ${sizes[size]} ${className}`} aria-hidden>
      {emoji}
    </span>
  );
}

/* ---------- Layout ---------- */

export function PageHeader({ title, subtitle, leading, actions }: { title: ReactNode; subtitle?: ReactNode; leading?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        {leading}
        <div className="min-w-0">
          <h1 className="display text-[2.5rem] break-words sm:text-5xl">{title}</h1>
          {subtitle ? <p className="mt-2 text-ink-soft">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="press -ml-2 mb-3 inline-flex min-h-11 items-center gap-1 rounded-full pr-3 pl-2 font-semibold text-ink-soft">
      <ArrowLeft size={18} />
      {children}
    </Link>
  );
}

export function Notice({ tone = "info", children, action }: { tone?: "info" | "warning" | "error" | "success"; children: ReactNode; action?: ReactNode }) {
  const cls = {
    info: "bg-mist text-ink",
    warning: "bg-spark-soft text-spark-deep",
    error: "bg-berry-soft text-berry",
    success: "bg-leaf-soft text-leaf-deep",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`mb-6 flex flex-col gap-3 rounded-2xl px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between ${cls}`}>
      <div className="min-w-0 font-medium">{children}</div>
      {action}
    </div>
  );
}

export function EmptyState({ emoji, title, body, action }: { emoji?: string; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {emoji ? <span className="mb-4 text-6xl" aria-hidden>{emoji}</span> : null}
      <h2 className="display text-3xl">{title}</h2>
      {body ? <p className="mt-2 max-w-xs text-ink-soft">{body}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

/** One row of a grouped list. Renders a link when `href` is set. */
export function ListRow({
  href,
  leading,
  title,
  subtitle,
  trailing,
  chevron = !!href,
}: {
  href?: string;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
}) {
  const body = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold break-words">{title}</span>
        {subtitle ? <span className="mt-0.5 block text-sm text-ink-soft">{subtitle}</span> : null}
      </span>
      {trailing}
      {chevron ? <ChevronRight size={18} className="text-ink-faint" /> : null}
    </>
  );
  return href ? (
    <Link href={href} className="list-row">
      {body}
    </Link>
  ) : (
    <div className="list-row">{body}</div>
  );
}

/** Same content as `ListRow`, for use as a `Sheet` trigger or other custom wrapper. */
export function RowContent({ leading, title, subtitle, trailing }: { leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode }) {
  return (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold break-words">{title}</span>
        {subtitle ? <span className="mt-0.5 block text-sm text-ink-soft">{subtitle}</span> : null}
      </span>
      {trailing}
      <ChevronRight size={18} className="text-ink-faint" />
    </>
  );
}

export function FormFeedback({ error, message }: { error?: string; message?: string }) {
  if (error) return <p role="alert" className="rounded-2xl bg-berry-soft px-4 py-3 text-sm font-semibold text-berry">{error}</p>;
  if (message) return <p role="status" className="rounded-2xl bg-leaf-soft px-4 py-3 text-sm font-semibold text-leaf-deep">{message}</p>;
  return null;
}
