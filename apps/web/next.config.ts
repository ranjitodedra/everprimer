import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

/** Private IPv4s so Capacitor / phones on LAN can hit `/_next` HMR in dev. */
function localPrivateIpv4s(): string[] {
  const out = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      const [a, b] = entry.address.split(".").map(Number);
      const isPrivate =
        a === 10 ||
        a === 127 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168);
      if (isPrivate) out.add(entry.address);
    }
  }
  return [...out];
}

const nextConfig: NextConfig = {
  // Verification launches a second dev server. It must not share .next with the one already running.
  ...(process.env.EVERPRIMER_VERIFY_DIST ? { distDir: process.env.EVERPRIMER_VERIFY_DIST } : {}),
  // Workspace packages ship TypeScript source; let Next compile them.
  transpilePackages: ["@eco/ai", "@eco/contracts", "@eco/db", "@eco/learnkit", "@eco/library", "@eco/mastery"],
  typedRoutes: false,
  allowedDevOrigins: localPrivateIpv4s(),
  async headers() {
    // `/a/*` is the artifact origin (ADR-001). It must be framable by a
    // sandboxed `srcdoc` document whose origin is opaque, which the app's
    // `X-Frame-Options: DENY` would block. The artifact route sets its own
    // ADR-001 headers per-response, so we exclude the path here instead of
    // layering app headers on top of it.
    return [
      {
        source: "/((?!a/).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The voice tutor asks for the mic from the app's own pages; lesson frames are sandboxed and never get it.
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
