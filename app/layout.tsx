import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Atkinson_Hyperlegible, B612_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const atkinson = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-atkinson",
});

const b612Mono = B612_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-b612",
});

export const metadata: Metadata = {
  title: "bkg-programmer",
  description:
    "Web-based programmer for Quansheng UV-K5/UV-K1 radios running F4HWN firmware",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${atkinson.variable} ${b612Mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
