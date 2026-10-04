// Reads the owner's finance workbook ("Humana Finance - 2026.xlsx") into the
// engine's Dataset shape, plus the figures the workbook itself calculates, so
// the app can prove it reproduces them before anything is written.
import * as XLSX from "xlsx";
import type { Dataset, MonthIn, TaxSettings } from "../src/lib/engine/types";

type Row = unknown[];

const MONTHS_RU = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (v == null ? "" : String(v).trim());

/** 202508 → "2025-08" */
export function monthKey(v: unknown): string | null {
  const n = typeof v === "number" ? v : Number(str(v));
  if (!Number.isFinite(n) || n < 190001) return null;
  const y = Math.floor(n / 100);
  const m = n % 100;
  if (m < 1 || m > 12) return null;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Excel serial date → ISO date (UTC midnight). Also accepts "dd.mm.yyyy". */
export function isoDate(v: unknown): string | null {
  if (typeof v === "number" && v > 0) {
    return new Date(Math.round((v - 25569) * 86400) * 1000).toISOString().slice(0, 10);
  }
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(str(v));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function monthRow(id: string, sortOrder: number): MonthIn {
  const [y, m] = id.split("-").map(Number);
  return { id, nameRu: `${MONTHS_RU[m - 1]} ${y}`, nameEn: `${MONTHS_EN[m - 1]} ${y}`, sortOrder };
}

export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** P&L group labels used in the workbook → the app's group codes. */
const TI_GROUP_CODES: Record<string, string> = {
  Salaries: "TI_SALARIES",
  "Taxes & Social": "TI_TAXES_SOCIAL",
  "Bank Fees": "TI_BANK_FEES",
  "Office & Rent": "TI_OFFICE_RENT",
  "Medical Investment": "TI_MEDICAL_INVEST",
  "Marketing & Advertising": "TI_MARKETING",
  Others: "TI_OTHERS",
  "Certificate & Toxicology": "TI_CERT_TOX",
};
const FARGO_GROUP_CODES: Record<string, string> = {
  "Sales Team & KPI": "FG_SALES_KPI",
  Warehouse: "FG_WAREHOUSE",
  "Logistics & Fuel": "FG_LOGISTICS",
  "Office & Admin": "FG_OFFICE_ADMIN",
  "Finance & Management": "FG_FINANCE_MGMT",
  "Marketing & Advertising": "FG_MARKETING",
  "Retro Bonuses": "FG_RETRO",
};
/** Fargo's write-off category: part of the stock loss, never an operating cost. */
export const FARGO_WRITEOFF_CATEGORY = "Списания / просрочка";

export interface WorkbookData {
  dataset: Dataset;
  /** shipment id → code / month / status, as the workbook lists them */
  shipmentHeaders: Array<{ id: string; code: string; monthId: string; status: string }>;
  opexCategories: Array<{ company: "TI" | "FARGO"; name: string; plGroup: string | null }>;
  importCategories: string[];
  warehouses: string[];
  /** transfers the workbook lists twice (+ and −) because they were the previous owner's money */
  skippedTransfers: Array<{ date: string; bank: number; note: string }>;
  reportTo: string;
  expected: Expected;
}

/** Figures the workbook calculates itself, keyed by month. */
export interface Expected {
  months: string[];
  rows: Record<string, Record<string, number>>;
}

function grid(wb: XLSX.WorkBook, name: string): Row[] {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`The workbook has no tab «${name}»`);
  return XLSX.utils.sheet_to_json<Row>(ws, { header: 1, defval: null, raw: true });
}

/** Monthly figures from a statement tab: label in column A, months from column C. */
function statementRows(rows: Row[], wanted: Record<string, number>): Expected {
  const header = rows[2] ?? [];
  const months: string[] = [];
  const cols: number[] = [];
  header.forEach((v, i) => {
    const m = i >= 2 ? monthKey(v) : null;
    if (m) {
      months.push(m);
      cols.push(i);
    }
  });
  const out: Expected = { months, rows: {} };
  for (const [key, rowNo] of Object.entries(wanted)) {
    const r = rows[rowNo - 1] ?? [];
    out.rows[key] = Object.fromEntries(months.map((m, j) => [m, num(r[cols[j]])]));
  }
  return out;
}

export function readWorkbook(path: string): WorkbookData {
  const wb = XLSX.readFile(path);
  const body = (name: string, from = 3) => grid(wb, name).slice(from);

  // ── settings ──
  const settings = grid(wb, "Settings");
  const setting = (key: string): number => {
    const row = settings.find((r) => str(r[2]) === key);
    return num(row?.[1]);
  };
  const settingLabel = (key: string): string => str(settings.find((r) => str(r[2]) === key)?.[0]);
  const reportTo = monthKey(setting("REPORT_TO")) ?? "";
  const startMonth = monthKey(setting("START_MONTH")) ?? "";
  const taxes: TaxSettings = {
    vatRate: setting("VAT_RATE"),
    deemedCashMargin: setting("DEEMED_MARGIN"),
    fargoIncomeTaxRate: setting("FARGO_TAX_RATE"),
    tiIncomeTaxRate: setting("TI_TAX_RATE"),
    writeOffDeduct: setting("WRITEOFF_DEDUCT") === 1,
  };

  // ── master data ──
  const products = body("Products")
    .filter((r) => str(r[0]))
    .map((r, i) => {
      const id = str(r[0]);
      const regular = str(r[4]);
      const isPromo = num(r[3]) === 1;
      return {
        id,
        nameRu: str(r[1]),
        price: num(r[2]),
        isPromo,
        regularProductId: isPromo && regular && regular !== id ? regular : null,
        sortOrder: i,
      };
    });
  const channels = body("Channels")
    .filter((r) => str(r[0]))
    .map((r, i) => ({ id: str(r[0]), name: str(r[1]), cashPct: num(r[2]), sortOrder: i }));

  // ── sales ──
  const sales = body("Sales")
    .filter((r) => monthKey(r[0]) && str(r[1]) && str(r[3]))
    .map((r) => ({
      monthId: monthKey(r[0])!,
      productId: str(r[1]),
      channelId: str(r[3]),
      qty: num(r[5]),
      amount: typeof r[6] === "number" ? r[6] : null,
    }));

  // ── trucks ──
  const shipmentHeaders = body("Shipments")
    .filter((r) => str(r[0]))
    .map((r) => ({ id: str(r[0]), code: str(r[1]), monthId: monthKey(r[2]) ?? "", status: str(r[3]) || "ARRIVED" }));
  const lineRows = body("Shipment lines").filter((r) => str(r[0]) && str(r[3]));
  const shipments = shipmentHeaders.map((h) => ({
    ...h,
    lines: lineRows
      .filter((r) => str(r[0]) === h.id)
      .map((r, i) => ({
        id: `${h.id}-L${i + 1}`,
        productId: str(r[3]),
        qty: num(r[5]),
        priceEur: num(r[6]),
        rate: num(r[7]),
        fixedUnitCost: typeof r[19] === "number" ? r[19] : null,
      })),
  }));
  const importExpenses = body("Import expenses")
    .filter((r) => str(r[0]) && typeof r[4] === "number")
    .map((r, i) => ({
      id: `IE${i + 1}`,
      shipmentId: str(r[0]),
      monthId: monthKey(r[2]) ?? "",
      categoryName: str(r[3]),
      amount: num(r[4]),
      paidMonthId: monthKey(r[5]),
      notes: str(r[6]) || null,
    }));

  // ── TI invoices and write-offs ──
  const invoices = body("TI invoices")
    .filter((r) => isoDate(r[0]) && str(r[4]) && !str(r[4]).startsWith("⚠"))
    .map((r, i) => {
      const special = num(r[14]) === 1;
      return {
        id: `INV${i + 1}`,
        date: isoDate(r[0])!,
        number: str(r[2]),
        productId: str(r[4]),
        qty: num(r[5]),
        price: num(r[6]),
        amount: num(r[7]),
        vat: num(r[9]),
        ownUnitCost: special ? num(r[11]) : null,
        sortOrder: i,
      };
    });
  const writeOffs = body("TI write-offs")
    .filter((r) => isoDate(r[0]) && str(r[3]))
    .map((r, i) => ({
      id: `WO${i + 1}`,
      date: isoDate(r[0])!,
      productId: str(r[3]),
      qty: num(r[4]),
      reason: str(r[8]) || null,
    }));

  // ── expenses ──
  const opexCategories: WorkbookData["opexCategories"] = [];
  const category = (company: "TI" | "FARGO", name: string, groupLabel: string) => {
    const plGroup =
      company === "FARGO" && name === FARGO_WRITEOFF_CATEGORY
        ? "FG_WRITEOFF"
        : (company === "TI" ? TI_GROUP_CODES : FARGO_GROUP_CODES)[groupLabel] ?? null;
    if (!opexCategories.some((c) => c.company === company && c.name === name)) {
      opexCategories.push({ company, name, plGroup });
    }
    return plGroup;
  };
  const opexTi = body("OPEX TI")
    .filter((r) => monthKey(r[0]) && str(r[1]))
    .map((r, i) => ({
      id: `OT${i + 1}`,
      monthId: monthKey(r[0])!,
      categoryName: str(r[1]),
      plGroup: category("TI", str(r[1]), str(r[2])),
      bankAmount: num(r[3]),
      cashAmount: num(r[4]),
    }));
  const opexFargo = body("OPEX Fargo")
    .filter((r) => monthKey(r[0]) && str(r[1]))
    .map((r, i) => ({
      id: `OF${i + 1}`,
      monthId: monthKey(r[0])!,
      categoryName: str(r[1]),
      plGroup: category("FARGO", str(r[1]), str(r[2])),
      amount: num(r[3]),
    }));

  // ── taxes ──
  const taxFilings = body("TI tax filings")
    .filter((r) => str(r[0]) && monthKey(r[1]))
    .map((r, i) => ({
      id: `TF${i + 1}`,
      quarterLabel: str(r[0]),
      bookedMonthId: monthKey(r[1])!,
      taxAmount: num(r[2]),
      declaredExpenses: num(r[3]),
      paidMonthId: monthKey(r[4]),
    }));
  const vatAccount = body("TI VAT account")
    .filter((r) => monthKey(r[0]) && str(r[2]))
    .map((r, i) => ({
      id: `VA${i + 1}`,
      period: monthKey(r[0])!,
      date: isoDate(r[1]),
      description: str(r[2]),
      charged: num(r[3]),
      reduced: num(r[4]),
      paid: num(r[5]),
      refunded: num(r[6]),
      balanceAfter: typeof r[7] === "number" ? r[7] : null,
      sortOrder: i,
    }));
  const vatCharges = [
    { id: "VC1", monthId: startMonth, description: settingLabel("STEEL_VAT"), amount: setting("STEEL_VAT"), bearer: "PRIOR_OWNER" },
    { id: "VC2", monthId: startMonth, description: settingLabel("PAPER_VAT"), amount: setting("PAPER_VAT"), bearer: "TI" },
  ].filter((c) => c.amount !== 0);
  const fargoVatReturns = body("Fargo VAT returns")
    .filter((r) => monthKey(r[0]))
    .map((r) => ({
      monthId: monthKey(r[0])!,
      declaredSales: num(r[1]),
      outputVat: num(r[2]),
      inputVat: num(r[3]),
      paid: num(r[4]),
    }));

  // ── funding ──
  const loans = body("Loans & assistance")
    .filter((r) => monthKey(r[0]) && str(r[1]))
    .map((r, i) => ({
      id: `LN${i + 1}`,
      monthId: monthKey(r[0])!,
      lender: str(r[1]),
      received: num(r[2]),
      repaid: num(r[3]),
      notes: str(r[4]) || null,
    }));
  const priorOwner = body("Previous owner")
    .filter((r) => isoDate(r[0]) && str(r[2]))
    .map((r, i) => ({
      id: `PO${i + 1}`,
      date: isoDate(r[0])!,
      description: str(r[2]),
      received: num(r[3]),
      paid: num(r[4]),
      viaFargo: /^Cash via Fargo/i.test(str(r[2])),
      notes: str(r[5]) || null,
    }));
  const otherReceipts = body("Other receipts")
    .filter((r) => isoDate(r[0]) && typeof r[3] === "number")
    .map((r, i) => ({
      id: `OR${i + 1}`,
      date: isoDate(r[0])!,
      payer: str(r[2]),
      amount: num(r[3]),
      notes: str(r[4]) || null,
    }));
  const contributions = body("Capital")
    .filter((r) => isoDate(r[0]))
    .map((r, i) => ({
      id: `CP${i + 1}`,
      date: isoDate(r[0])!,
      tiAmount: num(r[2]),
      fargoAmount: num(r[3]),
      viaFargo: num(r[6]) === 1,
      notes: str(r[5]) || null,
    }));

  // transfers: the previous owner's money appears as a + and a − row; it is
  // carried in «Previous owner» (received via Fargo) instead
  const transferRows = body("Transfers")
    .filter((r) => isoDate(r[0]))
    .map((r) => ({ date: isoDate(r[0])!, cash: num(r[2]), bank: num(r[3]), note: str(r[5]) }));
  const skippedTransfers: WorkbookData["skippedTransfers"] = [];
  const kept = [...transferRows];
  for (const rev of transferRows.filter((t) => /^Previous owner/i.test(t.note))) {
    const pair = kept.findIndex((t) => t !== rev && t.date === rev.date && Math.abs(t.bank + rev.bank) < 0.005 && t.cash === 0);
    const self = kept.indexOf(rev);
    if (pair >= 0 && self >= 0) {
      skippedTransfers.push(rev, kept[pair]);
      kept.splice(Math.max(pair, self), 1);
      kept.splice(Math.min(pair, self), 1);
    }
  }
  const transfers = kept.map((t, i) => ({
    id: `TR${i + 1}`,
    date: t.date,
    cashAmount: t.cash,
    bankAmount: t.bank,
    notes: t.note || null,
  }));

  // ── month-end inputs ──
  const arEntries = body("AR")
    .filter((r) => monthKey(r[0]) && str(r[1]))
    .map((r, i) => ({ id: `AR${i + 1}`, monthId: monthKey(r[0])!, customerName: str(r[1]), amount: num(r[2]) }));
  const warehouses: string[] = [];
  const stockCounts = body("Stock counts")
    .filter((r) => monthKey(r[0]) && str(r[1]))
    .map((r) => {
      const wh = str(r[3]) || "Основной склад";
      if (!warehouses.includes(wh)) warehouses.push(wh);
      return { monthId: monthKey(r[0])!, productId: str(r[1]), warehouseId: wh, qty: num(r[4]) };
    });
  const monthBalances = body("Month balances")
    .filter((r) => monthKey(r[0]))
    .map((r) => ({ monthId: monthKey(r[0])!, tiBank: num(r[1]), tiCash: num(r[2]), goodsInTransit: num(r[3]) }));

  // ── months: from the first statement month to the last month with any data ──
  const pnl = grid(wb, "P&L Consolidated");
  const statementMonths = (pnl[2] ?? []).slice(2).map(monthKey).filter((m): m is string => !!m);
  const last = [statementMonths.at(-1) ?? reportTo, ...sales.map((s) => s.monthId)].sort().at(-1)!;
  const months = monthRange(startMonth, last).map(monthRow);

  const importCategories = [...new Set(importExpenses.map((e) => e.categoryName))];

  const dataset: Dataset = {
    products,
    channels,
    months,
    warehouses: warehouses.map((name, i) => ({ id: name, name, sortOrder: i })),
    sales,
    shipments,
    importExpenses,
    invoices,
    writeOffs,
    opexTi,
    opexFargo,
    taxFilings,
    vatAccount,
    vatCharges,
    fargoVatReturns,
    loans,
    priorOwner,
    otherReceipts,
    contributions,
    transfers,
    stockCounts,
    monthBalances,
    arEntries,
    taxes,
  };

  // ── the workbook's own figures ──
  const expected = mergeExpected([
    prefix("ti.", statementRows(grid(wb, "P&L TI"), {
      revenue: 5, cogs: 7, giveaways: 8, grossProfit: 9, opex: 22, ebitda: 24, profitTax: 26, vatCost: 27, netProfit: 29,
      importVat: 33, outputInvoices: 34, outputOther: 35, netModel: 36, perAccount: 37, accountBalance: 39, priorOwnerPart: 40,
    })),
    prefix("fargo.", statementRows(grid(wb, "P&L Fargo"), {
      bankRevenue: 5, cashRevenue: 6, revenue: 7, salesAtPrice: 8, cashDeclared: 9, units: 11, cogs: 12, stockLoss: 13,
      writeOffsRecorded: 14, grossProfit: 15, opex: 27, incomeTax: 33, netProfit: 36,
      vatInput: 40, vatOutputBank: 41, vatOutputCash: 42, vatNet: 43, vatPaid: 44, vatCredit: 45,
    })),
    prefix("group.", statementRows(pnl, {
      revenue: 7, cogs: 9, giveaways: 10, stockLoss: 11, grossProfit: 12, opex: 36, ebitda: 38, taxes: 45, netProfit: 47, check: 57,
    })),
    prefix("settlement.", statementRows(grid(wb, "Settlement detail"), {
      actBalance: 7, notGoods: 14, partnership: 23, owesByAct: 26, byBank: 27, inCash: 28, owes: 41, check: 42,
    })),
    prefix("bsTi.", statementRows(grid(wb, "BS TI"), {
      receivableFromFargo: 7, stock: 8, vatOverpaid: 10, assets: 11, liabilities: 21, equity: 27, unreconciled: 29,
      unreconciledCash: 34, unreconciledVat: 35,
    })),
    prefix("bsFargo.", statementRows(grid(wb, "BS Fargo"), {
      stock: 5, vatCredit: 6, cashHeld: 8, assets: 9, equity: 17, check: 19,
    })),
    prefix("bsGroup.", statementRows(grid(wb, "BS Consolidated"), {
      stock: 5, assets: 13, liabilities: 23, equity: 29, unreconciled: 31,
    })),
  ]);

  return {
    dataset,
    shipmentHeaders,
    opexCategories,
    importCategories,
    warehouses,
    skippedTransfers,
    reportTo,
    expected,
  };
}

function prefix(p: string, e: Expected): Expected {
  return { months: e.months, rows: Object.fromEntries(Object.entries(e.rows).map(([k, v]) => [p + k, v])) };
}

function mergeExpected(parts: Expected[]): Expected {
  const months = [...new Set(parts.flatMap((p) => p.months))].sort();
  return { months, rows: Object.assign({}, ...parts.map((p) => p.rows)) };
}
