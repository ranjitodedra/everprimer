"use client";

import { useRef } from "react";
import { BirthFields } from "@/components/birth-fields";
import { SheetPanel, closeSheet, openSheet } from "@/components/sheet";
import { SubmitButton } from "@/components/submit-button";
import { RowContent } from "@/components/ui";
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
  const sheet = useRef<HTMLDialogElement>(null);
  const hasBirthday = birthMonth != null && birthYear != null && birthMonth >= 1 && birthMonth <= 12;
  const label = hasBirthday ? `${BIRTH_MONTHS[birthMonth - 1]} ${birthYear}` : "Not set";

  return (
    <>
      <button type="button" className="list-row w-full text-left" onClick={() => openSheet(sheet)}>
        <RowContent title="Birthday" trailing={<span className="text-ink-soft">{label}</span>} />
      </button>
      <SheetPanel ref={sheet} title="Birthday">
        <p className="-mt-2 mb-5 text-ink-soft">
          {age != null ? `${age} years old. ` : ""}Lessons follow their age as it changes.
        </p>
        <form
          key={`${birthMonth ?? ""}-${birthYear ?? ""}`}
          action={async (formData) => {
            await action(formData);
            closeSheet(sheet);
          }}
          className="space-y-5"
        >
          <div className="grid grid-cols-2 gap-3">
            <BirthFields required defaultMonth={birthMonth} defaultYear={birthYear} monthId="learner_birth_month" yearId="learner_birth_year" />
          </div>
          <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
        </form>
      </SheetPanel>
    </>
  );
}
