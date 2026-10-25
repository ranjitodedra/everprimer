import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { runSeedCheck } from "../seed-check";

const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../seeds/chain-reaction");

describe("chain-reaction seed", () => {
  it("exits 0 with level 3, an ok browser report, and no static report error", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      lines.push(String(message));
    });
    try {
      const code = await runSeedCheck(seedDir);
      expect(code).toBe(0);
      expect(lines).toHaveLength(1);
      const match = lines[0]!.match(
        /^id=chain-reaction level=3 ok=true phone=(\d+) desktop=(\d+) accepted=(\S+) dropped=(\S+)$/,
      );
      expect(match).not.toBeNull();
      expect(Number(match?.[1])).toBeLessThan(8000);
      expect(Number(match?.[2])).toBeLessThan(8000);
      const accepted = match?.[3]?.split(",") ?? [];
      expect(accepted).toContain("domino_toppled");
      expect(accepted).toContain("chain_completed");
      expect(match?.[4]?.split(",")).toContain("not_a_real_event");
    } finally {
      spy.mockRestore();
    }
  }, 60_000);
});
