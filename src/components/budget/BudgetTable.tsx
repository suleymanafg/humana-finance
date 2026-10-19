"use client";

// A budget statement by month as estimate and actual: a closed month shows the
// actual, under it the estimate it is compared with and the difference; an open
// month shows the latest estimate; the year columns show actual so far + the
// estimate for the rest, under it the original budget. Amounts in full UZS.
import { useT } from "@/lib/locale-context";
import { fmtN } from "@/lib/format";
import { shortMonth } from "@/lib/statement-ui";
import type { CompareWith, StatementGrid } from "@/lib/budget/statements";

export default function BudgetTable({ grid, firstPlan, tone, compareWith }: { grid: StatementGrid; firstPlan: string | null; tone: boolean; compareWith: CompareWith }) {
  const { locale, l } = useT();
  const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  const head = (c: StatementGrid["columns"][number]) => {
    if (c.kind === "period") {
      const y = c.key.slice(1);
      return { top: y === "2026" ? l({ ru: "Окт–дек 2026", en: "Oct–Dec 2026" }) : y, sub: l({ ru: "факт + оценка", en: "actual + estimate" }), ref: l({ ru: "под ним: исх. бюджет", en: "below: original budget" }) };
    }
    if (c.kind === "estimate") return { top: shortMonth(c.key, locale), sub: l({ ru: "оценка", en: "estimate" }), ref: compareWith === "original" ? l({ ru: "под ним: исх. бюджет", en: "below: original budget" }) : null };
    const ref =
      c.source === "start"
        ? l({ ru: `оценка на начало (${dm(c.takenAt!)})`, en: `estimate at the start (${dm(c.takenAt!)})` })
        : c.source === "earlier"
          ? l({ ru: `оценка на начало ${shortMonth(c.sourceMonth!, "ru")}`, en: `estimate at the start of ${shortMonth(c.sourceMonth!, "en")}` })
          : l({ ru: "исх. бюджет", en: "original budget" });
    return { top: shortMonth(c.key, locale), sub: l({ ru: "факт", en: "actual" }), ref: l({ ru: `под ним: ${ref}`, en: `below: ${ref}` }) };
  };
  const tiny = (v: number, decimals: number) => Math.abs(v) < (decimals ? 0.05 : 0.5);
  const fmt = (v: number | null, units: boolean, decimals: number) => {
    if (v == null || tiny(v, decimals)) return <span className="text-muted">—</span>;
    return <span className={!units && v < 0 ? "text-danger" : ""}>{fmtN(v, decimals)}</span>;
  };
  const sub = (v: number | null, ref: number | null | undefined, decimals: number) => {
    if (ref === undefined) return null;
    if ((ref == null || tiny(ref, decimals)) && (v == null || tiny(v, decimals))) return null;
    const diff = v != null && ref != null ? v - ref : null;
    return (
      <div className="text-[10.5px] leading-tight text-muted">
        {ref == null ? "—" : fmtN(ref, decimals)}
        {diff != null && !tiny(diff, decimals) && (
          <span className={`ml-1 ${tone ? (diff > 0 ? "text-ok" : "text-danger") : ""}`}>
            {diff > 0 ? "+" : "−"}
            {fmtN(Math.abs(diff), decimals)}
          </span>
        )}
      </div>
    );
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
                <th key={c.key} className={c.key === firstPlan || c.kind === "period" ? "is-focus" : ""} title={h.ref ?? undefined}>
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
                : r.cells.map((cell, i) => (
                    <td key={grid.columns[i].key} className={grid.columns[i].kind === "period" ? "is-focus" : ""}>
                      {fmt(cell.v, r.units, r.decimals)}
                      {sub(cell.v, cell.ref, r.decimals)}
                    </td>
                  ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11.5px] text-muted">
        {l({
          ru: "Закрытый месяц: факт, под ним серым — оценка, с которой он сравнивается (наведите на заголовок — какая), и разница. Открытый месяц — последняя оценка. Итого за год — факт за закрытые месяцы + оценка за остальные, под ним исходный бюджет.",
          en: "A closed month: the actual, below it in grey the estimate it is compared with (hover the heading for which) and the difference. An open month: the latest estimate. Year totals: actual for the closed months + the estimate for the rest, below them the original budget.",
        })}
      </p>
    </div>
  );
}
