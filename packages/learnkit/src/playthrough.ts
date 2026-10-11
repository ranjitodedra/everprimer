import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ArtifactBlueprint } from "@eco/contracts";
import { PLAYTHROUGH_DRIVER_SOURCE } from "./playthrough-driver";

/**
 * Result of playing a generated lesson end to end before it is published.
 *
 * - passed: the lesson reached topic_completed and every question was answered.
 * - failed: a child would get stuck; `problems` are repair instructions.
 * - inconclusive: the check could not run, or could not operate a control
 *   (for example an unusual ordering widget). Never blocks publishing.
 */
export interface LessonPlaythrough {
  status: "passed" | "failed" | "inconclusive";
  problems: string[];
  detail: string;
  durationMs: number;
}

interface DriverReport {
  status: "passed" | "failed" | "inconclusive" | "error";
  reason?: string;
  completed?: boolean;
  unanswered?: string[];
  lastSection?: string | null;
  stuckOn?: string | null;
  disabledControls?: string[];
  visibleControls?: string[];
  scriptErrors?: string[];
  steps?: string[];
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Every `node_modules` directory from `from` up to the filesystem root. */
function moduleDirs(from: string): string[] {
  const dirs: string[] = [];
  let dir = path.resolve(from);
  for (;;) {
    const candidate = path.join(dir, "node_modules");
    if (existsSync(candidate)) dirs.push(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) return dirs;
    dir = parent;
  }
}

function problemsFrom(report: DriverReport): string[] {
  const problems: string[] = [];
  const where = report.lastSection ? ` on section ${report.lastSection}` : "";
  const disabled = report.disabledControls?.length ? ` (still disabled: ${report.disabledControls.join(", ")})` : "";
  if (!report.completed) {
    problems.push(`a test play-through got stuck${where}${disabled}: after answering everything visible, nothing moved the child forward, so the lesson could not be finished`);
  }
  if (report.unanswered?.length) {
    problems.push(
      `questions a child can never reach or answer: ${report.unanswered.join(", ")}. Show every question of a section in turn and unlock Continue only after the last one`,
    );
  }
  if (report.completed && report.unanswered?.length) {
    problems.push("topic_completed fired before every question was answered");
  }
  for (const err of report.scriptErrors ?? []) problems.push(`the page threw a JavaScript error during the play-through: ${err}`);
  return problems;
}

/**
 * Play a lesson document the way a child would and report whether it can be
 * finished. Runs jsdom in a child Node process under the permission model: no
 * environment variables, no network, no file writes, no subprocesses, and
 * reads limited to `node_modules`. jsdom is resolved from `cwd`, so the app
 * running the pipeline must depend on it.
 */
export function playThroughLesson(
  html: string,
  blueprint: ArtifactBlueprint,
  opts: { timeoutMs?: number; cwd?: string } = {},
): Promise<LessonPlaythrough> {
  const started = Date.now();
  const cwd = opts.cwd ?? process.cwd();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: Omit<LessonPlaythrough, "durationMs">) => {
      if (settled) return;
      settled = true;
      resolve({ ...result, durationMs: Date.now() - started });
    };
    const inconclusive = (detail: string) => finish({ status: "inconclusive", problems: [], detail });

    const args = [
      "--permission",
      ...moduleDirs(cwd).map((dir) => `--allow-fs-read=${dir}`),
      "--max-old-space-size=384",
      "-e",
      PLAYTHROUGH_DRIVER_SOURCE,
    ];
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(process.execPath, args, { cwd, env: {} as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      inconclusive(`could not start the play-through: ${(err as Error).message}`);
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout!.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
      if (stderr.length < 4000) stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      inconclusive(`play-through timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      inconclusive(`play-through process failed: ${err.message}`);
    });
    child.on("close", () => {
      clearTimeout(timer);
      let report: DriverReport;
      try {
        report = JSON.parse(stdout) as DriverReport;
      } catch {
        inconclusive(`play-through produced no report${stderr ? `: ${stderr.trim().split("\n").slice(-3).join(" ")}` : ""}`);
        return;
      }
      if (report.status === "error") return inconclusive(`play-through harness error: ${report.reason ?? "unknown"}`);
      const detail = `steps: ${(report.steps ?? []).join(" > ") || "none"}; visible controls: ${(report.visibleControls ?? []).join(" | ") || "none"}`;
      if (report.status === "passed") return finish({ status: "passed", problems: [], detail });
      if (report.status === "inconclusive") {
        return inconclusive(`could not operate question ${report.stuckOn ?? "?"}${report.lastSection ? ` on section ${report.lastSection}` : ""}; ${detail}`);
      }
      finish({ status: "failed", problems: problemsFrom(report), detail });
    });

    child.stdin!.on("error", () => {});
    child.stdin!.end(JSON.stringify({ html, blueprint }));
  });
}
