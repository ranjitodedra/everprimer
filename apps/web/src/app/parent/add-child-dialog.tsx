"use client";

import { useRef } from "react";
import { BirthFields } from "@/components/birth-fields";
import { Plus, X } from "@/components/icons";

const AVATARS = ["🦊", "🐼", "🦉", "🐙", "🦖", "🐨", "🦄", "🐸"];

export function AddChildDialog({ action }: { action: (formData: FormData) => Promise<void> }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = () => dialogRef.current?.close();

  return (
    <>
      <div className="card flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-ink-soft">Takes ten seconds. You can refine everything later.</p>
        <button type="button" className="btn-primary shrink-0" onClick={() => dialogRef.current?.showModal()}>
          <Plus size={16} />
          Add a child
        </button>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="add_child_title"
        className="card m-auto w-[calc(100%-2rem)] max-w-md text-ink backdrop:bg-ink/40"
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="add_child_title" className="text-lg font-extrabold">Add a child</h2>
          <button type="button" className="btn-ghost" aria-label="Close" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <form action={action} className="space-y-4">
          <div>
            <label htmlFor="display_name" className="label">First name or nickname</label>
            <input id="display_name" name="display_name" required maxLength={40} className="input" placeholder="Maya" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <BirthFields monthId="child_birth_month" yearId="child_birth_year" />
          </div>
          <div>
            <label htmlFor="reading_level" className="label">Reading</label>
            <select id="reading_level" name="reading_level" className="input" defaultValue="">
              <option value="">Not sure</option>
              <option value="pre_reader">Pre-reader</option>
              <option value="early">Early</option>
              <option value="developing">Developing</option>
              <option value="fluent">Fluent</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>
          <fieldset>
            <legend className="label">Pick an avatar</legend>
            <div className="grid grid-cols-4 gap-2">
              {AVATARS.map((a, i) => (
                <label key={a} className="cursor-pointer">
                  <input type="radio" name="avatar" value={a} defaultChecked={i === 0} className="peer sr-only" />
                  <span className="grid h-12 w-full place-items-center rounded-xl border-2 border-line bg-card text-2xl transition peer-checked:border-brand peer-checked:bg-brand-soft peer-focus-visible:ring-4 peer-focus-visible:ring-brand/20 hover:border-line-strong">{a}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-ink-faint">We store a name, a birth month and year, and a reading level. Age is calculated from the birthday.</p>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={close}>Cancel</button>
            <button type="submit" className="btn-primary">Add child</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
