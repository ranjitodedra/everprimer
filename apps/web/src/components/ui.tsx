import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "./icons";

/* ---------- Status ---------- */

const STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  not_started: { label: "Not started", cls: "bg-paper-deep text-ink-soft", dot: "bg-ink-faint" },
  locked: { label: "Locked", cls: "bg-paper-deep text-ink-soft", dot: "bg-ink-faint" },
  in_progress: { label: "In progress", cls: "bg-sky-soft text-sky", dot: "bg-sky" },
  needs_review: { label: "Needs review", cls: "bg-sun-soft text-sun-deep", dot: "bg-sun" },
  completed: { label: "Completed", cls: "bg-brand-soft text-brand-deep", dot: "bg-brand" },
  generating: { label: "Generating", cls: "bg-violet-soft text-violet", dot: "bg-violet animate-pulse" },
  ready: { label: "Ready", cls: "bg-brand-soft text-brand-deep", dot: "bg-brand" },
  published: { label: "Ready", cls: "bg-brand-soft text-brand-deep", dot: "bg-brand" },
  failed: { label: "Failed", cls: "bg-berry-soft text-berry", dot: "bg-berry" },
  unknown: { label: "No data", cls: "bg-paper-deep text-ink-soft", dot: "bg-ink-faint" },
  developing: { label: "Developing", cls: "bg-sun-soft text-sun-deep", dot: "bg-sun" },
  proficient: { label: "Proficient", cls: "bg-sky-soft text-sky", dot: "bg-sky" },
  mastered: { label: "Mastered", cls: "bg-brand-soft text-brand-deep", dot: "bg-brand" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-paper-deep text-ink-soft", dot: "bg-ink-faint" };
  return (
    <span className={`badge ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}

/* ---------- Progress ---------- */

export function MasteryBar({ value, className = "", showLabel = false }: { value: number; className?: string; showLabel?: boolean }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-paper-deep" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Mastery ${pct}%`}>
        <div className="h-full rounded-full bg-gradient-to-r from-brand to-sun transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      {showLabel ? <span className="w-9 shrink-0 text-right text-xs font-extrabold tabular-nums text-ink-soft">{pct}%</span> : null}
    </div>
  );
}

/** Circular progress. `value` is 0..1. */
export function ProgressRing({ value, size = 56, stroke = 6, children, className = "" }: { value: number; size?: number; stroke?: number; children?: ReactNode; className?: string }) {
  const pct = Math.max(0, Math.min(1, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className={`relative grid place-items-center ${className}`} style={{ width: size, height: size }} role="img" aria-label={`${Math.round(pct * 100)}% complete`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-paper-deep)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-brand)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} className="transition-[stroke-dashoffset] duration-700" />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

/* ---------- Layout ---------- */

export function EmptyState({ title, body, action, icon }: { title: string; body: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card dotted-bg flex flex-col items-start gap-3 border-dashed border-line-strong">
      {icon ? <div className="tile h-12 w-12 text-2xl">{icon}</div> : null}
      <div>
        <h3 className="text-lg font-extrabold">{title}</h3>
        <p className="mt-1 text-ink-soft">{body}</p>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions, leading }: { eyebrow?: string; title: ReactNode; description?: string; actions?: ReactNode; leading?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-start gap-4">
        {leading}
        <div>
          {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{title}</h1>
          {description ? <p className="mt-2 max-w-2xl text-ink-soft">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionTitle({ children, hint, actions }: { children: ReactNode; hint?: string; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-extrabold">{children}</h2>
        {hint ? <p className="text-sm text-ink-soft">{hint}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mb-4 inline-flex items-center gap-1.5 text-sm font-bold text-ink-soft transition hover:text-brand-deep">
      <ArrowLeft size={16} />
      {children}
    </Link>
  );
}

export function Stat({ label, value, hint, icon, tone = "brand" }: { label: string; value: string | number; hint?: string; icon?: ReactNode; tone?: "brand" | "sun" | "sky" | "violet" }) {
  const tones = {
    brand: "bg-brand-soft text-brand-deep",
    sun: "bg-sun-soft text-sun-deep",
    sky: "bg-sky-soft text-sky",
    violet: "bg-violet-soft text-violet",
  };
  return (
    <div className="card flex items-start gap-3 py-4">
      {icon ? <span className={`tile h-10 w-10 ${tones[tone]}`}>{icon}</span> : null}
      <div className="min-w-0">
        <p className="text-xs font-extrabold tracking-wider text-ink-soft uppercase">{label}</p>
        <p className="mt-0.5 text-2xl font-black tabular-nums">{value}</p>
        {hint ? <p className="text-xs text-ink-soft">{hint}</p> : null}
      </div>
    </div>
  );
}

export function Notice({ tone = "info", children, action }: { tone?: "info" | "warning" | "error" | "success"; children: ReactNode; action?: ReactNode }) {
  const cls = {
    info: "border-brand/25 bg-brand-tint text-ink",
    warning: "border-sun/30 bg-sun-soft text-sun-deep",
    error: "border-berry/25 bg-berry-soft text-berry",
    success: "border-brand/25 bg-brand-soft text-brand-deep",
  }[tone];
  return (
    <div className={`mb-6 flex flex-col gap-3 rounded-2xl border px-4 py-3.5 text-sm sm:flex-row sm:items-center sm:justify-between ${cls}`}>
      <div className="flex items-center gap-3">
        {tone === "info" ? <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-brand" aria-hidden /> : null}
        {tone === "warning" ? <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-sun" aria-hidden /> : null}
        <div>{children}</div>
      </div>
      {action}
    </div>
  );
}

/** Emoji avatar in a coloured tile. */
export function Avatar({ emoji, size = "md", className = "" }: { emoji: string; size?: "sm" | "md" | "lg" | "xl"; className?: string }) {
  const sizes = {
    sm: "h-10 w-10 text-xl rounded-xl",
    md: "h-12 w-12 text-2xl rounded-2xl",
    lg: "h-16 w-16 text-4xl rounded-3xl",
    xl: "h-24 w-24 text-6xl rounded-[1.75rem]",
  };
  return (
    <span className={`grid shrink-0 place-items-center bg-gradient-to-br from-sun-soft to-brand-soft ${sizes[size]} ${className}`} aria-hidden>
      {emoji}
    </span>
  );
}
