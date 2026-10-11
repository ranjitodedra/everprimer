"use client";

import Link from "next/link";
import { useState } from "react";
import { EverprimerMark, Wordmark } from "@/components/logo";
import { PLANS, formatPrice } from "@/lib/plans";

const STEPS = [
  {
    title: "Set a goal",
    body: "Share their age, what they already know, and something they won’t stop talking about.",
  },
  {
    title: "They play the lesson",
    body: "Short bites, then a short test. They can stop after a session and pick it up later.",
  },
  {
    title: "You see what stuck",
    body: "Each objective gets a clear result. Replaying a lesson you already have is free.",
  },
] as const;

const PLANS_LIST = [PLANS.free, PLANS.paid, PLANS.max] as const;

function loginHref(mode: "signin" | "signup", next?: string) {
  const params = new URLSearchParams({ mode });
  if (next && next !== "/") params.set("next", next);
  return `/login?${params}`;
}

function learnerLine(childCap: number) {
  return childCap === 1 ? "1 learner" : `Up to ${childCap} learners`;
}

export function Landing({ next }: { next?: string }) {
  const signIn = loginHref("signin", next);
  const signUp = loginHref("signup", next);

  return (
    <div className="kid-sky flex min-h-[100svh] flex-1 flex-col">
      <a
        href="#start"
        className="absolute top-3 left-3 z-50 -translate-y-24 rounded-full bg-ink px-4 py-3 text-sm font-extrabold text-white focus-visible:translate-y-0"
      >
        Skip to content
      </a>

      <header className="px-4 pt-[max(0.75rem,env(safe-area-inset-top,0px))] sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
          <Link href="/" className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-full pr-2">
            <EverprimerMark className="h-10 w-10" />
            <Wordmark className="truncate text-xl sm:text-2xl" />
          </Link>
          <nav aria-label="Page" className="flex items-center gap-1 sm:gap-2">
            <a href="#how" className="hidden min-h-11 items-center rounded-full px-3 text-sm font-extrabold text-ink-soft hover:text-ink md:inline-flex">
              How it works
            </a>
            <a href="#plans" className="hidden min-h-11 items-center rounded-full px-3 text-sm font-extrabold text-ink-soft hover:text-ink md:inline-flex">
              Plans
            </a>
            <Link href={signIn} className="btn-ghost min-h-11 px-3 text-sm">
              Sign in
            </Link>
            <Link href={signUp} className="btn-primary hidden sm:inline-flex">
              Create free account
            </Link>
          </nav>
        </div>
      </header>

      <main id="start" className="flex-1">
        <section className="px-4 pt-8 pb-14 sm:px-6 sm:pt-12 md:pt-16 md:pb-20 lg:px-8 lg:pt-20 lg:pb-24">
          <div className="mx-auto grid w-full max-w-6xl items-start gap-10 md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] md:gap-8 lg:items-center lg:gap-16">
            <div className="min-w-0 max-w-xl">
              <h1 className="text-[2rem] leading-[1.08] font-black tracking-tight sm:text-5xl lg:text-[3.5rem] lg:leading-[1.02]">
                Lessons that grow around your child.
              </h1>
              <p className="mt-4 max-w-[42rem] text-base leading-relaxed text-ink sm:text-lg">
                Tell Everprimer their age, what they already know, and what they won’t stop talking about. It builds a lesson they can play, then shows you what stuck.
              </p>
              <div className="mt-7 flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link href={signUp} className="btn-primary btn-lg w-full sm:w-auto">
                  Create free account
                </Link>
                <Link href={signIn} className="btn-secondary btn-lg w-full sm:w-auto">
                  I already have an account
                </Link>
              </div>
              <p className="mt-4 max-w-[36rem] text-sm leading-relaxed text-ink-soft">
                Free includes {PLANS.free.credits} lesson credits. A paid plan can be canceled any time. A real person answers if something goes wrong.
              </p>
            </div>
            <ExampleLesson />
          </div>
        </section>

        <section id="how" className="scroll-mt-8 px-4 py-14 sm:px-6 md:py-20 lg:px-8 lg:py-24">
          <div className="mx-auto w-full max-w-6xl">
            <h2 className="max-w-xl text-3xl font-black tracking-tight sm:text-4xl">How a lesson gets made</h2>
            <p className="mt-3 max-w-[40rem] text-base leading-relaxed text-ink sm:text-lg">
              A grown-up 13 or older can also make lessons for themselves. Parents add the children they look after.
            </p>
            <ol className="mt-8 grid gap-4 md:mt-10 md:grid-cols-3 md:gap-5">
              {STEPS.map((step, index) => (
                <li key={step.title} className="card flex gap-4 md:flex-col md:gap-5">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-lg font-black text-brand-deep tabular-nums">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-lg font-black">{step.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink sm:text-base">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="plans" className="scroll-mt-8 px-4 py-14 sm:px-6 md:py-20 lg:px-8 lg:py-24">
          <div className="mx-auto w-full max-w-6xl">
            <h2 className="max-w-xl text-3xl font-black tracking-tight sm:text-4xl">Start free. Add credits when you need them.</h2>
            <p className="mt-3 max-w-[42rem] text-base leading-relaxed text-ink sm:text-lg">
              A credit is one new lesson, or one new set of topics. Credits refresh each month and do not roll over. Every account starts on Free, and you change plans in settings.
            </p>
            <div className="mt-8 grid items-stretch gap-4 md:mt-10 md:grid-cols-3 md:gap-5">
              {PLANS_LIST.map((plan) => {
                const featured = plan.id === "paid";
                return (
                  <article
                    key={plan.id}
                    className={`card flex h-full flex-col ${featured ? "ring-2 ring-brand" : ""}`}
                  >
                    <div className="min-h-7">
                      {featured ? <p className="text-xs font-extrabold text-sun-deep">A good next step</p> : null}
                    </div>
                    <h3 className="text-xl font-black">{plan.name}</h3>
                    <p className="mt-3 font-black tracking-tight text-ink tabular-nums">
                      <span className="text-4xl">{formatPrice(plan.price)}</span>
                      {plan.price > 0 ? <span className="ml-1 text-base font-bold text-ink-soft">/month</span> : null}
                    </p>
                    <ul className="mt-5 grid flex-1 content-start gap-2.5 text-sm leading-snug text-ink sm:text-base">
                      <li>{plan.credits} credits each month</li>
                      <li>{learnerLine(plan.childCap)}</li>
                      <li>{plan.regenerate ? "Rebuild a published lesson" : "Replay published lessons"}</li>
                    </ul>
                    <Link href={signUp} className={`${featured ? "btn-primary" : "btn-secondary"} mt-6 w-full`}>
                      Create free account
                    </Link>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="px-4 pt-4 pb-[max(3.5rem,env(safe-area-inset-bottom,0px))] sm:px-6 md:pb-24 lg:px-8">
          <div className="mx-auto grid w-full max-w-6xl gap-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] md:items-end lg:gap-16">
            <div className="max-w-xl">
              <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Try it with the free credits.</h2>
              <p className="mt-3 text-base leading-relaxed text-ink sm:text-lg">
                A 2024 study of 76 kindergarten children found that results depended on the teaching method and the child’s age. Interactive touchscreen learning beat video on some measures for the younger children.
              </p>
              <div className="mt-7 flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link href={signUp} className="btn-primary btn-lg w-full sm:w-auto">
                  Create free account
                </Link>
                <Link href={signIn} className="btn-secondary btn-lg w-full sm:w-auto">
                  I already have an account
                </Link>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-ink-soft md:pb-1">
              If something goes wrong, a real person answers. Published lessons stay playable if a paid plan ends.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

const ANSWERS = [
  { id: "magma", label: "Magma", correct: true },
  { id: "lava", label: "Lava", correct: false },
] as const;

type AnswerId = (typeof ANSWERS)[number]["id"];

function ExampleLesson() {
  const [picked, setPicked] = useState<AnswerId | null>(null);
  const feedback =
    picked === "magma"
      ? "That’s the one. Magma is melted rock still underground."
      : picked === "lava"
        ? "Lava is the name after it reaches the air. Underground, it is magma."
        : "Tap an answer. The lesson checks it.";

  return (
    <div className="animate-rise relative mx-auto w-full max-w-md md:max-w-none">
      <div aria-hidden className="absolute inset-x-5 top-6 -bottom-3 rounded-[1.75rem] bg-sun-soft" />
      <figure className="card relative p-5 shadow-lift sm:p-6">
        <figcaption className="flex items-center justify-between gap-3 text-sm font-extrabold text-ink-soft">
          <span>Example lesson</span>
          <span className="tabular-nums">Age 7</span>
        </figcaption>
        <p className="mt-4 text-2xl font-black tracking-tight">Why a volcano erupts</p>
        <p className="mt-3 text-base leading-relaxed text-ink">
          Under the ground, rock gets so hot it melts. While it is still underground, that melted rock is called magma.
        </p>
        <fieldset className="mt-5 min-w-0 border-0 p-0">
          <legend className="text-base font-extrabold text-ink">What is the melted rock called while it is still underground?</legend>
          <div className="mt-3 grid gap-2.5">
            {ANSWERS.map((answer) => {
              const selected = picked === answer.id;
              return (
                <button
                  key={answer.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setPicked(answer.id)}
                  className={`min-h-12 cursor-pointer rounded-2xl border px-4 text-left text-base font-extrabold transition-[transform,background-color,border-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] select-none active:scale-[0.98] ${
                    selected
                      ? answer.correct
                        ? "border-brand bg-brand-soft text-brand-deep"
                        : "border-sun-deep bg-sun-soft text-sun-deep"
                      : "border-line-strong bg-paper text-ink hover:border-brand"
                  }`}
                >
                  {answer.label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <p aria-live="polite" className="mt-3 min-h-12 text-sm leading-relaxed font-bold text-ink-soft">
          {feedback}
        </p>
      </figure>
    </div>
  );
}
