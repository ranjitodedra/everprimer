import type { ArtifactBlueprint } from "@eco/contracts";
import { LEARNKIT_RUNTIME_SOURCE } from "./runtime";
import { PLAYER_CSS, PLAYER_SOURCE } from "./player";

/**
 * Content Security Policy baked into every artifact document. Combined with
 * `sandbox="allow-scripts"` on the host iframe this means: inline code only,
 * no network egress, no frames, no forms posting anywhere.
 */
export const ARTIFACT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

/** Safely embed JSON inside a <script> block. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hexLuminance(hex: string): number {
  const n = hex.replace("#", "");
  if (n.length !== 6) return 1;
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function themeSurface(bp: ArtifactBlueprint): { ink: string; muted: string; card: string; line: string; dark: boolean } {
  const dark = hexLuminance(bp.theme.background) < 0.45;
  return dark
    ? { ink: "#f5f5f4", muted: "#d6d3d1", card: "#1c1c4a", line: "#4a4a8a", dark: true }
    : { ink: "#1f2a24", muted: "#5f6b64", card: "#ffffff", line: "#e5dfd2", dark: false };
}

/** Pull inline <script> bodies, skipping the injected LearnKit runtime. */
export function authoredScripts(html: string): string[] {
  const authored = html.includes("window.LearnKit = {") ? html.replace(LEARNKIT_RUNTIME_SOURCE, "") : html;
  const out: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(authored))) {
    if (/\bsrc\s*=/i.test(m[1] ?? "")) continue;
    const body = (m[2] ?? "").trim();
    if (body) out.push(body);
  }
  return out;
}

