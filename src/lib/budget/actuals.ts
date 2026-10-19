// The budget's actual side, read from the engine: the real position at the end
// of a closed month — the opening the rolling forecast starts from — and the
// actual figures of closed months, shown where the plan stood.
// Until 31 Dec 2026 Fargo sells and owes TI by the settlement model; from
// January 2027 TI's own invoices are its sales. What TI's customers owe is not
// recorded yet, so it is estimated from those invoices and the budget's payment
// days (flagged `estimated`). Pure — no DB imports.
import type { Computed, Dataset } from "../engine/types";
import { isImportVat } from "../engine/costing";
import { addMonths } from "../planning/compute";
import { BUDGET_ORIGIN, CHANNEL_KEYS, channelShares, type BudgetInputs, type BudgetOpening, type ChannelKey } from "./model";

const inMonth = (iso: string, monthId: string) => iso.slice(0, 7) === monthId;

/** Where a TI cost category sits in the budget's P&L groups. */
export function opexGroupOf(categoryName: string, plGroup: string | null): "medical" | "sales" | "admin" | "marketing" {
  if (/мед инвест|мед отдел|medical/i.test(categoryName) || plGroup === "TI_MEDICAL_INVEST") return "medical";
  if (plGroup === "TI_MARKETING") return "marketing";
  if (/SALES|LOGIST|WAREHOUSE|PROMO|DISTRIB/i.test(plGroup ?? "")) return "sales";
  return "admin";
}

/** TI's own sales (from the switch): its invoices incl. VAT, split over the budget's channels. */
function directInvoiced(c: Computed, inputs: BudgetInputs, monthId: string) {
  const switchMonth = `2027-${String(inputs.distStartMonth).padStart(2, "0")}`;
  if (monthId < switchMonth) return null;
  const lines = c.invoices.filter((l) => inMonth(l.date, monthId));
  const total = lines.reduce((t, l) => t + l.amount + l.vat, 0);
  const shares = channelShares(inputs);
  const disc = Object.fromEntries(inputs.channels.map((ch) => [ch.key, ch.discount])) as Record<ChannelKey, number>;
  const weight = CHANNEL_KEYS.reduce((t, k) => t + shares[k] * (1 - (disc[k] ?? 0)), 0);
  const byChannel = Object.fromEntries(CHANNEL_KEYS.map((k) => [k, weight ? (total * shares[k] * (1 - (disc[k] ?? 0))) / weight : 0])) as Record<ChannelKey, number>;
  return { total, units: lines.reduce((t, l) => t + l.qty, 0), byChannel };
}

/** What customers owe at a month-end, from three months of invoices and the budget's payment days. */
function estimatedCustomersOwe(c: Computed, inputs: BudgetInputs, monthId: string) {
  const inv = [0, 1, 2].map((k) => directInvoiced(c, inputs, addMonths(monthId, -k)));
  return inputs.channels.reduce((t, ch) => {
    const d = ch.days;
    const part = (k: number, from: number) => (inv[k]?.byChannel[ch.key] ?? 0) * Math.min(Math.max(d - from, 0), 30) / 30;
    return t + (1 - inputs.allowance) * (part(0, 0) + part(1, 30) + part(2, 60));
  }, 0);
}

function position(ds: Dataset, c: Computed, monthId: string) {
  const b = c.balance.find((x) => x.monthId === monthId);
  const st = c.settlement.find((x) => x.monthId === monthId);
  if (!b || !st) return null;
  const units = (k: "tiStockUnits" | "fargoStockUnits") => Object.values(c.fifo).reduce((t, f) => t + (f.months[monthId]?.[k] ?? 0), 0);
  return { b, st, tiUnits: units("tiStockUnits"), fargoUnits: units("fargoStockUnits") };
}

/**
 * The real position at the end of `monthId` as a budget opening. `approved` is the
 * approved budget's own opening (30 Sep 2026): its own funds stay the base, so the
 * change since then shows as profit and capital.
 */
