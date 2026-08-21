"use client";

// Sub-navigation of the supply-planning section: four pages, one section.
// Quiet underline tabs per the approved design canvas.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/locale-context";

const TABS = [
  { href: "/planning", ru: "План (IBP)", en: "Plan (IBP)" },
  { href: "/planning/inventory", ru: "Запасы", en: "Inventory" },
  { href: "/planning/decisions", ru: "Решения", en: "Decisions" },
  { href: "/planning/scenarios", ru: "Сценарии", en: "Scenarios" },
  { href: "/planning/order", ru: "Заказ", en: "Order" },
];

export default function PlanningTabs() {
  const pathname = usePathname();
  const { locale } = useT();
  const ru = locale === "ru";
  return (
    <div className="mb-5 flex gap-7 border-b border-border">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px px-0.5 py-2.5 text-[13.5px] transition-colors ${
              active
                ? "border-b-2 border-accent font-semibold text-accent"
                : "border-b-2 border-transparent text-muted hover:text-foreground"
            }`}
          >
            {ru ? t.ru : t.en}
          </Link>
        );
      })}
    </div>
  );
}
