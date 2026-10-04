"use client";

import { useT, type Bi } from "@/lib/locale-context";
import { fmtN } from "@/lib/format";
import type { MonthLite } from "./statement";

/** A month-per-row table of a few figures, newest first. */
export default function MonthTotals({
  months,
  rows,
  columns,
}: {
  months: MonthLite[];
  rows: Array<{ monthId: string; values: number[] }>;
  columns: Bi[];
}) {
  const { locale, l } = useT();
  const name = (id: string) => {
    const m = months.find((x) => x.id === id);
    return m ? (locale === "ru" ? m.nameRu : m.nameEn) : id;
  };
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-[13px] text-muted">
        {locale === "ru" ? "Нет данных" : "No data"}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="stmt">
        <thead>
          <tr>
            <th>{locale === "ru" ? "Месяц" : "Month"}</th>
            {columns.map((c, i) => (
              <th key={i}>{l(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((r) => (
            <tr key={r.monthId}>
              <td>{name(r.monthId)}</td>
              {r.values.map((v, i) => (
                <td key={i}>{Math.abs(v) < 0.5 ? "—" : fmtN(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
