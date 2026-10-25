import { realpathSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { LibraryFileEntry } from "@eco/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { complianceLevel, parseManifest, type ArtifactManifest } from "@eco/contracts";
import type { BrowserReport } from "./browser-report";
import { runBrowserCheck, type BrowserProbeStep } from "./browser-check";
import { recordBrowserReport, registerDraft } from "./catalog";
import { importArtifact } from "./import";
import { mimeFromExtension } from "./import/mime";
import type { InMemoryFile } from "./import/types";

const BESIDE = new Set(["manifest.json", "probe.json"]);

function resultLine(fields: {
  id: string;
  level?: number;
  ok?: boolean;
  phone?: number | null;
  desktop?: number | null;
  accepted?: string[];
  dropped?: string[];
  param?: { key: string; value: unknown };
  reducedMotion?: boolean;
}): string {
  const names = (values?: string[]) => (values && values.length ? values.join(",") : "-");
  const time = (value: number | null | undefined) => (typeof value === "number" ? String(value) : "-");
  const ok = fields.ok == null ? "-" : fields.ok ? "true" : "false";
  const parts = [
    `id=${fields.id}`,
    `level=${fields.level ?? "-"}`,
    `ok=${ok}`,
    `phone=${time(fields.phone)}`,
    `desktop=${time(fields.desktop)}`,
    `accepted=${names(fields.accepted)}`,
    `dropped=${names(fields.dropped)}`,
  ];
  if (fields.param) parts.push(`param=${fields.param.key}=${String(fields.param.value)}`);
  if (fields.reducedMotion) parts.push("reducedMotion=true");
  return parts.join(" ");
}

export interface SeedCheckOptions {
  /** One `key=value` override, sent before the page is told it is ready. */
  param?: string;
  /** Ask the page to mark reduced motion. The browser report stays ok only when it does. */
  reducedMotion?: boolean;
}

function paramOverride(manifest: ArtifactManifest, raw: string | undefined): { key: string; value: unknown } | undefined {
  if (!raw) return undefined;
  const eq = raw.indexOf("=");
  if (eq <= 0) return undefined;
  const key = raw.slice(0, eq);
  const text = raw.slice(eq + 1);
  const declared = manifest.params.find((param) => param.key === key);
  if (declared?.type === "number") return { key, value: Number(text) };
  if (declared?.type === "boolean") return { key, value: text === "true" };
  return { key, value: text };
}

function parseProbe(value: unknown): BrowserProbeStep[] | null {
  if (!Array.isArray(value)) return null;
  const steps: BrowserProbeStep[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length !== 1) return null;
    const key = keys[0];
    const raw = key ? record[key] : undefined;
    if (typeof raw !== "string" || !raw || !key) return null;
    if (key === "click") steps.push({ click: raw });
    else if (key === "expect") steps.push({ expect: raw });
    else if (key === "emit") steps.push({ emit: raw });
    else return null;
  }
  return steps;
}

async function bundleFiles(dir: string, prefix = ""): Promise<InMemoryFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: InMemoryFile[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await bundleFiles(full, rel)));
      continue;
    }
    if (!prefix && BESIDE.has(entry.name)) continue;
    const bytes = new Uint8Array(await readFile(full));
    files.push({ path: rel, bytes, mime: mimeFromExtension(rel) ?? "application/octet-stream" });
  }
  return files;
}

interface SeedOutcome {
  code: number;
  line: string;
  draft?: {
    manifest: ArtifactManifest;
    files: LibraryFileEntry[];
    bundleSha256: string;
    report: BrowserReport;
  };
}

/**
 * Seed check prints one line and returns the process exit code.
 * It does not write to the catalog.
 */
export async function runSeedCheck(dir: string, options: SeedCheckOptions = {}): Promise<number> {
  const outcome = await inspectSeed(dir, options);
  console.log(outcome.line);
  return outcome.code;
}

/** Runs the same check, stores its browser report on a draft, and does not publish a version. */
export async function runSeedLoad(dir: string, db: SupabaseClient, options: SeedCheckOptions = {}): Promise<number> {
  const outcome = await inspectSeed(dir, options);
  console.log(outcome.line);
  if (outcome.code === 0 && outcome.draft) {
    const registered = await registerDraft(db, {
      manifest: outcome.draft.manifest,
      files: outcome.draft.files,
      bundleSha256: outcome.draft.bundleSha256,
      actor: null,
    });
    if (registered.ok) await recordBrowserReport(db, registered.artifactId, registered.version, outcome.draft.report);
  }
  return outcome.code;
}

async function inspectSeed(dir: string, options: SeedCheckOptions): Promise<SeedOutcome> {
  const fallbackId = path.basename(dir);
  let directory = false;
  try {
    directory = (await stat(dir)).isDirectory();
  } catch {
    directory = false;
  }
  if (!directory) return { code: 1, line: resultLine({ id: fallbackId }) };

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
  } catch {
    return { code: 2, line: resultLine({ id: fallbackId }) };
  }
  const parsed = parseManifest(manifestJson);
  const id = parsed.ok ? parsed.manifest.id : fallbackId;
  if (!parsed.ok) return { code: 2, line: resultLine({ id }) };

  const imported = await importArtifact(
    { kind: "files", files: await bundleFiles(dir) },
    { manifest: parsed.manifest, actor: null },
  );
  if (!imported.ok || !imported.normalized) return { code: 2, line: resultLine({ id }) };
  const level = complianceLevel(imported.normalized.manifest);
  if (level < 3) return { code: 2, line: resultLine({ id, level }) };

  let probe: BrowserProbeStep[] = [];
  try {
    const parsedProbe = parseProbe(JSON.parse(await readFile(path.join(dir, "probe.json"), "utf8")));
    if (!parsedProbe) return { code: 4, line: resultLine({ id, level }) };
    probe = parsedProbe;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") return { code: 4, line: resultLine({ id, level }) };
  }

  const override = paramOverride(imported.normalized.manifest, options.param);
  const checked = await runBrowserCheck({
    manifest: imported.normalized.manifest,
    bundleSha256: imported.normalized.bundleSha256,
    files: imported.normalized.contents,
    probe,
    paramOverride: override,
    reducedMotion: options.reducedMotion,
  });
  const phone = checked.report.viewports.find((viewport) => viewport.name === "phone")?.readyMs ?? null;
  const desktop = checked.report.viewports.find((viewport) => viewport.name === "desktop")?.readyMs ?? null;
  const line = resultLine({
    id,
    level,
    ok: checked.report.ok,
    phone,
    desktop,
    accepted: checked.acceptedEvents,
    dropped: checked.droppedNames,
    param: override,
    reducedMotion: options.reducedMotion,
  });
  if (!checked.report.ok) return { code: 3, line };
  if (!checked.probeOk) return { code: 4, line };
  return {
    code: 0,
    line,
    draft: {
      manifest: imported.normalized.manifest,
      files: imported.normalized.files,
      bundleSha256: imported.normalized.bundleSha256,
      report: checked.report,
    },
  };
}

function optionFlags(argv: string[]): SeedCheckOptions {
  const options: SeedCheckOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--reduced-motion") options.reducedMotion = true;
    if (token === "--param") options.param = argv[++i];
  }
  return options;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  const [command, dir, ...rest] = process.argv.slice(2);
  const run = command === "check" && dir ? runSeedCheck(dir, optionFlags(rest)) : Promise.resolve(1);
  run.then((code) => {
    process.exit(code);
  });
}
