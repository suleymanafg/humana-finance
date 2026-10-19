// The budget section's statements as estimate and actual: each line knows its
// estimate (from a budget run) and, where the books have it, its actual for a
// closed month. A closed month is compared with the estimate kept at its start;
// open months show the latest estimate. Columns are October 2026 – December
// 2027 with totals for the rest of 2026 and for 2027. Pure — no DB imports.
import type { ActualMonth } from "./actuals";
import type { BudgetRun } from "./model";

type Bi = { ru: string; en: string };
export type BudgetView = "pnl" | "cash" | "balance" | "stock";

export interface BudgetLine {
  key: string;
  label: Bi;
  kind: "header" | "line" | "subtotal" | "total";
  units?: boolean; // units, not money
  decimals?: number;
  /** how the period columns add up: flows sum, positions take the last month, opening cash the first */
  period: "sum" | "last" | "first" | "none";
  plan?: (r: BudgetRun, i: number) => number;
  actual?: (a: ActualMonth) => number | null;
}

const H = (key: string, ru: string, en: string): BudgetLine => ({ key, label: { ru, en }, kind: "header", period: "none" });

const PNL: BudgetLine[] = [
  { key: "tiUnits", label: { ru: "Продано TI напрямую, шт.", en: "Units sold directly by TI" }, kind: "line", units: true, period: "sum", plan: (r, i) => r.pnl.tiUnits[i], actual: (a) => a.units.ti },
  { key: "fargoUnits", label: { ru: "Продано через Fargo, шт.", en: "Units sold through Fargo" }, kind: "line", units: true, period: "sum", plan: (r, i) => r.pnl.fargoUnits[i], actual: (a) => a.units.fargo },
  H("rev", "Выручка", "Revenue"),
  { key: "gross", label: { ru: "Продажи TI по прайсу без НДС", en: "TI sales at list price excl. VAT" }, kind: "line", period: "sum", plan: (r, i) => r.pnl.grossExVat[i], actual: () => null },
  { key: "disc", label: { ru: "− Скидки и ретро-бонусы", en: "− Discounts and retro bonuses" }, kind: "line", period: "sum", plan: (r, i) => r.pnl.discounts[i], actual: () => null },
  { key: "fargoRev", label: { ru: "+ Продажи через Fargo: долг Fargo перед TI (без НДС по счетам TI)", en: "+ Sales through Fargo: what Fargo owes TI (excl. VAT on TI's invoices)" }, kind: "line", period: "sum", plan: (r, i) => r.pnl.fargoRevenue[i], actual: (a) => a.pnl.fargoRevenue },
  { key: "net", label: { ru: "Чистая выручка", en: "Net revenue" }, kind: "subtotal", period: "sum", plan: (r, i) => r.pnl.netRevenue[i], actual: (a) => (a.pnl.tiNetSales ?? 0) + a.pnl.fargoRevenue },
  { key: "returns", label: { ru: "− Возвраты, просрочка, потери", en: "− Returns, expiry and losses" }, kind: "line", period: "sum", plan: (r, i) => r.pnl.returns[i], actual: (a) => -a.pnl.losses },
  { key: "tiCogs", label: { ru: "− Себестоимость продаж TI", en: "− Cost of goods sold by TI" }, kind: "line", period: "sum", plan: (r, i) => r.pnl.tiCogs[i], actual: (a) => -a.pnl.tiCogs },
  { key: "fargoCogs", label: { ru: "− Себестоимость продаж через Fargo", en: "− Cost of goods sold through Fargo" }, kind: "line", period: "sum", plan: (r, i) => r.pnl.fargoCogs[i], actual: (a) => -a.pnl.fargoCogs },
  { key: "gp", label: { ru: "Валовая прибыль", en: "Gross profit" }, kind: "subtotal", period: "sum", plan: (r, i) => r.pnl.grossProfit[i], actual: (a) => (a.pnl.tiNetSales ?? 0) + a.pnl.fargoRevenue - a.pnl.losses - a.pnl.tiCogs - a.pnl.fargoCogs },
  H("opex", "Операционные расходы", "Operating expenses"),
  { key: "medical", label: { ru: "− Медицина (МП и мед. инвестиции)", en: "− Medical (MR team and medical investment)" }, kind: "line", period: "sum", plan: (r, i) => r.pnl.medical[i], actual: (a) => -a.pnl.medical },
  { key: "sales", label: { ru: "− Продажи и дистрибуция", en: "− Sales and distribution" }, kind: "line", period: "sum", plan: (r, i) => r.pnl.sales[i], actual: (a) => -a.pnl.sales },
  { key: "admin", label: { ru: "− Бэк-офис и администрация", en: "− Back office and administration" }, kind: "line", period: "sum", plan: (r, i) => r.pnl.admin[i], actual: (a) => -a.pnl.admin },
  { key: "marketing", label: { ru: "− Маркетинг и реклама", en: "− Marketing and advertising" }, kind: "line", period: "sum", plan: (r, i) => r.pnl.marketing[i], actual: (a) => -a.pnl.marketing },
  { key: "opexTotal", label: { ru: "Итого операционные расходы", en: "Total operating expenses" }, kind: "subtotal", period: "sum", plan: (r, i) => r.pnl.opex[i], actual: (a) => -a.pnl.opex },
  { key: "ebitda", label: { ru: "ОПЕРАЦИОННАЯ ПРИБЫЛЬ (EBITDA)", en: "OPERATING PROFIT (EBITDA)" }, kind: "total", period: "sum", plan: (r, i) => r.pnl.ebitda[i], actual: (a) => a.pnl.ebitda },
  { key: "tax", label: { ru: "− Налог на прибыль", en: "− Profit tax" }, kind: "line", period: "sum", plan: (r, i) => r.pnl.profitTax[i], actual: (a) => -a.pnl.profitTax },
  { key: "np", label: { ru: "ЧИСТАЯ ПРИБЫЛЬ", en: "NET PROFIT" }, kind: "total", period: "sum", plan: (r, i) => r.pnl.netProfit[i], actual: (a) => a.pnl.netProfit },
];

