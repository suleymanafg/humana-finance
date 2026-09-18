"use client";

// Frame shared by the five supply-planning screens (owner's design canvas):
// the scoped palette, a sticky section header carrying the one fact every
// screen repeats — the next IBP deadline — and the tab strip.
// The app's own chrome (sidebar, user menu, RU/EN switch) stays where it is,
// so the canvas header drops its duplicate logo and language toggle.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { daysLeftLong, dstr } from "@/lib/planning/ui-format";
import type { OrderSlot } from "@/lib/planning/compute";

const TABS = [
  { href: "/planning/decisions", ru: "Решения", en: "Decisions" },
  { href: "/planning/inventory", ru: "Запасы", en: "Inventory" },
  { href: "/planning/order", ru: "Заказ", en: "Order" },
  { href: "/planning/plan", ru: "План (IBP)", en: "Plan (IBP)" },
  { href: "/planning/scenarios", ru: "Сценарии", en: "Scenarios" },
];

export default function PlanningShell({
  slot,
  children,
}: {
  slot: OrderSlot;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { locale } = useT();
  const ru = locale === "ru";
  // the deadline turns urgent in its last week
  const urgent = slot.daysLeft <= 7;

  return (
    // full-bleed inside AppShell's px-6 py-8 content box; the app header is
    // h-16 and sticky, so the section bar parks directly under it
    <div className="plan-design -mx-6 -mb-8 -mt-8 min-h-[calc(100vh-4rem)] pb-12">
      <div className="sticky top-16 z-30 border-b border-border bg-surface">
        <div className="flex flex-wrap items-center gap-4 px-6 pt-3">
          <div>
            <div className="text-[14px] font-extrabold leading-tight">
              {ru ? "Планирование поставок" : "Supply planning"}
            </div>
            <div className="text-[11px] font-semibold text-muted">
              {ru ? "Humana · DMK Baby, Бремен" : "Humana · DMK Baby, Bremen"}
            </div>
          </div>

          <div
            className="flex items-center gap-2.5 rounded-[9px] border px-3 py-1.5"
            style={{
              borderColor: urgent ? "var(--warn-border)" : "var(--border)",
              background: urgent ? "var(--warn-soft)" : "var(--surface-low)",
            }}
          >
            <span
              className="text-[10px] font-extrabold uppercase tracking-[0.06em]"
              style={{ color: urgent ? "var(--warn-ink)" : "var(--muted)" }}
            >
              {ru ? "Дедлайн" : "Deadline"}
            </span>
            <span className="pnum text-[13px] font-bold">{dstr(slot.deadline)}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-extrabold text-white"
              style={{ background: urgent ? "var(--warn)" : "var(--accent)" }}
            >
              {ru ? `${slot.daysLeft} дн.` : `${slot.daysLeft}d`}
            </span>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-6 pt-2.5">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className="shrink-0 border-b-[3px] px-4 pb-2.5 pt-2 text-[13.5px] font-extrabold transition-colors"
                style={{
                  borderColor: active ? "var(--accent)" : "transparent",
                  color: active ? "var(--accent)" : "var(--muted)",
                }}
              >
                {ru ? tab.ru : tab.en}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="px-6 pt-5">{children}</div>

      <span className="sr-only">{daysLeftLong(slot.daysLeft, ru)}</span>
    </div>
  );
}
