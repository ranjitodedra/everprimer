"use server";

import { LIBRARY_BUCKET } from "@eco/library";
import { getArtifactOrigin } from "@/lib/artifact-host";
import { artifactHostEnv } from "@/lib/env";
import { abandonPreview, previewNewArtifact, previewNextVersion, publishPreview, sittingManifest, type PreviewResult, type SittingFields } from "@/lib/studio";
import { currentStudioActor } from "@/lib/studio-session";
import { createServiceClient } from "@/lib/supabase/server";

function storage() {
  const db = createServiceClient();
  return {
    db,
    origin: getArtifactOrigin(),
    secret: artifactHostEnv.draftSecret,
    now: Math.floor(Date.now() / 1000),
    upload: async (path: string, bytes: Uint8Array, mime: string) => {
      const { error } = await db.storage.from(LIBRARY_BUCKET).upload(path, Buffer.from(bytes), { contentType: mime, upsert: false });
      return error?.message ?? null;
    },
    remove: async (paths: string[]) => {
      if (paths.length === 0) return null;
      const { error } = await db.storage.from(LIBRARY_BUCKET).remove(paths);
      return error?.message ?? null;
    },
  };
}

function fieldsFrom(formData: FormData): SittingFields {
  const text = (name: string) => String(formData.get(name) ?? "");
  return {
    id: text("id"),
    title: text("title"),
    description: text("description"),
    subjects: text("subjects"),
    topics: text("topics"),
    concepts: text("concepts"),
    params: text("params"),
    events: text("events"),
    entry: text("entry"),
    ageYoungest: text("ageYoungest"),
    ageOldest: text("ageOldest"),
    objective: text("objective"),
    summary: text("summary"),
    tutorIntro: text("tutorIntro"),
  };
}

export async function previewSitting(_prev: PreviewResult | null, formData: FormData): Promise<PreviewResult> {
  const { actor, userId } = await currentStudioActor();
  const file = formData.get("zip");
  const zip = file instanceof File && file.size > 0 ? new Uint8Array(await file.arrayBuffer()) : undefined;
  const fields = fieldsFrom(formData);
  let manifest: Record<string, unknown>;
  try {
    manifest = sittingManifest(fields);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The manifest fields are not valid.";
    return { type: "invalid", errors: [{ code: "manifest", message }], warnings: [] };
  }
  if (zip) manifest.format = "bundle";
  return previewNewArtifact(actor, { html: String(formData.get("html") ?? ""), zip, manifest, actorId: userId }, storage());
}

export async function previewNextSitting(artifactId: string, _prev: PreviewResult | null, formData: FormData): Promise<PreviewResult> {
  const { actor, userId } = await currentStudioActor();
  const file = formData.get("zip");
  const zip = file instanceof File && file.size > 0 ? new Uint8Array(await file.arrayBuffer()) : undefined;
  return previewNextVersion(
    actor,
    { artifactId, fields: fieldsFrom(formData), html: String(formData.get("html") ?? ""), zip, actorId: userId },
    storage(),
  );
}

export async function publishSitting(artifactId: string, version: number, ready: boolean) {
  const { actor, userId } = await currentStudioActor();
  return publishPreview(actor, { artifactId, version, ready, actorId: userId }, { db: createServiceClient() });
}

export async function abandonSitting(artifactId: string, version: number) {
  const { actor } = await currentStudioActor();
  return abandonPreview(actor, artifactId, version, storage());
}