function scriptSyntaxError(source: string): string | null {
  try {
    // Parses as a function body. Catches the Gemini failure mode: CSS var()
    // interpolated into a JS template literal (`stroke="${var(--x)}"`).
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(source);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

const VIEWPORT_META = `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">`;
const TOUCH_GUARD_STYLE = `<style data-lk-touch>html,body,a,button,input,select,textarea,label,[role="button"]{touch-action:manipulation}</style>`;

/**
 * Stop double-tap and pinch zoom inside the lesson iframe. The host page's
 * viewport and touch-action do not reach into the srcdoc document.
 */
export function withTouchGuards(html: string): string {
  let out = html.replace(/<meta[^>]+name=["']viewport["'][^>]*>\s*/gi, "");
  if (!/<head[\s>]/i.test(out)) return out;
  const tags = out.includes("data-lk-touch") ? VIEWPORT_META : `${VIEWPORT_META}\n${TOUCH_GUARD_STYLE}`;
  const csp = out.match(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i);
  const head = out.match(/<head[^>]*>/i)!;
  const anchor = csp && csp.index! > head.index! ? csp : head;
  const at = anchor.index! + anchor[0].length;
  out = `${out.slice(0, at)}\n${tags}${out.slice(at)}`;
  return out;
}

/** Deterministic, complete lesson document driven purely by the blueprint. */
export function renderBlueprintHtml(bp: ArtifactBlueprint): string {
  const surface = themeSurface(bp);
  const themeVars = `:root{--lk-primary:${bp.theme.primary};--lk-accent:${bp.theme.accent};--lk-bg:${bp.theme.background};--lk-ink:${surface.ink};--lk-muted:${surface.muted};--lk-card:${surface.card};--lk-line:${surface.line};}`;
  return withTouchGuards(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">
<title>${escapeHtml(bp.title)}</title>
<style>${PLAYER_CSS}${themeVars}</style>
</head>
<body class="${surface.dark ? "lk-dark" : ""}">
<div id="app" aria-live="off"></div>
<script>${LEARNKIT_RUNTIME_SOURCE}</script>
<script>window.__BLUEPRINT__=${jsonForScript(bp)};</script>
<script>${PLAYER_SOURCE}</script>
</body>
</html>`);
}

/**
 * Make a model-generated document conform to the runtime contract:
 * ensure the CSP meta and the LearnKit runtime are present, as the first
 * things in <head> and the first script respectively.
 */
export function normalizeGeneratedHtml(html: string): string {
  let out = html.trim();
  if (!/^<!doctype html>/i.test(out)) out = `<!doctype html>\n${out}`;
  if (!/<html[\s>]/i.test(out)) out = out.replace(/^<!doctype html>\s*/i, `<!doctype html>\n<html lang="en">`) + "\n</html>";
  if (!/<head[\s>]/i.test(out)) out = out.replace(/<html([^>]*)>/i, `<html$1>\n<head></head>`);

  // Strip any CSP the model wrote and inject ours.
  out = out.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, "");
  out = out.replace(/<head([^>]*)>/i, `<head$1>\n<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`);
  out = withTouchGuards(out);

  // Remove any runtime the model tried to include (script src pointing at learnkit, or an inline copy).
  out = out.replace(/<script[^>]+src=["'][^"']*learnkit[^"']*["'][^>]*>\s*<\/script>/gi, "");
  const runtimeTag = `<script>${LEARNKIT_RUNTIME_SOURCE}</script>`;
  if (!out.includes("window.LearnKit = {")) {
    // Place runtime as the first script in the document.
    const firstScript = out.search(/<script[\s>]/i);
    if (firstScript >= 0) out = out.slice(0, firstScript) + runtimeTag + "\n" + out.slice(firstScript);
    else out = out.replace(/<\/body>/i, `${runtimeTag}\n</body>`);
  }
  return out;
}

export interface HtmlValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Static checks that a generated document respects the sandbox contract.
 * Anything in `errors` blocks publishing; `warnings` are recorded only.
 */
export function validateArtifactHtml(html: string): HtmlValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lower = html.toLowerCase();
  const hasRuntime = html.includes("window.LearnKit = {");
  // Author code = everything except the injected runtime.
  const authored = hasRuntime ? html.replace(LEARNKIT_RUNTIME_SOURCE, "") : html;

  if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) errors.push("document is not a complete <html> document");
  if (!hasRuntime) errors.push("LearnKit runtime missing");
  if (!/\bLearnKit\b/.test(authored) || !/\.emit\(/.test(authored)) errors.push("artifact never emits LearnKit events");
  if (!/["']question_answered["']/.test(authored)) errors.push("artifact never emits question_answered (no knowledge check)");
  if (!/["']topic_completed["']/.test(authored)) errors.push("artifact never emits topic_completed");

  const externalSrc = html.match(/<(script|link|img|iframe|video|audio|source|object|embed)[^>]+(src|href)=["'](https?:)?\/\//gi);
  if (externalSrc) errors.push(`external resources are not allowed (${externalSrc.length} found)`);
  if (/<iframe[\s>]/i.test(html)) errors.push("nested iframes are not allowed");
  if (/\bfetch\s*\(/.test(html) || /XMLHttpRequest/.test(html) || /WebSocket\s*\(/.test(html) || /navigator\.sendBeacon/.test(html)) {
    errors.push("network calls (fetch/XHR/WebSocket/sendBeacon) are not allowed");
  }
  if (/\bimport\s*\(/.test(html) || /<script[^>]+type=["']module["']/i.test(html)) warnings.push("ES module syntax found; make sure nothing is imported from the network");
  if (/document\.cookie|localStorage|sessionStorage|indexedDB/.test(html)) warnings.push("storage APIs are unavailable in the sandbox and will throw");
  if (/window\.top|window\.parent\.document|parent\.location/.test(html)) errors.push("artifact must not touch the host window");
  if (!lower.includes("prefers-reduced-motion") && !lower.includes("reducedmotion")) warnings.push("no reduced-motion handling found");
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) warnings.push("missing viewport meta");
  if (html.length > 400_000) warnings.push("document is very large (>400KB)");

  for (const [i, source] of authoredScripts(html).entries()) {
    const syntax = scriptSyntaxError(source);
    if (syntax) errors.push(`authored script ${i + 1} has a JavaScript syntax error (${syntax})`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
