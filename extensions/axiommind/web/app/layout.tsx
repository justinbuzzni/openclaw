import type { Metadata } from "next";
import Providers from "@/lib/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "AxiomMind",
  description: "Memory Graduation Pipeline + Custom Chat UI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