const CASH: BudgetLine[] = [
  { key: "open", label: { ru: "Деньги на начало", en: "Opening cash" }, kind: "subtotal", period: "first", plan: (r, i) => r.cash.open[i], actual: (a) => a.cash.open },
  { key: "collected", label: { ru: "Получено от покупателей", en: "Collected from customers" }, kind: "line", period: "sum", plan: (r, i) => r.cash.collected[i], actual: () => null },
  { key: "paidHq", label: { ru: "− Оплачено Humana HQ", en: "− Paid to Humana HQ" }, kind: "line", period: "sum", plan: (r, i) => r.cash.paidHq[i], actual: (a) => a.cash.paidHq },
  { key: "importCosts", label: { ru: "− Импортные расходы", en: "− Import costs (freight, customs, certificates)" }, kind: "line", period: "sum", plan: (r, i) => r.cash.importCosts[i], actual: (a) => a.cash.importCosts },
  { key: "importVat", label: { ru: "− Импортный НДС на таможне", en: "− Import VAT at customs" }, kind: "line", period: "sum", plan: (r, i) => r.cash.importVat[i], actual: (a) => a.cash.importVat },
  { key: "opex", label: { ru: "− Операционные расходы", en: "− Operating expenses" }, kind: "line", period: "sum", plan: (r, i) => r.cash.opex[i], actual: (a) => a.cash.opex },
  { key: "vat", label: { ru: "− НДС в бюджет", en: "− VAT paid" }, kind: "line", period: "sum", plan: (r, i) => r.cash.vatPaid[i], actual: () => null },
  { key: "ptax", label: { ru: "− Налог на прибыль", en: "− Profit tax paid" }, kind: "line", period: "sum", plan: (r, i) => r.cash.taxPaid[i], actual: () => null },
  { key: "fargo", label: { ru: "Fargo платит TI", en: "Fargo pays TI" }, kind: "line", period: "sum", plan: (r, i) => r.cash.fargoPaid[i], actual: (a) => a.cash.fargoPaid },
  { key: "prior", label: { ru: "− Предыдущему владельцу TI", en: "− Previous owner of TI" }, kind: "line", period: "sum", plan: (r, i) => r.cash.priorOwnerPaid[i], actual: (a) => a.cash.priorOwner },
  { key: "loans", label: { ru: "Займы получены / (погашены)", en: "Loans received / (repaid)" }, kind: "line", period: "sum", plan: (r, i) => r.cash.loans[i], actual: (a) => a.cash.loans },
  { key: "capital", label: { ru: "Капитал акционеров", en: "Shareholder capital" }, kind: "line", period: "sum", plan: (r, i) => r.cash.capital[i], actual: (a) => a.cash.capital },
  { key: "other", label: { ru: "Прочее по банку (поступления, НДС, налоги…) — факт", en: "Other through the bank (collections, VAT, taxes…) — actual" }, kind: "line", period: "sum", actual: (a) => a.cash.other },
  { key: "close", label: { ru: "ДЕНЬГИ НА КОНЕЦ", en: "CLOSING CASH" }, kind: "total", period: "last", plan: (r, i) => r.cash.close[i], actual: (a) => a.cash.close },
  { key: "reserve", label: { ru: "Минимальный остаток (резерв)", en: "Minimum cash to keep (reserve)" }, kind: "line", period: "last", plan: (r, i) => r.cash.reserve[i] },
  { key: "above", label: { ru: "Сверх / (ниже) минимума", en: "Above / (below) the minimum" }, kind: "subtotal", period: "last", plan: (r, i) => r.cash.aboveReserve[i] },
];

