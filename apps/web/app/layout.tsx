import type { Metadata } from "next";
import "./globals.css";
import { TopNav } from "./components/TopNav";

export const metadata: Metadata = {
  title: "UniVerify",
  description: "UniVerify diploma registry",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <TopNav />
        {children}
      </body>
    </html>
  );
}
