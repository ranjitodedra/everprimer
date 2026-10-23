/**
 * Prompts for the per-lesson tutor character. The character is drawn once in
 * a talking pose, then redrawn from that image raising a finger to teach, so
 * both poses share one design. Concepts come from a fixed list of non-human,
 * original characters: deterministic per topic, never copyrighted, never a
 * depiction of a real child.
 */

/** Bump when the wording changes so stored characters stay traceable. */
export const CHARACTER_PROMPT_VERSION = "2026-10-17.1";

export const CHARACTER_CONCEPTS = [
  "a round little owl with big friendly eyes and soft feathers",
  "a small friendly fox with a fluffy tail",
  "a cheerful little robot with a rounded body and one short antenna",
  "a chubby bear cub with round ears",
  "a smiling round cloud with small arms and legs",
  "a small round penguin",
  "a cute little dragon with tiny wings",
  "a happy round bunny with long ears",
  "a curious little cat with a striped tail",
  "a bright little star with small arms and legs",
  "a small friendly dinosaur with a round belly",
  "a cheerful little monkey",
] as const;

export type CharacterPose = "talk" | "teach";

export interface CharacterConcept {
  concept: string;
  /** Non-negative 31-bit seed, reused for both poses. */
  seed: number;
}

function fnv1a(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The same topic always gets the same character and seed. */
export function pickCharacterConcept(topicId: string): CharacterConcept {
  const h = fnv1a(topicId);
  return { concept: CHARACTER_CONCEPTS[h % CHARACTER_CONCEPTS.length]!, seed: h & 0x7fffffff };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export interface CharacterTheme {
  primary?: string | null;
  accent?: string | null;
}

function colourLine(theme: CharacterTheme | null | undefined): string {
  const colours = [theme?.primary, theme?.accent].filter((c): c is string => !!c && HEX.test(c));
  return colours.length ? ` Use a soft palette with touches of ${colours.join(" and ")}.` : "";
}

const STYLE =
  "Simple flat 2D cartoon mascot for a children's learning app. Clean bold outlines, flat soft colours, no gradients, no shading noise.";
const FRAME =
  "Full body, standing, centered with generous margin, on a plain solid white background. No ground shadow, no drop shadow, no floor. No text, no letters, no logo, no props, no scenery.";

export function talkPrompt(concept: string, theme?: CharacterTheme | null): string {
  return `${STYLE} The character is ${concept}. It faces the viewer and looks straight into the camera with friendly eyes, mouth open mid-word as if talking, arms relaxed at its sides.${colourLine(theme)} ${FRAME}`;
}

export function teachPrompt(concept: string): string {
  return `The same character as in the image, ${concept}, keeping its exact design, colours, proportions and outline style. It now raises one hand with the index finger pointing up, as if sharing a clever idea, and looks straight into the camera with a warm smile. ${STYLE} ${FRAME}`;
}
