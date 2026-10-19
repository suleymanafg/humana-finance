"use client";

// A budget statement by month: closed months are marked actual, the rest plan,
// then the totals for the rest of 2026 and for 2027. Amounts in full UZS.
import { useT } from "@/lib/locale-context";
import { fmtN } from "@/lib/format";
import { shortMonth } from "@/lib/statement-ui";
import type { StatementGrid } from "@/lib/budget/statements";

export default function BudgetTable({ grid, firstPlan }: { grid: StatementGrid; firstPlan: string | null }) {
  const { locale, l } = useT();
  const head = (c: StatementGrid["columns"][number]) => {
    if (c.kind === "period") {
      const y = c.key.slice(1);
      return { top: y === "2026" ? l({ ru: "Окт–дек 2026", en: "Oct–Dec 2026" }) : y, sub: l({ ru: "итого", en: "total" }) };
    }
    return { top: shortMonth(c.key, locale), sub: c.kind === "actual" ? l({ ru: "факт", en: "actual" }) : l({ ru: "план", en: "plan" }) };
  };
  const fmt = (v: number | null, units: boolean, decimals: number) => {
    if (v == null) return <span className="text-muted">—</span>;
    if (Math.abs(v) < (decimals ? 0.05 : 0.5)) return <span className="text-muted">—</span>;
    return <span className={!units && v < 0 ? "text-danger" : ""}>{fmtN(v, decimals)}</span>;
  };
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="stmt">
        <thead>
          <tr>
            <th className="sticky-col">{l({ ru: "сум", en: "UZS" })}</th>
            {grid.columns.map((c) => {
              const h = head(c);
              return (
                <th key={c.key} className={c.key === firstPlan || c.kind === "period" ? "is-focus" : ""}>
                  <div>{h.top}</div>
                  <div className={`text-[10.5px] font-normal ${c.kind === "actual" ? "text-ok" : "text-muted/80"}`}>{h.sub}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((r) => (
            <tr key={r.key} className={`is-${r.kind}`}>
              <td className="sticky-col">{l(r.label)}</td>
              {r.kind === "header"
                ? grid.columns.map((c) => <td key={c.key} />)
                : r.values.map((v, i) => (
                    <td key={grid.columns[i].key} className={grid.columns[i].kind === "period" ? "is-focus" : ""}>
                      {fmt(v, r.units, r.decimals)}
                    </td>
                  ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
