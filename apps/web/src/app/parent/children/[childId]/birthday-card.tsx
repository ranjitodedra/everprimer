"use client";

import { useRef } from "react";
import { BirthFields } from "@/components/birth-fields";
import { X } from "@/components/icons";
import { BIRTH_MONTHS } from "@/lib/birth-calendar";

export function BirthdayCard({
  action,
  birthMonth,
  birthYear,
  age,
}: {
  action: (formData: FormData) => Promise<void>;
  birthMonth: number | null;
  birthYear: number | null;
  age: number | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = () => dialogRef.current?.close();
  const hasBirthday = birthMonth != null && birthYear != null && birthMonth >= 1 && birthMonth <= 12;
  const label = hasBirthday ? `${BIRTH_MONTHS[birthMonth - 1]} ${birthYear}` : null;

  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-extrabold">Birthday</h2>
          {label ? (
            <p className="mt-1 text-sm text-ink-soft">
              {label}
              {age != null ? ` · Age ${age}` : ""}
            </p>
          ) : (
            <p className="mt-1 text-sm text-ink-soft">Birthday not set</p>
          )}
        </div>
        <button type="button" className="btn-secondary shrink-0" onClick={() => dialogRef.current?.showModal()}>
          {hasBirthday ? "Update" : "Add birthday"}
        </button>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="birthday_title"
        className="card m-auto w-[calc(100%-2rem)] max-w-md text-ink backdrop:bg-ink/40"
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="birthday_title" className="text-lg font-extrabold">{hasBirthday ? "Update birthday" : "Add birthday"}</h2>
            <p className="mt-1 text-sm text-ink-soft">Age in lessons is calculated from this. It updates as the year goes on.</p>
          </div>
          <button type="button" className="btn-ghost shrink-0" aria-label="Close" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <form
          key={`${birthMonth ?? ""}-${birthYear ?? ""}`}
          action={async (formData) => {
            await action(formData);
            close();
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BirthFields required defaultMonth={birthMonth} defaultYear={birthYear} monthId="learner_birth_month" yearId="learner_birth_year" />
          </div>
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={close}>Cancel</button>
            <button type="submit" className="btn-primary">Save birthday</button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