const sumAssets = (a: ActualMonth) => a.balance.cash + a.balance.customersOwe + a.balance.stock + a.balance.transit + a.balance.vatCredit + a.balance.fargoStock + a.balance.fargoOwes;
const sumLiabilities = (a: ActualMonth) => a.balance.vatPayable + a.balance.taxPayable + a.balance.loans + a.balance.priorOwner + a.balance.other;
const BALANCE: BudgetLine[] = [
  H("assets", "Активы", "Assets"),
  { key: "cash", label: { ru: "Деньги", en: "Cash" }, kind: "line", period: "last", plan: (r, i) => r.balance.cash[i], actual: (a) => a.balance.cash },
  { key: "ar", label: { ru: "Долг покупателей", en: "Customers owe us" }, kind: "line", period: "last", plan: (r, i) => r.balance.customersOwe[i], actual: (a) => a.balance.customersOwe },
  { key: "stock", label: { ru: "Товар на складе", en: "Stock in warehouse" }, kind: "line", period: "last", plan: (r, i) => r.balance.stock[i], actual: (a) => a.balance.stock },
  { key: "transit", label: { ru: "Оплачено HQ, в пути", en: "Paid to HQ, on the way" }, kind: "line", period: "last", plan: (r, i) => r.balance.transit[i], actual: (a) => a.balance.transit },
  { key: "vatCredit", label: { ru: "Переплата НДС", en: "VAT credit" }, kind: "line", period: "last", plan: (r, i) => r.balance.vatCredit[i], actual: (a) => a.balance.vatCredit },
  { key: "fargoStock", label: { ru: "Товар Humana у Fargo", en: "Humana stock at Fargo" }, kind: "line", period: "last", plan: (r, i) => r.balance.fargoStock[i], actual: (a) => a.balance.fargoStock },
  { key: "fargoOwes", label: { ru: "Долг Fargo перед TI", en: "Fargo owes TI" }, kind: "line", period: "last", plan: (r, i) => r.balance.fargoOwes[i], actual: (a) => a.balance.fargoOwes },
  { key: "assetsTotal", label: { ru: "ИТОГО АКТИВЫ", en: "TOTAL ASSETS" }, kind: "subtotal", period: "last", plan: (r, i) => r.balance.assets[i], actual: sumAssets },
  H("liab", "Обязательства", "Liabilities"),
  { key: "vatPay", label: { ru: "НДС к уплате", en: "VAT payable" }, kind: "line", period: "last", plan: (r, i) => r.balance.vatPayable[i], actual: (a) => a.balance.vatPayable },
  { key: "taxPay", label: { ru: "Налог на прибыль к уплате", en: "Profit tax payable" }, kind: "line", period: "last", plan: (r, i) => r.balance.taxPayable[i], actual: (a) => a.balance.taxPayable },
  { key: "loans", label: { ru: "Займы", en: "Loans" }, kind: "line", period: "last", plan: (r, i) => r.balance.loans[i], actual: (a) => a.balance.loans },
  { key: "prior", label: { ru: "Долг перед предыдущим владельцем", en: "Owed to the previous owner" }, kind: "line", period: "last", plan: (r, i) => r.balance.priorOwner[i], actual: (a) => a.balance.priorOwner },
  { key: "otherLiab", label: { ru: "Прочие обязательства", en: "Other liabilities" }, kind: "line", period: "last", plan: (r) => r.balance.otherLiabilities, actual: (a) => a.balance.other },
  { key: "liabTotal", label: { ru: "ИТОГО ОБЯЗАТЕЛЬСТВА", en: "TOTAL LIABILITIES" }, kind: "subtotal", period: "last", plan: (r, i) => r.balance.liabilities[i], actual: sumLiabilities },
  { key: "equity", label: { ru: "СОБСТВЕННЫЕ СРЕДСТВА", en: "OWN FUNDS" }, kind: "total", period: "last", plan: (r, i) => r.balance.equity[i], actual: (a) => sumAssets(a) - sumLiabilities(a) },
];

