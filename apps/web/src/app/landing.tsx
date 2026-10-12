"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Star } from "@/components/icons";
import { EverprimerMark, Wordmark } from "@/components/logo";
import { PLANS, formatPrice } from "@/lib/plans";

const PLANS_LIST = [PLANS.free, PLANS.paid, PLANS.max] as const;

function loginHref(mode: "signin" | "signup", next?: string) {
  const params = new URLSearchParams({ mode });
  if (next && next !== "/") params.set("next", next);
  return `/login?${params}`;
}

export function Landing({ next }: { next?: string }) {
  const signIn = loginHref("signin", next);
  const signUp = loginHref("signup", next);

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <a href="#start" className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-3 focus:text-white">
        Skip to content
      </a>

      <header className="px-5 pt-[max(0.75rem,env(safe-area-inset-top,0px))]">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between">
          <Link href="/" className="press flex items-center gap-2 rounded-full pr-2">
            <EverprimerMark className="h-9 w-9" />
            <Wordmark className="text-xl" />
          </Link>
          <Link href={signIn} className="btn-ghost btn-sm -mr-2">
            Sign in
          </Link>
        </div>
      </header>

      <main id="start" className="flex-1 px-5">
        <section className="mx-auto grid w-full max-w-6xl items-center gap-10 pt-8 pb-16 md:grid-cols-[1fr_minmax(0,26rem)] md:gap-12 md:pt-16 md:pb-28 lg:gap-24">
          <div className="max-w-xl">
            <h1 className="display text-[3.25rem] sm:text-7xl lg:text-[5.5rem]">Learning, written for one child.</h1>
            <p className="mt-5 max-w-md text-lg text-ink-soft sm:text-xl">Tell us what they love. Any topic becomes a lesson they play.</p>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link href={signUp} className="btn-primary btn-lg">
                Start free
              </Link>
              <span className="text-sm text-ink-soft">{PLANS.free.credits} free lessons every month</span>
            </div>
          </div>
          <Demo />
        </section>

        <WhatStuck />

        <section className="mx-auto w-full max-w-6xl pt-4 pb-20 md:pb-28">
          <details className="group">
            <summary className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
              <h2 className="display text-4xl sm:text-5xl">Free to start.</h2>
              <span className="btn-secondary btn-sm">
                <span className="group-open:hidden">See plans</span>
                <span className="hidden group-open:inline">Hide plans</span>
              </span>
            </summary>
            <ul className="animate-rise mt-8 grid gap-3 sm:grid-cols-3">
              {PLANS_LIST.map((plan) => (
                <li key={plan.id} className={`rounded-3xl p-6 ${plan.id === "paid" ? "bg-ink text-white" : "bg-mist"}`}>
                  <p className="font-semibold">{plan.name}</p>
                  <p className="display mt-3 text-5xl tabular-nums">
                    {formatPrice(plan.price)}
                    {plan.price > 0 ? <span className="ml-1 font-sans text-base font-medium tracking-normal opacity-70">a month</span> : null}
                  </p>
                  <p className="mt-4 opacity-80">{plan.credits} lessons a month</p>
                  <p className="opacity-80">{plan.childCap === 1 ? "1 learner" : `Up to ${plan.childCap} learners`}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-ink-soft">A credit makes one new lesson or one new set of topics. Lessons you already have replay for free.</p>
          </details>
        </section>
      </main>

      <footer className="px-5 pb-[max(2rem,env(safe-area-inset-bottom,0px))]">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 border-t border-line pt-6 text-sm text-ink-soft">
          <span className="flex items-center gap-2">
            <EverprimerMark className="h-6 w-6" />
            Everprimer
          </span>
          <Link href={signUp} className="link">
            Start free
          </Link>
        </div>
      </footer>
    </div>
  );
}

/* ---------- Live demo ---------- */

type InterestId = "dinosaurs" | "football" | "space";
type Thing = "egg" | "pitch" | "pizza";

const INTERESTS: Record<InterestId, { label: string; emoji: string; field: string; thing: Thing; text: string }> = {
  dinosaurs: {
    label: "Dinosaurs",
    emoji: "🦖",
    field: "f-meadow",
    thing: "egg",
    text: "A T. rex shares one big egg with her baby. She cuts it into two equal parts. Each part is a half.",
  },
  football: {
    label: "Football",
    emoji: "⚽",
    field: "f-sky",
    thing: "pitch",
    text: "Two teams share one pitch. The halfway line makes two equal parts. Each side is a half.",
  },
  space: {
    label: "Space",
    emoji: "🚀",
    field: "f-lilac",
    thing: "pizza",
    text: "An astronaut shares one space pizza with a friend. Two equal slices. Each slice is a half.",
  },
};

type Cut = "uneven" | "half" | "thirds";
const CUTS: Cut[] = ["uneven", "half", "thirds"];
const FEEDBACK: Record<Cut, string> = {
  half: "Yes! Two equal parts.",
  uneven: "Two parts, but one is bigger. Halves are the same size.",
  thirds: "That makes three parts. A half is one of two.",
};

function Demo() {
  const [interest, setInterest] = useState<InterestId>("dinosaurs");
  const [picked, setPicked] = useState<Cut | null>(null);
  const [stars, setStars] = useState<Set<InterestId>>(() => new Set());
  const it = INTERESTS[interest];

  const choose = (id: InterestId) => {
    setInterest(id);
    setPicked(null);
  };
  const answer = (cut: Cut) => {
    setPicked(cut);
    if (cut === "half") setStars((prev) => new Set(prev).add(interest));
  };

  return (
    <div className={`${it.field} field -mx-5 px-5 pt-7 pb-10 transition-colors duration-500 md:mx-0 md:bg-transparent md:p-0 md:text-ink`}>
      <div role="group" aria-label="What Maya loves" className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <span className="mb-1 w-full font-semibold opacity-75">Maya is 6 and loves</span>
        {(Object.keys(INTERESTS) as InterestId[]).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={interest === id}
            onClick={() => choose(id)}
            className={`press inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[0.9375rem] font-semibold transition-colors sm:px-4 sm:text-base ${
              interest === id ? "bg-(--field-ink) text-(--field)" : "bg-(--field-ink)/10 text-(--field-ink)"
            }`}
          >
            <span aria-hidden>{INTERESTS[id].emoji}</span>
            {INTERESTS[id].label}
          </button>
        ))}
      </div>

      <div className="mt-6 md:mt-5 md:rounded-[3rem] md:bg-ink md:p-2.5 md:shadow-[0_40px_80px_-30px_rgb(20_61_39/0.55)]">
        <figure className="field transition-colors duration-500 md:min-h-[38rem] md:rounded-[2.5rem] md:px-7 md:pt-7 md:pb-8" aria-label="Example lesson">
          <div className="flex items-center gap-4">
            <div className="flex flex-1 gap-1.5" aria-hidden>
              <span className="h-2 flex-1 rounded-full bg-current/50" />
              <span className="h-2 flex-1 rounded-full bg-current" />
              <span className="h-2 flex-1 rounded-full bg-current/15" />
            </div>
            <span className="inline-flex items-center gap-1 font-bold tabular-nums" aria-label={`${stars.size} stars`}>
              <Star size={18} className="text-spark" />
              <span key={stars.size} className="animate-pop">{stars.size}</span>
            </span>
          </div>

          <div key={interest} className="mt-8">
            <span className="animate-pop block text-7xl" aria-hidden>{it.emoji}</span>
            <h2 className="display mt-5 text-[2.5rem]">Halves</h2>
            <p className="animate-swap mt-3 text-lg leading-snug">{it.text}</p>
          </div>

          <fieldset className="mt-7 min-w-0">
            <legend className="text-lg font-bold">Which {it.thing} is cut in half?</legend>
            <div className="mt-3 grid grid-cols-3 gap-2.5">
              {CUTS.map((cut) => {
                const chosen = picked === cut;
                return (
                  <button
                    key={cut}
                    type="button"
                    onClick={() => answer(cut)}
                    aria-pressed={chosen}
                    aria-label={cut === "half" ? "Two equal parts" : cut === "uneven" ? "Two different parts" : "Three parts"}
                    className={`press grid aspect-square place-items-center rounded-3xl transition-colors ${
                      chosen ? (cut === "half" ? "bg-(--field-ink) text-(--field)" : "bg-paper/80 ring-2 ring-(--field-ink)/40") : "bg-paper/55"
                    }`}
                  >
                    <Shape thing={it.thing} cut={cut} />
                  </button>
                );
              })}
            </div>
          </fieldset>
          <p aria-live="polite" className="mt-4 min-h-14 text-lg leading-snug font-semibold">
            {picked ? <span key={`${interest}-${picked}`} className="animate-swap block">{FEEDBACK[picked]}</span> : null}
          </p>
        </figure>
      </div>
    </div>
  );
}

