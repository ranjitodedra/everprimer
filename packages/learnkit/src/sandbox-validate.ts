/**
 * Shared static checks for HTML that will run inside our sandboxed iframes.
 *
 * Used by both the lesson validator (`validateArtifactHtml` in `html.ts`) and
 * the Stage 3 library importer. Each caller composes these primitives with its
 * own domain-specific rules; this module stays free of lesson or library
 * concepts so the two call sites cannot drift apart.
 */

export interface SandboxFinding {
  message: string;
}

/** Extract inline <script> bodies from an HTML string, skipping scripts with a `src` attribute. */
export function extractInlineScripts(html: string, stripSources: string[] = []): string[] {
  let authored = html;
  for (const s of stripSources) authored = authored.split(s).join("");
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

/** Parse a script body as a Function to catch JS syntax errors. Returns the message, or null when the source parses. */
export function scriptSyntaxError(source: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    new Function(source);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

/** Hard sandbox contract that applies to any document we drop into an iframe (lessons and library artifacts alike). */
export interface SandboxBasicsOptions {
  /** When true, require a complete <html>…</html> document. Default: true. */
  requireFullDocument?: boolean;
  /** When true, flag http(s) `src`/`href` on script/link/img/iframe/video/audio/source/object/embed. Default: true. */
  rejectExternalResources?: boolean;
  /** When true, flag nested <iframe>. Default: true. */
  rejectNestedIframes?: boolean;
  /** When true, flag `window.top`, `window.parent.document`, `parent.location`. Default: true. */
  rejectParentAccess?: boolean;
}

/** The generic sandbox rules. Appends problems to `errors` so callers can mix in their own. */
export function checkSandboxBasics(
  html: string,
  errors: string[],
  options: SandboxBasicsOptions = {},
): void {
  const {
    requireFullDocument = true,
    rejectExternalResources = true,
    rejectNestedIframes = true,
    rejectParentAccess = true,
  } = options;

  if (requireFullDocument && (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html))) {
    errors.push("document is not a complete <html> document");
  }
  if (rejectExternalResources) {
    const externalSrc = html.match(
      /<(script|link|img|iframe|video|audio|source|object|embed)[^>]+(src|href)=["'](https?:)?\/\//gi,
    );
    if (externalSrc) errors.push(`external resources are not allowed (${externalSrc.length} found)`);
  }
  if (rejectNestedIframes && /<iframe[\s>]/i.test(html)) {
    errors.push("nested iframes are not allowed");
  }
  if (rejectParentAccess && /window\.top|window\.parent\.document|parent\.location/.test(html)) {
    errors.push("artifact must not touch the host window");
  }
}

/** Check that every inline <script> body parses. `stripSources` lets callers skip injected runtime text. */
export function checkInlineScriptSyntax(html: string, errors: string[], stripSources: string[] = []): void {
  for (const [i, source] of extractInlineScripts(html, stripSources).entries()) {
    const syntax = scriptSyntaxError(source);
    if (syntax) errors.push(`authored script ${i + 1} has a JavaScript syntax error (${syntax})`);
  }
}
