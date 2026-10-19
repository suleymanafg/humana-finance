// The budget forecast's supply side from the supply plan (planning): units sold
// = the stage engine's demand less what the plan cannot supply; trucks become
// sellable when the plan says (45 days after dispatch) and are paid at
// dispatch — trucks already arrived at their real cost, trucks on their way
// and agreed at their lines, the plan's loads at HQ prices. HQ's price change
// applies from its month, as in the budget. Pure — no DB imports.
import { addMonths } from "../planning/compute";
import type { PlanData } from "../planning/plan-data";
import { BUDGET_END, monthNumber, type BudgetInputs, type BudgetProduct, type BudgetSupply } from "./model";

const LOOKAHEAD = 5;

/** A truck already in the warehouse in a month the forecast still plans. */
export interface ArrivedTruck {
  monthId: string;
  dispatchMonth: string | null;
  units: number;
  hqValue: number; // UZS, at its own rate
}

/** The budget product a planning SKU sells as (Platin 1 400 g, HN, AC …). */
export function budgetProductOf(skuName: string, products: BudgetProduct[]): number {
  const key = (n: string) => {
    const stage = n.match(/Platin\s*([123])/i)?.[1];
    const size = n.match(/(\d{3})\s*g/i)?.[1];
    if (stage && size) return `P${stage}-${size}`;
    const line = n.match(/\b(HN|SL|AC|AR)\b/i)?.[1];
    return line ? line.toUpperCase() : n.toLowerCase();
  };
  const k = key(skuName);
  return products.findIndex((p) => key(p.name) === k);
}

export function supplyFromPlan(p: PlanData, arrived: ArrivedTruck[], inputs: BudgetInputs, start: string): BudgetSupply {
  const months: string[] = [];
  for (let m = start; m <= addMonths(BUDGET_END, LOOKAHEAD); m = addMonths(m, 1)) months.push(m);
  const zero = () => Object.fromEntries(months.map((m) => [m, 0])) as Record<string, number>;
  const out: BudgetSupply = { marketUnits: zero(), listPrice: zero(), arrivals: zero(), arrivalsHq: zero(), paidHq: zero(), trucks: zero() };
  const hqFactor = (m: string) => 1 + (monthNumber(m) >= inputs.hqPriceChangeMonth + 3 ? inputs.hqPriceChange : 0);
  const has = (m: string | null): m is string => !!m && m in out.arrivals;

  // sales: demand less lost, priced at the month's own product mix
  const listOf = Object.fromEntries(p.skus.map((s) => [s.id, inputs.products[budgetProductOf(s.name, inputs.products)]?.listPrice ?? 0]));
  for (const m of months) {
    let units = 0;
    let atList = 0;
    for (const s of p.skus) {
      const u = Math.max(0, (p.engine.demand[s.id]?.[m] ?? 0) - (p.plan.lost[s.id]?.[m] ?? 0));
      units += u;
      atList += u * listOf[s.id];
    }
    out.marketUnits[m] = units;
    out.listPrice![m] = units > 0 && atList > 0 ? atList / units : 0;
  }

  // trucks already in the warehouse in the forecast's months
  for (const t of arrived) {
    if (!has(t.monthId)) continue;
    out.arrivals[t.monthId] += t.units;
    out.arrivalsHq[t.monthId] += t.hqValue;
    out.trucks[t.monthId] += 1;
    if (has(t.dispatchMonth)) out.paidHq[t.dispatchMonth] += t.hqValue;
  }
  // on their way or agreed: their lines at the budget's rate; paid at dispatch (earlier = already in transit)
  const priceOf = Object.fromEntries(p.skus.map((s) => [s.id, s.priceEur]));
  for (const t of p.pipeline) {
    const units = Object.values(t.units).reduce((a, b) => a + b, 0);
    const hq = Object.entries(t.units).reduce((a, [id, q]) => a + q * (priceOf[id] ?? 0), 0) * inputs.eurRate * hqFactor(t.shipMonth);
    if (has(t.sellMonth)) {
      out.arrivals[t.sellMonth] += units;
      out.arrivalsHq[t.sellMonth] += hq;
      out.trucks[t.sellMonth] += 1;
    }
    if (has(t.shipMonth)) out.paidHq[t.shipMonth] += hq;
  }
  // the plan's loads
  for (const l of p.plan.loads) {
    if (l.trucks === 0) continue;
    const units = Object.values(l.units).reduce((a, b) => a + b, 0);
    const hq = l.eur * inputs.eurRate * hqFactor(l.shipMonth);
    if (has(l.sellMonth)) {
      out.arrivals[l.sellMonth] += units;
      out.arrivalsHq[l.sellMonth] += hq;
      out.trucks[l.sellMonth] += l.trucks;
    }
    if (has(l.shipMonth)) out.paidHq[l.shipMonth] += hq;
  }
  return out;
}
