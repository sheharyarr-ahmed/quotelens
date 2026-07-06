import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuoteLens",
  description: "Client quote pages for QuoteLens estimates.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
