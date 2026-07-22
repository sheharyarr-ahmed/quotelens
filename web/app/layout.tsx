import type { Metadata } from "next";
import "./globals.css";

// Icons and the social card come from the App Router file conventions in this
// directory: favicon.ico, icon.png, apple-icon.png, opengraph-image.png.
// metadataBase makes the generated card URLs absolute, which every scraper needs.
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_WEB_URL ?? "https://quotelens-ten.vercel.app",
  ),
  title: "QuoteLens",
  description: "Client quote pages for QuoteLens estimates.",
  openGraph: {
    title: "QuoteLens",
    description: "Client quote pages for QuoteLens estimates.",
    siteName: "QuoteLens",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "QuoteLens",
    description: "Client quote pages for QuoteLens estimates.",
  },
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
