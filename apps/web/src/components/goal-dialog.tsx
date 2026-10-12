"use client";

import { useRef, useState, type ReactNode } from "react";
import { Plus } from "@/components/icons";
import { SheetPanel, openSheet } from "@/components/sheet";
import { SubmitButton } from "@/components/submit-button";

const SCOPES = [
  { id: "overview", title: "Quick look", body: "The big ideas, broad and light." },
  { id: "hobby", title: "For fun", body: "Curiosity first, with interesting detours." },
  { id: "exam", title: "Test prep", body: "Everything covered, with practice for each part." },
  { id: "mastery", title: "Deep", body: "Well enough to use it somewhere new." },
] as const;

/**
 * New learning goal: what to learn, how deep, and optionally one interest to
 * frame the lessons around. The interest shapes examples only, never the content.
 */
export function GoalDialog({
  action,
  from,
  self = false,
  trigger,
  triggerClassName = "btn-primary",
}: {
  action: (formData: FormData) => Promise<void>;
  from?: "learn";
  self?: boolean;
  trigger?: ReactNode;
  triggerClassName?: string;
}) {
  const sheet = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState<(typeof SCOPES)[number]["id"]>("hobby");
  const who = self ? "you" : "they";

  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => openSheet(sheet)}>
        {trigger ?? (
          <>
            <Plus size={18} />
            New goal
          </>
        )}
      </button>

      <SheetPanel ref={sheet} title="New goal">
        <form action={action} className="space-y-6">
          {from ? <input type="hidden" name="from" value={from} /> : null}
          <div>
            <label htmlFor="goal_text" className="label">What should {who} learn?</label>
            <textarea
              id="goal_text"
              name="goal"
              required
              minLength={5}
              maxLength={600}
              rows={3}
              className="input text-lg"
              placeholder={self ? "How compound interest works" : "The solar system and all the planets"}
            />
          </div>

          <fieldset>
            <legend className="label">How deep?</legend>
            <div className="flex flex-wrap gap-2">
              {SCOPES.map((s) => (
                <label key={s.id}>
                  <input type="radio" name="scope" value={s.id} checked={scope === s.id} onChange={() => setScope(s.id)} className="peer sr-only" />
                  <span className="chip">{s.title}</span>
                </label>
              ))}
            </div>
            <p key={scope} className="animate-swap mt-3 text-sm text-ink-soft">{SCOPES.find((s) => s.id === scope)?.body}</p>
          </fieldset>

          <details className="group">
            <summary className="inline-flex min-h-11 items-center gap-2 font-semibold text-leaf">
              <Plus size={16} className="transition-transform duration-200 group-open:rotate-45" />
              Something {who} love, or a detail
            </summary>
            <div className="mt-3 space-y-4">
              <div>
                <label htmlFor="goal_interest" className="label">Something {who} love right now</label>
                <input id="goal_interest" name="interest" maxLength={120} className="input" placeholder="Football, Minecraft, horses" />
                <p className="mt-1.5 text-sm text-ink-faint">Used for examples only. It never changes what&apos;s taught.</p>
              </div>
              <div>
                <label htmlFor="scope_note" className="label">Anything specific</label>
                <input id="scope_note" name="scopeNote" maxLength={300} className="input" placeholder="Year 4 science test in March" />
              </div>
            </div>
          </details>

          <SubmitButton pendingLabel="Making lessons…">Make lessons</SubmitButton>
        </form>
      </SheetPanel>
    </>
  );
}
