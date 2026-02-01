import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Providers from "@/lib/providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "AxiomMind Chat",
  description: "Next-gen Memory Graduation Pipeline with AxiomMind",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className="dark">
      <body className={`${inter.variable} font-sans bg-background text-foreground h-screen overflow-hidden selection:bg-primary-500/30`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