export function openingAt(ds: Dataset, c: Computed, monthId: string, inputs: BudgetInputs): { opening: BudgetOpening; estimated: string[] } | null {
  const p = position(ds, c, monthId);
  if (!p) return null;
  const { b, st } = p;
  const next = addMonths(monthId, 1);
  // planned trucks are only agreed loads (their month is the dispatch month), not arrivals
  const arriving = c.shipments.filter((s) => s.monthId === next && s.status !== "PLANNED");
  const estimated: string[] = [];
  const direct = [0, 1].map((k) => directInvoiced(c, inputs, addMonths(monthId, -k)));
  const customersOwe = direct[0] ? estimatedCustomersOwe(c, inputs, monthId) : 0;
  if (direct[0]) estimated.push("customersOwe");
  const year = monthId.slice(0, 4);
  const opening: BudgetOpening = {
    monthId,
    cash: b.ti.bank + b.ti.cash,
    stockUnits: p.tiUnits,
    stockValue: b.ti.stock,
    arrivingUnits: arriving.reduce((t, s) => t + s.units, 0),
    arrivingHqValue: arriving.reduce((t, s) => t + s.purchaseTotal, 0),
    transitPaid: b.ti.goodsInTransit,
    customersOwe,
    loans: b.ti.loans,
    vatCredit: b.ti.vatOverpaid,
    vatPayable: b.ti.vatDebt,
    profitTaxPayable: b.ti.profitTaxPayable,
    priorOwner: b.ti.priorOwnerVat + b.ti.priorOwnerCash,
    importUnpaid: b.ti.importUnpaid,
    otherLiabilities: b.ti.otherReceipts,
    fargoOwes: st.owes,
    fargoStockUnits: p.fargoUnits,
    fargoStockValue: b.group.stockAtFargo,
    fargoCustomersOwe: st.receivables,
    profitYtd: c.ti.filter((t) => t.monthId.slice(0, 4) === year && t.monthId <= monthId).reduce((t, x) => t + x.ebitda, 0),
    fargoAccruedPrev: st.accrued,
  };
  if (direct[0]) opening.invoicedPrev = Object.fromEntries(CHANNEL_KEYS.map((k) => [k, [direct[0]!.byChannel[k], direct[1]?.byChannel[k] ?? 0]]));
  // since 1 Oct 2026: shareholder capital, and the rest of the change in own funds as profit
  if (monthId >= BUDGET_ORIGIN) {
    const capital = ds.contributions.filter((x) => !x.viaFargo && x.date.slice(0, 7) >= BUDGET_ORIGIN && x.date.slice(0, 7) <= monthId).reduce((t, x) => t + x.tiAmount, 0);
    const o = inputs.opening;
    const ownFunds0 = o.cash + o.customersOwe + o.stockValue + o.transitPaid + o.vatCredit + o.fargoStockValue + o.fargoOwes + o.fargoCustomersOwe
      - (o.vatPayable + o.profitTaxPayable + o.loans + o.priorOwner + (o.importUnpaid ?? 0) + (o.otherLiabilities ?? 0));
    const assets = opening.cash + opening.customersOwe + opening.stockValue + opening.transitPaid + opening.vatCredit + opening.fargoStockValue + opening.fargoOwes + opening.fargoCustomersOwe;
    const liabilities = opening.vatPayable + opening.profitTaxPayable + opening.loans + opening.priorOwner + (opening.importUnpaid ?? 0) + (opening.otherLiabilities ?? 0);
    opening.capitalAdded = capital;
    opening.profitSinceOrigin = assets - liabilities - ownFunds0 - capital;
  }
  return { opening, estimated };
}

export interface ActualMonth {
  monthId: string;
  estimated: string[];
  units: { ti: number; fargo: number; arrived: number; tiStock: number; fargoStock: number };
  pnl: {
    tiInvoiced: number | null; // incl. VAT, from the switch
    tiNetSales: number | null;
    fargoRevenue: number; // what Fargo owes TI less VAT on TI's invoices to Fargo
    tiCogs: number;
    fargoCogs: number;
    losses: number; // stock lost and written off at Fargo, at TI cost
    medical: number;
    sales: number;
    admin: number;
    marketing: number;
    opex: number;
    ebitda: number;
    profitTax: number;
    netProfit: number;
  };
  cash: {
    open: number;
    fargoPaid: number;
    paidHq: number;
    importCosts: number;
    importVat: number;
    opex: number;
    loans: number;
    priorOwner: number;
    capital: number;
    other: number; // collections, VAT, profit tax and the rest: what closes the month to the bank
    close: number;
  };
  balance: {
    cash: number;
    customersOwe: number;
    stock: number;
    transit: number;
    vatCredit: number;
    fargoStock: number;
    fargoOwes: number;
    loans: number;
    vatPayable: number;
    taxPayable: number;
    priorOwner: number;
    other: number;
  };
}

