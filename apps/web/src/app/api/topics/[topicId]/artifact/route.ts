import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Lightweight status poll used by the player while a lesson is generating. */
export async function GET(_req: Request, ctx: RouteContext<"/api/topics/[topicId]/artifact">) {
  const { topicId } = await ctx.params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("artifacts")
    .select("id, version, status, stage, stage_at, used_fallback, error, created_at, published_at")
    .eq("topic_id", topicId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return NextResponse.json({ status: "missing" });
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
