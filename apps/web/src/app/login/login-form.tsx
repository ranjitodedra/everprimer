"use client";

import Link from "next/link";
import { useActionState, useState, type FocusEvent, type ReactNode } from "react";
import { BirthFields } from "@/components/birth-fields";
import { ArrowLeft, ChevronRight } from "@/components/icons";
import { PinField } from "@/components/pin-field";
import { FormFeedback } from "@/components/ui";
import { signIn, signInChild, signUp, type AuthState } from "./actions";
import { type AuthMode, type Who } from "./who";

function landingHref(next: string) {
  if (!next || next === "/") return "/";
  return `/?next=${encodeURIComponent(next)}`;
}

function keepInView(e: FocusEvent<HTMLElement>) {
  // Safety net for Android WebView and iOS Safari, where the on-screen keyboard
  // shrinks the visual viewport but doesn't always scroll the focused field
  // into view on its own.
  const el = e.currentTarget;
  window.setTimeout(() => {
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      /* older browsers */
    }
  }, 250);
}

type AdultWho = Exclude<Who, "child">;

const PEOPLE: { who: Who; emoji: string; title: string }[] = [
  { who: "parent", emoji: "👪", title: "I'm a parent" },
  { who: "individual", emoji: "🎒", title: "I'm learning for myself" },
  { who: "child", emoji: "🧒", title: "I'm a kid with a PIN" },
  { who: "shared", emoji: "📱", title: "Our family shares one device" },
];

const COPY: Record<AdultWho, Record<AuthMode, { title: string; body?: string }>> = {
  individual: {
    signin: { title: "Welcome back." },
    signup: { title: "Start learning.", body: "For ages 13 and up." },
  },
  parent: {
    signin: { title: "Welcome back." },
    signup: { title: "Make a parent account.", body: "You'll add your children next." },
  },
  shared: {
    signin: { title: "Welcome back.", body: "Then pick who is learning." },
    signup: { title: "Make a family login.", body: "One login for this device. Children pick their name." },
  },
};

function Step({ title, body, back, children }: { title: string; body?: string; back: ReactNode; children: ReactNode }) {
  return (
    <div className="animate-rise">
      {back}
      <h1 className="display mt-6 text-[2.75rem] sm:text-5xl">{title}</h1>
      {body ? <p className="mt-3 text-lg text-ink-soft">{body}</p> : null}
      <div className="mt-8">{children}</div>
    </div>
  );
}

const BACK = "press -ml-2 inline-flex min-h-11 items-center gap-1 rounded-full pr-3 pl-2 font-semibold text-ink-soft";

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={BACK}>
      <ArrowLeft size={18} />
      Back
    </button>
  );
}

function Choice({ emoji, title, onClick }: { emoji: string; title: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="list-row min-h-[4.5rem] text-lg">
      <span className="text-3xl" aria-hidden>{emoji}</span>
      <span className="min-w-0 flex-1 font-semibold">{title}</span>
      <ChevronRight size={18} className="text-ink-faint" />
    </button>
  );
}

function EmailFields({ mode }: { mode: AuthMode }) {
  return (
    <>
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" enterKeyHint="next" required className="input" placeholder="you@example.com" onFocus={keepInView} />
      </div>
      <div>
        <label htmlFor="password" className="label">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          enterKeyHint="go"
          minLength={8}
          required
          className="input"
          placeholder={mode === "signup" ? "8 characters or more" : ""}
          onFocus={keepInView}
        />
      </div>
    </>
  );
}