function Shape({ thing, cut }: { thing: Thing; cut: Cut }) {
  const id = useId();
  const outline =
    thing === "egg" ? <ellipse cx="50" cy="50" rx="31" ry="41" /> : thing === "pitch" ? <rect x="10" y="22" width="80" height="56" rx="6" /> : <circle cx="50" cy="50" r="40" />;
  const lines =
    cut === "half" ? (
      <path d="M50 0V100" />
    ) : cut === "uneven" ? (
      <path d="M68 0V100" />
    ) : (
      <path d="M50 50V-10M50 50 112 86M50 50-12 86" />
    );
  return (
    <svg viewBox="0 0 100 100" className="h-[72%] w-[72%]" aria-hidden>
      <clipPath id={id}>{outline}</clipPath>
      <g fill="currentColor" fillOpacity="0.16" stroke="none">{outline}</g>
      <g clipPath={`url(#${id})`} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
        {lines}
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="4">{outline}</g>
    </svg>
  );
}

/* ---------- What stuck ---------- */

function WhatStuck() {
  return (
    <section className="mx-auto grid w-full max-w-6xl items-center gap-10 py-16 md:grid-cols-2 md:gap-16 md:py-24">
      <h2 className="display text-[3.25rem] sm:text-7xl">You see what stuck.</h2>
      <figure className="rounded-[2rem] bg-mist p-6 sm:p-8" aria-label="Example summary for a grown-up">
        <figcaption className="flex items-center gap-3">
          <span className="field f-meadow grid h-11 w-11 place-items-center rounded-full text-2xl" aria-hidden>🦊</span>
          <span className="font-semibold">Maya, today</span>
        </figcaption>
        <p className="mt-5 text-xl leading-snug font-medium">Maya finished Halves and got 7 of 8 right the first time.</p>
        <ul className="mt-6 space-y-2.5">
          <li className="flex items-center justify-between gap-4 rounded-2xl bg-paper px-4 py-3">
            <span>Splits a shape into equal parts</span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-leaf">
              <span className="h-2 w-2 rounded-full bg-leaf" aria-hidden />
              Strong
            </span>
          </li>
          <li className="flex items-center justify-between gap-4 rounded-2xl bg-paper px-4 py-3">
            <span>Names one part as a half</span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-spark-deep">
              <span className="h-2 w-2 rounded-full bg-spark" aria-hidden />
              Growing
            </span>
          </li>
        </ul>
      </figure>
    </section>
  );
}
