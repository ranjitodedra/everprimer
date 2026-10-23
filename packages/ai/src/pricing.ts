import type { UsageRecord } from "./provider";

/**
 * What API work costs, in credits. A credit is a fixed slice of provider
 * spend, the same for lessons, pictures and the live tutor, so every feature
 * draws from one monthly balance at its real cost.
 *
 * Rates are USD list prices. A typical lesson (outline share, planner,
 * blueprint, fact check, page code and four pictures) comes to about 100
 * credits; plan budgets in apps/web/src/lib/plans.ts and plan_credits() in
 * SQL are sized from that.
 */

export const USD_PER_CREDIT = 0.0015;

/** Rough credits per lesson, only for "about N lessons" hints. */
export const CREDITS_PER_LESSON = 100;

interface TextRate {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

const TEXT_RATES: Record<string, TextRate> = {
  "gemini-3.8-flash": { input: 0.5, output: 3 },
  "gemini-3.8-pro": { input: 2, output: 12 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
};

/** Unknown models are billed as the default lesson model, never as free. */
const DEFAULT_TEXT_RATE: TextRate = TEXT_RATES["gemini-3.8-flash"]!;

/** USD per generated or processed image at 768x768. */
export const IMAGE_USD = {
  generate: 0.009,
  edit: 0.012,
  cutout: 0.003,
} as const;

/** Gemini Live, USD per 1M tokens by direction and modality. */
const LIVE_RATE = { textIn: 0.5, audioIn: 3, textOut: 2, audioOut: 12 } as const;

/** Gemini counts audio at 32 tokens a second. */
const AUDIO_TOKENS_PER_SECOND = 32;

/**
 * Bounds on what a minute of live talk may cost, whatever the browser reports:
 * at least the microphone stream itself, at most a long, chatty minute with a
 * full context window.
 */
export const LIVE_CREDITS_PER_MINUTE = {
  min: Math.ceil(((AUDIO_TOKENS_PER_SECOND * 60) / 1e6) * LIVE_RATE.audioIn / USD_PER_CREDIT),
  max: 60,
} as const;

export interface LiveUsage {
  textIn: number;
  audioIn: number;
  textOut: number;
  audioOut: number;
}

function toCredits(usd: number): number {
  if (!(usd > 0)) return 0;
  // Float noise must not round a whole number of credits up by one.
  return Math.ceil(Number((usd / USD_PER_CREDIT).toFixed(6)));
}

function textUsd(r: Pick<UsageRecord, "modelId" | "inputTokens" | "outputTokens">): number {
  const rate = TEXT_RATES[r.modelId] ?? DEFAULT_TEXT_RATE;
  return (Math.max(0, r.inputTokens) * rate.input + Math.max(0, r.outputTokens) * rate.output) / 1e6;
}

/** Credits for one generation job's model calls. The mock provider is free. */
export function creditsFor(usage: ReadonlyArray<Pick<UsageRecord, "provider" | "modelId" | "inputTokens" | "outputTokens">>): number {
  return toCredits(usage.filter((r) => r.provider !== "mock").reduce((sum, r) => sum + textUsd(r), 0));
}

/** Credits for one tutor character: both poses, each cut out of its background. */
export function creditsForCharacter(): number {
  return toCredits(IMAGE_USD.generate + IMAGE_USD.edit + 2 * IMAGE_USD.cutout);
}

/** Credits for cutting existing poses out of their background. */
export function creditsForCutouts(n: number): number {
  return toCredits(Math.max(0, n) * IMAGE_USD.cutout);
}

/** Credits for a live conversation's reported token use, before any bounds. */
export function creditsForLive(t: LiveUsage): number {
  const usd =
    (Math.max(0, t.textIn) * LIVE_RATE.textIn +
      Math.max(0, t.audioIn) * LIVE_RATE.audioIn +
      Math.max(0, t.textOut) * LIVE_RATE.textOut +
      Math.max(0, t.audioOut) * LIVE_RATE.audioOut) /
    1e6;
  return toCredits(usd);
}

/** Reported live cost held between the per-minute floor and ceiling for the time actually spent. */
export function boundedLiveCredits(t: LiveUsage, seconds: number): number {
  const minutes = Math.max(0, seconds) / 60;
  const floor = Math.ceil(minutes * LIVE_CREDITS_PER_MINUTE.min);
  const ceiling = Math.ceil(minutes * LIVE_CREDITS_PER_MINUTE.max);
  return Math.min(ceiling, Math.max(floor, creditsForLive(t)));
}
