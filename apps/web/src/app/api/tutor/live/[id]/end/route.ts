import { NextResponse } from "next/server";
import { LiveUsageBody, NO_USAGE, liveSessionChild } from "@/lib/live-tutor-access";
import { tickLiveTutor } from "@/lib/live-tutor";

export const runtime = "nodejs";

/** Ends a voice session with a final charge. Sent with sendBeacon on leave; the usage body is optional. */
export async function POST(req: Request, ctx: RouteContext<"/api/tutor/live/[id]/end">) {
  const { id } = await ctx.params;
  const access = await liveSessionChild(id);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = LiveUsageBody.safeParse(await req.json().catch(() => null));
  const result = await tickLiveTutor(id, access.childId, body.success ? body.data.usage : NO_USAGE, true);
  return NextResponse.json({ ok: true, creditsUsed: result?.creditsUsed ?? null });
}
