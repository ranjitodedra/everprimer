import type { Metadata } from "next";
import { EverprimerMark, Wordmark } from "@/components/logo";
import { LoginForm } from "./login-form";
import { parseWho } from "./who";

export const metadata: Metadata = { title: "Sign in" };

const POINTS = [
  { emoji: "🎯", title: "You set the goal", body: "Write it the way you'd say it. We turn it into an ordered curriculum." },
  { emoji: "🪐", title: "They explore", body: "Every topic becomes a hands-on lesson: tap, play, discover, then a short quiz." },
  { emoji: "📈", title: "You see what stuck", body: "Mastery per objective and a plain daily summary. No guesswork about mood." },
];

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const who = parseWho(sp.who);
  return (
    <main className="kid-sky flex flex-1 flex-col justify-start px-4 pt-[max(1.25rem,env(safe-area-inset-top,0px))] pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] lg:items-center lg:justify-center lg:py-10">
      <div className="grid w-full max-w-5xl items-center gap-4 lg:grid-cols-[1.1fr_1fr] lg:gap-10">
        {/* Compact mobile brand row. Hidden on lg (marketing panel takes over). */}
        <div className="flex items-center gap-3 lg:hidden">
          <EverprimerMark className="h-10 w-10" />
          <div className="min-w-0">
            <Wordmark className="text-2xl" />
            <p className="text-sm text-ink-soft">Lessons that grow around your child.</p>
          </div>
        </div>

        {/* Sign-in card first in DOM so it sits above the fold on mobile. */}
        <section className="animate-rise w-full max-w-md justify-self-center lg:order-last lg:justify-self-end" style={{ animationDelay: "80ms" }}>
          <LoginForm next={next} who={who} />
        </section>

        {/* Marketing panel: hidden on mobile/tablet, shown on lg on the left. */}
        <section className="animate-rise hidden lg:order-first lg:block">
          <div className="mb-6 flex items-center gap-3">
            <EverprimerMark className="h-12 w-12" />
            <Wordmark className="text-3xl" />
          </div>
          <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
            Lessons that grow
            <br />
            <span className="text-brand">around your child.</span>
          </h1>
          <p className="mt-4 max-w-md text-lg text-ink-soft">Describe what you want them to learn. Everprimer builds an interactive lesson for every topic and tells you what stuck.</p>

          <ul className="mt-8 grid gap-3">
            {POINTS.map((p, i) => (
              <li key={p.title} className="card animate-rise flex items-start gap-4 py-4" style={{ animationDelay: `${120 + i * 70}ms` }}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sun-soft to-brand-soft text-2xl" aria-hidden>
                  {p.emoji}
                </span>
                <div>
                  <p className="font-extrabold">{p.title}</p>
                  <p className="text-sm text-ink-soft">{p.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
