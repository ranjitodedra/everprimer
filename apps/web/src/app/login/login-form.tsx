"use client";

import { useActionState, useState, type FocusEvent } from "react";
import { BirthFields } from "@/components/birth-fields";
import { Lock } from "@/components/icons";
import { signIn, signInChild, signUp, type AuthState } from "./actions";
import { type AuthMode, type Who } from "./who";

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

const PEOPLE: { who: Who; emoji: string; title: string; body: string }[] = [
  { who: "individual", emoji: "🎒", title: "Individual", body: "Learn for myself." },
  { who: "parent", emoji: "👪", title: "Parent", body: "Manage my children's lessons." },
  { who: "child", emoji: "🧒", title: "Child", body: "Username and PIN from a grown-up." },
  { who: "shared", emoji: "📱", title: "Shared device", body: "One parent login. Kids pick their name." },
];

const COPY: Record<AdultWho, Record<AuthMode, { title: string; body: string }>> & {
  child: { title: string; body: string };
} = {
  individual: {
    signin: { title: "Welcome back", body: "Sign in with your email and password." },
    signup: { title: "Start learning", body: "Accounts are for people 13 and older." },
  },
  parent: {
    signin: { title: "Welcome back", body: "Sign in to manage your children's lessons." },
    signup: { title: "Create a parent account", body: "You'll add children, goals, and kid logins next." },
  },
  child: { title: "Hi there!", body: "Use the username and PIN your grown-up made for you." },
  shared: {
    signin: { title: "Welcome back", body: "Sign in, then pick who is learning on this device." },
    signup: { title: "Create a family login", body: "One login for this device. You'll add children next, then share it." },
  },
};

function ChooseAgain({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="mb-4 text-sm font-extrabold text-ink-soft hover:text-ink">
      ← Choose someone else
    </button>
  );
}

function Feedback({ state }: { state: AuthState }) {
  if (state.error) return <p role="alert" className="rounded-xl border border-berry/25 bg-berry-soft px-3 py-2 text-sm font-bold text-berry">{state.error}</p>;
  if (state.message) return <p role="status" className="rounded-xl border border-brand/25 bg-brand-soft px-3 py-2 text-sm font-bold text-brand-deep">{state.message}</p>;
  return null;
}

function EmailFields({ mode }: { mode: AuthMode }) {
  return (
    <>
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          enterKeyHint="next"
          required
          className="input"
          placeholder="you@example.com"
          onFocus={keepInView}
        />
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
          placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
          onFocus={keepInView}
        />
      </div>
    </>
  );
}

function CredentialForm({ who, mode, next }: { who: AdultWho; mode: AuthMode; next: string }) {
  const action = mode === "signin" ? signIn : signUp;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(action, {});
  const copy = COPY[who][mode];
  const kind = who === "individual" ? "individual" : "parent";

  return (
    <>
      <h2 className="text-xl font-black">{copy.title}</h2>
      <p className="mb-5 text-sm text-ink-soft">{copy.body}</p>
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        {mode === "signup" ? <input type="hidden" name="account_kind" value={kind} /> : null}
        {mode === "signin" && who === "shared" ? <input type="hidden" name="intent" value="shared" /> : null}

        {mode === "signup" && who === "individual" ? (
          <div className="space-y-3">
            <div>
              <label htmlFor="display_name" className="label">Your name</label>
              <input id="display_name" name="display_name" autoComplete="given-name" maxLength={40} required className="input" placeholder="Alex" onFocus={keepInView} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <BirthFields required monthId="signup_birth_month" yearId="signup_birth_year" onFocus={keepInView} />
            </div>
          </div>
        ) : null}

        <EmailFields mode={mode} />

        {mode === "signup" && kind === "parent" ? (
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" name="adult" required className="mt-0.5 h-4 w-4 accent-brand" />
            <span>I am 18 or older and a parent or guardian.</span>
          </label>
        ) : null}

        <Feedback state={state} />
        <button type="submit" disabled={pending} className="btn-primary btn-lg w-full">
          {pending ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
      <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-ink-faint">
        <Lock size={12} />
        Children never sign up. A parent creates their profile.
      </p>
    </>
  );
}

function ChildForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(signInChild, {});
  return (
    <>
      <h2 className="text-xl font-black">{COPY.child.title}</h2>
      <p className="mb-5 text-sm text-ink-soft">{COPY.child.body}</p>
      <form action={formAction} className="space-y-4">
        <div>
          <label htmlFor="username" className="label">Username</label>
          <input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} enterKeyHint="next" required className="input" placeholder="your_username" onFocus={keepInView} />
        </div>
        <div>
          <label htmlFor="pin" className="label">PIN</label>
          <input id="pin" name="pin" type="password" inputMode="numeric" pattern="\d{4,6}" autoComplete="current-password" enterKeyHint="go" required className="input tracking-[0.4em]" placeholder="••••" onFocus={keepInView} />
        </div>
        <Feedback state={state} />
        <button type="submit" disabled={pending} className="btn-primary btn-lg w-full">
          {pending ? "One moment…" : "Let's learn"}
        </button>
      </form>
      <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-ink-faint">
        <Lock size={12} />
        No login yet? A grown-up can make one in their account.
      </p>
    </>
  );
}

