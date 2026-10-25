import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserReport } from "./browser-report";
import { getArtifact } from "./catalog";
import { fakeDb } from "./catalog-double";
import { runSeedCheck, runSeedLoad } from "./seed-check";

const PAGE = "<!doctype html><html><head></head><body><p>Hello</p></body></html>";

function manifest(id: string, level: 1 | 3): Record<string, unknown> {
  const events = [
    {
      name: "item_tapped",
      data: { count: "number" },
      description: "The child tapped the item.",
    },
  ];
  const base: Record<string, unknown> = {
    manifestVersion: 1,
    id,
    version: 1,
    title: "Tap Once",
    description: "A small page that records one tap.",
    format: "html",
    entry: "index.html",
    rendering: { dimension: "2d", tech: [], webgl: false },
    subjects: ["science"],
    topics: ["testing"],
    concepts: ["cause and effect"],
    prerequisites: [],
    learningObjectives: ["Notice that one tap records an event"],
    objectiveIntents: ["predict"],
    visualKinds: ["simulation"],
    interactionTypes: ["select"],
    ageRange: [6, 10],
    difficulty: 1,
    durationSec: [30, 60],
    events,
    accessibility: {
      reducedMotion: true,
      keyboard: true,
      screenReaderSummary: "One button records a tap.",
      colorSafe: true,
    },
    performance: { mobileTested: true },
    provenance: { createdWith: ["fixture"], createdAt: "2026-10-25T00:00:00.000Z" },
    license: { artifact: "proprietary", thirdParty: [], attributions: [] },
  };
  if (level === 1) return { ...base, params: [] };
  return {
    ...base,
    params: [{ key: "count", type: "number", default: 1, description: "How many items to show." }],
    tutorGuide: {
      intro: "Tap the item once.",
      steps: ["Tap the button."],
      hints: ["The button is on the page."],
      successCriteria: [{ description: "Tapped the item", evidence: ["item_tapped"] }],
    },
  };
}

const THROW_PAGE = `<!doctype html><html><head></head><body>
<script>document.addEventListener("DOMContentLoaded", function () { throw new Error("boom"); });</script>
</body></html>`;

const TAP_PAGE = `<!doctype html><html><head></head><body>
<button id="go">Go</button>
<script>
document.getElementById("go").addEventListener("click", function () {
  var count = window.ArtifactKit && window.ArtifactKit.params ? window.ArtifactKit.params.count : 1;
  window.ArtifactKit.emit("item_tapped", { count: count });
});
</script>
</body></html>`;

const STRIP_MOTION_PAGE = `<!doctype html><html><head></head><body>
<button id="go">Go</button>
<script>
new MutationObserver(function () {
  document.documentElement.removeAttribute("data-reduced-motion");
}).observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduced-motion"] });
document.getElementById("go").addEventListener("click", function () {
  var count = window.ArtifactKit && window.ArtifactKit.params ? window.ArtifactKit.params.count : 1;
  window.ArtifactKit.emit("item_tapped", { count: count });
});
</script>
</body></html>`;

const TAP_PROBE = [
  { click: "#go" },
  { expect: "item_tapped" },
  { emit: "not_declared" },
];

async function writeSeed(
  id: string,
  level: 1 | 3,
  files: { html?: string; probe?: unknown } = {},
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "seed-check-"));
  const dir = path.join(root, id);
  await mkdir(dir);
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest(id, level)));
  await writeFile(path.join(dir, "index.html"), files.html ?? PAGE);
  if (files.probe !== undefined) await writeFile(path.join(dir, "probe.json"), JSON.stringify(files.probe));
  return dir;
}

async function printed(run: () => Promise<number>): Promise<{ code: number; line: string }> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
    lines.push(String(message));
  });
  try {
    const code = await run();
    expect(lines).toHaveLength(1);
    return { code, line: lines[0]! };
  } finally {
    spy.mockRestore();
  }
}

