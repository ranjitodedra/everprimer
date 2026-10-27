/**
 * Document check for the authoring brief, the review checklist, and the coverage list.
 * Prints `brief ok` when every required fact is present.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_DOCS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../Docs/artifact-library");

function docsDir(): string {
  const index = process.argv.indexOf("--docs");
  const given = index === -1 ? undefined : process.argv[index + 1];
  return given ? resolve(given) : DEFAULT_DOCS_DIR;
}

const COVERAGE_LINES = [
  "chain-reaction level 3 ages 6 to 10 kinds simulation and sequence intents explain_process and predict.",
  "cycle-explorer level 3 ages 8 to 12 kinds simulation and sequence intents explain_process and sequence.",
  "shape-compare level 3 ages 7 to 11 kinds comparison and parts intents compare and identify.",
  "quantity-compare level 3 ages 7 to 11 kind comparison intents compare and apply.",
  "sequence-builder level 3 ages 6 to 10 kinds timeline and sequence intents sequence and explain.",
  "solar-system level 3 ages 8 to 12 kinds orbit and simulation intents explain_process, compare, and predict.",
  "simple-circuits level 3 ages 9 to 13 kinds simulation and parts intents explain_process and predict.",
  "animal-cell level 3 ages 8 to 12 kind parts intents identify and explain.",
  "forces-motion level 3 ages 9 to 13 kind simulation intents explain_process and predict.",
  "simple-machines level 3 ages 8 to 12 kinds simulation and parts intents explain_process and apply.",
  "states-of-matter level 3 ages 7 to 11 kinds simulation and comparison intents explain_process and compare.",
  "human-heart level 3 ages 9 to 13 kinds parts and sequence intents explain_process and sequence.",
];

const HEADINGS = [
  "Scientific accuracy",
  "Age fit",
  "Whether it teaches the objective",
  "Interaction quality",
  "Mobile feel",
  "Tutor-guide completeness",
];

interface Docs {
  brief: string;
  checklist: string;
  coverage: string;
}

interface Fact {
  name: string;
  ok: (docs: Docs) => boolean;
}

function coverageLines(coverage: string): string[] {
  return coverage
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function headingLines(checklist: string): string[] {
  return checklist
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("## "));
}

function completenessSection(checklist: string): string {
  const lines = checklist.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "## Tutor-guide completeness");
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const next = rest.findIndex((line) => line.trim().startsWith("## "));
  return (next === -1 ? rest : rest.slice(0, next)).join("\n");
}

function briefFacts(): Fact[] {
  const needles: Array<[string, string]> = [
    [
      "level 3 rule",
      "A level 3 seed has at least one param, at least one declared event, a tutor-guide intro, at least one step, at least one hint, and at least one success criterion whose evidence names are all declared events.",
    ],
    ["reserved interacted", "The built-in event `interacted` is reserved and must not be declared."],
    [
      "gesture param read",
      "Read params inside the gesture that uses them, because the host sends those values when the page becomes ready.",
    ],
    [
      "runtime ready",
      "The runtime posts ready when the page has loaded, and authors do not ship a second copy of the runtime.",
    ],
    ["id rule", "Artifact ids are lowercase words joined by hyphens, 3 to 64 characters, for example solar-system-simulator."],
    [
      "event-name rule",
      "Event names are snake_case, a lowercase letter followed by 1 to 47 lowercase letters, digits, or underscores, for example planet_selected.",
    ],
    [
      "param-key rule",
      "Param keys are camelCase, a lowercase letter followed by up to 39 letters or digits, for example orbitSpeed.",
    ],
    ["vendor lock pin three@0.160.0", "three@0.160.0"],
    ["vendor lock pin three@0.170.0", "three@0.170.0"],
    ["vendor lock pin matter-js@0.19.0", "matter-js@0.19.0"],
    ["vendor lock pin gsap@3.12.5", "gsap@3.12.5"],
    ["vendor lock pin canvas-confetti@1.9.2", "canvas-confetti@1.9.2"],
    ["rejected d3, p5, and chart.js", "`d3`, `p5`, and `chart.js` are rejected."],
    ["set uses three at 0.170.0, matter-js at 0.19.0, or no pin", "uses `three` at 0.170.0, `matter-js` at 0.19.0, or no pin"],
    ["does not pin gsap or canvas-confetti", "does not pin `gsap` or `canvas-confetti`"],
    ["public CDN", "A script loaded from a public CDN is a static report error."],
    ["300 files", "300 files"],
    ["5 MB per file", "5 MB per file"],
    ["15 MB per bundle", "15 MB per bundle"],
    ["15360 KB", "at or under 15360 KB"],
    ["third-party license list", "Every tech pin is copied into the third-party license list."],
  ];
  return needles.map(([name, needle]) => ({
    name,
    ok: (docs) => docs.brief.includes(needle) && (name.startsWith("vendor lock pin") ? docs.brief.includes("vendor lock") : true),
  }));
}

function checklistFacts(): Fact[] {
  const headingFacts: Fact[] = HEADINGS.map((heading) => ({
    name: heading.charAt(0).toLowerCase() + heading.slice(1),
    ok: (docs) => headingLines(docs.checklist).includes(`## ${heading}`),
  }));
  return [
    ...headingFacts,
    {
      name: "six headings",
      ok: (docs) => headingLines(docs.checklist).length === HEADINGS.length,
    },
    {
      name: "observation prompts",
      ok: (docs) => completenessSection(docs.checklist).includes("observation prompts"),
    },
    {
      name: "misconceptions",
      ok: (docs) => completenessSection(docs.checklist).includes("misconceptions"),
    },
  ];
}

function coverageFacts(): Fact[] {
  return [
    ...COVERAGE_LINES.map((line) => ({
      name: line,
      ok: (docs: Docs) => coverageLines(docs.coverage).includes(line),
    })),
    {
      name: "exactly twelve coverage lines",
      ok: (docs) => {
        const lines = coverageLines(docs.coverage);
        return lines.length === COVERAGE_LINES.length && lines.every((line, index) => line === COVERAGE_LINES[index]);
      },
    },
  ];
}

function loadDocs(dir: string): Docs | null {
  try {
    return {
      brief: readFileSync(resolve(dir, "AUTHORING_BRIEF.md"), "utf8"),
      checklist: readFileSync(resolve(dir, "REVIEW_CHECKLIST.md"), "utf8"),
      coverage: readFileSync(resolve(dir, "COVERAGE.md"), "utf8"),
    };
  } catch {
    return null;
  }
}

function fail(name: string): never {
  process.stdout.write(`missing fact: ${name}\n`);
  process.exit(1);
}

const docs = loadDocs(docsDir());
if (!docs) fail("authoring brief");
const missing = [...briefFacts(), ...checklistFacts(), ...coverageFacts()].find((fact) => !fact.ok(docs));
if (missing) fail(missing.name);
process.stdout.write("brief ok\n");
