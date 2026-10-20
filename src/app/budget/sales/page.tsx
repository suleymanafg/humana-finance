// «Продажи по товарам» — the estimate's sales, product by product and month by
// month: closed months actual, the rest the demand model's — or the owner's own
// number, typed over it. A saved number changes the whole estimate: the supply
// plan sizes the trucks to it, and revenue, cash and the capital answer follow.
import { pageContext, type SearchParams } from "@/lib/page-context";
import { loadBudget } from "@/lib/budget/data";
import { loadPlan } from "@/lib/planning/plan-data";
import { budgetProductOf } from "@/lib/budget/supply";
import { yearIndexes, total } from "@/lib/budget/model";
import { BudgetEmpty } from "@/components/budget/BudgetStatus";
import SalesByProductView from "@/components/budget/SalesByProductView";

export const dynamic = "force-dynamic";

export default async function BudgetSalesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const [d, p] = await Promise.all([loadBudget(), loadPlan()]);
  if (d.empty || !d.plan || !d.planCapital) return <BudgetEmpty />;
  const months = d.months;

  // the model's own figure for a product and month (without the owner's month numbers)
  const modelOf = (id: string, m: string): number => {
    const s = p.skus.find((x) => x.id === id)!;
    const own = p.overrides.own[id];
    const engine =
      s.stage === null
        ? p.engine.expertLevel[id]?.level ?? 0
        : (p.engine.stageForecast[s.stage]?.[m] ?? 0) * (s.size800 ? p.engine.share800[s.stage] : 1 - p.engine.share800[s.stage]);
    const f = own ?? engine;
    return m === p.thisMonth ? (p.engine.thisMonth[id]?.runningAt ?? 0) * p.monthDone + (1 - p.monthDone) * f : f;
  };

  const rows = p.skus.map((s) => {
    const list = d.planInputs.products[budgetProductOf(s.name, d.planInputs.products)]?.listPrice ?? 0;
    return {
      id: s.id,
      name: s.name,
      listPrice: list,
      cells: months.map((m) => {
        if (m <= p.lastClosed) return { m, kind: "actual" as const, v: p.engine.demand[s.id]?.[m] ?? 0 };
        const own = p.overrides.month[s.id]?.[m];
        return {
          m,
          kind: "estimate" as const,
          v: p.engine.demand[s.id]?.[m] ?? 0,
          model: modelOf(s.id, m),
          own: own ?? null,
          soldSoFar: m === p.thisMonth ? (p.engine.thisMonth[s.id]?.runningAt ?? 0) * p.monthDone : null,
          short: p.plan.lost[s.id]?.[m] ?? 0,
        };
      }),
    };
  });

  const run = d.plan;
  const idx27 = yearIndexes(run, 2027);
  const net27 = d.planCapital.years.find((y) => y.year === 2027)?.netProfit ?? 0;
  const alreadyIn = d.actuals.reduce((t, a) => t + a.cash.capital, 0);

  return (
    <SalesByProductView
      months={months}
      thisMonth={p.thisMonth}
      rows={rows}
      summary={{
        ask: Math.max(0, d.planCapital.ask - alreadyIn),
        firstNeeded: d.planCapital.firstNeeded,
        net27,
        units27: total(run.sales.marketUnits, idx27),
        trucks27: total(run.stock.trucks, idx27),
      }}
      isAdmin={ctx.isAdmin}
    />
  );
}