describe("seed check", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("exits 1 when the directory is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "seed-check-"));
    dirs.push(root);
    const missing = path.join(root, "missing-seed");
    const { code, line } = await printed(() => runSeedCheck(missing));
    expect(code).toBe(1);
    expect(line).toBe("id=missing-seed level=- ok=- phone=- desktop=- accepted=- dropped=-");
  });

  it("exits 2 when the level is below 3 and the line shows that level", async () => {
    const dir = await writeSeed("low-seed", 1);
    dirs.push(path.dirname(dir));
    const { code, line } = await printed(() => runSeedCheck(dir));
    expect(code).toBe(2);
    expect(line).toBe("id=low-seed level=1 ok=- phone=- desktop=- accepted=- dropped=-");
  });

  it("exits 0 for a level 3 fixture and prints the browser report, ready times, and events", async () => {
    const dir = await writeSeed("tap-once", 3, { html: TAP_PAGE, probe: TAP_PROBE });
    dirs.push(path.dirname(dir));
    const { code, line } = await printed(() => runSeedCheck(dir));
    expect(code).toBe(0);
    const match = line.match(
      /^id=tap-once level=3 ok=true phone=(\d+) desktop=(\d+) accepted=(\S+) dropped=(\S+)$/,
    );
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeLessThan(8000);
    expect(Number(match?.[2])).toBeLessThan(8000);
    expect(match?.[3]?.split(",")).toContain("item_tapped");
    expect(match?.[4]?.split(",")).toContain("not_declared");
  }, 60_000);

  it("exits 4 when the probe expects an event the page never emits", async () => {
    const dir = await writeSeed("silent-tap", 3, { probe: [{ expect: "item_tapped" }] });
    dirs.push(path.dirname(dir));
    const { code, line } = await printed(() => runSeedCheck(dir));
    expect(code).toBe(4);
    expect(line).toMatch(/^id=silent-tap level=3 ok=true phone=\d+ desktop=\d+ accepted=- dropped=-$/);
  }, 60_000);

  it("exits 3 when the browser report is not ok", async () => {
    const dir = await writeSeed("throws-once", 3, { html: THROW_PAGE });
    dirs.push(path.dirname(dir));
    const { code, line } = await printed(() => runSeedCheck(dir));
    expect(code).toBe(3);
    expect(line).toMatch(/^id=throws-once level=3 ok=false phone=\d+ desktop=\d+ accepted=- dropped=-$/);
  }, 60_000);

  it("exits 0 when a param override is set and the line shows that override", async () => {
    const dir = await writeSeed("tap-once", 3, { html: TAP_PAGE, probe: TAP_PROBE });
    dirs.push(path.dirname(dir));
    const { code, line } = await printed(() => runSeedCheck(dir, { param: "count=4" }));
    expect(code).toBe(0);
    const match = line.match(
      /^id=tap-once level=3 ok=true phone=(\d+) desktop=(\d+) accepted=(\S+) dropped=(\S+) param=count=4$/,
    );
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeLessThan(8000);
    expect(Number(match?.[2])).toBeLessThan(8000);
    expect(match?.[3]?.split(",")).toContain("item_tapped");
    expect(match?.[4]?.split(",")).toContain("not_declared");
  }, 60_000);

  it("exits 0 for a reduced-motion run when the page marks that state", async () => {
    const dir = await writeSeed("tap-once", 3, { html: TAP_PAGE, probe: TAP_PROBE });
    dirs.push(path.dirname(dir));
    const { code, line } = await printed(() => runSeedCheck(dir, { reducedMotion: true }));
    expect(code).toBe(0);
    const match = line.match(
      /^id=tap-once level=3 ok=true phone=(\d+) desktop=(\d+) accepted=(\S+) dropped=(\S+) reducedMotion=true$/,
    );
    expect(match).not.toBeNull();
    expect(match?.[3]?.split(",")).toContain("item_tapped");
    expect(match?.[4]?.split(",")).toContain("not_declared");
  }, 60_000);

  it("exits 0 for the sequence-builder seed and prints its seed-check line", async () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../seeds/sequence-builder");
    const { code, line } = await printed(() => runSeedCheck(dir));
    expect(code).toBe(0);
    const match = line.match(
      /^id=sequence-builder level=3 ok=true phone=(\d+) desktop=(\d+) accepted=(\S+) dropped=(\S+)$/,
    );
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeLessThan(8000);
    expect(Number(match?.[2])).toBeLessThan(8000);
    const accepted = match?.[3]?.split(",") ?? [];
    expect(accepted).toContain("step_placed");
    expect(accepted).toContain("sequence_checked");
    expect(match?.[4]?.split(",")).toContain("not_a_real_event");
  }, 60_000);

  it("does not exit 0 for a reduced-motion run when the page leaves that state unmarked", async () => {
    const dir = await writeSeed("tap-once", 3, { html: STRIP_MOTION_PAGE, probe: TAP_PROBE });
    dirs.push(path.dirname(dir));
    const { code, line } = await printed(() => runSeedCheck(dir, { reducedMotion: true }));
    expect(code).toBe(3);
    expect(line).toMatch(
      /^id=tap-once level=3 ok=false phone=\d+ desktop=\d+ accepted=\S+ dropped=\S+ reducedMotion=true$/,
    );
  }, 60_000);
});

describe("seed load", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("stores the browser report from that check on a draft", async () => {
    const dir = await writeSeed("tap-once", 3, { html: TAP_PAGE, probe: TAP_PROBE });
    dirs.push(path.dirname(dir));
    const { db } = fakeDb({});
    const { code, line } = await printed(() => runSeedLoad(dir, db));
    expect(code).toBe(0);
    const match = line.match(/^id=tap-once level=3 ok=true phone=(\d+) desktop=(\d+) accepted=(\S+) dropped=(\S+)$/);
    expect(match).not.toBeNull();
    const loaded = await getArtifact(db, "tap-once", 1);
    if (!loaded.ok) throw new Error(loaded.problems.join("; "));
    expect(loaded.version.status).toBe("draft");
    const report = loaded.version.validation_report as BrowserReport | null;
    expect(report?.ok).toBe(true);
    expect(report?.viewports.find((viewport) => viewport.name === "phone")?.readyMs).toBe(Number(match?.[1]));
    expect(report?.viewports.find((viewport) => viewport.name === "desktop")?.readyMs).toBe(Number(match?.[2]));
  }, 60_000);
});
