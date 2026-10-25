"use client";

import { useActionState } from "react";
import { retireSitting } from "./actions";

export function RetireButton({ artifactId, version }: { artifactId: string; version: number }) {
  const [state, action, pending] = useActionState(
    (_prev: Awaited<ReturnType<typeof retireSitting>> | null) => retireSitting(artifactId, version),
    null,
  );
  const problems = state && "problems" in state ? state.problems : [];

  return (
    <form action={action} className="shrink-0">
      <button type="submit" className="btn-ghost btn-sm" disabled={pending} aria-label={`Retire ${artifactId} version ${version}`}>
        Retire
      </button>
      {problems.length ? <p className="mt-1 text-sm text-berry">{problems.join(" ")}</p> : null}
    </form>
  );
}
