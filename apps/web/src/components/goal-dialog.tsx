"use client";

import { useRef } from "react";
import { Sparkles, X } from "@/components/icons";

const SCOPES = [
  { id: "overview", title: "Quick overview", body: "The big ideas, broad and light." },
  { id: "hobby", title: "For fun", body: "Curiosity first, with interesting detours." },
  { id: "exam", title: "Test prep", body: "Cover everything, with practice for each part." },
  { id: "mastery", title: "Deep mastery", body: "Understand it well enough to use it in new situations." },
] as const;

/**
 * New learning goal: what to learn, how deep, and one interest to frame the
 * lessons around. The interest shapes examples only, never the content.
 */
export function GoalDialog({
  action,
  from,
  self = false,
  intro,
}: {
  action: (formData: FormData) => Promise<void>;
  from?: "learn";
  self?: boolean;
  intro?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = () => dialogRef.current?.close();

  return (
    <>
      <div className="card relative overflow-hidden">
        <span className="pointer-events-none absolute -top-10 -right-10 h-36 w-36 rounded-full bg-sun-soft/70" aria-hidden />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="tile h-10 w-10 bg-sun-soft text-sun-deep"><Sparkles size={18} /></span>
            <div>
              <h2 className="text-lg font-extrabold">New learning goal</h2>
              <p className="text-sm text-ink-soft">{intro ?? "Write it the way you would say it. No prompting skills needed."}</p>
            </div>
          </div>
          <button type="button" className="btn-primary shrink-0" onClick={() => dialogRef.current?.showModal()}>
            Add a goal
          </button>
        </div>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="goal_dialog_title"
        className="card m-auto w-[calc(100%-2rem)] max-w-lg text-ink backdrop:bg-ink/40"
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="goal_dialog_title" className="text-lg font-extrabold">New learning goal</h2>
          <button type="button" className="btn-ghost" aria-label="Close" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <form action={action} className="space-y-5">
          {from ? <input type="hidden" name="from" value={from} /> : null}
          <div>
            <label htmlFor="goal_text" className="label">What should {self ? "you" : "they"} learn?</label>
            <textarea
              id="goal_text"
              name="goal"
              required
              minLength={5}
              maxLength={600}
              rows={3}
              className="input"
              placeholder={self ? "I want to understand how compound interest works." : "I want my child to learn about the solar system and all the planets."}
            />
          </div>

          <fieldset>
            <legend className="label">How deep?</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SCOPES.map((s) => (
                <label key={s.id} className="cursor-pointer">
                  <input type="radio" name="scope" value={s.id} defaultChecked={s.id === "hobby"} className="peer sr-only" />
                  <span className="block h-full rounded-xl border-2 border-line bg-card px-3 py-2.5 transition peer-checked:border-brand peer-checked:bg-brand-soft peer-focus-visible:ring-4 peer-focus-visible:ring-brand/20 hover:border-line-strong">
                    <span className="block text-sm font-extrabold">{s.title}</span>
                    <span className="block text-xs text-ink-soft">{s.body}</span>
                  </span>
                </label>
              ))}
            </div>
            <label htmlFor="scope_note" className="sr-only">Anything specific about depth</label>
            <input
              id="scope_note"
              name="scopeNote"
              maxLength={300}
              className="input mt-2"
              placeholder="Optional: e.g. Year 4 science test in March, or skip the history part"
            />
          </fieldset>

          <div>
            <label htmlFor="goal_interest" className="label">Something {self ? "you" : "they"} love right now (optional)</label>
            <input id="goal_interest" name="interest" maxLength={120} className="input" placeholder="football, Minecraft, horses…" />
            <p className="mt-1 text-xs text-ink-faint">Used for examples and comparisons only. It never changes what is taught.</p>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-ink-faint">5 to 14 lessons, from familiar to new.</p>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost" onClick={close}>Cancel</button>
              <button type="submit" className="btn-primary">Create curriculum</button>
            </div>
          </div>
        </form>
      </dialog>
    </>
  );
}
