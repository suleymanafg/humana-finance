"use client";

import Link from "next/link";
import { useT, type Bi } from "@/lib/locale-context";
import { fmtN, fmtPct } from "@/lib/format";
import { Figure, SectionTitle } from "./statement";
import MonthBars from "./MonthBars";

interface Point {
  key: string;
  short: string;
  long: string;
  value: number;
  focus?: boolean;
}

const signed = (v: number) => `${v >= 0 ? "+" : "−"}${fmtN(Math.abs(v))}`;

export default function OverviewView({
  monthName,
  figures,
  results,
  attention,
  revenue,
  net,
}: {
  monthName: string;
  figures: {
    net: number;
    netCum: number;
    revenue: number;
    revenuePrev: number | null;
    margin: number | null;
    owes: number;
    owesPrev: number | null;
    stock: number;
    stockUnits: number;
  };
  results: Array<{ label: Bi; month: number; cum: number; strong?: boolean; href: string }>;
  attention: Array<{ text: Bi; href: string }>;
  revenue: Point[];
  net: Point[];
}) {
  const { l } = useT();
  const change = (now: number, prev: number | null) =>
    prev == null ? undefined : `${l({ ru: "к прошлому месяцу", en: "vs last month" })} ${signed(now - prev)}`;
  return (
    <>
      <div className="mb-8 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Figure
          label={l({ ru: "Чистая прибыль группы за месяц", en: "Group net profit, month" })}
          value={fmtN(figures.net)}
          tone={figures.net < 0 ? "neg" : undefined}
          sub={`${l({ ru: "с начала", en: "to date" })} ${fmtN(figures.netCum)}`}
        />
        <Figure
          label={l({ ru: "Выручка без НДС", en: "Revenue, ex-VAT" })}
          value={fmtN(figures.revenue)}
          sub={
            figures.margin != null
              ? `${l({ ru: "валовая маржа", en: "gross margin" })} ${fmtPct(figures.margin)}`
              : change(figures.revenue, figures.revenuePrev)
          }
        />
        <Figure label={l({ ru: "Fargo должен TI", en: "Fargo owes TI" })} value={fmtN(figures.owes)} sub={change(figures.owes, figures.owesPrev)} />
        <Figure
          label={l({ ru: "Товар по стоимости TI", en: "Stock at TI landed cost" })}
          value={fmtN(figures.stock)}
          sub={`${fmtN(figures.stockUnits)} ${l({ ru: "шт", en: "units" })}`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <div className="min-w-0">
          <SectionTitle>{l({ ru: "Результаты", en: "Results" })}</SectionTitle>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <table className="stmt">
              <thead>
                <tr>
                  <th>{l({ ru: "Чистая прибыль", en: "Net profit" })}</th>
                  <th>{monthName}</th>
                  <th>{l({ ru: "С начала", en: "To date" })}</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className={r.strong ? "is-total" : ""}>
                    <td>
                      <Link href={r.href} className="hover:text-accent hover:underline">
                        {l(r.label)}
                      </Link>
                    </td>
                    <td className={r.month < 0 ? "text-danger" : ""}>{fmtN(r.month)}</td>
                    <td className={r.cum < 0 ? "text-danger" : ""}>{fmtN(r.cum)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="min-w-0">
          <SectionTitle>{l({ ru: "Требует внимания", en: "Needs attention" })}</SectionTitle>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            {attention.length === 0 ? (
              <div className="px-4 py-5 text-[13px] text-muted">
                {l({ ru: "Данные за месяц внесены, проверки пройдены.", en: "The month's data is in and every check passes." })}
              </div>
            ) : (
              <ul>
                {attention.map((a, i) => (
                  <li key={i} className="border-b border-border last:border-0">
                    <Link href={a.href} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] hover:bg-surface-low">
                      <span>{l(a.text)}</span>
                      <span className="shrink-0 text-[12px] text-accent">{l({ ru: "Открыть", en: "Open" })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 grid gap-6 xl:grid-cols-2">
        <div className="min-w-0">
          <SectionTitle>{l({ ru: "Выручка без НДС по месяцам", en: "Revenue ex-VAT by month" })}</SectionTitle>
          <div className="rounded-lg border border-border bg-surface px-4 pb-2 pt-4">
            <MonthBars points={revenue} label={l({ ru: "Выручка без НДС по месяцам", en: "Revenue ex-VAT by month" })} />
          </div>
        </div>
        <div className="min-w-0">
          <SectionTitle>{l({ ru: "Чистая прибыль группы по месяцам", en: "Group net profit by month" })}</SectionTitle>
          <div className="rounded-lg border border-border bg-surface px-4 pb-2 pt-4">
            <MonthBars points={net} label={l({ ru: "Чистая прибыль группы по месяцам", en: "Group net profit by month" })} />
          </div>
        </div>
      </div>
    </>
  );
}
