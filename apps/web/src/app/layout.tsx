import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import { logo } from "@/components/logo";
import { NativeShell } from "@/components/native-shell";
import "./globals.css";

const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Everprimer", template: "%s · Everprimer" },
  description: "Parents set the goal. Children explore interactive lessons built just for them.",
  icons: { icon: { url: logo.src, type: "image/svg+xml" } },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Prevent accidental double-tap / pinch zoom in the mobile WebView and on phones.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#f8f5ee",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${nunito.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <NativeShell />
        {children}
      </body>
    </html>
  );
}
