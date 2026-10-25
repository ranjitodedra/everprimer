import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const libraryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDocs = resolve(libraryRoot, "../../Docs/artifact-library");
const checker = resolve(libraryRoot, "scripts/brief-check.ts");
const tsx = resolve(libraryRoot, "node_modules/.bin/tsx");

const LEVEL_3_RULE =
  "A level 3 seed has at least one param, at least one declared event, a tutor-guide intro, at least one step, at least one hint, and at least one success criterion whose evidence names are all declared events.";

function runBriefChecker(args: string[] = []): { status: number; output: string } {
  try {
    const output = execFileSync(tsx, [checker, ...args], {
      cwd: libraryRoot,
      encoding: "utf8",
    });
    return { status: 0, output };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    const stdout = failed.stdout == null ? "" : String(failed.stdout);
    const stderr = failed.stderr == null ? "" : String(failed.stderr);
    return { status: failed.status ?? 1, output: `${stdout}${stderr}` };
  }
}

describe("brief checker", () => {
  it("prints brief ok when the brief, the checklist, and the coverage list contain every required fact", () => {
    const result = runBriefChecker();
    expect(result).toEqual({ status: 0, output: "brief ok\n" });
  });

  it("fails and names the missing fact when one required fact is removed", () => {
    const dir = mkdtempSync(join(tmpdir(), "brief-"));
    try {
      const brief = readFileSync(join(repoDocs, "AUTHORING_BRIEF.md"), "utf8").replace(LEVEL_3_RULE, "");
      writeFileSync(join(dir, "AUTHORING_BRIEF.md"), brief);
      writeFileSync(join(dir, "REVIEW_CHECKLIST.md"), readFileSync(join(repoDocs, "REVIEW_CHECKLIST.md")));
      writeFileSync(join(dir, "COVERAGE.md"), readFileSync(join(repoDocs, "COVERAGE.md")));
      const result = runBriefChecker(["--docs", dir]);
      expect(result).toEqual({ status: 1, output: "missing fact: level 3 rule\n" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
