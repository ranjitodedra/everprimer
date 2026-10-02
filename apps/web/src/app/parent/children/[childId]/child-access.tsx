"use client";

import { useActionState } from "react";
import { createChildLogin, removeChildLogin, resetChildPin, setSharedDevice, type FormState } from "@/app/actions";
import { Lock, Users } from "@/components/icons";

function Feedback({ state }: { state: FormState }) {
  if (state.error) return <p role="alert" className="rounded-xl border border-berry/25 bg-berry-soft px-3 py-2 text-sm font-bold text-berry">{state.error}</p>;
  if (state.message) return <p role="status" className="rounded-xl border border-brand/25 bg-brand-soft px-3 py-2 text-sm font-bold text-brand-deep">{state.message}</p>;
  return null;
}

export function ChildAccess({ childId, sharedDevice, username }: { childId: string; sharedDevice: boolean; username: string | null }) {
  const [createState, create, creating] = useActionState(createChildLogin.bind(null, childId), {});
  const [resetState, reset, resetting] = useActionState(resetChildPin.bind(null, childId), {});
  const toggleShared = setSharedDevice.bind(null, childId, !sharedDevice);
  const remove = removeChildLogin.bind(null, childId);

  return (
    <section className="card">
      <div className="mb-1 flex items-center gap-2">
        <Lock size={16} className="text-brand" />
        <h2 className="font-extrabold">Access</h2>
      </div>
      <p className="mb-4 text-sm text-ink-soft">How this child opens their lessons. Keep at least one way on.</p>

      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm">
          <Users size={16} className="text-ink-soft" />
          <span>
            <span className="font-bold">Shared device</span>
            <span className="block text-xs text-ink-soft">Pick them in kid mode on your login.</span>
          </span>
        </div>
        <form action={toggleShared}>
          <button type="submit" className="btn-secondary btn-sm" disabled={sharedDevice && !username} title={sharedDevice && !username ? "Create a login first" : undefined}>
            {sharedDevice ? "Turn off" : "Turn on"}
          </button>
        </form>
      </div>

      {username ? (
        <div className="space-y-3">
          <p className="text-sm">
            Kid login: <span className="font-extrabold">{username}</span>
            <span className="block text-xs text-ink-soft">They sign in on the Kid login tab and can only open their lessons.</span>
          </p>
          <form action={reset} className="flex gap-2">
            <input name="pin" type="password" inputMode="numeric" pattern="\d{4,6}" required className="input min-w-0 flex-1" placeholder="New PIN (4–6 digits)" aria-label="New PIN" />
            <button type="submit" disabled={resetting} className="btn-secondary shrink-0">Reset PIN</button>
          </form>
          <Feedback state={resetState} />
          <form action={remove}>
            <button type="submit" className="btn-ghost btn-sm text-berry">Remove login</button>
          </form>
        </div>
      ) : (
        <form action={create} className="space-y-3">
          <p className="text-sm font-bold">Give them their own login</p>
          <input name="username" required autoCapitalize="none" spellCheck={false} maxLength={20} className="input" placeholder="Username, e.g. maya_learns" aria-label="Username" />
          <input name="pin" type="password" inputMode="numeric" pattern="\d{4,6}" required className="input" placeholder="PIN (4–6 digits)" aria-label="PIN" />
          <Feedback state={createState} />
          <button type="submit" disabled={creating} className="btn-primary w-full">{creating ? "Creating…" : "Create kid login"}</button>
        </form>
      )}
    </section>
  );
}
