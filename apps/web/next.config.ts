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
  // Workspace packages ship TypeScript source; let Next compile them.
  transpilePackages: ["@eco/ai", "@eco/contracts", "@eco/db", "@eco/learnkit", "@eco/mastery"],
  typedRoutes: false,
  allowedDevOrigins: localPrivateIpv4s(),
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
