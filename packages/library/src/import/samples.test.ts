/**
 * Golden tests against the five real AI outputs collected in Stage 0.
 *
 * Lives under `Docs/artifact-library/decisions/evidence/stage-0/samples/`, so
 * these tests both verify ADR-003 is implemented correctly and keep the
 * samples useful as a regression suite. A new sample is a drop-in file: the
 * test discovers them from disk.
 *
 * Expectations per sample come from ADR-003's table of outputs.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { solarSystemManifest } from "@eco/contracts/testing";
import { importArtifact } from "./index";
import { resolveFileMime } from "./mime";
import type { InMemoryFile } from "./types";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SAMPLES_ROOT = join(HERE, "..", "..", "..", "..", "Docs", "artifact-library", "decisions", "evidence", "stage-0", "samples");

interface Expectation {
  entry: string;
  fontsWarning: boolean;
  /** How many jsdelivr/cdnjs rewrites we expect (at least this many). */
  minRewrites: number;
}

const EXPECT: Record<string, Expectation> = {
  "opus-solar-single": { entry: "index.html", fontsWarning: true, minRewrites: 1 },
  "gemini-solar-single": { entry: "index.html", fontsWarning: true, minRewrites: 1 },
  "gemini-cell-multi": { entry: "index.html", fontsWarning: true, minRewrites: 1 },
  "gemini-lever-single": { entry: "index.html", fontsWarning: true, minRewrites: 1 },
  "opus-circuit-multi": { entry: "index.html", fontsWarning: false, minRewrites: 0 },
};

function walk(root: string, dir: string = root): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...walk(root, abs));
    else out.push(relative(root, abs).replace(/\\/g, "/"));
  }
  return out;
}

function readSample(dir: string): InMemoryFile[] {
  const paths = walk(dir);
  const files: InMemoryFile[] = [];
  for (const path of paths) {
    const bytes = new Uint8Array(readFileSync(join(dir, path)));
    const mime = resolveFileMime(path, bytes);
    if (!mime.ok) throw new Error(`sample ${dir}/${path} mime check failed: ${mime.reason}`);
    files.push({ path, bytes, mime: mime.mime });
  }
  return files;
}

function manifestFor(sampleId: string, files: InMemoryFile[]): unknown {
  const base = solarSystemManifest();
  return {
    ...base,
    id: sampleId,
    title: sampleId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60),
    format: files.length === 1 ? "html" : "bundle",
    entry: "index.html",
  };
}

describe("Stage 0 samples import cleanly after rewriting", () => {
  for (const [sampleId, expect_] of Object.entries(EXPECT)) {
    it(`${sampleId}: imports with the expected changes`, async () => {
      const files = readSample(join(SAMPLES_ROOT, sampleId));
      const manifest = manifestFor(sampleId, files);
      const r = await importArtifact({ kind: "files", files }, { manifest, actor: null });
      if (!r.ok) {
        throw new Error(`sample ${sampleId} failed to import: ${JSON.stringify(r.errors, null, 2)}`);
      }
      expect(r.normalized!.files.some((f) => f.path === expect_.entry)).toBe(true);
      const rewrites = r.normalized!.changes.filter((c) => c.rule === "jsdelivr" || c.rule === "cdnjs" || c.rule === "unpkg" || c.rule === "import-map");
      expect(rewrites.length).toBeGreaterThanOrEqual(expect_.minRewrites);
      const hasFontsWarning = r.warnings.some((w) => w.code === "google-fonts-stripped");
      expect(hasFontsWarning).toBe(expect_.fontsWarning);
    });
  }
});
