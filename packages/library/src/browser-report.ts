import type { ArtifactManifest } from "@eco/contracts";

export interface BrowserFinding {
  code:
    | "ready_timeout"
    | "uncaught_exception"
    | "console_error"
    | "fatal_error"
    | "foreign_request"
    | "failed_request"
    | "missing_webgl"
    | "console_warn"
    | "console_log"
    | "ak_error"
    | "autofocus"
    | "favicon";
  message: string;
}

export interface BrowserViewportReport {
  name: "phone" | "desktop";
  width: number;
  height: number;
  readyMs: number | null;
  webglCreated: boolean;
  heapBytes: number | null;
  frameCount: number | null;
  findings: BrowserFinding[];
}

export interface BrowserReport {
  ok: boolean;
  bundleSha256: string;
  webgl: boolean;
  params: Record<string, unknown>;
  /** Object path of the stored desktop PNG. Null until Studio stores it. */
  thumbnailPath: string | null;
  viewports: BrowserViewportReport[];
}

export interface BrowserCheckResult {
  report: BrowserReport;
  /** PNG bytes of the desktop iframe. Null when that viewport never becomes ready. */
  thumbnail: Uint8Array | null;
}

/** The parameter defaults a lesson sends in ak-init. */
export function defaultParams(manifest: ArtifactManifest): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const param of manifest.params) params[param.key] = param.default;
  return params;
}

function sameValue(got: unknown, expected: unknown): boolean {
  return JSON.stringify(got) === JSON.stringify(expected);
}

function sameParams(got: unknown, expected: Record<string, unknown>): boolean {
  if (got == null || typeof got !== "object" || Array.isArray(got)) return false;
  const record = got as Record<string, unknown>;
  const keys = Object.keys(expected);
  if (Object.keys(record).length !== keys.length) return false;
  return keys.every((key) => sameValue(record[key], expected[key]));
}

/**
 * Why this report cannot publish this version.
 * A title change is ignored. The bundle hash, WebGL flag, and parameter defaults are not.
 */
export function browserReportProblems(report: unknown, manifest: ArtifactManifest, bundleSha256: string): string[] {
  if (report == null || typeof report !== "object" || Array.isArray(report)) return ["browser report is missing"];
  const fields = report as Partial<BrowserReport>;
  const problems: string[] = [];
  if (fields.ok !== true) problems.push("browser report did not pass");
  if (fields.bundleSha256 !== bundleSha256) problems.push("browser report does not match the bundle");
  if (fields.webgl !== manifest.rendering.webgl) problems.push("browser report does not match the WebGL flag");
  if (!sameParams(fields.params, defaultParams(manifest))) problems.push("browser report does not match the parameter defaults");
  return problems;
}
