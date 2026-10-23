import { artifactHostEnv } from "./env";

/**
 * Host-based routing for the artifact origin, per ADR-001. Lets `proxy.ts` and
 * the artifact routes answer disjoint sets of requests on each hostname even
 * though a single Next server handles both.
 *
 * `isArtifactHost` is intentionally conservative: when `ARTIFACT_ORIGIN` is not
 * set the library feature is disabled, so no request can be on "the artifact
 * host" and every request is treated as the app.
 */

export function getArtifactOrigin(): string | null {
  return artifactHostEnv.origin;
}

export function getArtifactHost(): string | null {
  return artifactHostEnv.host;
}

export function isArtifactHost(request: { headers: Pick<Headers, "get"> }): boolean {
  const host = getArtifactHost();
  if (!host) return false;
  const requestHost = request.headers.get("host");
  if (!requestHost) return false;
  return requestHost.toLowerCase() === host.toLowerCase();
}

/** True for a path the artifact origin is allowed to serve. */
export function isArtifactRoutePath(pathname: string): boolean {
  return pathname === "/a" || pathname.startsWith("/a/");
}