/** The actual figures of a closed month, in the budget's lines. */
export function actualMonth(ds: Dataset, c: Computed, monthId: string, inputs: BudgetInputs): ActualMonth | null {
  const now = openingAt(ds, c, monthId, inputs);
  const before = openingAt(ds, c, addMonths(monthId, -1), inputs);
  const ti = c.ti.find((x) => x.monthId === monthId);
  const fg = c.fargo.find((x) => x.monthId === monthId);
  const gr = c.group.find((x) => x.monthId === monthId);
  const st = c.settlement.find((x) => x.monthId === monthId);
  if (!now || !before || !ti || !fg || !gr || !st) return null;
  const o = now.opening, ob = before.opening;
  const direct = directInvoiced(c, inputs, monthId);

  const groups = { medical: 0, sales: 0, admin: 0, marketing: 0 };
  let opexPaid = 0;
  for (const e of ds.opexTi.filter((x) => x.monthId === monthId)) {
    groups[opexGroupOf(e.categoryName, e.plGroup)] += e.bankAmount + e.cashAmount;
    opexPaid += e.bankAmount + e.cashAmount;
  }
  const opex = groups.medical + groups.sales + groups.admin + groups.marketing;
  const fargoRevenue = direct ? 0 : st.accrued - ti.vat.outputInvoices;
  const tiNetSales = direct ? direct.total / (1 + inputs.vatRate) : null;
  const tiCogs = direct ? ti.cogs : 0;
  const losses = gr.stockLoss + gr.fargoWriteOffs;
  const ebitda = (tiNetSales ?? 0) + fargoRevenue - tiCogs - gr.cogs - losses - opex;

  const arrived = c.shipments.filter((s) => s.monthId === monthId && s.status === "ARRIVED");
  const hqArrived = arrived.reduce((t, s) => t + s.purchaseTotal, 0);
  const paidIn = (e: { monthId: string; paidMonthId?: string | null }) => (e.paidMonthId ?? e.monthId) === monthId;
  const importCosts = ds.importExpenses.filter((e) => paidIn(e) && !isImportVat(e.categoryName)).reduce((t, e) => t + e.amount, 0);
  const importVat = ds.importExpenses.filter((e) => paidIn(e) && isImportVat(e.categoryName)).reduce((t, e) => t + e.amount, 0);
  const cash = {
    open: ob.cash,
    fargoPaid: ds.transfers.filter((x) => inMonth(x.date, monthId)).reduce((t, x) => t + x.cashAmount + x.bankAmount, 0),
    paidHq: -(o.transitPaid - ob.transitPaid + hqArrived),
    importCosts: -importCosts,
    importVat: -importVat,
    opex: -opexPaid,
    loans: ds.loans.filter((x) => x.monthId === monthId).reduce((t, x) => t + x.received - x.repaid, 0),
    priorOwner: ds.priorOwner.filter((x) => !x.viaFargo && inMonth(x.date, monthId)).reduce((t, x) => t + x.received - x.paid, 0),
    capital: ds.contributions.filter((x) => !x.viaFargo && inMonth(x.date, monthId)).reduce((t, x) => t + x.tiAmount, 0),
    other: 0,
    close: o.cash,
  };
  cash.other = cash.close - cash.open - (cash.fargoPaid + cash.paidHq + cash.importCosts + cash.importVat + cash.opex + cash.loans + cash.priorOwner + cash.capital);

  return {
    monthId,
    estimated: now.estimated,
    units: { ti: direct?.units ?? 0, fargo: fg.units, arrived: arrived.reduce((t, s) => t + s.units, 0), tiStock: o.stockUnits, fargoStock: o.fargoStockUnits },
    pnl: {
      tiInvoiced: direct?.total ?? null,
      tiNetSales,
      fargoRevenue,
      tiCogs,
      fargoCogs: gr.cogs,
      losses,
      ...groups,
      opex,
      ebitda,
      profitTax: ti.profitTax,
      netProfit: ebitda - ti.profitTax,
    },
    cash,
    balance: {
      cash: o.cash,
      customersOwe: o.customersOwe,
      stock: o.stockValue,
      transit: o.transitPaid,
      vatCredit: o.vatCredit,
      fargoStock: o.fargoStockValue,
      fargoOwes: o.fargoOwes + o.fargoCustomersOwe,
      loans: o.loans,
      vatPayable: o.vatPayable,
      taxPayable: o.profitTaxPayable,
      priorOwner: o.priorOwner,
      other: (o.importUnpaid ?? 0) + (o.otherLiabilities ?? 0),
    },
  };
}
