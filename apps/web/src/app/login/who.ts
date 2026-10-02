const WHO_IDS = ["individual", "parent", "child", "shared"] as const;
export type Who = (typeof WHO_IDS)[number];

export function parseWho(value: unknown): Who | null {
  return typeof value === "string" && (WHO_IDS as readonly string[]).includes(value) ? (value as Who) : null;
}
