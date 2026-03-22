import type { Metadata } from "next";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { TopNav } from "./components/TopNav";

export const metadata: Metadata = {
  title: "UniVerify",
  description: "Tamper-proof diploma registry on Ethereum. Verify academic credentials instantly with cryptographic Merkle proofs.",
};

const fontSans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-uv-sans",
});

const fontMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-uv-mono",
  weight: ["400", "500", "600"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${fontSans.variable} ${fontMono.variable} antialiased`}>
        <TopNav />
        {children}
      </body>
    </html>
  );
}
