import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { runSeedCheck } from "../seed-check";

const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../seeds/simple-machines");

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

it("prints a level 3 seed-check line for simple-machines", async () => {
  const { code, line } = await printed(() => runSeedCheck(seedDir));
  expect(code).toBe(0);
  const match = line.match(
    /^id=simple-machines level=3 ok=true phone=(\d+) desktop=(\d+) accepted=(\S+) dropped=(\S+)$/,
  );
  expect(match).not.toBeNull();
  expect(Number(match?.[1])).toBeLessThan(8000);
  expect(Number(match?.[2])).toBeLessThan(8000);
  const accepted = match?.[3]?.split(",") ?? [];
  expect(accepted).toContain("machine_selected");
  expect(accepted).toContain("advantage_compared");
  expect(match?.[4]?.split(",")).toContain("not_a_real_event");
}, 60_000);
