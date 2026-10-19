// What-ifs on the budget (the Capital page's sliders): sales, selling prices,
// the euro rate, customers' payment days and the minimum cash, applied to the
// estimate's inputs and its supply plan. More sales need proportionally more
// goods; HQ is paid in euro. With every value at zero (and the reserve as set)
// it is the estimate itself. The first month's trucks are already decided (and
// those arriving in it already paid), so sales and goods move from the month after;
// the euro rate moves every payment still to make. Pure — no DB, no React.
import { addMonths } from "../planning/compute";
import type { BudgetInputs, BudgetSupply } from "./model";

export interface Scenario {
  sales: number;
  price: number;
  fx: number;
  days: number;
  reserve: number;
}

/** each month's value × k for the months from `from` on */
const scale = (r: Record<string, number> | undefined, k: number, from: string) => (r ? Object.fromEntries(Object.entries(r).map(([m, v]) => [m, m >= from ? v * k : v])) : r);

export function applyScenario(inputs: BudgetInputs, supply: BudgetSupply | null, s: Scenario): { inputs: BudgetInputs; supply: BudgetSupply | undefined } {
  const i: BudgetInputs = {
    ...inputs,
    eurRate: inputs.eurRate * (1 + s.fx),
    reserveMonths: s.reserve,
    baseUnits: inputs.baseUnits * (1 + s.sales),
    products: inputs.products.map((p) => ({ ...p, listPrice: p.listPrice * (1 + s.price) })),
    channels: inputs.channels.map((c) => ({ ...c, days: Math.min(90, Math.max(0, c.days + s.days)) })),
  };
  if (!supply) return { inputs: i, supply: undefined };
  // more sales need proportionally more goods; HQ is paid in euro
  const goods = 1 + s.sales;
  const fx = 1 + s.fx;
  const first = addMonths(inputs.opening.monthId, 1);
  const next = addMonths(first, 1);
  const times = (r: Record<string, number>, kFirst: number, kLater: number) =>
    Object.fromEntries(Object.entries(r).map(([m, v]) => [m, m < first ? v : m === first ? v * kFirst : v * kLater]));
  return {
    inputs: i,
    supply: {
      marketUnits: scale(supply.marketUnits, goods, next)!,
      listPrice: scale(supply.listPrice, 1 + s.price, first),
      arrivals: scale(supply.arrivals, goods, next)!,
      // the first month's arrivals were paid before; later ones at the new rate and volume
      arrivalsHq: scale(supply.arrivalsHq, goods * fx, next)!,
      // the first month's payments are for trucks already decided: the rate only
      paidHq: times(supply.paidHq, fx, goods * fx),
      trucks: scale(supply.trucks, goods, next)!,
    },
  };
}