function CredentialForm({ who, mode, next, back, onModeChange }: { who: AdultWho; mode: AuthMode; next: string; back: ReactNode; onModeChange: (mode: AuthMode) => void }) {
  const action = mode === "signin" ? signIn : signUp;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(action, {});
  const copy = COPY[who][mode];
  const kind = who === "individual" ? "individual" : "parent";

  return (
    <Step title={copy.title} body={copy.body} back={back}>
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        {mode === "signup" ? <input type="hidden" name="account_kind" value={kind} /> : null}
        {mode === "signin" && who === "shared" ? <input type="hidden" name="intent" value="shared" /> : null}

        {mode === "signup" && who === "individual" ? (
          <>
            <div>
              <label htmlFor="display_name" className="label">Your name</label>
              <input id="display_name" name="display_name" autoComplete="given-name" maxLength={40} required className="input" placeholder="Alex" onFocus={keepInView} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <BirthFields required monthId="signup_birth_month" yearId="signup_birth_year" onFocus={keepInView} />
            </div>
          </>
        ) : null}

        <EmailFields mode={mode} />

        {mode === "signup" && kind === "parent" ? (
          <label className="flex items-start gap-3 py-1">
            <input type="checkbox" name="adult" required className="mt-0.5 h-5 w-5 shrink-0 accent-leaf" />
            <span>I&apos;m 18 or older and a parent or guardian.</span>
          </label>
        ) : null}

        <FormFeedback error={state.error} message={state.message} />
        <button type="submit" disabled={pending} className="btn-primary btn-lg mt-2 w-full">
          {pending ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
      <button
        type="button"
        onClick={() => onModeChange(mode === "signin" ? "signup" : "signin")}
        className="btn-ghost mt-3 w-full"
      >
        {mode === "signin" ? "New here? Create an account" : "Have an account? Sign in"}
      </button>
    </Step>
  );
}

function ChildForm({ back }: { back: ReactNode }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(signInChild, {});
  return (
    <Step title="Hi there!" body="Use the username and PIN your grown-up made." back={back}>
      <form action={formAction} className="space-y-4">
        <div>
          <label htmlFor="username" className="label">Username</label>
          <input id="username" name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" required className="input text-lg" placeholder="your_name" onFocus={keepInView} />
        </div>
        <div>
          <p className="label" aria-hidden>PIN</p>
          <PinField label="PIN" onFocus={keepInView} />
        </div>
        <FormFeedback error={state.error} message={state.message} />
        <button type="submit" disabled={pending} className="btn-primary btn-lg mt-2 w-full">
          {pending ? "One moment…" : "Let's learn"}
        </button>
      </form>
    </Step>
  );
}

export function LoginForm({ next, who, initialMode }: { next: string; who: Who | null; initialMode?: AuthMode | null }) {
  const [mode, setMode] = useState<AuthMode | null>(initialMode ?? (who ? "signin" : null));
  const [selected, setSelected] = useState<Who | null>(who);
  const people = mode === "signup" ? PEOPLE.filter((p) => p.who !== "child") : PEOPLE;
  const toLanding = (
    <Link href={landingHref(next)} className={BACK}>
      <ArrowLeft size={18} />
      Back
    </Link>
  );

  if (selected && mode) {
    const back = <BackButton onClick={() => setSelected(null)} />;
    return selected === "child" ? (
      <ChildForm key="child" back={back} />
    ) : (
      <CredentialForm key={`${selected}-${mode}`} who={selected} mode={mode} next={next} back={back} onModeChange={setMode} />
    );
  }

  if (mode) {
    return (
      <Step key={mode} title={mode === "signup" ? "Who's it for?" : "Who's signing in?"} back={toLanding}>
        <div className="list-group" role="group" aria-label="Who are you?">
          {people.map((person) => (
            <Choice key={person.who} emoji={person.emoji} title={person.title} onClick={() => setSelected(person.who)} />
          ))}
        </div>
        <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="btn-ghost mt-4 w-full">
          {mode === "signin" ? "New here? Create an account" : "Have an account? Sign in"}
        </button>
      </Step>
    );
  }

  return (
    <Step title="Hello." back={toLanding}>
      <div className="list-group" role="group" aria-label="Create account or sign in">
        <Choice emoji="✨" title="Create an account" onClick={() => setMode("signup")} />
        <Choice emoji="🔑" title="Sign in" onClick={() => setMode("signin")} />
      </div>
    </Step>
  );
}
