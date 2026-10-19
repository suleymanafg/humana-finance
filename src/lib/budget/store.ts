// Where budgets live and what a valid one looks like. Two Settings rows hold
// them as JSON: the approved budget (frozen; plan vs actual is measured
// against it) and the working forecast (the owner's current assumptions).
// Pure — no DB imports; the API routes do the reading and writing.
import { addMonths } from "../planning/compute";
import { CHANNEL_KEYS, monthRange, type BudgetInputs, type BudgetMonthly, type BudgetOpening } from "./model";

export const SETTING_APPROVED = "budget.approved";
export const SETTING_FORECAST = "budget.forecast";
/** the approved budget before the last approval, kept for one step back */
export const SETTING_PREVIOUS = "budget.approved.previous";

export interface StoredBudget {
  name: string;
  savedAt: string; // ISO
  savedBy: string;
  source?: string; // e.g. the workbook it was loaded from
  inputs: BudgetInputs;
}

const SCALARS = [
  "vatRate", "profitTaxRate", "eurRate", "sellPriceChange", "sellPriceChangeMonth", "hqPriceChange", "hqPriceChangeMonth",
  "baseUnits", "growth", "allowance", "spikeReady", "importCostPct", "importVatPct", "truckUnits", "coverMonths", "buildupMonths",
  "leadDays", "korzinkaShare", "medicalPct", "mrPayroll", "officePayroll", "payrollTaxes", "officeCosts", "marketing", "tradePromo",
  "smartUp", "vehicles", "certificates", "certificatesMonth", "bankFeePct", "nutribenSales", "nutribenGrowth", "fargoRemitPct",
  "tiMarkup", "distStartMonth", "fargoOldMonths", "reserveMonths", "spikeBuffer",
] as const satisfies readonly (keyof BudgetInputs)[];

const OPENING = [
  "cash", "stockUnits", "stockValue", "arrivingHqValue", "transitPaid", "customersOwe", "loans", "vatCredit", "vatPayable",
  "profitTaxPayable", "priorOwner", "fargoOwes", "fargoStockUnits", "fargoStockValue", "fargoCustomersOwe", "profitYtd",
] as const satisfies readonly (keyof BudgetOpening)[];

const MONTHLY_NUM = ["spikePct", "tiShare", "stockToFargo", "loans", "priorOwnerPaid", "plannedCapital"] as const satisfies readonly (keyof BudgetMonthly)[];
const MONTHLY_NULLABLE = ["expectedUnits", "fixedTrucks", "fargoPaid"] as const satisfies readonly (keyof BudgetMonthly)[];

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** The inputs if they are complete and sane, else the first problem found. */
export function checkInputs(raw: unknown): { inputs: BudgetInputs } | { error: string } {
  if (!isObj(raw)) return { error: "inputs: object expected" };
  for (const k of SCALARS) if (!isNum(raw[k])) return { error: `${k}: number expected` };
  if (raw.hqEurPerUnit !== null && !isNum(raw.hqEurPerUnit)) return { error: "hqEurPerUnit: number or null expected" };
  const r = raw as unknown as BudgetInputs;
  if (r.truckUnits <= 0) return { error: "truckUnits must be above 0" };
  if (r.leadDays < 0 || r.leadDays > 60) return { error: "leadDays: 0–60" };
  if (r.korzinkaShare < 0 || r.korzinkaShare > 1) return { error: "korzinkaShare: 0–1" };
  if (!Array.isArray(r.products) || !r.products.length || r.products.some((p) => !isObj(p) || typeof p.name !== "string" || !isNum(p.listPrice) || !isNum(p.hqEur) || !isNum(p.units) || p.units < 0)) {
    return { error: "products: name, listPrice, hqEur, units" };
  }
  if (!Array.isArray(r.channels) || r.channels.length !== CHANNEL_KEYS.length || CHANNEL_KEYS.some((k, i) => r.channels[i]?.key !== k)) {
    return { error: `channels: ${CHANNEL_KEYS.join(", ")} in that order` };
  }
  if (r.channels.some((c) => !isNum(c.mix) || !isNum(c.discount) || !isNum(c.days) || c.days < 0 || c.days > 90)) return { error: "channels: mix, discount, days (0–90)" };
  if (!Array.isArray(r.shared) || r.shared.some((s) => !isObj(s) || typeof s.name !== "string" || !isNum(s.amount) || (s.split !== "50/50" && s.split !== "SALES") || (s.group !== "sales" && s.group !== "admin"))) {
    return { error: "shared: name, amount, split 50/50 | SALES, group sales | admin" };
  }
  if (!isObj(r.opening) || !/^\d{4}-\d{2}$/.test(String(r.opening.monthId))) return { error: "opening.monthId: YYYY-MM" };
  for (const k of OPENING) if (!isNum(r.opening[k])) return { error: `opening.${k}: number expected` };
  if (r.opening.arrivingUnits !== null && !isNum(r.opening.arrivingUnits)) return { error: "opening.arrivingUnits: number or null" };
  const months = monthRange(addMonths(r.opening.monthId, 1), "2027-12").length;
  if (!isObj(r.monthly)) return { error: "monthly: object expected" };
  for (const k of MONTHLY_NUM) {
    const a = r.monthly[k];
    if (!Array.isArray(a) || a.length !== months || a.some((x) => !isNum(x))) return { error: `monthly.${k}: ${months} numbers` };
  }
  for (const k of MONTHLY_NULLABLE) {
    const a = r.monthly[k];
    if (!Array.isArray(a) || a.length !== months || a.some((x) => x !== null && !isNum(x))) return { error: `monthly.${k}: ${months} numbers or blanks` };
  }
  const ret = r.monthly.fargoReturns;
  if (!Array.isArray(ret) || ret.length !== months || ret.some((x) => x !== "all" && !isNum(x))) return { error: `monthly.fargoReturns: ${months} numbers or "all"` };
  return { inputs: r };
}

export function parseStored(value: string | null | undefined): StoredBudget | null {
  if (!value) return null;
  try {
    const s = JSON.parse(value) as StoredBudget;
    const ok = checkInputs(s.inputs);
    return "inputs" in ok ? { ...s, inputs: ok.inputs } : null;
  } catch {
    return null;
  }
}

/** Monthly inputs from `offset` months later: a forecast run starts after the closed months. */
export function shiftMonthly(m: BudgetMonthly, offset: number): BudgetMonthly {
  if (offset <= 0) return m;
  return Object.fromEntries(Object.entries(m).map(([k, a]) => [k, (a as unknown[]).slice(offset)])) as unknown as BudgetMonthly;
}
