import type { TutorContext } from "@eco/contracts";

/** Gemini Live takes 16 kHz mono PCM16 in and sends 24 kHz mono PCM16 back. */
export const INPUT_RATE = 16_000;
export const OUTPUT_RATE = 24_000;

/** Averages each output sample over its window of input samples, which doubles as a cheap low-pass. */
export function downsample(input: Float32Array, fromRate: number, toRate: number = INPUT_RATE): Float32Array {
  if (fromRate === toRate) return input.slice();
  if (fromRate < toRate) throw new Error("upsampling is not supported");
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j]!;
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Little-endian PCM16 bytes to floats in [-1, 1). A trailing odd byte is dropped. */
export function pcm16ToFloat(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength - (bytes.byteLength % 2));
  const out = new Float32Array(view.byteLength / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

export function pcm16Bytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i]!, true);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Root-mean-square level of a block, 0..1. Used to tell when the learner is talking. */
export function rms(input: Float32Array): number {
  if (input.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < input.length; i++) sum += input[i]! * input[i]!;
  return Math.sqrt(sum / input.length);
}

/** Mic block from the capture worklet, ready to send: base64 PCM16 at 16 kHz. */
export function encodeMicBlock(input: Float32Array, sampleRate: number): string {
  return bytesToBase64(pcm16Bytes(floatToPcm16(downsample(input, sampleRate))));
}

const SCREENS: Record<TutorContext["screen"], string> = {
  section: "a lesson page",
  bite: "a lesson step",
  map: "the map of rounds",
  session_done: "the end of a round",
  final: "the big challenge",
  score: "the results",
};

/**
 * What the learner is looking at, as a [screen] note for the tutor.
 * The player only includes an explanation after the learner has answered.
 */
export function formatTutorContext(c: TutorContext): string {
  const lines = [`[screen] The learner is on ${SCREENS[c.screen]}${c.title ? `: "${c.title}"` : ""}.`];
  if (c.progress) lines.push(`Round ${Math.min(c.progress.round + 1, c.progress.rounds)} of ${c.progress.rounds}.`);
  if (c.sessionTitle) lines.push(`Round title: ${c.sessionTitle}.`);
  if (c.text) lines.push(`On screen: ${c.text}`);
  if (c.question) {
    lines.push(`Question: ${c.question.prompt}`);
    if (c.question.options?.length) lines.push(`Choices: ${c.question.options.join(" | ")}`);
    if (c.question.hint) lines.push(`Hint they can ask for: ${c.question.hint}`);
    if (!c.answered) lines.push("They have not answered yet. Do not give the answer.");
    else lines.push(c.correct ? "They answered correctly." : "They did not get it; the answer has been shown.");
  }
  if (c.explanation) lines.push(`Why: ${c.explanation}`);
  return lines.join("\n");
}

/**
 * Identifies the slide itself, not its state: answering, retrying or revealing an
 * answer keeps the key, so the tutor explains each slide once.
 */
export function tutorSlideKey(c: TutorContext): string {
  return JSON.stringify([c.screen, c.title ?? "", c.sessionTitle ?? "", c.biteType ?? "", c.progress?.round ?? -1, c.question?.prompt ?? ""]);
}

/** Appended to a [screen] note to ask for a spoken walk-through; the system prompt keys on the last line. */
export const EXPLAIN_SCREEN = "(The learner hasn't said anything yet.) Explain this screen";

/** Tokens a conversation has used, split the way Gemini Live prices them. */
export interface LiveUsage {
  textIn: number;
  audioIn: number;
  textOut: number;
  audioOut: number;
}

export const emptyLiveUsage = (): LiveUsage => ({ textIn: 0, audioIn: 0, textOut: 0, audioOut: 0 });

interface ModalityCount {
  modality?: string;
  tokenCount?: number;
}

interface LiveUsageMetadata {
  promptTokenCount?: number;
  promptTokensDetails?: ModalityCount[];
  responseTokenCount?: number;
  responseTokensDetails?: ModalityCount[];
  thoughtsTokenCount?: number;
}

const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

function split(total: number, details: ModalityCount[] | undefined): { audio: number; text: number } {
  let audio = 0;
  let detailed = 0;
  for (const d of details ?? []) {
    const n = count(d.tokenCount);
    detailed += n;
    if (d.modality === "AUDIO") audio += n;
  }
  const rest = Math.max(0, total - detailed);
  return { audio, text: detailed - audio + rest };
}

/**
 * Adds one Gemini Live usage report to the running total. Each report covers one
 * model turn, including the context it re-read. Tokens without a modality count as text.
 */
export function addLiveUsage(total: LiveUsage, meta: LiveUsageMetadata | undefined): LiveUsage {
  if (!meta) return total;
  const input = split(count(meta.promptTokenCount), meta.promptTokensDetails);
  const output = split(count(meta.responseTokenCount), meta.responseTokensDetails);
  return {
    textIn: total.textIn + input.text,
    audioIn: total.audioIn + input.audio,
    textOut: total.textOut + output.text + count(meta.thoughtsTokenCount),
    audioOut: total.audioOut + output.audio,
  };
}
