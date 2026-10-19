// «Отчёты по месяцам» — the budget's statements (StatementsView): P&L, cash
// flow, balance sheet and stock by quarter or month. Closed months show the
// actual; the difference to the estimate kept at their start (or the original
// budget) can be switched on.
import { pageContext, type SearchParams } from "@/lib/page-context";
import { loadBudget } from "@/lib/budget/data";
import { BUDGET_STATEMENTS, statementGrid, type BudgetView, type CompareWith } from "@/lib/budget/statements";
import { todayInTashkent } from "@/lib/planning/data";
import { BudgetEmpty } from "@/components/budget/BudgetStatus";
import StatementsView from "@/components/budget/StatementsView";

export const dynamic = "force-dynamic";

export default async function BudgetStatementsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  await pageContext(sp.month);
  const data = await loadBudget();
  if (data.empty) return <BudgetEmpty />;
  const view: BudgetView = sp.view === "cash" || sp.view === "balance" || sp.view === "stock" ? sp.view : "pnl";
  const compareWith: CompareWith = sp.compare === "original" ? "original" : "start";

  return (
    <StatementsView
      view={view}
      grid={statementGrid(BUDGET_STATEMENTS[view], view, data.months, data, compareWith)}
      compareWith={compareWith}
      hasActuals={data.actuals.length > 0}
      asOf={todayInTashkent()}
      lastClosed={data.lastClosed}
    />
  );
}
