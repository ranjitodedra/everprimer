"use client";

import { useActionState } from "react";
import { unlockGrownup, type FormState } from "@/app/actions";
import { PinField } from "@/components/pin-field";
import { FormFeedback } from "@/components/ui";

export function UnlockForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(unlockGrownup, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <PinField label="Grown-up PIN" autoComplete="one-time-code" autoFocus />
      <FormFeedback error={state.error} />
      <button type="submit" disabled={pending} className="btn-primary btn-lg w-full">
        {pending ? "Checking…" : "Open"}
      </button>
    </form>
  );
}