const STOCK: BudgetLine[] = [
  { key: "market", label: { ru: "Продажи рынка, шт.", en: "Market sales, units" }, kind: "line", units: true, period: "sum", plan: (r, i) => r.sales.marketUnits[i], actual: (a) => a.units.ti + a.units.fargo },
  { key: "arrivals", label: { ru: "Приход от HQ, шт.", en: "Arrivals from HQ, units" }, kind: "line", units: true, period: "sum", plan: (r, i) => r.stock.arrivals[i], actual: (a) => a.units.arrived },
  { key: "trucks", label: { ru: "Фур", en: "Trucks" }, kind: "line", units: true, decimals: 1, period: "sum", plan: (r, i) => r.stock.trucks[i] },
  { key: "tiStock", label: { ru: "Склад TI на конец месяца, шт.", en: "TI stock at month-end, units" }, kind: "subtotal", units: true, period: "last", plan: (r, i) => r.stock.tiClose[i], actual: (a) => a.units.tiStock },
  { key: "cover", label: { ru: "Запас, месяцев продаж", en: "Stock cover, months of sales" }, kind: "line", units: true, decimals: 1, period: "last", plan: (r, i) => r.stock.cover[i] },
  { key: "fargoStock", label: { ru: "Товар у Fargo на конец месяца, шт.", en: "Stock at Fargo at month-end, units" }, kind: "line", units: true, period: "last", plan: (r, i) => r.stock.fgClose[i], actual: (a) => a.units.fargoStock },
  { key: "hqUnit", label: { ru: "Цена HQ за шт., сум", en: "HQ price per unit, UZS" }, kind: "line", period: "none", plan: (r, i) => r.stock.hqUnit[i] },
  { key: "landed", label: { ru: "Себестоимость за шт., сум", en: "Landed cost per unit, UZS" }, kind: "line", period: "none", plan: (r, i) => r.stock.landedUnit[i] },
];

export const BUDGET_STATEMENTS: Record<BudgetView, BudgetLine[]> = { pnl: PNL, cash: CASH, balance: BALANCE, stock: STOCK };

/**
 * The estimate as it stood at the start of a month, kept when the month before
 * closes: every statement line's figure for that month and the months after.
 * Figures, not inputs — a later change to the model or the assumptions does not
 * rewrite it.
 */
export interface EstimateSnapshot {
  /** the month it is the estimate at the start of */
  monthId: string;
  takenAt: string;
  takenBy: string;
  /** the assumptions it was run on */
  basedOn: string;
  months: string[];
  /** `${view}.${line key}` -> one figure per month */
  values: Record<string, (number | null)[]>;
  ask: number;
}

export function snapshotFromRun(run: BudgetRun, meta: { monthId: string; takenAt: string; takenBy: string; basedOn: string; ask: number }): EstimateSnapshot {
  const values: Record<string, (number | null)[]> = {};
  for (const [view, lines] of Object.entries(BUDGET_STATEMENTS)) {
    for (const line of lines) if (line.plan) values[`${view}.${line.key}`] = run.months.map((_, i) => line.plan!(run, i));
  }
  return { ...meta, months: run.months, values };
}

/** Which estimate a closed month is compared with: the one from its start, else the latest before it, else the original budget. */
export type EstimateSource = { kind: "start"; snap: EstimateSnapshot } | { kind: "earlier"; snap: EstimateSnapshot } | { kind: "original" };

export function estimateSourceFor(monthId: string, estimates: EstimateSnapshot[]): EstimateSource {
  const own = estimates.find((e) => e.monthId === monthId);
  if (own) return { kind: "start", snap: own };
  const earlier = estimates.filter((e) => e.monthId < monthId && e.months.includes(monthId)).sort((a, b) => b.monthId.localeCompare(a.monthId))[0];
  return earlier ? { kind: "earlier", snap: earlier } : { kind: "original" };
}

