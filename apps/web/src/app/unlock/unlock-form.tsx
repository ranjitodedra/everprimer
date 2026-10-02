"use client";

import { useActionState } from "react";
import { unlockGrownup, type FormState } from "@/app/actions";

export function UnlockForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(unlockGrownup, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="pin" className="label">PIN</label>
        <input
          id="pin"
          name="pin"
          type="password"
          inputMode="numeric"
          pattern="\d{4,6}"
          autoComplete="one-time-code"
          required
          className="input tracking-[0.4em]"
          placeholder="••••"
        />
      </div>
      {state.error ? <p role="alert" className="rounded-xl border border-berry/25 bg-berry-soft px-3 py-2 text-sm font-bold text-berry">{state.error}</p> : null}
      <button type="submit" disabled={pending} className="btn-primary btn-lg w-full">
        {pending ? "Checking…" : "Open grown-up area"}
      </button>
    </form>
  );
}
