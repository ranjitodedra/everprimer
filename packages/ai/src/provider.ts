import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { APICallError, LoadAPIKeyError, type LanguageModel } from "ai";

/**
 * Model routing. Every task on every tier runs on Gemini; paid plans differ
 * only by how many lesson credits they get.
 *
 * - `mock`  : deterministic local generator, no network, no keys.
 * - `google`: Gemini.
 *
 * Set AI_PROVIDER=mock to force the mock. A missing Gemini key also falls
 * back to the mock. `AI_MODEL_<TIER>_<TASK>=google:<model-id>` swaps the
 * Gemini model for one task.
 */

export type AiTask = "curriculum" | "planner" | "blueprint" | "factcheck" | "report" | "memory";
export type Tier = "free" | "paid" | "max";
export type ProviderId = "mock" | "google";

export interface ModelSpec {
  provider: ProviderId;
  modelId: string;
}

export const GEMINI: ModelSpec = { provider: "google", modelId: "gemini-3.8-flash" };
const MOCK: ModelSpec = { provider: "mock", modelId: "mock" };

function envOverride(task: AiTask, tier: Tier): ModelSpec | undefined {
  // e.g. AI_MODEL_PAID_BLUEPRINT=google:gemini-3.8-pro
  const raw = process.env[`AI_MODEL_${tier.toUpperCase()}_${task.toUpperCase()}`];
  if (!raw) return undefined;
  const [provider, ...rest] = raw.split(":");
  const modelId = rest.join(":");
  if (provider === "mock") return MOCK;
  if (provider === "google" && modelId) return { provider, modelId };
  return undefined;
}

export function resolveModelSpec(task: AiTask, tier: Tier): ModelSpec {
  if (process.env.AI_PROVIDER === "mock") return MOCK;
  const spec = envOverride(task, tier) ?? GEMINI;
  if (spec.provider === "mock") return MOCK;
  return process.env.GOOGLE_GENERATIVE_AI_API_KEY ? spec : MOCK;
}

export type ResolvedModel = { provider: "mock"; modelId: "mock"; model: null } | { provider: "google"; modelId: string; model: LanguageModel };

export function resolveModel(task: AiTask, tier: Tier): ResolvedModel {
  const spec = resolveModelSpec(task, tier);
  if (spec.provider === "mock") return { provider: "mock", modelId: "mock", model: null };
  const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
  return { provider: "google", modelId: spec.modelId, model: google(spec.modelId) };
}

const PERMANENT_STATUS = new Set([400, 401, 403, 404]);

/**
 * True for provider errors a later attempt cannot fix: a missing, invalid or
 * revoked key, or an unknown model. Rate limits and server errors are
 * retried inside the SDK call and never count as permanent.
 */
export function isPermanentAiError(err: unknown): boolean {
  if (LoadAPIKeyError.isInstance(err)) return true;
  if (!APICallError.isInstance(err)) return false;
  return !err.isRetryable && err.statusCode !== undefined && PERMANENT_STATUS.has(err.statusCode);
}

export interface UsageRecord {
  provider: ProviderId;
  modelId: string;
  task: AiTask;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}
