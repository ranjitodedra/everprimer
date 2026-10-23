import { NextResponse } from "next/server";
import { LiveUsageBody, liveSessionChild } from "@/lib/live-tutor-access";
import { tickLiveTutor } from "@/lib/live-tutor";

export const runtime = "nodejs";

/** Once a minute while the tutor talks: records time and token use, charges credits, and says when to stop. */
export async function POST(req: Request, ctx: RouteContext<"/api/tutor/live/[id]/tick">) {
  const headers = { "cache-control": "no-store" };
  const { id } = await ctx.params;
  const access = await liveSessionChild(id);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status, headers });

  const body = LiveUsageBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid request" }, { status: 400, headers });

  const result = await tickLiveTutor(id, access.childId, body.data.usage);
  if (!result) return NextResponse.json({ error: "busy" }, { status: 409, headers });
  return NextResponse.json(result, { headers });
}
