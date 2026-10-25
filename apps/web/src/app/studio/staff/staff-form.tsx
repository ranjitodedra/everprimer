"use client";

import { useActionState, useEffect, useRef } from "react";
import { grantStaffAction, removeStaffAction } from "./actions";

export function AddStaffForm() {
  const [state, action, pending] = useActionState(grantStaffAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.type === "granted") formRef.current?.reset();
  }, [state]);
  const problems = state && "problems" in state ? state.problems : [];

  return (
    <form ref={formRef} action={action} className="mb-10 grid gap-3 sm:grid-cols-2">
      <label className="block text-sm font-semibold">
        Email
        <input name="email" type="email" autoComplete="off" required className="input mt-1" />
      </label>
      <label className="block text-sm font-semibold">
        Password
        <input name="password" type="password" autoComplete="new-password" required minLength={8} className="input mt-1" />
      </label>
      <div className="sm:col-span-2">
        <button type="submit" className="btn-primary btn-sm" disabled={pending}>
          Add staff
        </button>
        {problems.length ? <p className="mt-3 text-sm text-berry">{problems.join(" ")}</p> : null}
      </div>
    </form>
  );
}

export function RemoveStaffButton({ userId, email }: { userId: string; email: string }) {
  const [state, action, pending] = useActionState(removeStaffAction.bind(null, userId), null);
  const problems = state && "problems" in state ? state.problems : [];

  return (
    <form action={action}>
      <button type="submit" className="btn-ghost btn-sm" disabled={pending} aria-label={`Remove ${email}`}>
        Remove
      </button>
      {problems.length ? <p className="mt-1 text-sm text-berry">{problems.join(" ")}</p> : null}
    </form>
  );
}
