function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. Copy apps/web/.env.example to apps/web/.env.local.`);
  return v;
}

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
