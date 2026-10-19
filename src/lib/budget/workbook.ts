// Reads the inputs of a budget workbook in the owner's v10 layout (Inputs and
// Monthly tabs, named cells such as OPEN_CASH) into BudgetInputs. Typed cells in
// the Monthly tab override the model; formula cells there are the model's own
// rules (Fargo pays last month's sales; Fargo returns what it still holds).
// Works on a small reader interface, so the upload route can use ExcelJS and
// scripts SheetJS.
import { CHANNEL_KEYS, type BudgetInputs, type SharedCost } from "./model";

export interface BookCell {
  v: number | string | null; // the value Excel saved (formula result for formula cells)
  f?: string; // the formula, without "="
  w?: string; // the text as shown
}
export interface BudgetBook {
  sheetNames: string[];
  cell(sheet: string, a1: string): BookCell | undefined;
  /** a defined name's reference, e.g. 'Inputs · Допущения'!$B$16 */
  name(name: string): string | undefined;
}

const SHARED_GROUP: SharedCost["group"][] = ["sales", "sales", "sales", "admin", "admin", "admin", "sales", "sales", "sales", "sales"];

export function readBudgetWorkbook(wb: BudgetBook): BudgetInputs {
  const sheetOf = (prefix: string) => {
    const n = wb.sheetNames.find((s) => s.startsWith(prefix));
    if (!n) throw new Error(`budget workbook: no sheet "${prefix}"`);
    return n;
  };
  const byName = (name: string) => {
    const ref = wb.name(name);
    if (!ref) throw new Error(`budget workbook: no named cell ${name}`);
    const m = ref.match(/^'?(.+?)'?!\$?([A-Z]+)\$?(\d+)$/);
    if (!m) throw new Error(`budget workbook: ${name} is not a single cell (${ref})`);
    return wb.cell(m[1].replace(/''/g, "'"), `${m[2]}${m[3]}`);
  };
  const num = (c: BookCell | undefined) => (c && typeof c.v === "number" ? c.v : 0);
  const numOrNull = (c: BookCell | undefined) => (c && typeof c.v === "number" ? c.v : null);
  const text = (c: BookCell | undefined) => String(c?.w ?? c?.v ?? "").trim();
  const n = (name: string) => num(byName(name));
  // supply-side cells later workbooks dropped (v12 on: trucks by pallets, per-SKU stock) — the supply plan sizes trucks now
  const nOr = (name: string, fallback: number) => (wb.name(name) ? num(byName(name)) : fallback);

  const cellAt = (sheet: string, a1: string) => wb.cell(sheet, a1);
  const IN = sheetOf("Inputs");
  const MO = sheetOf("Monthly");
  const MONTH_COLS = "DEFGHIJKLMNOPQR".split(""); // Oct 2026..Dec 2027
  const row = (r: number) => MONTH_COLS.map((c) => cellAt(MO, `${c}${r}`));
  // a typed number, or a formula of numbers only (e.g. =1000000+2000000), is the owner's figure
  const typed = (c: BookCell | undefined) => !!c && typeof c.v === "number" && (!c.f || !/[A-Za-z]/.test(c.f));

  return {
    vatRate: n("VAT_RATE"),
    profitTaxRate: n("TAX_RATE"),
    eurRate: n("FX_RATE"),
    sellPriceChange: n("SELL_CHG"),
    sellPriceChangeMonth: n("SELL_CHG_M"),
    hqPriceChange: n("HQ_CHG"),
    hqPriceChangeMonth: n("HQ_CHG_M"),
    baseUnits: n("BASE_UNITS"),
    growth: n("GROWTH"),
    allowance: n("ALLOW"),
    spikeReady: n("SPIKE_READY"),
    importCostPct: n("IMP_COST"),
    importVatPct: n("IMP_VAT"),
    truckUnits: nOr("TRUCK", 20_000),
    coverMonths: nOr("COVER", 2),
    buildupMonths: nOr("BUILDUP", 0),
    leadDays: nOr("LEAD_DAYS", 45),
    hqEurPerUnit: wb.name("HQ_EUR_UNIT") ? numOrNull(byName("HQ_EUR_UNIT")) : null,
    products: Array.from({ length: 10 }, (_, i) => 32 + i).map((r) => ({
      name: text(cellAt(IN, `A${r}`)),
      listPrice: num(cellAt(IN, `B${r}`)),
      hqEur: num(cellAt(IN, `C${r}`)),
      units: num(cellAt(IN, `D${r}`)),
    })),
    korzinkaShare: n("KORZ_SHARE"),
    channels: CHANNEL_KEYS.map((key, i) => ({
      key,
      name: text(cellAt(IN, `A${47 + i}`)),
      mix: num(cellAt(IN, `E${47 + i}`)),
      discount: num(cellAt(IN, `C${47 + i}`)),
      days: num(cellAt(IN, `D${47 + i}`)),
    })),
    medicalPct: n("MED_PCT"),
    mrPayroll: n("MR_PAY"),
    officePayroll: n("OFFICE_PAY"),
    payrollTaxes: n("PAY_TAX"),
    officeCosts: n("OFFICE_COST"),
    marketing: n("MKT_COST"),
    tradePromo: n("PROMO"),
    smartUp: n("SMARTUP"),
    vehicles: n("VEHICLE"),
    certificates: n("CERT"),
    certificatesMonth: n("CERT_M"),
    bankFeePct: n("BANK_PCT"),
    shared: Array.from({ length: 10 }, (_, i) => 71 + i).map((r, i) => ({
      name: text(cellAt(IN, `A${r}`)),
      amount: num(cellAt(IN, `B${r}`)),
      split: text(cellAt(IN, `C${r}`)) === "50/50" ? "50/50" : "SALES",
      group: SHARED_GROUP[i],
    })),
    nutribenSales: n("NUT_BASE"),
    nutribenGrowth: n("NUT_GROWTH"),
    fargoRemitPct: n("FARGO_REMIT"),
    tiMarkup: n("TI_MARKUP"),
    distStartMonth: n("DIST_START"),
    fargoOldMonths: n("FARGO_OLD_M"),
    reserveMonths: n("BUFFER_M"),
    spikeBuffer: n("SPIKE_BUFFER"),
    opening: {
      monthId: "2026-09",
      cash: n("OPEN_CASH"),
      stockUnits: n("OPEN_STOCK"),
      stockValue: n("OPEN_STOCK_VAL"),
      arrivingUnits: n("OPEN_TRANSIT"),
      arrivingHqValue: n("OPEN_TRANSIT_GOODS"),
      transitPaid: n("OPEN_TRANSIT_VAL"),
      customersOwe: n("OPEN_AR"),
      loans: n("OPEN_LOANS"),
      vatCredit: n("OPEN_VATCR"),
      vatPayable: n("OPEN_VATPAY"),
      profitTaxPayable: 0,
      priorOwner: n("OTHER_LIAB"),
      fargoOwes: n("FARGO_OPEN"),
      fargoStockUnits: n("FARGO_STOCK"),
      fargoStockValue: n("FARGO_STOCK_VAL"),
      fargoCustomersOwe: n("FARGO_AR"),
      profitYtd: n("OPEN_YTD"),
    },
    monthly: {
      spikePct: row(6).map(num),
      expectedUnits: row(7).map((c) => (num(c) > 0 ? num(c) : null)),
      tiShare: row(8).map(num),
      fixedTrucks: row(9).map(numOrNull),
      stockToFargo: row(10).map(num),
      fargoPaid: row(12).map((c) => (typed(c) ? num(c) : null)),
      fargoReturns: row(14).map((c) => (c?.f && !typed(c) ? "all" : num(c))),
      loans: row(16).map(num),
      priorOwnerPaid: row(18).map(num),
      plannedCapital: row(20).map(num),
    },
  };
}
