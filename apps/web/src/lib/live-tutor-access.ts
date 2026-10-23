import "server-only";
import { z } from "zod";
import type { LiveTutorError } from "@/lib/live-tutor";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const STATUS: Record<LiveTutorError, number> = { plan: 403, disabled: 403, credits: 402, busy: 409, unavailable: 503 };

const TOKENS = z.number().int().min(0).max(1_000_000_000);

/** Cumulative token use the browser reports for one conversation. */
export const LiveUsageBody = z.object({
  usage: z.object({ textIn: TOKENS, audioIn: TOKENS, textOut: TOKENS, audioOut: TOKENS }),
});

export const NO_USAGE = { textIn: 0, audioIn: 0, textOut: 0, audioOut: 0 };

/**
 * The learner a voice session belongs to, when the signed-in caller may act on it:
 * parents and the learner's own login can both read the child row; nobody else can.
 */
export async function liveSessionChild(id: string): Promise<{ childId: string } | { status: number; error: string }> {
  if (!z.string().uuid().safeParse(id).success) return { status: 400, error: "invalid request" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: 401, error: "unauthorized" };

  const { data: row } = await createServiceClient().from("tutor_sessions").select("child_id").eq("id", id).maybeSingle();
  if (!row) return { status: 404, error: "not found" };
  const childId = (row as { child_id: string }).child_id;
  const { data: child } = await supabase.from("children").select("id").eq("id", childId).maybeSingle();
  if (!child) return { status: 404, error: "not found" };
  return { childId };
}
