import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { LocaleProvider } from "@/lib/locale-context";
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { getComputed } from "@/lib/data";
import { computeMonthStatus, defaultMonthId } from "@/lib/month-status";
import { MONTH_COOKIE } from "@/lib/month-cookie";

const inter = Inter({ variable: "--font-inter", subsets: ["latin", "cyrillic"] });
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin", "cyrillic"] });
// figures use plain Arial (see .num in globals.css) — no webfont needed

export const metadata: Metadata = {
  title: "Humana Finance",
  description: "P&L and financial management for Turbo Impex + Fargo",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const store = await cookies();
  const locale: Locale = store.get(LOCALE_COOKIE)?.value === "en" ? "en" : "ru";
  const session = await getSession();
  // the public fill page is stand-alone: it must never render inside the app
  // shell, including when the owner opens their own link while logged in
  const pathname = (await headers()).get("x-pathname") ?? "";
  // the forced password-change screen must render bare too — that session
  // cannot load the shell's data anyway
  const standalone = pathname.startsWith("/f/") || pathname.startsWith("/change-password");

  let shellData: {
    months: Array<{ id: string; nameRu: string; nameEn: string }>;
    status: Array<{ monthId: string; status: "complete" | "partial" | "empty" }>;
    fallbackMonth: string;
    healthWarnings: number;
  } | null = null;

  if (session && !standalone) {
    const { dataset, computed } = await getComputed();
    const status = computeMonthStatus(dataset);
    const fallback = defaultMonthId(status, dataset.months[0]?.id ?? "");
    // resolve the sticky month cookie on the server so SSR and hydration agree
    const cookieMonth = store.get(MONTH_COOKIE)?.value;
    shellData = {
      months: dataset.months.map((m) => ({ id: m.id, nameRu: m.nameRu, nameEn: m.nameEn })),
      status: status.map((s) => ({ monthId: s.monthId, status: s.status })),
      fallbackMonth:
        cookieMonth && dataset.months.some((m) => m.id === cookieMonth) ? cookieMonth : fallback,
      healthWarnings: computed.healthChecks.filter((h) => h.status === "warn" && h.severity === "warn").length,
    };
  }

  return (
    <html lang={locale} className={`${inter.variable} ${manrope.variable} h-full antialiased`}>
      <body className="min-h-full">
        <LocaleProvider initial={locale}>
          {session && shellData && !standalone ? (
            <AppShell
              username={session.username}
              role={session.role}
              months={shellData.months}
              status={shellData.status}
              fallbackMonth={shellData.fallbackMonth}
              healthWarnings={shellData.healthWarnings}
              aiConfigured={Boolean(process.env.ANTHROPIC_API_KEY)}
            >
              {children}
            </AppShell>
          ) : (
            children
          )}
        </LocaleProvider>
      </body>
    </html>
  );
}
