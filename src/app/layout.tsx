import "@/styles/globals.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";

import { TRPCReactProvider } from "@/trpc/react";
import { ThemeProvider } from "@/components/provider/theme-provider";
import { PostHogProvider } from "@/components/provider/posthog-provider";

export const metadata: Metadata = {
  metadataBase: new URL('https://panel.justicerp.com'),
  title: {
    default: "JGN Panel",
    template: "%s | JGN Panel",
  },
  description: "The official control panel for Justice RP. Manage your account, applications, and more.",
  icons: [{ rel: "icon", url: "https://vgrtqyl5lv.ufs.sh/f/dbe186b0-89bf-4548-8b8b-3bbca8d77c0e-29ew.png" }],
  openGraph: {
    title: "JGN Panel",
    description: "The official control panel for Justice RP.",
    url: 'https://panel.justicerp.com',
    siteName: "JGN Panel",
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: "JGN Panel",
    description: "The official control panel for Justice RP.",
  },
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
