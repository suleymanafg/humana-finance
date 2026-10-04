"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/lib/locale-context";
import type { Role } from "@/lib/auth-crypto";
import { MONTH_COOKIE } from "@/lib/month-cookie";
import { locate, visibleSections, type NavSection } from "@/lib/nav";
import ChatWidget from "./ChatWidget";
import { IconChevronLeft, IconChevronRight, IconLock } from "./icons";

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

const ROLE_LABEL: Record<string, { ru: string; en: string }> = {
  ADMIN: { ru: "Администратор", en: "Administrator" },
  STAFF: { ru: "Сотрудник", en: "Staff" },
  VIEWER: { ru: "Просмотр", en: "Viewer" },
};

function PendingDot() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-sidebar-fg-strong transition-opacity ${
        pending ? "animate-pulse opacity-100" : "opacity-0"
      }`}
    />
  );
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
  const tabQuery = useSearchParams();
  const { locale, setLocale, l } = useT();
  const router = useRouter();
  const sections = visibleSections(role);
  const { section, page } = locate(pathname);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const item = (s: NavSection) => {
    const active = section?.key === s.key;
    return (
      <li key={s.key}>
        <Link
          href={s.pages[0].href}
          className={`flex items-center gap-2 border-l-2 px-5 py-2 text-[13.5px] transition-colors ${
            active
              ? "border-sidebar-accent bg-white/[0.07] font-medium text-sidebar-fg-strong"
              : "border-transparent text-sidebar-fg hover:bg-white/[0.04] hover:text-sidebar-fg-strong"
          }`}
        >
          <span className="truncate">{l(s.label)}</span>
          {s.key === "admin" && healthWarnings > 0 && (
            <span className="ml-1 rounded-full bg-white/10 px-1.5 text-[11px] font-semibold text-sidebar-fg-strong">
              {healthWarnings}
            </span>
          )}
          <PendingDot />
        </Link>
      </li>
    );
  };

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-sidebar text-sidebar-fg">
        <div className="px-5 pb-6 pt-6">
          <div className="font-display text-[16px] font-bold tracking-[-0.01em] text-sidebar-fg-strong">
            Humana Finance
          </div>
          <div className="mt-0.5 text-[10.5px] uppercase tracking-[0.14em] text-sidebar-fg/70">Turbo Impex · Fargo</div>
        </div>

        <nav className="flex-1 overflow-y-auto pb-4">
          <ul className="space-y-px">{sections.filter((s) => s.group === "main").map(item)}</ul>
          {sections.some((s) => s.group === "admin") && (
            <ul className="mt-4 space-y-px border-t border-sidebar-line pt-4">
              {sections.filter((s) => s.group === "admin").map(item)}
            </ul>
          )}
        </nav>

        <div className="border-t border-sidebar-line px-5 py-4">
          <div className="truncate text-[13px] text-sidebar-fg-strong">{username}</div>
          <div className="text-[11px] text-sidebar-fg/70">{l(ROLE_LABEL[role] ?? ROLE_LABEL.VIEWER)}</div>
          <div className="mt-3 flex items-center justify-between">
            <div className="flex rounded bg-white/[0.06] p-0.5">
              {(["ru", "en"] as const).map((x) => (
                <button
                  key={x}
                  onClick={() => setLocale(x)}
                  className={`rounded px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                    locale === x ? "bg-white/[0.14] text-sidebar-fg-strong" : "text-sidebar-fg/70 hover:text-sidebar-fg"
                  }`}
                >
                  {x}
                </button>
              ))}
            </div>
            <button
              onClick={logout}
              className="text-[12px] text-sidebar-fg/80 transition-colors hover:text-sidebar-fg-strong"
            >
              {locale === "ru" ? "Выйти" : "Log out"}
            </button>
          </div>
        </div>
      </aside>

      <main className="ml-60 flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center border-b border-border bg-surface/95 px-8 backdrop-blur">
          <MonthSwitcher months={months} status={status} fallbackMonth={fallbackMonth} />
        </header>
        {role === "VIEWER" && (
          <div className="mx-8 mt-4 rounded border border-border bg-surface-low px-3.5 py-2 text-[13px] text-muted">
            {locale === "ru" ? "Режим просмотра: изменения недоступны" : "View only: changes are disabled"}
          </div>
        )}
        <div className="mx-auto w-full max-w-[1440px] flex-1 px-8 pb-16 pt-7">
          {section && !section.ownHeader && (
            <div className="mb-6">
              <h1 className="font-display text-[22px] font-semibold tracking-[-0.015em]">{l(section.label)}</h1>
              {section.pages.length > 1 && (
                <nav className="mt-4 flex gap-6 border-b border-border">
                  {section.pages.map((p) => {
                    const active = page?.href === p.href;
                    // pages of a section share their filters (entity, units, selection)
                    const qs = tabQuery.toString();
                    return (
                      <Link
                        key={p.href}
                        href={qs ? `${p.href}?${qs}` : p.href}
                        className={`-mb-px border-b-2 pb-2.5 text-[13.5px] transition-colors ${
                          active
                            ? "border-accent font-medium text-foreground"
                            : "border-transparent text-muted hover:text-foreground"
                        }`}
                      >
                        {l(p.label)}
                      </Link>
                    );
                  })}
                </nav>
              )}
            </div>
          )}
          {children}
        </div>
      </main>
      <ChatWidget configured={aiConfigured} canWrite={role === "ADMIN"} />
    </div>
  );
}

/** ‹ Month › with a popover listing every month and its data completeness. */
function MonthSwitcher({
  months,
  status,
  fallbackMonth,
}: {
  months: MonthLite[];
  status: StatusLite[];
  fallbackMonth: string;
}) {
  const { locale } = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const popRef = useRef<HTMLDivElement>(null);

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
  const closed = status.find((x) => x.monthId === current)?.closed;

  return (
    <div className="relative flex items-center gap-1" ref={popRef}>
      <button
        onClick={() => idx > 0 && goTo(months[idx - 1].id)}
        disabled={idx <= 0}
        aria-label={locale === "ru" ? "Предыдущий месяц" : "Previous month"}
        className="rounded p-1 text-muted transition-colors hover:text-foreground disabled:opacity-30"
      >
        <IconChevronLeft size={17} />
      </button>
      <button
        onClick={() => setOpen(!open)}
        className={`min-w-[150px] rounded px-2 py-1 text-center font-display text-[15px] font-semibold transition-opacity hover:bg-surface-low ${
          pending ? "opacity-50" : ""
        }`}
      >
        {name(months[idx])}
      </button>
      <button
        onClick={() => idx < months.length - 1 && goTo(months[idx + 1].id)}
        disabled={idx >= months.length - 1}
        aria-label={locale === "ru" ? "Следующий месяц" : "Next month"}
        className="rounded p-1 text-muted transition-colors hover:text-foreground disabled:opacity-30"
      >
        <IconChevronRight size={17} />
      </button>
      {closed && (
        <span className="ml-2 flex items-center gap-1 text-[12px] text-muted">
          <IconLock size={12} />
          {locale === "ru" ? "Месяц закрыт" : "Month closed"}
        </span>
      )}

      {open && (
        <div className="absolute left-0 top-10 z-50 w-72 rounded-lg border border-border bg-surface p-2 shadow-xl">
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
                  <span className={`ml-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot(st?.status)}`} />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
