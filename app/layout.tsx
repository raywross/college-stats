import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { BottomNav } from "@/components/layout/BottomNav";
import { CompareTray } from "@/components/compare/CompareTray";
import { AnalyticsProvider } from "@/components/analytics/AnalyticsProvider";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/brand";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME}: ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: "Explore and compare U.S. college admissions, test scores, and student demographics through interactive charts.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No viewportFit "cover": with it, Chrome on iOS draws the page under its own top toolbar, which then covers the
  // header when the toolbar re-expands on scroll up (specs/mobile.md). The browser keeps the page inside safe areas.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0d1f" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <ThemeProvider>
          <TooltipProvider>
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
            <CompareTray />
            <BottomNav />
            {/* Product analytics (specs/product/telemetry.md): a no-op without NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN. */}
            <Suspense fallback={null}>
              <AnalyticsProvider />
            </Suspense>
            {/* Core Web Vitals; its script exists only on Vercel deployments, so elsewhere it would 404 on every page. */}
            {process.env.VERCEL === "1" && <SpeedInsights />}
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
