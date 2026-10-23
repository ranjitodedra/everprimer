import { NextResponse } from "next/server";
import { STATUS, liveSessionChild } from "@/lib/live-tutor-access";
import { renewLiveTutor } from "@/lib/live-tutor";

export const runtime = "nodejs";

/** A fresh token for an open conversation, so it can reconnect when Gemini moves it or the old token nears expiry. */
export async function POST(_req: Request, ctx: RouteContext<"/api/tutor/live/[id]/renew">) {
  const headers = { "cache-control": "no-store" };
  const { id } = await ctx.params;
  const access = await liveSessionChild(id);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status, headers });

  try {
    const result = await renewLiveTutor(id, access.childId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "ended" ? 410 : STATUS[result.error], headers });
    return NextResponse.json(result.grant, { headers });
  } catch (err) {
    console.error("[live-tutor] renew failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers });
  }
}
