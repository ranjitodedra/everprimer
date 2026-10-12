"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({ children, pendingLabel = "One moment…", className = "btn-primary btn-lg w-full" }: { children: ReactNode; pendingLabel?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}
