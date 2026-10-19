// Loads the budget section's picture once per request: the approved budget and
// the working forecast from Settings, the engine's actuals for the closed
// months, and the runs and capital answers built from them.
import { cache } from "react";
import { prisma } from "../db";
import { getComputed } from "../data";
import { addMonths } from "../planning/compute";
import { BUDGET_END, BUDGET_ORIGIN, monthRange, runBudget, type BudgetOpening } from "./model";
import { capitalAnswer } from "./capital";
import { actualMonth, openingAt, type ActualMonth } from "./actuals";
import { forecastRun } from "./forecast";
import { supplyFromPlan, type ArrivedTruck } from "./supply";
import { loadPlan } from "../planning/plan-data";
import { parseStored, SETTING_APPROVED, SETTING_FORECAST } from "./store";

/** Opening lines whose budget figure differs from the books at the same month-end. */
function openingDiffs(budget: BudgetOpening, books: BudgetOpening) {
  const keys = ["cash", "stockUnits", "stockValue", "arrivingUnits", "arrivingHqValue", "transitPaid", "customersOwe", "loans", "vatCredit", "vatPayable", "profitTaxPayable", "priorOwner", "fargoOwes", "fargoStockUnits", "fargoStockValue", "fargoCustomersOwe", "profitYtd"] as const;
  return keys
    .map((k) => ({ key: k, budget: Number(budget[k] ?? 0), books: Number(books[k] ?? 0) }))
    .filter((d) => Math.abs(d.budget - d.books) > 0.5);
}

/** The supply plan as the forecast's supply side; null when planning cannot run (the workbook's own rule then). */
async function supplyOf(start: string, inputs: Parameters<typeof supplyFromPlan>[2], c: Awaited<ReturnType<typeof getComputed>>["computed"]) {
  try {
    const [p, rows] = await Promise.all([
      loadPlan(),
      prisma.shipment.findMany({ where: { deletedAt: null, status: "ARRIVED" }, select: { id: true, dispatchDate: true } }),
    ]);
    const dispatchOf = new Map(rows.map((r) => [r.id, r.dispatchDate ? r.dispatchDate.toISOString().slice(0, 7) : null]));
    const arrived: ArrivedTruck[] = c.shipments
      .filter((s) => s.status === "ARRIVED" && s.monthId >= start)
      .map((s) => ({ monthId: s.monthId, dispatchMonth: dispatchOf.get(s.shipmentId) ?? null, units: s.units, hqValue: s.purchaseTotal }));
    return supplyFromPlan(p, arrived, inputs, start);
  } catch {
    return null;
  }
}

export const loadBudget = cache(async () => {
  const rows = await prisma.setting.findMany({ where: { key: { in: [SETTING_APPROVED, SETTING_FORECAST] } } });
  const approved = parseStored(rows.find((r) => r.key === SETTING_APPROVED)?.value);
  const working = parseStored(rows.find((r) => r.key === SETTING_FORECAST)?.value) ?? approved;
  if (!approved || !working) return { empty: true as const };

  const { dataset: ds, computed: c } = await getComputed();
  const closed = ds.months.filter((m) => m.closedAt).map((m) => m.id).sort();
  // the forecast starts from the last closed month whose bank, cash and transit balances are entered
  const entered = closed.filter((id) => c.balance.find((b) => b.monthId === id)?.hasInputs);
  const lastClosed = entered.length ? entered[entered.length - 1] : null;
  const missingBalances = closed.filter((id) => id >= BUDGET_ORIGIN && (!lastClosed || id > lastClosed));
  const actualIds = lastClosed && lastClosed >= BUDGET_ORIGIN ? monthRange(BUDGET_ORIGIN, lastClosed < BUDGET_END ? lastClosed : BUDGET_END) : [];

  // the forecast starts from the books at the last closed month, once that is later than the budget's own opening
  const start = lastClosed && lastClosed > working.inputs.opening.monthId ? openingAt(ds, c, lastClosed, approved.inputs) : null;
  const budget = runBudget(approved.inputs);
  // the forecast's trucks, HQ payments and units sold come from the supply plan
  const planStart = addMonths((start?.opening ?? working.inputs.opening).monthId, 1);
  const supply = await supplyOf(planStart, working.inputs, c);
  const plan = !start || start.opening.monthId < BUDGET_END ? forecastRun(working.inputs, start?.opening ?? null, supply ?? undefined) : null;
  const booksAtBudgetOpening = openingAt(ds, c, approved.inputs.opening.monthId, approved.inputs);

  return {
    empty: false as const,
    approved,
    working,
    lastClosed,
    actuals: actualIds.map((id) => actualMonth(ds, c, id, approved.inputs)).filter((a): a is ActualMonth => a !== null),
    startEstimated: start?.estimated ?? [],
    /** the books at the last closed month, once later than the budget opening */
    realOpening: start?.opening ?? null,
    budget,
    budgetCapital: capitalAnswer(budget, approved.inputs),
    plan,
    planCapital: plan ? capitalAnswer(plan, working.inputs) : null,
    /** the forecast's trucks and sales follow the supply plan (else the workbook's own truck rule) */
    supplyFromPlan: supply !== null,
    /** does the approved budget's opening match the books at that month-end? */
    openingCheck: booksAtBudgetOpening ? openingDiffs(approved.inputs.opening, booksAtBudgetOpening.opening) : null,
    months: monthRange(BUDGET_ORIGIN, BUDGET_END),
    nextToClose: lastClosed ? addMonths(lastClosed, 1) : BUDGET_ORIGIN,
    /** closed months left out of the actuals: their month-end balances are not entered */
    missingBalances,
  };
});

export type BudgetData = Exclude<Awaited<ReturnType<typeof loadBudget>>, { empty: true }>;

/** The few facts every budget page shows in its status line. */
export function statusInfo(d: BudgetData) {
  return {
    approvedName: d.approved.name,
    approvedAt: d.approved.savedAt,
    forecastName: d.working.name,
    forecastAt: d.working.savedAt,
    lastClosed: d.lastClosed,
    planStart: d.plan?.months[0] ?? null,
    budgetOpening: d.approved.inputs.opening.monthId,
    openingCheck: d.openingCheck,
    estimated: d.startEstimated,
    missingBalances: d.missingBalances,
    supplyFromPlan: d.supplyFromPlan,
  };
}
