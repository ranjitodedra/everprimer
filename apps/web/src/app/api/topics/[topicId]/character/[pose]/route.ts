import { NextResponse } from "next/server";
import type { CharacterPose, LessonCharacterRow } from "@eco/db";
import { CHARACTER_POSES, characterStatusOf, downloadPose } from "@/lib/lesson-art";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MIMES = new Set(["image/webp", "image/png", "image/jpeg"]);

/**
 * One pose of the lesson's character. The bucket is private: the RLS read is
 * the access check, then the service role fetches the bytes. Same-origin, so
 * the host page needs no CSP change, and immutable per version.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/topics/[topicId]/character/[pose]">) {
  const { topicId, pose } = await ctx.params;
  if (!CHARACTER_POSES.includes(pose as CharacterPose)) return NextResponse.json({ error: "unknown pose" }, { status: 404 });

  const supabase = await createClient();
  const { data } = await supabase
    .from("lesson_characters")
    .select("status, ready_at, seed, talk_path, teach_path")
    .eq("topic_id", topicId)
    .maybeSingle();
  const row = data as Pick<LessonCharacterRow, "status" | "ready_at" | "seed" | "talk_path" | "teach_path"> | null;
  if (!row || row.status !== "ready") return NextResponse.json({ error: "not ready" }, { status: 404, headers: { "cache-control": "no-store" } });

  const { version } = characterStatusOf(row);
  const etag = `"${version}-${pose}"`;
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });

  const blob = await downloadPose(row, pose as CharacterPose);
  if (!blob) return NextResponse.json({ error: "unavailable" }, { status: 502, headers: { "cache-control": "no-store" } });
  const type = MIMES.has(blob.type) ? blob.type : "image/webp";
  return new Response(blob, {
    headers: {
      "content-type": type,
      "cache-control": "private, max-age=31536000, immutable",
      etag,
      "x-content-type-options": "nosniff",
    },
  });
}
