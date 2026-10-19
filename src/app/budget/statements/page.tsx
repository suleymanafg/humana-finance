// The budget's statements by month: P&L, cash flow, balance sheet and stock —
// the forecast (closed months actual, the rest plan), the approved budget, or
// the difference between them.
import { pageContext, type SearchParams } from "@/lib/page-context";
import { loadBudget, statusInfo } from "@/lib/budget/data";
import { BUDGET_STATEMENTS, statementGrid, type Basis, type BudgetView } from "@/lib/budget/statements";
import { Notice, Segmented, Toolbar } from "@/components/statement";
import BudgetTable from "@/components/budget/BudgetTable";
import { BudgetEmpty, BudgetStatus } from "@/components/budget/BudgetStatus";

export const dynamic = "force-dynamic";

const VIEWS = [
  { value: "pnl", label: { ru: "ОПиУ", en: "P&L" } },
  { value: "cash", label: { ru: "Движение денег", en: "Cash flow" } },
  { value: "balance", label: { ru: "Баланс", en: "Balance sheet" } },
  { value: "stock", label: { ru: "Запасы", en: "Stock" } },
];
const BASES = [
  { value: "forecast", label: { ru: "Прогноз (факт + план)", en: "Forecast (actual + plan)" } },
  { value: "budget", label: { ru: "Утверждённый бюджет", en: "Approved budget" } },
  { value: "diff", label: { ru: "Прогноз − бюджет", en: "Forecast − budget" } },
];

export default async function BudgetStatementsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const data = await loadBudget();
  if (data.empty) return <BudgetEmpty />;
  const view: BudgetView = sp.view === "cash" || sp.view === "balance" || sp.view === "stock" ? sp.view : "pnl";
  const basis: Basis = sp.basis === "budget" || sp.basis === "diff" ? sp.basis : "forecast";
  const grid = statementGrid(BUDGET_STATEMENTS[view], data.months, data, basis);
  const firstPlan = basis === "budget" ? null : data.plan?.months[0] ?? null;

  return (
    <>
      <BudgetStatus info={statusInfo(data)} />
      <Toolbar>
        <Segmented param="view" value={view} options={VIEWS} />
        <Segmented param="basis" value={basis} options={BASES} />
      </Toolbar>
      {view === "cash" && data.actuals.length > 0 && basis !== "budget" && (
        <Notice>
          {ctx.l({
            ru: "В закрытых месяцах поступления от покупателей, НДС и налог на прибыль пока не разнесены — они в строке «Прочее по банку», которая сводит месяц к остатку в банке.",
            en: "In closed months, collections, VAT and profit tax are not split out yet — they sit in «Other through the bank», which closes the month to the bank balance.",
          })}
        </Notice>
      )}
      <BudgetTable grid={grid} firstPlan={firstPlan} />
    </>
  );
}
