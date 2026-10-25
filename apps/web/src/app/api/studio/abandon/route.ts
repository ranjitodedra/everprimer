import { NextResponse } from "next/server";
import { abandonPreview } from "@/lib/studio";
import { currentStudioActor } from "@/lib/studio-session";
import { createServiceClient } from "@/lib/supabase/server";
import { LIBRARY_BUCKET } from "@eco/library";

/** Leaving the sitting deletes the draft. `pagehide` calls this with keepalive. */
export async function POST(request: Request) {
  const { actor } = await currentStudioActor();
  const body = (await request.json().catch(() => null)) as { artifactId?: unknown; version?: unknown } | null;
  const artifactId = typeof body?.artifactId === "string" ? body.artifactId : "";
  const version = typeof body?.version === "number" ? body.version : Number(body?.version);
  if (!artifactId || !Number.isInteger(version)) return NextResponse.json({ type: "refused" }, { status: 400 });

  const db = createServiceClient();
  const result = await abandonPreview(actor, artifactId, version, {
    db,
    remove: async (paths) => {
      if (paths.length === 0) return null;
      const { error } = await db.storage.from(LIBRARY_BUCKET).remove(paths);
      return error?.message ?? null;
    },
  });
  if (result.type === "not-found") return new NextResponse(null, { status: 404 });
  if (result.type === "redirect") return new NextResponse(null, { status: 401 });
  if (result.type === "refused") return NextResponse.json(result, { status: 409 });
  if (result.type === "unavailable") return NextResponse.json(result, { status: 500 });
  return NextResponse.json(result);
}
