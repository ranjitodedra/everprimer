import { afterEach, describe, expect, it } from "vitest";
import { resolveModelSpec, type AiTask, type Tier } from "./provider";

const TASKS: AiTask[] = ["curriculum", "blueprint", "codegen", "factcheck", "report"];
const KEYS = [
  "AI_PROVIDER",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "ANTHROPIC_API_KEY",
  "AI_MODEL_FREE_BLUEPRINT",
  "AI_MODEL_FREE_CODEGEN",
  "AI_MODEL_PAID_CODEGEN",
  "AI_MODEL_PAID_MEMORY",
  "AI_MODEL_MAX_BLUEPRINT",
  "AI_MODEL_MAX_MEMORY",
] as const;

const saved = new Map<string, string | undefined>();

function rememberEnv() {
  saved.clear();
  for (const key of KEYS) saved.set(key, process.env[key]);
}

function restoreEnv() {
  for (const key of KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("resolveModelSpec", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("never sends the free tier to Anthropic, even when Gemini is missing", () => {
    rememberEnv();
    delete process.env.AI_PROVIDER;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
    delete process.env.AI_MODEL_FREE_CODEGEN;
    for (const task of TASKS) {
      expect(resolveModelSpec(task, "free").provider).not.toBe("anthropic");
    }
  });

  it("ignores a free-tier override that names Anthropic", () => {
    rememberEnv();
    delete process.env.AI_PROVIDER;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google";
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
    process.env.AI_MODEL_FREE_BLUEPRINT = "anthropic:claude-opus-4-1";
    expect(resolveModelSpec("blueprint", "free")).toEqual({ provider: "google", modelId: "gemini-3.8-flash" });
  });

  it("uses mock for free when the Gemini key is absent", () => {
    rememberEnv();
    delete process.env.AI_PROVIDER;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
    expect(resolveModelSpec("codegen", "free")).toEqual({ provider: "mock", modelId: "mock" });
  });

  it("routes Max the same way as Plus", () => {
    rememberEnv();
    delete process.env.AI_PROVIDER;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google";
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
    for (const task of TASKS) {
      expect(resolveModelSpec(task, "max")).toEqual(resolveModelSpec(task, "paid"));
    }
    expect(resolveModelSpec("blueprint", "max").provider).toBe("anthropic");
    expect(resolveModelSpec("codegen", "max").provider).toBe("anthropic");
    expect(resolveModelSpec("factcheck", "max").provider).toBe("google");
  });

  it("still honors a Plus env override", () => {
    rememberEnv();
    delete process.env.AI_PROVIDER;
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
    process.env.AI_MODEL_PAID_CODEGEN = "anthropic:claude-opus-4-1";
    expect(resolveModelSpec("codegen", "paid")).toEqual({ provider: "anthropic", modelId: "claude-opus-4-1" });
  });

  it("keeps memory compaction on Gemini and ignores an Anthropic override", () => {
    rememberEnv();
    delete process.env.AI_PROVIDER;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google";
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
    process.env.AI_MODEL_PAID_MEMORY = "anthropic:claude-opus-4-1";
    process.env.AI_MODEL_MAX_MEMORY = "anthropic:claude-opus-4-1";
    expect(resolveModelSpec("memory", "paid")).toEqual({ provider: "google", modelId: "gemini-3.8-flash" });
    expect(resolveModelSpec("memory", "max")).toEqual({ provider: "google", modelId: "gemini-3.8-flash" });
    expect(resolveModelSpec("memory", "free")).toEqual({ provider: "google", modelId: "gemini-3.8-flash" });
  });

  it("does not fall back to Claude when memory has no Gemini key", () => {
    rememberEnv();
    delete process.env.AI_PROVIDER;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
    expect(resolveModelSpec("memory", "paid")).toEqual({ provider: "mock", modelId: "mock" });
    expect(resolveModelSpec("memory", "max")).toEqual({ provider: "mock", modelId: "mock" });
  });

  it("lets AI_PROVIDER=mock short-circuit every tier", () => {
    rememberEnv();
    process.env.AI_PROVIDER = "mock";
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
    const tiers: Tier[] = ["free", "paid", "max"];
    for (const tier of tiers) {
      expect(resolveModelSpec("codegen", tier)).toEqual({ provider: "mock", modelId: "mock" });
    }
  });
});
