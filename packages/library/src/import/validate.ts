/**
 * Static validation of a normalized library bundle.
 *
 * Composes the shared sandbox rules from `@eco/learnkit` with library-specific
 * checks: the entry file exists, every local reference in the entry HTML
 * resolves to a bundle file or a vendored `/v/…` path, and nothing calls the
 * APIs the sandbox blocks. The code-level compliance signal (does any inline
 * script call `ArtifactKit.emit`?) is returned alongside the errors so the
 * Studio can compare it to the manifest-declared compliance level.
 */

import { checkSandboxBasics, scriptSyntaxError } from "@eco/learnkit";
import type { ArtifactManifest } from "@eco/contracts";
import { ARTIFACTKIT_RUNTIME_SOURCE } from "../runtime";
import type { ImportError, ImportWarning, InMemoryFile } from "./types";

export interface ValidateInput {
  manifest: ArtifactManifest;
  files: InMemoryFile[];
  /** The entry HTML text after rewriting and ArtifactKit injection. */
  entryHtml: string;
}

export interface ValidateResult {
  errors: ImportError[];
  warnings: ImportWarning[];
  /** True when any inline script calls `ArtifactKit.emit(`, used as the code-level L1 estimate. */
  callsEmit: boolean;
}

function err(code: string, message: string, file?: string): ImportError {
  return file ? { code, message, file } : { code, message };
}

function warn(code: string, message: string, file?: string): ImportWarning {
  return file ? { code, message, file } : { code, message };
}

/** Local HTML references we expect to resolve against the bundle (relative src/href). */
function extractLocalRefs(html: string): string[] {
  const refs = new Set<string>();
  const re = /\b(?:src|href)=["']([^"'#?]+)(?:[?#][^"']*)?["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const value = m[1]!;
    if (!value || value === "#") continue;
    if (/^(?:https?:|data:|blob:|mailto:|tel:)/i.test(value)) continue;
    if (value.startsWith("//")) continue;
    if (value.startsWith("/v/")) continue; // vendored prefix served by Stage 4
    refs.add(value.replace(/^\.\//, "").replace(/^\//, ""));
  }
  return [...refs];
}

function fileIndex(files: InMemoryFile[]): Set<string> {
  return new Set(files.map((f) => f.path));
}

export function validateLibraryBundle(input: ValidateInput): ValidateResult {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  const paths = fileIndex(input.files);

  if (!paths.has(input.manifest.entry)) {
    errors.push(err("missing-entry", `manifest entry "${input.manifest.entry}" is not in the bundle`));
  }

  const basicErrors: string[] = [];
  checkSandboxBasics(input.entryHtml, basicErrors);
  // Syntax-check inline classic scripts only. ES modules use top-level `import`,
  // which `new Function(body)` cannot parse; we rely on the browser to catch
  // genuine module syntax errors during Stage 6's Playwright harness.
  const stripped = input.entryHtml.split(ARTIFACTKIT_RUNTIME_SOURCE).join("");
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let scriptMatch: RegExpExecArray | null;
  let index = 0;
  while ((scriptMatch = scriptRe.exec(stripped))) {
    index++;
    const attrs = scriptMatch[1] ?? "";
    const body = (scriptMatch[2] ?? "").trim();
    if (!body) continue;
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/type\s*=\s*["'](?:module|importmap|application\/json)["']/i.test(attrs)) continue;
    const syntax = scriptSyntaxError(body);
    if (syntax) basicErrors.push(`authored script ${index} has a JavaScript syntax error (${syntax})`);
  }
  for (const message of basicErrors) errors.push(err("sandbox-violation", message, input.manifest.entry));

  for (const ref of extractLocalRefs(input.entryHtml)) {
    if (!paths.has(ref)) {
      errors.push(
        err("missing-local-file", `entry HTML references "${ref}" but the bundle has no such file`, input.manifest.entry),
      );
    }
  }

  if (/window\.open\s*\(/.test(input.entryHtml)) {
    errors.push(err("sandbox-violation", "window.open is blocked by the artifact sandbox", input.manifest.entry));
  }
  if (/\beval\s*\(/.test(input.entryHtml)) {
    errors.push(err("sandbox-violation", "eval() is blocked by the artifact sandbox", input.manifest.entry));
  }

  // ADR-003: storage APIs throw inside opaque-origin sandboxes unless wrapped in try/catch.
  const storageRe = /(localStorage|sessionStorage|indexedDB)/g;
  let m: RegExpExecArray | null;
  let warnedStorage = false;
  while (!warnedStorage && (m = storageRe.exec(input.entryHtml))) {
    const context = input.entryHtml.slice(Math.max(0, m.index - 80), m.index);
    if (!/\btry\s*\{/.test(context)) {
      warnings.push(
        warn(
          "unguarded-storage",
          `${m[1]} access is not wrapped in try/catch; it will throw inside the sandbox`,
          input.manifest.entry,
        ),
      );
      warnedStorage = true;
    }
  }

  if (!/prefers-reduced-motion|reducedMotion/i.test(input.entryHtml) && input.manifest.accessibility.reducedMotion) {
    warnings.push(
      warn(
        "no-reduced-motion-handling",
        "manifest declares reducedMotion support but the entry HTML has no matching code",
        input.manifest.entry,
      ),
    );
  }

  const callsEmit = /ArtifactKit\.emit\s*\(/.test(input.entryHtml);

  return { errors, warnings, callsEmit };
}
