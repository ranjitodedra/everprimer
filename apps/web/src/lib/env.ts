function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. Copy apps/web/.env.example to apps/web/.env.local.`);
  return v;
}

function intIn(name: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function flag(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** fal.ai settings for the per-lesson tutor character. Server only; never NEXT_PUBLIC_. */
export const lessonArtEnv = {
  get falKey() {
    return process.env.FAL_KEY ?? "";
  },
  /** Off when FAL_KEY is missing, so lessons stay plain instead of failing. */
  get enabled() {
    return flag("LESSON_ART_ENABLED", true) && !!this.falKey;
  },
  get model() {
    return process.env.LESSON_ART_MODEL || "fal-ai/flux-2/klein/9b";
  },
  /** Image-to-image endpoint that redraws the talking pose as the teaching pose. */
  get editModel() {
    return process.env.LESSON_ART_EDIT_MODEL || `${this.model}/edit`;
  },
  /** Background removal, so the character stands on the lesson page with nothing behind it. */
  get cutoutModel() {
    return process.env.LESSON_ART_CUTOUT_MODEL || "fal-ai/birefnet/v2";
  },
  /** Characters a single account may generate per UTC day. */
  get dailyLimit() {
    return intIn("LESSON_ART_DAILY_LIMIT", 40, 0, 10_000);
  },
};

/** Gemini Live settings for the voice tutor. Server only; never NEXT_PUBLIC_. */
export const liveTutorEnv = {
  get apiKey() {
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
  },
  get enabled() {
    return flag("TUTOR_LIVE_ENABLED", true) && !!this.apiKey;
  },
  get model() {
    return process.env.TUTOR_LIVE_MODEL || "gemini-3.8-live";
  },
  /** The SDK documents ephemeral tokens for v1alpha; override if Google moves them. */
  get apiVersion() {
    return process.env.TUTOR_LIVE_API_VERSION || "v1alpha";
  },
  get voice() {
    return process.env.TUTOR_LIVE_VOICE || "Puck";
  },
};

/**
 * Artifact origin: the second, cookie-less registrable domain library artifacts load from
 * (see Docs/artifact-library/decisions/ADR-001-artifact-origin.md). In dev we point it at
 * `127.0.0.1:3000` so the same `next dev` serves both the app and the artifact routes but
 * on a different origin. In prod it is a separate registrable domain, e.g.
 * `https://everprimer-artifacts.app`. When unset, library bites quietly fall back to the
 * built-in visual, so the app keeps working.
 */
export const artifactHostEnv = {
  get origin() {
    const raw = process.env.ARTIFACT_ORIGIN?.trim();
    if (!raw) return null;
    try {
      const url = new URL(raw);
      return `${url.protocol}//${url.host}`;
    } catch {
      return null;
    }
  },
  get host() {
    const o = this.origin;
    return o ? new URL(o).host : null;
  },
  /** HMAC-SHA256 key used to sign draft-preview URLs. Rotating it invalidates every outstanding draft link. */
  get draftSecret() {
    return process.env.ARTIFACT_DRAFT_SECRET ?? "";
  },
};

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
  /** Derives child-login passwords from PINs. Rotating it breaks every child login. */
  get childLoginSecret() {
    const v = required("CHILD_LOGIN_SECRET");
    if (v.length < 32) throw new Error("CHILD_LOGIN_SECRET must be at least 32 characters.");
    return v;
  },
  get childLoginEmailDomain() {
    return process.env.CHILD_LOGIN_EMAIL_DOMAIN || "child-login.everprimer.invalid";
  },
  get stripeSecretKey() {
    return required("STRIPE_SECRET_KEY");
  },
  get stripeWebhookSecret() {
    return required("STRIPE_WEBHOOK_SECRET");
  },
  get stripePricePlus() {
    return required("STRIPE_PRICE_PLUS");
  },
  get stripePriceMax() {
    return required("STRIPE_PRICE_MAX");
  },
  /** Hosted Checkout does not load Stripe.js. Present so the publishable key is configured beside the secret. */
  get stripePublishableKey() {
    return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
  },
};
