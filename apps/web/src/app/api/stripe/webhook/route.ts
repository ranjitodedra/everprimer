import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { handleStripeEvent } from "@/lib/billing";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing signature" }, { status: 400 });

  const body = await req.text();
  let event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, env.stripeWebhookSecret);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event);
    return NextResponse.json({ received: true, duplicate: result === "duplicate" });
  } catch (err) {
    console.error("[stripe] webhook failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "retry" }, { status: 500 });
  }
}
