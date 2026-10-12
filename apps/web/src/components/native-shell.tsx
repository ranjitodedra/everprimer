"use client";

import { useEffect } from "react";

/**
 * Capacitor-only chrome. Plugins load in the browser after mount so Next.js
 * SSR never evaluates them. On the web this is a no-op.
 */
export function NativeShell() {
  useEffect(() => {
    let cancelled = false;
    let remove: (() => void) | undefined;

    void (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform() || cancelled) return;

      const [{ App }, { SplashScreen }, { StatusBar, Style }] = await Promise.all([
        import("@capacitor/app"),
        import("@capacitor/splash-screen"),
        import("@capacitor/status-bar"),
      ]);

      document.documentElement.classList.add("native-app");
      await StatusBar.setStyle({ style: Style.Dark });
      if (Capacitor.getPlatform() === "android") {
        await StatusBar.setBackgroundColor({ color: "#ffffff" });
      }
      await SplashScreen.hide();

      const handle = await App.addListener("backButton", ({ canGoBack }) => {
        if (canGoBack || window.history.length > 1) {
          window.history.back();
        } else {
          void App.minimizeApp();
        }
      });

      if (cancelled) {
        handle.remove();
        return;
      }
      remove = () => handle.remove();
    })();

    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);

  return null;
}
