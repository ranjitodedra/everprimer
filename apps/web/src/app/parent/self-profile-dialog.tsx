"use client";

import { useRef } from "react";
import { BirthFields } from "@/components/birth-fields";
import { Plus, X } from "@/components/icons";

export function SelfProfileDialog({ action }: { action: (formData: FormData) => Promise<void> }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = () => dialogRef.current?.close();

  return (
    <>
      <div className="card flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-ink-soft">Want your own lessons too?</p>
        <button type="button" className="btn-secondary shrink-0" onClick={() => dialogRef.current?.showModal()}>
          <Plus size={16} />
          Add my own learner profile
        </button>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="self_profile_title"
        className="card m-auto w-[calc(100%-2rem)] max-w-md text-ink backdrop:bg-ink/40"
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="self_profile_title" className="text-lg font-extrabold">Add my own learner profile</h2>
          <button type="button" className="btn-ghost" aria-label="Close" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <form action={action} className="space-y-3">
          <div>
            <label htmlFor="self_name" className="label">Your name</label>
            <input id="self_name" name="display_name" required maxLength={40} className="input" placeholder="Your name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <BirthFields required monthId="self_birth_month" yearId="self_birth_year" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={close}>Cancel</button>
            <button type="submit" className="btn-primary">Add</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
