"use client";

// Horizontal month picker: every month is one click away, and months without
// data are dimmed so an unfilled period is obvious at a glance. Writes the same
// cookie as the global top-bar switcher so the choice follows you across pages.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { MONTH_COOKIE } from "@/lib/month-cookie";
import type { MonthIn } from "@/lib/engine/types";

export default function MonthStrip({
  months,
  monthId,
  hasData,
  withArrows = true,
}: {
  months: MonthIn[];
  monthId: string;
  /** months carrying data — the rest render dimmed */
  hasData: Set<string>;
  withArrows?: boolean;
}) {
  const { locale } = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function goTo(id: string) {
    document.cookie = `${MONTH_COOKIE}=${id};path=/;max-age=${3600 * 24 * 90}`;
    const p = new URLSearchParams(params.toString());
    p.set("month", id);
    router.push(`${pathname}?${p.toString()}`);
  }

  const idx = months.findIndex((m) => m.id === monthId);
  const short = (m: MonthIn) => {
    const name = locale === "ru" ? m.nameRu : m.nameEn;
    return `${name.split(" ")[0].slice(0, 3)} ’${m.id.slice(2, 4)}`;
  };

  return (
    <div className="mb-5 flex items-center gap-1.5 overflow-x-auto rounded-xl border border-border bg-surface p-1.5">
      {withArrows && (
        <button
          onClick={() => idx > 0 && goTo(months[idx - 1].id)}
          disabled={idx <= 0}
          className="shrink-0 rounded-lg px-2 py-1.5 text-[15px] text-muted transition-colors hover:bg-surface-low hover:text-accent disabled:opacity-30"
          aria-label="prev"
        >
          ‹
        </button>
      )}
      {months.map((m) => {
        const active = m.id === monthId;
        const filled = hasData.has(m.id);
        return (
          <button
            key={m.id}
            onClick={() => goTo(m.id)}
            className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors ${
              active
                ? "bg-accent font-semibold text-white"
                : filled
                  ? "font-medium text-ink hover:bg-accent-soft"
                  : "text-muted/60 hover:bg-surface-low"
            }`}
            title={locale === "ru" ? m.nameRu : m.nameEn}
          >
            {short(m)}
          </button>
        );
      })}
      {withArrows && (
        <button
          onClick={() => idx < months.length - 1 && goTo(months[idx + 1].id)}
          disabled={idx >= months.length - 1}
          className="shrink-0 rounded-lg px-2 py-1.5 text-[15px] text-muted transition-colors hover:bg-surface-low hover:text-accent disabled:opacity-30"
          aria-label="next"
        >
          ›
        </button>
      )}
    </div>
  );
}
