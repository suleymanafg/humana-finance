// The budget's statements by month as estimate and actual: P&L, cash flow,
// balance sheet and stock. A closed month shows the actual next to the estimate
// kept at its start (or, when asked, the original budget); open months show the
// latest estimate.
import { pageContext, type SearchParams } from "@/lib/page-context";
import { loadBudget, statusInfo } from "@/lib/budget/data";
import { BUDGET_STATEMENTS, statementGrid, type BudgetView, type CompareWith } from "@/lib/budget/statements";
import { Notice, Segmented, Toolbar } from "@/components/statement";
import BudgetTable from "@/components/budget/BudgetTable";
import { BudgetEmpty, BudgetStatus } from "@/components/budget/BudgetStatus";
import SaveEstimate from "@/components/budget/SaveEstimate";

export const dynamic = "force-dynamic";

const VIEWS = [
  { value: "pnl", label: { ru: "ОПиУ", en: "P&L" } },
  { value: "cash", label: { ru: "Движение денег", en: "Cash flow" } },
  { value: "balance", label: { ru: "Баланс", en: "Balance sheet" } },
  { value: "stock", label: { ru: "Запасы", en: "Stock" } },
];
const COMPARE = [
  { value: "start", label: { ru: "Факт против оценки на начало месяца", en: "Actual vs the estimate at the month's start" } },
  { value: "original", label: { ru: "Против исходного бюджета", en: "Vs the original budget" } },
];

export default async function BudgetStatementsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const data = await loadBudget();
  if (data.empty) return <BudgetEmpty />;
  const view: BudgetView = sp.view === "cash" || sp.view === "balance" || sp.view === "stock" ? sp.view : "pnl";
  const compareWith: CompareWith = sp.compare === "original" ? "original" : "start";
  const grid = statementGrid(BUDGET_STATEMENTS[view], view, data.months, data, compareWith);
  const firstOpen = data.plan?.months[0] ?? null;
  const kept = firstOpen ? data.estimates.find((e) => e.monthId === firstOpen) ?? null : null;

  return (
    <>
      <BudgetStatus info={statusInfo(data)} />
      <Toolbar>
        <Segmented param="view" value={view} options={VIEWS} />
        <Segmented param="compare" value={compareWith} options={COMPARE} />
        {firstOpen && ctx.isAdmin && <SaveEstimate month={firstOpen} keptAt={kept?.takenAt ?? null} />}
      </Toolbar>
      {view === "cash" && data.actuals.length > 0 && (
        <Notice>
          {ctx.l({
            ru: "В закрытых месяцах поступления от покупателей, НДС и налог на прибыль пока не разнесены — они в строке «Прочее по банку», которая сводит месяц к остатку в банке. Их оценка видна под фактом.",
            en: "In closed months, collections, VAT and profit tax are not split out yet — they sit in «Other through the bank», which closes the month to the bank balance. Their estimate shows below the actual.",
          })}
        </Notice>
      )}
      <BudgetTable grid={grid} firstPlan={firstOpen} tone={view === "pnl" || view === "cash"} compareWith={compareWith} />
    </>
  );
}
