import type { Metadata } from "next";
import { fontVariables } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "forge — forge your workflow",
  description: "Unified dev workflow tool. Triage, spec, and ship with parallel agent teams.",
  metadataBase: new URL("https://forge-cc.vercel.app"),
  openGraph: {
    title: "forge",
    description: "Unified dev workflow tool. Triage, spec, and ship with parallel agent teams.",
    siteName: "forge",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "forge",
    description: "Unified dev workflow tool. Triage, spec, and ship with parallel agent teams.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={fontVariables}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
