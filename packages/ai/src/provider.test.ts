import { APICallError, LoadAPIKeyError } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { GEMINI, isPermanentAiError, resolveModelSpec, type AiTask, type Tier } from "./provider";

const TASKS: AiTask[] = ["curriculum", "planner", "blueprint", "factcheck", "report", "memory"];
const KEYS = ["AI_PROVIDER", "GOOGLE_GENERATIVE_AI_API_KEY", "AI_MODEL_PAID_BLUEPRINT", "AI_MODEL_FREE_PLANNER"] as const;

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

  it("uses Gemini for every task and tier when the key is present", () => {
    rememberEnv();
    delete process.env.AI_PROVIDER;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google";
    for (const tier of ["free", "paid", "max"] as Tier[]) {
      for (const task of TASKS) {
        expect(resolveModelSpec(task, tier)).toEqual(GEMINI);
      }
    }
  });

  it("falls back to mock when the Gemini key is missing", () => {
    rememberEnv();
    delete process.env.AI_PROVIDER;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    expect(resolveModelSpec("blueprint", "paid")).toEqual({ provider: "mock", modelId: "mock" });
  });

  it("honors a google: override and ignores any other provider", () => {
    rememberEnv();
    delete process.env.AI_PROVIDER;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google";
    process.env.AI_MODEL_PAID_BLUEPRINT = "google:gemini-3.8-pro";
    expect(resolveModelSpec("blueprint", "paid")).toEqual({ provider: "google", modelId: "gemini-3.8-pro" });
    process.env.AI_MODEL_PAID_BLUEPRINT = "anthropic:claude-sonnet-4-5";
    expect(resolveModelSpec("blueprint", "paid")).toEqual(GEMINI);
  });

  it("lets AI_PROVIDER=mock short-circuit every tier", () => {
    rememberEnv();
    process.env.AI_PROVIDER = "mock";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google";
    for (const tier of ["free", "paid", "max"] as Tier[]) {
      expect(resolveModelSpec("planner", tier)).toEqual({ provider: "mock", modelId: "mock" });
    }
  });
});

describe("isPermanentAiError", () => {
  const apiError = (statusCode: number, isRetryable: boolean) =>
    new APICallError({ message: "provider said no", url: "https://example.invalid", requestBodyValues: {}, statusCode, isRetryable });

  it("treats an invalid or revoked key as permanent", () => {
    expect(isPermanentAiError(apiError(400, false))).toBe(true);
    expect(isPermanentAiError(apiError(401, false))).toBe(true);
    expect(isPermanentAiError(apiError(403, false))).toBe(true);
    expect(isPermanentAiError(new LoadAPIKeyError({ message: "missing key" }))).toBe(true);
  });

  it("keeps rate limits, server errors and our own errors retryable", () => {
    expect(isPermanentAiError(apiError(429, true))).toBe(false);
    expect(isPermanentAiError(apiError(503, true))).toBe(false);
    expect(isPermanentAiError(new Error("curriculum did not match the schema"))).toBe(false);
  });
});
