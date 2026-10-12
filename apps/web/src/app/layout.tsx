import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import { logo } from "@/components/logo";
import { NativeShell } from "@/components/native-shell";
import "./globals.css";

const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"], display: "swap", axes: ["opsz", "wdth"] });

export const metadata: Metadata = {
  title: { default: "Everprimer", template: "%s · Everprimer" },
  description: "Lessons written for one child, around what they love.",
  icons: { icon: { url: logo.src, type: "image/svg+xml" } },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bricolage.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <NativeShell />
        {children}
      </body>
    </html>
  );
}
