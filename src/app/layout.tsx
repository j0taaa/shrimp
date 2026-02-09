import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shrimp",
  description: "Local computer-use agent"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto min-h-screen max-w-7xl px-4 py-4 md:px-6 md:py-6">
          <header className="mb-4 flex items-center justify-between rounded-xl border bg-card px-4 py-3">
            <div>
              <h1 className="text-lg font-semibold">Shrimp</h1>
              <p className="text-xs text-muted-foreground">Local computer-use agent</p>
            </div>
            <nav className="flex items-center gap-3 text-sm">
              <Link href="/chat" className="hover:underline">
                Chat
              </Link>
              <Link href="/settings" className="hover:underline">
                Settings
              </Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
