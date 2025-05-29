import "@/styles/globals.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";

import { TRPCReactProvider } from "@/trpc/react";
import { ThemeProvider } from "@/components/provider/theme-provider";
import { PostHogProvider } from "@/components/provider/posthog-provider";

export const metadata: Metadata = {
  title: "JGN Panel",
  description: "JGN Panel",
  icons: [{ rel: "icon", url: "https://vgrtqyl5lv.ufs.sh/f/dbe186b0-89bf-4548-8b8b-3bbca8d77c0e-29ew.png" }],
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable}`} suppressHydrationWarning>
      <body>
        <PostHogProvider>
          <TRPCReactProvider>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              {children}
            </ThemeProvider>
          </TRPCReactProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
