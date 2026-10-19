"use client";

// One line on every budget page: which budget and forecast are shown, how far
// the actuals go, and whether the budget's opening still matches the books.
import Link from "next/link";
import { useT } from "@/lib/locale-context";
import { fmtN } from "@/lib/format";
import { shortMonth } from "@/lib/statement-ui";

export interface BudgetStatusInfo {
  approvedName: string;
  approvedAt: string;
  forecastName: string;
  forecastAt: string;
  lastClosed: string | null;
  planStart: string | null;
  budgetOpening: string;
  openingCheck: { key: string; budget: number; books: number }[] | null;
  estimated: string[];
  missingBalances: string[];
  /** the forecast's trucks, HQ payments and units sold come from the supply plan */
  supplyFromPlan: boolean;
}

const date = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

export function BudgetStatus({ info }: { info: BudgetStatusInfo }) {
  const { locale, l } = useT();
  const m = (id: string) => shortMonth(id, locale);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-border bg-surface px-3.5 py-2.5 text-[12.5px]">
      <span>
        <span className="text-muted">{l({ ru: "Бюджет: ", en: "Budget: " })}</span>
        <b>{info.approvedName}</b> <span className="text-muted">({date(info.approvedAt)})</span>
      </span>
      <span>
        <span className="text-muted">{l({ ru: "Прогноз: ", en: "Forecast: " })}</span>
        <b>{info.forecastName}</b> <span className="text-muted">({date(info.forecastAt)})</span>
      </span>
      <span>
        <span className="text-muted">{l({ ru: "Факт: ", en: "Actual: " })}</span>
        {info.lastClosed && info.lastClosed >= "2026-10"
          ? l({ ru: `окт 26 – ${m(info.lastClosed)}`, en: `Oct 26 – ${m(info.lastClosed)}` })
          : l({ ru: "закрытых месяцев в бюджете ещё нет", en: "no closed month in the budget yet" })}
      </span>
      <span className="text-muted">
        {info.planStart
          ? l({ ru: `План с ${m(info.planStart)} — от реальных остатков на конец закрытого месяца`, en: `Plan from ${m(info.planStart)} — from the real balances at the last month-end closed` })
          : l({ ru: "Все месяцы закрыты", en: "All months closed" })}
      </span>
      {info.supplyFromPlan && (
        <Link href="/planning" className="text-muted hover:underline">
          {l({ ru: "Фуры, оплаты HQ и продажи в штуках — из плана поставок", en: "Trucks, HQ payments and units sold come from the supply plan" })}
        </Link>
      )}
      {info.openingCheck &&
        (info.openingCheck.length === 0 ? (
          <span className="text-ok">
            {l({ ru: `✓ Начальные остатки бюджета (${m(info.budgetOpening)}) совпадают с учётом`, en: `✓ The budget's opening (${m(info.budgetOpening)}) matches the books` })}
          </span>
        ) : (
          <span className="text-warn" title={info.openingCheck.map((d) => `${d.key}: ${fmtN(d.budget)} / ${fmtN(d.books)}`).join("\n")}>
            {l({ ru: `Начальные остатки бюджета расходятся с учётом: ${info.openingCheck.length} строк(и)`, en: `The budget's opening differs from the books in ${info.openingCheck.length} line(s)` })}
          </span>
        ))}
      {info.missingBalances.length > 0 && (
        <span className="text-warn">
          {l({
            ru: `Закрыто, но нет остатков на конец месяца (банк, касса, товар в пути): ${info.missingBalances.map(m).join(", ")} — факт и прогноз идут от последнего месяца с остатками`,
            en: `Closed without month-end balances (bank, cash, goods in transit): ${info.missingBalances.map(m).join(", ")} — actuals and the forecast run from the last month that has them`,
          })}
        </span>
      )}
      {info.estimated.includes("customersOwe") && (
        <span className="text-warn">
          {l({ ru: "Долг покупателей TI — оценка по счетам и срокам оплаты", en: "What TI's customers owe is estimated from invoices and payment days" })}
        </span>
      )}
    </div>
  );
}

export function BudgetEmpty() {
  const { l } = useT();
  return (
    <div className="rounded-lg border border-border bg-surface px-5 py-10 text-center text-[13.5px]">
      <p className="mb-3">{l({ ru: "Бюджет ещё не загружен.", en: "No budget has been loaded yet." })}</p>
      <Link href="/budget/inputs" className="text-accent hover:underline">
        {l({ ru: "Загрузить книгу бюджета (v10–v17) на вкладке «Допущения»", en: "Load the budget workbook (v10–v17) on the Assumptions tab" })}
      </Link>
    </div>
  );
}
