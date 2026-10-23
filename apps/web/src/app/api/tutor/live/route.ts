import { NextResponse } from "next/server";
import { z } from "zod";
import type { SessionRow } from "@eco/db";
import { startLiveTutor } from "@/lib/live-tutor";
import { STATUS } from "@/lib/live-tutor-access";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const Body = z.object({ sessionId: z.string().uuid() });

/**
 * Starts a live voice tutor session for the lesson the learner has open.
 * Returns a single-use Gemini token; the API key never leaves the server.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  const headers = { "cache-control": "no-store" };
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400, headers });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });

  // RLS limits this to the caller's own learners, so it doubles as the ownership check.
  const { data: session } = await supabase.from("artifact_sessions").select("id, child_id, topic_id").eq("id", parsed.data.sessionId).maybeSingle();
  if (!session) return NextResponse.json({ error: "unknown session" }, { status: 404, headers });

  try {
    const result = await startLiveTutor(session as Pick<SessionRow, "id" | "child_id" | "topic_id">);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS[result.error], headers });
    return NextResponse.json(result.grant, { headers });
  } catch (err) {
    console.error("[live-tutor] start failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers });
  }
}
