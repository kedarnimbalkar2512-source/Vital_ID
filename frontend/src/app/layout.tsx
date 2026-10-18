import type { Metadata, Viewport } from "next";

import { AuthProvider } from "@/lib/auth";

import "./globals.css";

export const metadata: Metadata = {
  title: "VitalID: medical memory for people whose memory is failing",
  description:
    "One health ID, consented doctor access with an AI brief, an emergency QR, and cognitive tracking that catches decline early.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#257b72" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
