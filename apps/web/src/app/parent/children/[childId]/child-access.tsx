"use client";

import { useActionState, useRef } from "react";
import { createChildLogin, removeChildLogin, resetChildPin, setSharedDevice } from "@/app/actions";
import { PinField } from "@/components/pin-field";
import { SheetPanel, openSheet } from "@/components/sheet";
import { FormFeedback, RowContent } from "@/components/ui";

function summary(sharedDevice: boolean, username: string | null) {
  if (sharedDevice && username) return "Kid mode and their own login";
  if (username) return `Their own login, ${username}`;
  if (sharedDevice) return "Kid mode on this device";
  return "Not set up";
}

export function ChildAccess({ childId, sharedDevice, username }: { childId: string; sharedDevice: boolean; username: string | null }) {
  const sheet = useRef<HTMLDialogElement>(null);
  const [createState, create, creating] = useActionState(createChildLogin.bind(null, childId), {});
  const [resetState, reset, resetting] = useActionState(resetChildPin.bind(null, childId), {});
  const toggleShared = setSharedDevice.bind(null, childId, !sharedDevice);
  const remove = removeChildLogin.bind(null, childId);

  return (
    <>
      <button type="button" className="list-row w-full text-left" onClick={() => openSheet(sheet)}>
        <RowContent title="How they sign in" subtitle={summary(sharedDevice, username)} />
      </button>

      <SheetPanel ref={sheet} title="How they sign in">
        <p className="-mt-2 mb-5 text-ink-soft">Keep at least one way on.</p>
        <div className="list-group">
          <div className="list-row">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Kid mode</span>
              <span className="block text-sm text-ink-soft">Pick them on your device, no password.</span>
            </span>
            <form action={toggleShared}>
              <button
                type="submit"
                role="switch"
                aria-checked={sharedDevice}
                aria-label="Kid mode"
                disabled={sharedDevice && !username}
                title={sharedDevice && !username ? "Create a login first" : undefined}
                className={`relative h-8 w-13 shrink-0 rounded-full transition-colors duration-200 ease-out disabled:opacity-50 ${sharedDevice ? "bg-leaf" : "bg-mist-deep"}`}
              >
                <span className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${sharedDevice ? "translate-x-5" : ""}`} />
              </button>
            </form>
          </div>
        </div>

        <h3 className="mt-7 mb-3 font-semibold">Their own login</h3>
        {username ? (
          <div className="space-y-4">
            <p className="text-ink-soft">
              They sign in as <span className="font-semibold text-ink">{username}</span> and can only open their lessons.
            </p>
            <form action={reset} className="space-y-3">
              <PinField id="reset_pin" label="New PIN" autoComplete="new-password" showLabel />
              <FormFeedback error={resetState.error} message={resetState.message} />
              <button type="submit" disabled={resetting} className="btn-secondary w-full">{resetting ? "Saving…" : "Change PIN"}</button>
            </form>
            <form action={remove}>
              <button type="submit" className="btn-ghost w-full text-berry">Remove login</button>
            </form>
          </div>
        ) : (
          <form action={create} className="space-y-4">
            <div>
              <label htmlFor="kid_username" className="label">Username</label>
              <input id="kid_username" name="username" required autoCapitalize="none" autoComplete="off" spellCheck={false} maxLength={20} className="input" placeholder="maya_learns" />
            </div>
            <PinField id="kid_pin" label="PIN, 4 to 6 digits" autoComplete="new-password" showLabel />
            <FormFeedback error={createState.error} message={createState.message} />
            <button type="submit" disabled={creating} className="btn-primary btn-lg w-full">{creating ? "Creating…" : "Create login"}</button>
          </form>
        )}
      </SheetPanel>
    </>
  );
}
