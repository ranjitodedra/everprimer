"use client";

import { useRef, type ReactNode } from "react";
import { BirthFields } from "@/components/birth-fields";
import { Plus } from "@/components/icons";
import { SheetPanel, openSheet } from "@/components/sheet";
import { SubmitButton } from "@/components/submit-button";

const AVATARS = ["🦊", "🐼", "🦉", "🐙", "🦖", "🐨", "🦄", "🐸"];

export function AddChildDialog({
  action,
  trigger,
  triggerClassName = "btn-primary",
}: {
  action: (formData: FormData) => Promise<void>;
  trigger?: ReactNode;
  triggerClassName?: string;
}) {
  const sheet = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => openSheet(sheet)}>
        {trigger ?? (
          <>
            <Plus size={18} />
            Add a child
          </>
        )}
      </button>

      <SheetPanel ref={sheet} title="Add a child">
        <form action={action} className="space-y-5">
          <fieldset className="min-w-0">
            <legend className="sr-only">Avatar</legend>
            <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 py-1">
              {AVATARS.map((a, i) => (
                <label key={a} className="shrink-0 cursor-pointer">
                  <input type="radio" name="avatar" value={a} defaultChecked={i === 0} className="peer sr-only" />
                  <span className="grid h-14 w-14 place-items-center rounded-full text-3xl transition-[background-color,transform] duration-200 ease-out peer-checked:scale-105 peer-checked:bg-leaf-soft peer-focus-visible:ring-4 peer-focus-visible:ring-leaf/25 active:scale-95">{a}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="display_name" className="label">Name</label>
            <input id="display_name" name="display_name" required maxLength={40} className="input" placeholder="Maya" autoComplete="off" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <BirthFields monthId="child_birth_month" yearId="child_birth_year" />
          </div>
          <div>
            <label htmlFor="reading_level" className="label">Reading</label>
            <select id="reading_level" name="reading_level" className="input" defaultValue="">
              <option value="">Not sure</option>
              <option value="pre_reader">Not reading yet</option>
              <option value="early">Early</option>
              <option value="developing">Developing</option>
              <option value="fluent">Fluent</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>
          <SubmitButton pendingLabel="Adding…">Add child</SubmitButton>
          <p className="text-center text-sm text-ink-faint">We keep a name, birth month and year, and reading level.</p>
        </form>
      </SheetPanel>
    </>
  );
}