const MODES: { mode: AuthMode; emoji: string; title: string; body: string }[] = [
  { mode: "signup", emoji: "✨", title: "Create account", body: "Start with a free plan." },
  { mode: "signin", emoji: "🔑", title: "Sign in", body: "I already have an account." },
];

function PersonaForm({
  who,
  mode,
  next,
  onBack,
  onModeChange,
}: {
  who: Who;
  mode: AuthMode;
  next: string;
  onBack: () => void;
  onModeChange: (mode: AuthMode) => void;
}) {
  return (
    <>
      <ChooseAgain onBack={onBack} />
      {who === "child" ? (
        <ChildForm />
      ) : (
        <>
          <CredentialForm key={mode} who={who} mode={mode} next={next} />
          <button
            type="button"
            onClick={() => onModeChange(mode === "signin" ? "signup" : "signin")}
            className="mt-4 w-full text-center text-sm font-extrabold text-ink-soft hover:text-ink"
          >
            {mode === "signin" ? "Need an account? Create one" : "Already have an account? Sign in"}
          </button>
        </>
      )}
    </>
  );
}

function Tile({
  emoji,
  title,
  body,
  onClick,
}: {
  emoji: string;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card flex h-full w-full items-center gap-4 p-5 text-left transition hover:border-brand/40 lg:h-auto lg:gap-3 lg:p-3"
    >
      <span className="text-5xl lg:text-2xl" aria-hidden>{emoji}</span>
      <span className="min-w-0">
        <span className="block text-xl font-black lg:text-sm">{title}</span>
        <span className="block text-base text-ink-soft lg:text-xs">{body}</span>
      </span>
    </button>
  );
}

export function LoginForm({ next, who, initialMode }: { next: string; who: Who | null; initialMode?: AuthMode | null }) {
  const [mode, setMode] = useState<AuthMode | null>(initialMode ?? (who ? "signin" : null));
  const [selected, setSelected] = useState<Who | null>(who);
  const people = mode === "signup" ? PEOPLE.filter((p) => p.who !== "child") : PEOPLE;

  return (
    <div className="card p-5 shadow-lift sm:p-7">
      {selected && mode ? (
        <PersonaForm
          key={`${selected}-${mode}`}
          who={selected}
          mode={mode}
          next={next}
          onBack={() => setSelected(null)}
          onModeChange={setMode}
        />
      ) : mode ? (
        <>
          <button type="button" onClick={() => setMode(null)} className="mb-4 text-sm font-extrabold text-ink-soft hover:text-ink">
            ← Back
          </button>
          <h2 className="text-xl font-black">Who are you?</h2>
          <p className="mb-4 text-sm text-ink-soft">Pick the login that matches you.</p>
          <div
            className={`grid grid-cols-1 gap-3 lg:h-auto lg:grid-rows-none lg:gap-2 ${people.length === 3 ? "h-[60dvh] grid-rows-3" : "h-[75dvh] grid-rows-4"}`}
            role="group"
            aria-label="Who are you?"
          >
            {people.map((person) => (
              <Tile key={person.who} emoji={person.emoji} title={person.title} body={person.body} onClick={() => setSelected(person.who)} />
            ))}
          </div>
        </>
      ) : (
        <>
          <h2 className="text-xl font-black">Get started</h2>
          <p className="mb-4 text-sm text-ink-soft">Create a free account or sign in.</p>
          <div className="grid h-[40dvh] grid-cols-1 grid-rows-2 gap-3 lg:h-auto lg:grid-rows-none" role="group" aria-label="Create account or sign in">
            {MODES.map((option) => (
              <Tile key={option.mode} emoji={option.emoji} title={option.title} body={option.body} onClick={() => setMode(option.mode)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
