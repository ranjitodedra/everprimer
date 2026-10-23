import { createHmac, timingSafeEqual } from "node:crypto";
import { artifactHostEnv } from "@/lib/env";

/**
 * Response headers for every file the artifact origin serves, per
 * Docs/artifact-library/decisions/ADR-001-artifact-origin.md.
 *
 * Why the artifact origin is named explicitly instead of `'self'`:
 * sandboxed documents have an opaque origin, and WebKit then matches `'self'`
 * against nothing, breaking the artifact's own `fetch`. Chromium matches
 * `'self'` to the URL origin, so naming the origin is the only form that
 * works in both engines, and iOS is WebKit-only.
 *
 * Why `Access-Control-Allow-Origin: *` is safe here: from an opaque origin,
 * even same-origin `<script type="module">` and `fetch` go out in CORS mode
 * with `Origin: null`. Published files are public by id and version and hold
 * no learner data, so public CORS is appropriate.
 *
 * Why no `frame-ancestors`: lessons embed artifacts from a sandboxed `srcdoc`
 * document (also an opaque origin). Every `frame-ancestors` value blocks that
 * embedding in Chromium and WebKit, so the directive is useless here.
 */
export interface ArtifactHeadersInput {
  /** The file's content type (from the stored file entry). */
  contentType: string;
  /** Byte length of the response body. */
  contentLength: number;
  /** `published` and `retired` are immutable and publicly cacheable; drafts are not. */
  immutable: boolean;
}

export function buildArtifactHeaders(origin: string, input: ArtifactHeadersInput): Headers {
  const h = new Headers();
  h.set("Content-Type", input.contentType);
  h.set("Content-Length", String(input.contentLength));
  h.set("Content-Security-Policy", buildCsp(origin));
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Cross-Origin-Resource-Policy", "cross-origin");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set(
    "Cache-Control",
    input.immutable ? "public, max-age=31536000, immutable" : "private, no-store",
  );
  return h;
}

export function buildCsp(origin: string): string {
  const ao = origin;
  return [
    "sandbox allow-scripts",
    `default-src ${ao}`,
    `script-src ${ao} 'unsafe-inline'`,
    `style-src ${ao} 'unsafe-inline'`,
    `img-src ${ao} data: blob:`,
    `media-src ${ao} data: blob:`,
    `font-src ${ao} data:`,
    `connect-src ${ao}`,
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/**
 * HTML entry files are only served when the request looks like an iframe load.
 * `Sec-Fetch-Dest: iframe` (or `frame`) covers the real embedding path; a
 * missing header covers old browsers and non-browser clients (curl, image
 * previewers). We reject `Sec-Fetch-Dest: document` to stop top-level phishing
 * pages served from the artifact domain.
 */
export function allowHtmlEntry(request: Request): boolean {
  const dest = request.headers.get("sec-fetch-dest");
  if (!dest) return true;
  return dest === "iframe" || dest === "frame";
}

/**
 * Draft previews are gated by an HMAC-SHA256 signature over `${id}:${version}:${expiry}`.
 * The expiry is a unix timestamp in seconds. Rotating `ARTIFACT_DRAFT_SECRET`
 * invalidates every outstanding link. Verification is constant-time to deny a
 * timing oracle on the signature.
 */
export interface DraftToken {
  expiry: number;
  signature: string;
}

export function signDraftToken(artifactId: string, version: number, expirySeconds: number, secret: string): DraftToken {
  if (!secret) throw new Error("ARTIFACT_DRAFT_SECRET is not set");
  const payload = `${artifactId}:${version}:${expirySeconds}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return { expiry: expirySeconds, signature };
}

export function verifyDraftToken(
  artifactId: string,
  version: number,
  token: { expiry: number; signature: string } | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const secret = artifactHostEnv.draftSecret;
  if (!secret) return false;
  if (!token) return false;
  if (!Number.isFinite(token.expiry) || token.expiry <= nowSeconds) return false;
  if (typeof token.signature !== "string" || !/^[0-9a-f]{64}$/i.test(token.signature)) return false;
  const expected = createHmac("sha256", secret)
    .update(`${artifactId}:${version}:${token.expiry}`)
    .digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(token.signature, "hex");
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function parseDraftTokenFromQuery(search: URLSearchParams): { expiry: number; signature: string } | null {
  const t = search.get("t");
  const e = search.get("e");
  if (!t || !e) return null;
  const expiry = Number(e);
  if (!Number.isFinite(expiry)) return null;
  return { expiry, signature: t };
}