/** Compare closed months with the estimate from their start (default) or with the original budget. */
export type CompareWith = "start" | "original";

export interface GridCell {
  /** actual for a closed month, the latest estimate for an open one; periods: actual so far + estimate for the rest */
  v: number | null;
  /** what it is compared with (closed months: the estimate; periods: the original budget) */
  ref?: number | null;
}

export interface StatementGrid {
  columns: { key: string; months: string[]; kind: "actual" | "estimate" | "period"; source?: EstimateSource["kind"]; sourceMonth?: string; takenAt?: string }[];
  /** plain data, so a client table can render it */
  rows: { key: string; label: Bi; kind: BudgetLine["kind"]; units: boolean; decimals: number; period: BudgetLine["period"]; cells: GridCell[] }[];
}

const periodOf = (line: BudgetLine, vals: (number | null)[]): number | null => {
  if (line.period === "none") return null;
  if (line.period === "first") return vals[0];
  if (line.period === "last") return vals[vals.length - 1];
  return vals.some((v) => v == null) ? null : vals.reduce((t: number, v) => t + (v ?? 0), 0);
};

/**
 * One statement as a grid of estimate and actual: closed months show the actual
 * next to the estimate they are compared with, open months the latest estimate,
 * year columns actual so far + estimate for the rest next to the original budget.
 */
export function statementGrid(
  lines: BudgetLine[],
  view: BudgetView,
  months: string[],
  src: { budget: BudgetRun; plan: BudgetRun | null; actuals: ActualMonth[]; estimates: EstimateSnapshot[] },
  compareWith: CompareWith,
): StatementGrid {
  const actualOf = new Map(src.actuals.map((a) => [a.monthId, a]));
  const fromRun = (run: BudgetRun | null, line: BudgetLine, m: string) => {
    const i = run ? run.months.indexOf(m) : -1;
    return i >= 0 && line.plan ? line.plan(run!, i) : null;
  };
  const original = (line: BudgetLine, m: string) => fromRun(src.budget, line, m);
  const fromSnap = (snap: EstimateSnapshot, line: BudgetLine, m: string) => {
    const i = snap.months.indexOf(m);
    return i >= 0 ? snap.values[`${view}.${line.key}`]?.[i] ?? null : null;
  };
  const sources = new Map(months.filter((m) => actualOf.has(m)).map((m) => [m, estimateSourceFor(m, src.estimates)]));
  const main = (line: BudgetLine, m: string): number | null => {
    const a = actualOf.get(m);
    if (a) return line.actual ? line.actual(a) : null;
    return fromRun(src.plan, line, m);
  };
  const ref = (line: BudgetLine, m: string): number | null | undefined => {
    if (!actualOf.has(m)) return compareWith === "original" ? original(line, m) : undefined;
    if (compareWith === "original") return original(line, m);
    const s = sources.get(m)!;
    return s.kind === "original" ? original(line, m) : fromSnap(s.snap, line, m);
  };

  const periods = [...new Set(months.map((m) => m.slice(0, 4)))].map((y) => ({ key: `y${y}`, months: months.filter((m) => m.startsWith(y)), kind: "period" as const }));
  const columns: StatementGrid["columns"] = [
    ...months.map((m) => {
      const s = sources.get(m);
      if (!s) return { key: m, months: [m], kind: "estimate" as const };
      const shown = compareWith === "original" ? ({ kind: "original" } as const) : s;
      return { key: m, months: [m], kind: "actual" as const, source: shown.kind, sourceMonth: "snap" in shown ? shown.snap.monthId : undefined, takenAt: "snap" in shown ? shown.snap.takenAt : undefined };
    }),
    ...periods,
  ];
  const rows = lines.map((line) => ({
    key: line.key,
    label: line.label,
    kind: line.kind,
    units: !!line.units,
    decimals: line.decimals ?? 0,
    period: line.period,
    cells: columns.map((c): GridCell => {
      if (line.kind === "header") return { v: null };
      if (c.kind !== "period") return { v: main(line, c.key), ref: ref(line, c.key) };
      return { v: periodOf(line, c.months.map((m) => main(line, m))), ref: line.plan ? periodOf(line, c.months.map((m) => original(line, m))) : null };
    }),
  }));
  return { columns, rows };
}
