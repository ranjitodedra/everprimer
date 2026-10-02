import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";

let client: Stripe | null = null;

/** Server-only. Never import this from a client component. */
export function getStripe(): Stripe {
  if (!client) client = new Stripe(env.stripeSecretKey);
  return client;
}
