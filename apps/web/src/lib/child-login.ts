import { createHmac, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { env } from "@/lib/env";

const scrypt = promisify(scryptCb) as (pin: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, "Usernames are 3–20 lowercase letters, numbers, or underscores");

export const Pin = z.string().trim().regex(/^\d{4,6}$/, "PINs are 4–6 digits");

export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCK_MS = 15 * 60 * 1000;

export function newChildAuthUser(): { id: string; email: string } {
  const id = randomUUID();
  return { id, email: `kid-${id}@${env.childLoginEmailDomain}` };
}

/** The Supabase password for a child login. Only this server can derive it from a PIN. */
export function childPassword(userId: string, pin: string): string {
  return createHmac("sha256", env.childLoginSecret).update(`${userId}:${pin}`).digest("base64url");
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pin, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPin(pin: string, stored: string | null): Promise<boolean> {
  const [scheme, salt, hash] = stored?.split("$") ?? [];
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(pin, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

export function lockedUntil(failedAttempts: number): string | null {
  return failedAttempts >= MAX_PIN_ATTEMPTS ? new Date(Date.now() + PIN_LOCK_MS).toISOString() : null;
}

export function isLocked(until: string | null): boolean {
  return !!until && new Date(until).getTime() > Date.now();
}
