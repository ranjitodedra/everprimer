"use client";

import { useState, type FocusEvent } from "react";

/**
 * Passcode-style PIN entry: dot slots drawn over a real numeric input, so the
 * phone shows its number pad and password managers still work.
 */
export function PinField({
  id = "pin",
  name = "pin",
  label,
  autoComplete = "current-password",
  autoFocus = false,
  showLabel = false,
  onFocus,
}: {
  id?: string;
  name?: string;
  label: string;
  autoComplete?: string;
  autoFocus?: boolean;
  showLabel?: boolean;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
}) {
  const [value, setValue] = useState("");
  const slots = Math.max(4, Math.min(6, value.length + 1));
  return (
    <div>
      <label htmlFor={id} className={showLabel ? "label" : "sr-only"}>
        {label}
      </label>
      <div className="group relative flex h-16 items-center justify-center gap-3 rounded-2xl bg-mist transition-shadow focus-within:bg-paper focus-within:shadow-[0_0_0_2px_var(--color-leaf)]">
        {Array.from({ length: slots }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className={`h-4 w-4 rounded-full transition-[background-color,transform] duration-150 ${
              i < value.length ? "scale-100 bg-ink" : i >= 4 ? "scale-75 bg-ink/10" : "bg-ink/15"
            }`}
          />
        ))}
        <input
          id={id}
          name={name}
          type="password"
          inputMode="numeric"
          pattern="\d{4,6}"
          maxLength={6}
          minLength={4}
          autoComplete={autoComplete}
          enterKeyHint="go"
          autoFocus={autoFocus}
          required
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onFocus={onFocus}
          className="absolute inset-0 h-full w-full cursor-text rounded-2xl bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent"
        />
      </div>
    </div>
  );
}
