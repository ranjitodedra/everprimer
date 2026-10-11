const SWEEP_MS = 30_000;

/**
 * In development nothing else calls the job sweeper (production uses the
 * Vercel cron), so queued retries would wait forever. Calls the same route
 * the cron does, so jobs run inside a request scope.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "development") return;
  const g = globalThis as typeof globalThis & { __ecoJobSweep?: ReturnType<typeof setInterval> };
  if (g.__ecoJobSweep) return;

  const url = `http://localhost:${process.env.PORT ?? 3000}/api/jobs/run`;
  const secret = process.env.CRON_SECRET;
  g.__ecoJobSweep = setInterval(async () => {
    try {
      const res = await fetch(url, { headers: secret ? { authorization: `Bearer ${secret}` } : {} });
      const body = (await res.json()) as { ran?: number };
      if (body.ran) console.log(`[jobs] dev sweep ran ${body.ran} job(s)`);
    } catch (err) {
      console.error("[jobs] dev sweep failed:", err instanceof Error ? err.message : err);
    }
  }, SWEEP_MS);
}
