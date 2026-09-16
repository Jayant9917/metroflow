import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MetroFlow",
  icons: { icon: "/metro.png" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
