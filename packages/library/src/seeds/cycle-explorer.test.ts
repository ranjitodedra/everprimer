import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { runSeedCheck } from "../seed-check";

const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../seeds/cycle-explorer");

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

it("prints a level 3 seed-check line for cycle-explorer with both cycle events", async () => {
  const { code, line } = await printed(() => runSeedCheck(seedDir));
  expect(code).toBe(0);
  const match = line.match(
    /^id=cycle-explorer level=3 ok=true phone=(\d+) desktop=(\d+) accepted=(\S+) dropped=(\S+)$/,
  );
  expect(match).not.toBeNull();
  expect(Number(match?.[1])).toBeLessThan(8000);
  expect(Number(match?.[2])).toBeLessThan(8000);
  const accepted = match?.[3]?.split(",") ?? [];
  expect(accepted).toContain("stage_selected");
  expect(accepted).toContain("cycle_completed");
  expect(match?.[4]?.split(",")).toContain("not_a_real_event");

  const rock = await printed(() => runSeedCheck(seedDir, { param: "cycle=rock" }));
  expect(rock.code).toBe(0);
  const rockMatch = rock.line.match(
    /^id=cycle-explorer level=3 ok=true phone=(\d+) desktop=(\d+) accepted=(\S+) dropped=\S+ param=cycle=rock$/,
  );
  expect(rockMatch).not.toBeNull();
  expect(Number(rockMatch?.[1])).toBeLessThan(8000);
  expect(Number(rockMatch?.[2])).toBeLessThan(8000);
  expect(rockMatch?.[3]?.split(",")).toEqual(expect.arrayContaining(["stage_selected", "cycle_completed"]));

  const motion = await printed(() => runSeedCheck(seedDir, { reducedMotion: true }));
  expect(motion.code).toBe(0);
  const motionMatch = motion.line.match(
    /^id=cycle-explorer level=3 ok=true phone=(\d+) desktop=(\d+) accepted=(\S+) dropped=\S+ reducedMotion=true$/,
  );
  expect(motionMatch).not.toBeNull();
  expect(Number(motionMatch?.[1])).toBeLessThan(8000);
  expect(Number(motionMatch?.[2])).toBeLessThan(8000);
  expect(motionMatch?.[3]?.split(",")).toEqual(expect.arrayContaining(["stage_selected", "cycle_completed"]));
}, 180_000);
