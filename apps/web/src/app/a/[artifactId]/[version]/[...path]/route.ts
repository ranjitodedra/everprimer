import { NextResponse } from "next/server";
import { LibraryArtifactId } from "@eco/contracts";
import { LIBRARY_BUCKET, bundleObjectPath, getArtifact, isSafeObjectPath } from "@eco/library";
import {
  allowHtmlEntry,
  buildArtifactHeaders,
  parseDraftTokenFromQuery,
  verifyDraftToken,
} from "@/lib/artifact-headers";
import { getArtifactOrigin, isArtifactHost } from "@/lib/artifact-host";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Serves one file from a library artifact bundle. Every byte goes out with the
 * ADR-001 headers (sandboxed CSP naming the artifact origin, cross-origin CORS,
 * `nosniff`, `no-referrer`). Published and retired versions are public and
 * immutably cached. Drafts and testing versions need a short-lived HMAC token
 * and are served `no-store`.
 *
 * This route only answers on the artifact host. The middleware already 404s
 * `/a/*` on the app host, but we check again here because middleware is
 * excluded from some static-asset matchers.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ artifactId: string; version: string; path: string[] }> },
) {
  if (!isArtifactHost(req)) return notFound();

  const origin = getArtifactOrigin();
  if (!origin) return notFound();

  const { artifactId, version: versionRaw, path: pathSegments } = await ctx.params;

  if (!LibraryArtifactId.safeParse(artifactId).success) return notFound();
  const version = Number(versionRaw);
  if (!Number.isInteger(version) || version < 1) return notFound();

  const filePath = (pathSegments ?? []).join("/");
  if (!filePath || !isSafeObjectPath(filePath)) return notFound();

  const db = createServiceClient();
  const loaded = await getArtifact(db, artifactId, version);
  if (!loaded.ok) return notFound();
  const row = loaded.version;

  const file = row.files.find((f) => f.path === filePath);
  if (!file) return notFound();

  // Draft / testing versions are gated by a signed query token. Published and
  // retired versions are public by id and version.
  const immutable = row.status === "published" || row.status === "retired";
  if (!immutable) {
    const token = parseDraftTokenFromQuery(new URL(req.url).searchParams);
    if (!verifyDraftToken(artifactId, version, token)) return notFound();
  }

  // HTML entry files are not valid top-level pages. This blocks phishing use
  // of the artifact domain without blocking the real iframe-embed path.
  const isHtml = /^text\/html(?:$|;)/i.test(file.mime);
  if (isHtml && !allowHtmlEntry(req)) return notFound();

  const objectPath = bundleObjectPath(artifactId, version, filePath);
  const { data, error } = await db.storage.from(LIBRARY_BUCKET).download(objectPath);
  if (error || !data) return notFound();

  const bytes = new Uint8Array(await data.arrayBuffer());
  const headers = buildArtifactHeaders(origin, {
    contentType: file.mime,
    contentLength: bytes.byteLength,
    immutable,
  });
  return new NextResponse(bytes, { status: 200, headers });
}

function notFound(): NextResponse {
  // No artifact headers on 404: the response body is empty and we don't want
  // to help a probe tell "wrong token" from "no such file".
  return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}
