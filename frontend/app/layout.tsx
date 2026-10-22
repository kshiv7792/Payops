import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PayOps · Invoice operations",
  description: "PayOps keeps invoice operations clear with AI-powered extraction, validation, approvals and payment tracking.",
  icons: { icon: "/payops-mark.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
