"use client";

import { useRef, type ReactNode } from "react";
import { BirthFields } from "@/components/birth-fields";
import { SheetPanel, openSheet } from "@/components/sheet";
import { SubmitButton } from "@/components/submit-button";

export function SelfProfileDialog({
  action,
  trigger = "Add yourself",
  triggerClassName = "btn-secondary",
}: {
  action: (formData: FormData) => Promise<void>;
  trigger?: ReactNode;
  triggerClassName?: string;
}) {
  const sheet = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => openSheet(sheet)}>
        {trigger}
      </button>

      <SheetPanel ref={sheet} title="Your own lessons">
        <form action={action} className="space-y-5">
          <div>
            <label htmlFor="self_name" className="label">Your name</label>
            <input id="self_name" name="display_name" required maxLength={40} className="input" autoComplete="given-name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <BirthFields required monthId="self_birth_month" yearId="self_birth_year" />
          </div>
          <SubmitButton pendingLabel="Adding…">Add me</SubmitButton>
        </form>
      </SheetPanel>
    </>
  );
}
