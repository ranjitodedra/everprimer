/**
 * Make an uploaded entry HTML conform to the library runtime contract.
 *
 * Mirrors `normalizeGeneratedHtml` from `@eco/learnkit` for lessons but for
 * library artifacts:
 *
 *   - ensures a `<!doctype html>`, `<html>`, `<head>`, `<meta viewport>`
 *   - strips any CSP the author wrote (Stage 4 adds the real one via headers)
 *   - removes any `<script src=…artifactkit…>` the author tried to include
 *   - places the ArtifactKit runtime as the first script in the document
 *
 * Does NOT add a `<meta>` CSP: library artifacts rely on headers from the
 * Stage 4 artifact-origin route plus the hosting iframe's `sandbox` attribute.
 * Adding a meta CSP here would double up and risk conflicting with headers.
 */

import { ARTIFACTKIT_RUNTIME_SOURCE } from "../runtime";

const VIEWPORT_META = `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`;

function hasHtml(html: string): boolean {
  return /<html[\s>]/i.test(html);
}

function hasHead(html: string): boolean {
  return /<head[\s>]/i.test(html);
}

/** Normalize an authored or AI-generated HTML document into the shape the sandbox expects. */
export function injectArtifactKit(html: string): string {
  let out = html.trim();
  if (!/^<!doctype html>/i.test(out)) out = `<!doctype html>\n${out}`;
  if (!hasHtml(out)) {
    out = out.replace(/^<!doctype html>\s*/i, `<!doctype html>\n<html lang="en">\n`) + "\n</html>";
  }
  if (!hasHead(out)) {
    out = out.replace(/<html([^>]*)>/i, `<html$1>\n<head></head>`);
  }

  // Strip any author-written CSP; the real one comes from Stage 4 headers.
  out = out.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>\s*/gi, "");

  // Ensure a mobile viewport. Authored viewports are left alone (artifacts
  // may legitimately disable zoom for interactive scenes).
  if (!/<meta[^>]+name=["']viewport["']/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>\n${VIEWPORT_META}`);
  }

  // Remove any author attempt to load an external ArtifactKit script.
  out = out.replace(/<script[^>]+src=["'][^"']*artifactkit[^"']*["'][^>]*>\s*<\/script>\s*/gi, "");

  if (!out.includes(ARTIFACTKIT_RUNTIME_SOURCE)) {
    const runtimeTag = `<script>${ARTIFACTKIT_RUNTIME_SOURCE}</script>`;
    const firstScript = out.search(/<script[\s>]/i);
    if (firstScript >= 0) out = out.slice(0, firstScript) + runtimeTag + "\n" + out.slice(firstScript);
    else if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, `${runtimeTag}\n</body>`);
    else if (/<\/html>/i.test(out)) out = out.replace(/<\/html>/i, `${runtimeTag}\n</html>`);
    else out = `${out}\n${runtimeTag}`;
  }

  return out;
}
