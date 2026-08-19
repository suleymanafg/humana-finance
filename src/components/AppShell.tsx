"use client";

// App shell per the approved Stitch design: fixed navy sidebar with a 4px
// left-bar active indicator, and a sticky top bar carrying the global month
// switcher, notifications and the greeting.
import { useEffect, useRef, useState, useTransition } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/lib/locale-context";
import type { DictKey } from "@/lib/i18n";
import type { Role } from "@/lib/auth-crypto";
import { MONTH_COOKIE } from "@/lib/month-cookie";
import ChatWidget from "./ChatWidget";
import {
  IconBell,
  IconBuilding,
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconDashboard,
  IconEdit,
  IconInbox,
  IconLock,
  IconLogout,
  IconPercent,
  IconPnl,
  IconSales,
  IconScale,
  IconSettings,
  IconShield,
  IconStore,
  IconTruck,
} from "./icons";

type NavItem = { href: string; key: DictKey; icon: React.ComponentType<{ size?: number }>; adminOnly?: boolean };

/** Fixed-size spinner slot inside each nav link; visible only while that
 *  link's navigation is pending, so a click always gives instant feedback. */
function NavSpinner() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 border-sidebar-fg/30 border-t-sidebar-fg-strong transition-opacity ${
        pending ? "animate-spin opacity-100" : "opacity-0"
      }`}
    />
  );
}

const NAV: NavItem[] = [
  { href: "/", key: "navDashboard", icon: IconDashboard },
  { href: "/pnl", key: "navPnl", icon: IconPnl },
  { href: "/balance", key: "navBalance", icon: IconScale },
  { href: "/sales", key: "navSales", icon: IconSales },
  { href: "/shipments", key: "navShipments", icon: IconTruck },
  { href: "/taxes", key: "navTaxes", icon: IconPercent },
  { href: "/opex-ti", key: "navOpexTi", icon: IconBuilding },
  { href: "/opex-fargo", key: "navOpexFargo", icon: IconStore },
  { href: "/close", key: "navClose", icon: IconEdit },
  { href: "/requests", key: "navRequests", icon: IconInbox, adminOnly: true },
  { href: "/health", key: "navHealth", icon: IconShield, adminOnly: true },
  { href: "/settings", key: "navSettings", icon: IconSettings, adminOnly: true },
];

interface MonthLite {
  id: string;
  nameRu: string;
  nameEn: string;
}
interface StatusLite {
  monthId: string;
  status: "complete" | "partial" | "empty";
  closed: boolean;
}

export default function AppShell({
  username,
  role,
  months,
  status,
  fallbackMonth,
  healthWarnings,
  aiConfigured,
  children,
}: {
  username: string;
  role: Role;
  months: MonthLite[];
  status: StatusLite[];
  fallbackMonth: string;
  healthWarnings: number;
  aiConfigured: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { locale, setLocale, t } = useT();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const now = new Date();
  const hour = now.getHours();
  const greeting = t(hour < 12 ? "goodMorning" : hour < 18 ? "goodDay" : "goodEvening");
  const dateLine = now.toLocaleDateString(locale === "ru" ? "ru-RU" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-sidebar text-sidebar-fg">
        <div className="mb-4 flex items-center gap-3 p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-accent-hover text-white">
            <IconScale size={20} />
          </div>
          <div className="leading-tight">
            <div className="font-display text-[16px] font-bold text-sidebar-fg-strong">Humana Finance</div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-sidebar-fg/70">
              Turbo Impex · Fargo
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto">
          <ul className="space-y-0.5">
            {NAV.filter((item) => !item.adminOnly || role === "ADMIN").map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-3 border-l-4 px-5 py-2.5 text-[13.5px] transition-colors ${
                      active
                        ? "border-[#a9a7ff] bg-white/[0.07] font-medium text-sidebar-fg-strong"
                        : "border-transparent hover:bg-white/[0.04] hover:text-sidebar-fg-strong"
                    }`}
                  >
                    <span className={active ? "text-[#a9a7ff]" : "text-sidebar-fg/70"}>
                      <Icon size={17} />
                    </span>
                    <span className="flex-1 truncate">{t(item.key)}</span>
                    <NavSpinner />
                    {item.href === "/health" && healthWarnings > 0 && (
                      <span className="rounded-full bg-[#b54708]/30 px-1.5 text-[11px] font-semibold text-[#ffb85c]">
                        {healthWarnings}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-sidebar-line p-5">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-[13px] font-semibold uppercase text-sidebar-fg-strong">
              {username.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="label-caps !text-sidebar-fg/60">{role === "ADMIN" ? "Администратор" : role === "STAFF" ? "Сотрудник" : "Просмотр"}</div>
              <div className="truncate text-[13px] text-sidebar-fg-strong">{username}</div>
            </div>
            <button
              onClick={logout}
              title={t("logout")}
              className="flex h-7 w-7 items-center justify-center rounded text-sidebar-fg/70 transition-colors hover:bg-white/10 hover:text-sidebar-fg-strong"
            >
              <IconLogout size={15} />
            </button>
          </div>
          <div className="flex rounded bg-white/[0.06] p-0.5">
            {(["ru", "en"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLocale(l)}
                className={`flex-1 rounded py-1 text-[11.5px] font-semibold uppercase tracking-wide transition-colors ${
                  locale === l ? "bg-white/[0.14] text-sidebar-fg-strong" : "text-sidebar-fg/60 hover:text-sidebar-fg"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="ml-60 flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border bg-surface/95 px-6 backdrop-blur">
          <MonthSwitcher months={months} status={status} fallbackMonth={fallbackMonth} />
          <div className="flex items-center gap-5">
            {role === "ADMIN" && (
              <Link
                href="/health"
                title={t("navHealth")}
                className="relative p-1.5 text-muted transition-colors hover:text-accent"
              >
                <IconBell size={19} />
                {healthWarnings > 0 && (
                  <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full border-2 border-surface bg-danger" />
                )}
              </Link>
            )}
            <div className="border-l border-border pl-5 text-right leading-tight">
              <div className="text-[13px]">
                {greeting}, {username}
              </div>
              <div className="label-caps">{dateLine}</div>
            </div>
          </div>
        </header>
        {role === "VIEWER" && (
          <div className="mx-6 mt-4 rounded border border-accent/15 bg-accent-soft-bg px-3.5 py-2 text-[13px] text-accent">
            {t("viewerReadOnly")}
          </div>
        )}
        <div className="mx-auto w-full max-w-[1440px] flex-1 px-6 py-8">{children}</div>
      </main>
      <ChatWidget configured={aiConfigured} canWrite={role === "ADMIN"} />
    </div>
  );
}

/** Global month switcher: ‹ Month › with a completeness-dot popover. */
function MonthSwitcher({
  months,
  status,
  fallbackMonth,
}: {
  months: MonthLite[];
  status: StatusLite[];
  fallbackMonth: string;
}) {
  const { locale, t } = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const popRef = useRef<HTMLDivElement>(null);

  // fallbackMonth is already cookie-resolved on the server, so SSR and the
  // client agree; only an explicit ?month= overrides it
  const raw = params.get("month") ?? fallbackMonth;
  const current = months.some((m) => m.id === raw) ? raw : fallbackMonth;
  const idx = months.findIndex((m) => m.id === current);
  const name = (m: MonthLite | undefined) => (m ? (locale === "ru" ? m.nameRu : m.nameEn) : "");

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  function goTo(monthId: string) {
    document.cookie = `${MONTH_COOKIE}=${monthId};path=/;max-age=${3600 * 24 * 90}`;
    const p = new URLSearchParams(params.toString());
    p.set("month", monthId);
    startTransition(() => router.push(`${pathname}?${p.toString()}`));
    setOpen(false);
  }

  const dot = (s: StatusLite["status"] | undefined) =>
    s === "complete" ? "bg-ok" : s === "partial" ? "bg-warn" : "bg-border-strong";

  return (
    <div className="relative flex items-center gap-2" ref={popRef}>
      <h2 className={`font-display text-[20px] font-bold text-accent transition-opacity ${pending ? "opacity-50" : ""}`}>
        {name(months[idx])}
      </h2>
      {status.find((x) => x.monthId === current)?.closed && (
        <span className="text-muted" title={t("monthClosedBadge")}>
          <IconLock size={14} />
        </span>
      )}
      <span
        aria-hidden
        className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 border-accent/30 border-t-accent transition-opacity ${
          pending ? "animate-spin opacity-100" : "opacity-0"
        }`}
      />
      <div className="ml-1 flex items-center">
        <button
          onClick={() => idx > 0 && goTo(months[idx - 1].id)}
          disabled={idx <= 0}
          className="p-1 text-muted transition-colors hover:text-accent disabled:opacity-30"
        >
          <IconChevronLeft size={18} />
        </button>
        <button
          onClick={() => setOpen(!open)}
          className={`p-1.5 transition-colors hover:text-accent ${open ? "text-accent" : "text-muted"}`}
        >
          <IconCalendar size={17} />
        </button>
        <button
          onClick={() => idx < months.length - 1 && goTo(months[idx + 1].id)}
          disabled={idx >= months.length - 1}
          className="p-1 text-muted transition-colors hover:text-accent disabled:opacity-30"
        >
          <IconChevronRight size={18} />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 top-11 z-50 w-72 rounded-lg border border-border bg-surface p-2 shadow-xl">
          <div className="grid grid-cols-2 gap-1">
            {months.map((m) => {
              const st = status.find((x) => x.monthId === m.id);
              const active = m.id === current;
              return (
                <button
                  key={m.id}
                  onClick={() => goTo(m.id)}
                  className={`flex items-center justify-between rounded px-2.5 py-1.5 text-left text-[12.5px] transition-colors ${
                    active ? "bg-accent-soft-bg font-medium text-accent" : "hover:bg-surface-low"
                  }`}
                >
                  <span className="truncate">{name(m)}</span>
                  <span className="ml-2 flex shrink-0 items-center gap-1.5">
                    {st?.closed && (
                      <span className="text-muted">
                        <IconLock size={11} />
                      </span>
                    )}
                    <span className={`h-1.5 w-1.5 rounded-full ${dot(st?.status)}`} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
