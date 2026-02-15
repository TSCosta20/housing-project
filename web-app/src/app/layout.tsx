import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ImoWatch",
  description: "Deals and market view by zone",
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
