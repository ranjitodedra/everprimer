import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { EventBatch } from "@eco/contracts";
import type { SessionRow } from "@eco/db";
import { ingestEventBatch } from "@/lib/progress";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Batched learning-event ingestion from the topic player.
 * Ownership is checked with the caller's RLS-scoped client; writes then run
 * with the service role inside `ingestEventBatch`.
 */
export async function POST(req: Request) {
  const parsed = EventBatch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid batch", issues: parsed.error.issues }, { status: 400 });
  const batch = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: session } = await supabase.from("artifact_sessions").select("*").eq("id", batch.sessionId).maybeSingle();
  if (!session) return NextResponse.json({ error: "unknown session" }, { status: 404 });

  try {
    const row = session as SessionRow;
    const result = await ingestEventBatch(row, batch);
    if (result.inserted > 0) {
      revalidatePath(`/learn/${row.child_id}`);
      revalidatePath(`/parent/children/${row.child_id}`);
      const { data: topic } = await supabase.from("topics").select("curriculum_id").eq("id", row.topic_id).maybeSingle();
      const curriculumId = (topic as { curriculum_id: string } | null)?.curriculum_id;
      if (curriculumId) {
        revalidatePath(`/learn/${row.child_id}/curricula/${curriculumId}`);
        revalidatePath(`/parent/curricula/${curriculumId}`);
      }
    }
    return NextResponse.json(result);
  } catch (err) {
    const detail = err instanceof Error ? err.message : ((err as { code?: string; message?: string } | null)?.message ?? String(err));
    console.error("[events] ingest failed", (err as { code?: string } | null)?.code ?? "", detail);
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  }
}
