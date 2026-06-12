import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Console",
  description: "Production-grade WebSocket console for the Alchemyst AI agent",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="h-full bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
