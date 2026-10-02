import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import type { CapacitorConfig } from "@capacitor/cli";

const dir = process.cwd();
for (const file of [".env", ".env.local"] as const) {
  const path = resolve(dir, file);
  if (existsSync(path)) loadEnv({ path, override: file === ".env.local" });
}

const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

if (!serverUrl) {
  console.warn(
    "[mobile] CAPACITOR_SERVER_URL is unset. The native app will load the local www/ fallback until you set it and re-run `pnpm mobile:sync`.",
  );
}

const config: CapacitorConfig = {
  appId: "app.everprimer.learn",
  appName: "Everprimer",
  webDir: "www",
  server: {
    ...(serverUrl
      ? {
          url: serverUrl,
          cleartext: serverUrl.startsWith("http://"),
        }
      : {}),
    androidScheme: "https",
    errorPath: "offline.html",
  },
  ios: {
    // Swift Package Manager — no CocoaPods required for `cap sync`.
    path: "ios",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#f8f5ee",
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#f8f5ee",
    },
    Keyboard: {
      resize: "body",
    },
  },
};

export default config;
