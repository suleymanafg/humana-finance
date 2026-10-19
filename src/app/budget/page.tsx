// «Капитал» — the budget for shareholders (CapitalView): how much capital the
// business needs and when, where the sum comes from, 2027 profit, what-ifs and
// what the figures rest on. The view re-runs the budget model in the browser on
// the estimate's own inputs and supply plan, so its figures are the estimate's.
import { pageContext, type SearchParams } from "@/lib/page-context";
import { loadBudget } from "@/lib/budget/data";
import { todayInTashkent } from "@/lib/planning/data";
import { BudgetEmpty } from "@/components/budget/BudgetStatus";
import CapitalView from "@/components/budget/CapitalView";

export const dynamic = "force-dynamic";

export default async function BudgetCapitalPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const data = await loadBudget();
  if (data.empty || !data.plan) return <BudgetEmpty />;
  const original2027 = data.budgetCapital.years.find((y) => y.year === 2027);

  return (
    <CapitalView
      asOf={todayInTashkent()}
      lastClosed={data.lastClosed}
      inputs={data.planInputs}
      supply={data.supply}
      alreadyIn={data.actuals.reduce((t, a) => t + a.cash.capital, 0)}
      original={{ ask: data.budgetCapital.ask, net2027: original2027?.netProfit ?? 0 }}
      isAdmin={ctx.isAdmin}
    />
  );
}
