"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { EverprimerMark, Wordmark } from "@/components/logo";
import { PLANS, formatPrice } from "@/lib/plans";

const PANELS = [
  {
    emoji: "🌱",
    title: "What is this?",
    points: [
      "A learning app for your kids.",
      "Designed to meet their needs — not a one-size-fits-all lesson they sit through.",
    ],
  },
  {
    emoji: "🎯",
    title: "How are their needs met?",
    points: [
      "We take their age, what they already know, and what they like — the show they won't stop talking about, the thing they keep asking about — so the lesson holds their attention.",
      "When they get curious, a responsive helper answers like a friend, right in the moment.",
    ],
  },
  {
    emoji: "💰",
    title: "What about the money?",
    points: [
      `Free gives you ${PLANS.free.credits} lesson credits so you can try it before you pay. Enough to see what you would be buying.`,
      `Want more? Plus is ${formatPrice(PLANS.paid.price)}/month for ${PLANS.paid.credits} credits. Max is ${formatPrice(PLANS.max.price)}/month for ${PLANS.max.credits}.`,
      "Cancel any time. If something goes wrong, email or call — a real person answers.",
    ],
  },
  {
    emoji: "📊",
    title: "Why should I care?",
    points: [
      "Interactive learning can outperform sitting a young child in front of a video.",
      "A 2024 study of 76 kindergarten children found that learning outcomes varied by teaching method and age. Interactive touchscreen learning beat video on some measures for younger children.",
    ],
  },
] as const;

const LAST = PANELS.length - 1;
const SWIPE_PX = 50;

function loginHref(mode: "signin" | "signup", next?: string) {
  const params = new URLSearchParams({ mode });
  if (next && next !== "/") params.set("next", next);
  return `/login?${params}`;
}

export function Landing({ next }: { next?: string }) {
  const [step, setStep] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const panel = PANELS[step];

  const go = useCallback((to: number) => {
    setStep(Math.max(0, Math.min(LAST, to)));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") go(step + 1);
      if (e.key === "ArrowLeft") go(step - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, step]);

  function onPointerDown(e: PointerEvent<HTMLElement>) {
    start.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerUp(e: PointerEvent<HTMLElement>) {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    start.current = null;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
    go(step + (dx < 0 ? 1 : -1));
  }

  return (
    <main className="kid-sky flex min-h-[100dvh] flex-1 flex-col px-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1.25rem,env(safe-area-inset-bottom,0px))]">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <EverprimerMark className="h-10 w-10" />
          <Wordmark className="text-2xl" />
        </div>
        <Link href={loginHref("signin", next)} className="btn-ghost min-h-11 px-3 text-sm font-extrabold">
          Sign in
        </Link>
      </header>

      <section
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center py-6"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        aria-roledescription="carousel"
        aria-label="What Everprimer is"
      >
        <article key={step} className="card animate-rise p-6 shadow-lift sm:p-8 md:grid md:grid-cols-[auto_1fr] md:items-start md:gap-8">
          <span
            className="mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-sun-soft to-brand-soft text-4xl sm:h-20 sm:w-20 sm:text-5xl md:mb-0"
            aria-hidden
          >
            {panel.emoji}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-extrabold tracking-wide text-ink-faint uppercase">
              {step + 1} of {PANELS.length}
            </p>
            <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl lg:text-5xl">{panel.title}</h1>
            <ul className="mt-5 grid gap-4">
              {panel.points.map((point) => (
                <li key={point} className="text-base text-ink-soft sm:text-lg">
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </article>
      </section>

      <footer className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="flex items-center justify-center gap-2" role="tablist" aria-label="Progress">
          {PANELS.map((p, i) => (
            <button
              key={p.title}
              type="button"
              role="tab"
              aria-selected={i === step}
              aria-label={`Go to ${p.title}`}
              onClick={() => go(i)}
              className={`h-2.5 rounded-full transition ${i === step ? "w-8 bg-brand" : "w-2.5 bg-line-strong hover:bg-ink-faint"}`}
            />
          ))}
        </div>

        {step < LAST ? (
          <div className="grid grid-cols-[auto_1fr] gap-3">
            <button
              type="button"
              onClick={() => go(step - 1)}
              disabled={step === 0}
              className={`btn-ghost btn-lg ${step === 0 ? "invisible" : ""}`}
            >
              Back
            </button>
            <button type="button" onClick={() => go(step + 1)} className="btn-primary btn-lg w-full">
              Continue
            </button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Link href={loginHref("signup", next)} className="btn-primary btn-lg w-full text-center">
              Create free account
            </Link>
            <Link href={loginHref("signin", next)} className="btn-secondary btn-lg w-full text-center">
              I already have an account
            </Link>
          </div>
        )}
      </footer>
    </main>
  );
}
