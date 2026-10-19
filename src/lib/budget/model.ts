// The budget model for Humana under Turbo Impex, month by month from an opening
// position to December 2027 — the owner's budget workbook (v10) as code:
// sales by channel → stock and HQ prepayments → costs → P&L, cash flow, VAT,
// profit tax and the balance sheet → how much capital the business needs.
// The same model runs the approved budget (from 30 Sep 2026) and the rolling
// forecast (from the real position at the end of the last closed month).
// Month numbers count from October 2026 (= 1), as in the workbook, so price
// changes, the switch from Fargo and the stock build-up land on the same months
// whatever month the run starts in. Pure — no DB imports.
import { addMonths } from "../planning/compute";

export const BUDGET_ORIGIN = "2026-10"; // month number 1
export const BUDGET_END = "2027-12";
const LOOKAHEAD = 5; // demand plan runs 5 months past the end (stock targets look 3 ahead)

export const CHANNEL_KEYS = ["korzinka", "chains", "tashkent", "fergana", "regions"] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

export interface BudgetProduct {
  name: string;
  listPrice: number; // UZS incl. VAT
  hqEur: number; // HQ price per unit
  units: number; // units sold in the reference period — the sales mix
}

export interface BudgetChannel {
  key: ChannelKey;
  name: string;
  mix: number; // share in the reference period; Korzinka's share is set separately
  discount: number; // discount / retro off the list price
  days: number; // days to pay (0–90)
}

export interface SharedCost {
  name: string;
  amount: number; // per month, total for both brands
  split: "50/50" | "SALES"; // fixed half, or Humana's share of combined sales
  group: "sales" | "admin"; // where it sits in the P&L
}

/** The position the run starts from (end of the month before the first month). */
export interface BudgetOpening {
  monthId: string;
  cash: number;
  stockUnits: number;
  stockValue: number;
  /** units arriving in the first month (trucks already on the way); null = the model decides */
  arrivingUnits: number | null;
  /** their value at HQ prices */
  arrivingHqValue: number;
  /** paid to HQ for goods not yet arrived */
  transitPaid: number;
  customersOwe: number;
  loans: number;
  vatCredit: number;
  vatPayable: number; // paid in the first month
  profitTaxPayable: number;
  priorOwner: number; // owed to the previous owner of TI
  importUnpaid?: number; // import costs booked, not yet paid — paid in the first month
  otherLiabilities?: number; // carried as they are; the plan does not pay them
  fargoOwes: number; // for goods already sold
  fargoStockUnits: number;
  fargoStockValue: number; // at TI cost
  fargoCustomersOwe: number;
  profitYtd: number; // TI profit before tax, calendar year to date
  /** forecast runs: carried from the months already closed */
  capitalAdded?: number; // shareholder capital since 1 Oct 2026
  profitSinceOrigin?: number; // net profit since 1 Oct 2026
  invoicedPrev?: Partial<Record<ChannelKey, [number, number]>>; // last month, the month before (incl. VAT)
  fargoAccruedPrev?: number; // what Fargo owes for last month's sales
}

/** Monthly inputs, one value per month from the run's first month; missing = default. */
export interface BudgetMonthly {
  spikePct: number[]; // extra sales on top of the plan
  expectedUnits: (number | null)[]; // replaces the plan when > 0
  tiShare: number[]; // share of the market TI sells directly (the rest through Fargo)
  fixedTrucks: (number | null)[]; // trucks arriving; null = the model decides
  stockToFargo: number[]; // at least this many units handed to Fargo
  fargoPaid: (number | null)[]; // null = rule: last month's sales + part of the old balance
  fargoReturns: (number | "all")[]; // "all" = Fargo returns all it still holds
  loans: number[]; // received (+) / repaid (−)
  priorOwnerPaid: number[];
  plannedCapital: number[];
}

export interface BudgetInputs {
  vatRate: number;
  profitTaxRate: number;
  eurRate: number;
  sellPriceChange: number;
  sellPriceChangeMonth: number; // month of 2027 (1–12)
  hqPriceChange: number;
  hqPriceChangeMonth: number;
  baseUnits: number; // normal demand per month
  growth: number; // per month
  allowance: number; // returns, expiry and bad debt, % of invoiced sales
  spikeReady: number; // sudden sales jump to be ready for
  importCostPct: number;
  importVatPct: number;
  truckUnits: number;
  coverMonths: number;
  buildupMonths: number;
  leadDays: number; // paying HQ → goods arriving (0–60)
  hqEurPerUnit: number | null; // null = product mix
  products: BudgetProduct[];
  korzinkaShare: number;
  channels: BudgetChannel[];
  medicalPct: number; // % of market sales at list price
  mrPayroll: number;
  officePayroll: number;
  payrollTaxes: number;
  officeCosts: number;
  marketing: number;
  tradePromo: number;
  smartUp: number;
  vehicles: number;
  certificates: number;
  certificatesMonth: number; // month of the year
  bankFeePct: number; // % of money collected
  shared: SharedCost[];
  nutribenSales: number;
  nutribenGrowth: number;
  fargoRemitPct: number; // what Fargo owes TI, % of its sales at list price
  tiMarkup: number; // TI invoice price to Fargo over landed cost
  distStartMonth: number; // month of 2027 TI's own distribution costs start
  fargoOldMonths: number; // months over which Fargo clears its old balance
  reserveMonths: number; // minimum cash, months of operating costs
  spikeBuffer: number; // recommended permanent buffer (typed in)
  opening: BudgetOpening;
  monthly: BudgetMonthly;
}

/**
 * Supply from the supply plan (planning), by month id: when given it replaces the model's own
 * truck rule and sales plan — units sold are the plan's demand less what runs short, trucks
 * become sellable when the plan says (45 days after dispatch) and HQ is paid at dispatch.
 */
export interface BudgetSupply {
  /** units sold, TI + Fargo (before the spike test) */
  marketUnits: Record<string, number>;
  /** list price of the month's product mix, UZS incl. VAT, before the price change */
  listPrice?: Record<string, number>;
  /** units that become sellable in the month, and their HQ value in UZS */
  arrivals: Record<string, number>;
  arrivalsHq: Record<string, number>;
  /** paid to HQ in the month, UZS */
  paidHq: Record<string, number>;
  /** trucks that become sellable in the month */
  trucks: Record<string, number>;
}

type Line = number[];
const sum =(a: Line, from = 0, to = a.length - 1) => a.slice(from, to + 1).reduce((t, x) => t + x, 0);
const avg3 = (a: Line, i: number) => (a[i + 1] + a[i + 2] + a[i + 3]) / 3;
const div = (a: number, b: number, fallback = 0) => (b === 0 ? fallback : a / b);

/** months from `from` to `to`, inclusive */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}
export const monthNumber = (monthId: string) => monthRange(BUDGET_ORIGIN, monthId).length;

/** Products' list price and HQ price weighted by the sales mix. */
export function productAverages(inputs: Pick<BudgetInputs, "products">) {
  const units = inputs.products.reduce((t, p) => t + p.units, 0);
  const mix = inputs.products.map((p) => div(p.units, units));
  return {
    mix,
    listPrice: inputs.products.reduce((t, p, i) => t + p.listPrice * mix[i], 0),
    hqEur: inputs.products.reduce((t, p, i) => t + p.hqEur * mix[i], 0),
  };
}

/** Korzinka's share is typed; the other channels keep their mix and fill the rest. */
export function channelShares(inputs: Pick<BudgetInputs, "korzinkaShare" | "channels">): Record<ChannelKey, number> {
  const others = inputs.channels.filter((c) => c.key !== "korzinka");
  const otherMix = others.reduce((t, c) => t + c.mix, 0);
  const out = { korzinka: inputs.korzinkaShare } as Record<ChannelKey, number>;
  for (const c of others) out[c.key] = div(c.mix * (1 - inputs.korzinkaShare), otherMix);
  return out;
}

/** HQ payment timing: shares paid in the month of arrival, one and two months before. */
export function paymentWeights(leadDays: number): [number, number, number] {
  const d = leadDays / 30;
  return [Math.max(0, 1 - d), Math.min(1, d) - Math.max(0, d - 1), Math.max(0, Math.min(1, d - 1))];
}

export type BudgetRun = ReturnType<typeof runBudget>;

export function runBudget(inputs: BudgetInputs, opts: { start?: string; end?: string; supply?: BudgetSupply } = {}) {
  const I = inputs;
  const SP = opts.supply;
  const O = I.opening;
  const start = opts.start ?? addMonths(O.monthId, 1);
  const end = opts.end ?? BUDGET_END;
  const months = monthRange(start, end);
  const H = months.length;
  const N = H + LOOKAHEAD; // demand plan
  const S = H + 2; // stock and arrivals (payments look two months ahead)
  const all = monthRange(start, addMonths(end, LOOKAHEAD));
  const mNum = all.map(monthNumber);
  const monthOfYear = all.map((m) => Number(m.slice(5)));
  const M = I.monthly;
  const at = <T>(arr: T[] | undefined, i: number, fallback: T): T => (arr && i < arr.length && arr[i] !== undefined ? arr[i] : fallback);

  const { listPrice: avgList, hqEur: avgEur } = productAverages(I);
  const shares = channelShares(I);
  const chan = Object.fromEntries(I.channels.map((c) => [c.key, c])) as Record<ChannelKey, BudgetChannel>;
  const avgDiscount = CHANNEL_KEYS.reduce((t, k) => t + shares[k] * (chan[k]?.discount ?? 0), 0);
  const [w0, w1, w2] = paymentWeights(I.leadDays);
  const distOn = (i: number) => (mNum[i] >= I.distStartMonth + 3 ? 1 : 0);
  const z = (n: number) => new Array<number>(n).fill(0);

  // ── Sales ────────────────────────────────────────────────────────────────
  const planUnits = z(N), spike = z(N), marketUnits = z(N), tiShare = z(N), tiUnits = z(N), fargoUnits = z(N), price = z(N);
  for (let i = 0; i < N; i++) {
    planUnits[i] = SP?.marketUnits[all[i]] ?? I.baseUnits * (1 + I.growth) ** mNum[i];
    spike[i] = i < H ? at(M.spikePct, i, 0) : spike[i - 1] ?? 0;
    const expected = i < H ? at(M.expectedUnits, i, null) : null;
    marketUnits[i] = expected && expected > 0 ? expected : planUnits[i] * (1 + spike[i]);
    tiShare[i] = i < H ? at(M.tiShare, i, 1) : 1;
    tiUnits[i] = marketUnits[i] * tiShare[i];
    fargoUnits[i] = marketUnits[i] - tiUnits[i];
    price[i] = (SP?.listPrice?.[all[i]] || avgList) * (1 + (mNum[i] >= I.sellPriceChangeMonth + 3 ? I.sellPriceChange : 0));
  }
  const marketAtList = z(H), tiAtList = z(H), fargoAtList = z(H), fargoAccrued = z(H);
  const invoiced = Object.fromEntries(CHANNEL_KEYS.map((k) => [k, z(H)])) as Record<ChannelKey, Line>;
  const owed = Object.fromEntries(CHANNEL_KEYS.map((k) => [k, z(H)])) as Record<ChannelKey, Line>;
  const invoicedTotal = z(H), discounts = z(H), outputVat = z(H), netSales = z(H), grossExVat = z(H), allowance = z(H);
  const customersOwe = z(H), daysInMarket = z(H), collected = z(H);
  const inv = (k: ChannelKey, i: number) => (i >= 0 ? invoiced[k][i] : (O.invoicedPrev?.[k]?.[-i - 1] ?? 0));
  for (let i = 0; i < H; i++) {
    marketAtList[i] = marketUnits[i] * price[i];
    tiAtList[i] = tiUnits[i] * price[i];
    fargoAtList[i] = fargoUnits[i] * price[i];
    fargoAccrued[i] = fargoAtList[i] * I.fargoRemitPct;
    for (const k of CHANNEL_KEYS) invoiced[k][i] = tiAtList[i] * shares[k] * (1 - (chan[k]?.discount ?? 0));
    invoicedTotal[i] = CHANNEL_KEYS.reduce((t, k) => t + invoiced[k][i], 0);
    discounts[i] = tiAtList[i] - invoicedTotal[i];
    outputVat[i] = (invoicedTotal[i] * I.vatRate) / (1 + I.vatRate);
    netSales[i] = invoicedTotal[i] - outputVat[i];
    grossExVat[i] = tiAtList[i] / (1 + I.vatRate);
    allowance[i] = invoicedTotal[i] * I.allowance;
    for (const k of CHANNEL_KEYS) {
      const d = chan[k]?.days ?? 0;
      owed[k][i] = (1 - I.allowance) * (inv(k, i) * Math.min(d, 30) / 30 + inv(k, i - 1) * Math.min(Math.max(d - 30, 0), 30) / 30 + inv(k, i - 2) * Math.min(Math.max(d - 60, 0), 30) / 30);
    }
    customersOwe[i] = CHANNEL_KEYS.reduce((t, k) => t + owed[k][i], 0);
    daysInMarket[i] = div(customersOwe[i], invoicedTotal[i] * (1 - I.allowance)) * 30;
    collected[i] = (1 - I.allowance) * invoicedTotal[i] + (i === 0 ? O.customersOwe : customersOwe[i - 1]) - customersOwe[i];
  }

  // ── Stock: units, Fargo, cost, HQ payments, warehouse value ─────────────────
  const toFargo = z(S), leaving = z(S), targetCover = z(S), targetUnits = z(S), tiOpen = z(S), fromFargo = z(S), arrivals = z(S), tiClose = z(S), cover = z(S), trucks = z(S);
  const fgOpen = z(S), fgClose = z(S), fgOpenVal = z(S), fgReceivedVal = z(S), fgAvgCost = z(S), fargoCogs = z(S), fgReturnedVal = z(S), fgCloseVal = z(S);
  const hqUnit = z(S), landedUnit = z(S), hqArriving = z(S), paidHq = z(S), transit = z(S), importCosts = z(S), importVat = z(S);
  const tiOpenVal = z(S), arrivalsLanded = z(S), tiAvgCost = z(S), tiCogs = z(S), toFargoVal = z(S), tiCloseVal = z(S), vatOnTiInvoices = z(S);
  let openCover = 0;
  for (let i = 0; i < S; i++) {
    fgOpen[i] = i === 0 ? O.fargoStockUnits : fgClose[i - 1];
    fromFargo[i] = i < H ? (at(M.fargoReturns, i, 0) === "all" ? fgOpen[i] : (at(M.fargoReturns, i, 0) as number)) : 0;
    toFargo[i] = i < H ? Math.max(at(M.stockToFargo, i, 0), fargoUnits[i] - fgOpen[i]) : 0;
    leaving[i] = tiUnits[i] + toFargo[i];
    if (i === 0) openCover = div(O.stockUnits, leaving[0]);
    targetCover[i] = Math.min(I.coverMonths, openCover + (I.coverMonths - openCover) * (I.buildupMonths <= 0 ? 1 : Math.min(1, mNum[i] / I.buildupMonths)));
    targetUnits[i] = targetCover[i] * avg3(planUnits, i);
    tiOpen[i] = i === 0 ? O.stockUnits : tiClose[i - 1];
    const fixed = i < H ? at(M.fixedTrucks, i, null) : null;
    // the first month: trucks already on the way, unless the owner typed the month's trucks
    const known = !SP && i === 0 && O.arrivingUnits !== null && fixed === null;
    if (SP) arrivals[i] = SP.arrivals[all[i]] ?? 0;
    else if (known) arrivals[i] = O.arrivingUnits!;
    else if (fixed !== null) arrivals[i] = fixed * I.truckUnits;
    else arrivals[i] = Math.ceil(Number((Math.max(0, targetUnits[i] - tiOpen[i] - fromFargo[i] + leaving[i]) / I.truckUnits).toFixed(6))) * I.truckUnits;
    tiClose[i] = tiOpen[i] + fromFargo[i] + arrivals[i] - leaving[i];
    cover[i] = div(tiClose[i], avg3(planUnits, i));
    trucks[i] = SP ? SP.trucks[all[i]] ?? 0 : arrivals[i] / I.truckUnits;

    hqUnit[i] = (I.hqEurPerUnit ?? avgEur) * I.eurRate * (1 + (mNum[i] >= I.hqPriceChangeMonth + 3 ? I.hqPriceChange : 0));
    landedUnit[i] = hqUnit[i] * (1 + I.importCostPct);
    hqArriving[i] = SP ? SP.arrivalsHq[all[i]] ?? 0 : i === 0 && O.arrivingUnits !== null && (i < H ? at(M.fixedTrucks, i, null) : null) === null ? O.arrivingHqValue : arrivals[i] * hqUnit[i];
    importCosts[i] = hqArriving[i] * I.importCostPct;
    importVat[i] = hqArriving[i] * I.importVatPct;

    // Fargo's stock at TI cost: returns leave at Fargo's opening average
    fgOpenVal[i] = i === 0 ? O.fargoStockValue : fgCloseVal[i - 1];
    fgReturnedVal[i] = fromFargo[i] * div(fgOpenVal[i], fgOpen[i]);
    // TI warehouse at moving average cost
    tiOpenVal[i] = i === 0 ? O.stockValue : tiCloseVal[i - 1];
    arrivalsLanded[i] = hqArriving[i] * (1 + I.importCostPct);
    tiAvgCost[i] = tiOpen[i] + arrivals[i] + fromFargo[i] === 0 ? landedUnit[i] : (tiOpenVal[i] + arrivalsLanded[i] + fgReturnedVal[i]) / (tiOpen[i] + arrivals[i] + fromFargo[i]);
    tiCogs[i] = tiUnits[i] * tiAvgCost[i];
    toFargoVal[i] = toFargo[i] * tiAvgCost[i];
    tiCloseVal[i] = tiOpenVal[i] + arrivalsLanded[i] + fgReturnedVal[i] - tiCogs[i] - toFargoVal[i];
    vatOnTiInvoices[i] = toFargoVal[i] * (1 + I.tiMarkup) * I.vatRate;

    fgReceivedVal[i] = toFargoVal[i];
    fgAvgCost[i] = div(fgOpenVal[i] + fgReceivedVal[i], fgOpen[i] + toFargo[i]);
    fargoCogs[i] = fargoUnits[i] * fgAvgCost[i];
    fgCloseVal[i] = fgOpenVal[i] + fgReceivedVal[i] - fargoCogs[i] - fgReturnedVal[i];
    fgClose[i] = fgOpen[i] + toFargo[i] - fargoUnits[i] - fromFargo[i];
  }
  // HQ is prepaid: what arrives this month, next month and the month after
  for (let i = 0; i < H; i++) {
    // from the supply plan: paid at dispatch
    paidHq[i] = SP
      ? SP.paidHq[all[i]] ?? 0
      : i === 0
        ? hqArriving[0] - O.transitPaid + (w1 + w2) * hqArriving[1] + w2 * hqArriving[2]
        : w0 * hqArriving[i] + w1 * hqArriving[i + 1] + w2 * hqArriving[i + 2];
    transit[i] = (i === 0 ? O.transitPaid : transit[i - 1]) + paidHq[i] - hqArriving[i];
  }

  // ── Operating costs ─────────────────────────────────────────────────────
  const nutriben = z(H), splitKey = z(H), medical = z(H), promo = z(H), smartUp = z(H), vehicles = z(H), certificates = z(H), bankFees = z(H);
  const ownTotal = z(H), sharedTotal = z(H), opexTotal = z(H);
  const sharedLines = I.shared.map(() => z(H));
  const groupMedical = z(H), groupSales = z(H), groupAdmin = z(H), groupMarketing = z(H);
  for (let i = 0; i < H; i++) {
    nutriben[i] = I.nutribenSales * (1 + I.nutribenGrowth) ** mNum[i];
    splitKey[i] = invoicedTotal[i] + nutriben[i] === 0 ? 0.5 : invoicedTotal[i] / (invoicedTotal[i] + nutriben[i]);
    medical[i] = I.medicalPct * marketAtList[i];
    promo[i] = I.tradePromo * distOn(i);
    smartUp[i] = I.smartUp * distOn(i);
    vehicles[i] = I.vehicles * distOn(i);
    certificates[i] = monthOfYear[i] === I.certificatesMonth ? I.certificates : 0;
    bankFees[i] = I.bankFeePct * collected[i];
    ownTotal[i] = medical[i] + I.mrPayroll + I.officePayroll + I.payrollTaxes + I.officeCosts + I.marketing + promo[i] + smartUp[i] + vehicles[i] + certificates[i] + bankFees[i];
    I.shared.forEach((s, k) => { sharedLines[k][i] = s.amount * (s.split === "50/50" ? 0.5 : splitKey[i]) * distOn(i); });
    sharedTotal[i] = sharedLines.reduce((t, l) => t + l[i], 0);
    opexTotal[i] = ownTotal[i] + sharedTotal[i];
    const shared = (g: SharedCost["group"]) => I.shared.reduce((t, s, k) => t + (s.group === g ? sharedLines[k][i] : 0), 0);
    groupMedical[i] = medical[i] + I.mrPayroll;
    groupSales[i] = promo[i] + vehicles[i] + shared("sales");
    groupAdmin[i] = I.officePayroll + I.payrollTaxes + I.officeCosts + smartUp[i] + certificates[i] + bankFees[i] + shared("admin");
    groupMarketing[i] = I.marketing;
  }

  // ── P&L ─────────────────────────────────────────────────────────────────
  const fargoRevenue = z(H), netRevenue = z(H), grossProfit = z(H), ebitda = z(H), profitYtd = z(H), taxYtd = z(H), profitTax = z(H), netProfit = z(H), netCum = z(H);
  for (let i = 0; i < H; i++) {
    fargoRevenue[i] = fargoAccrued[i] - vatOnTiInvoices[i];
    netRevenue[i] = grossExVat[i] - (grossExVat[i] - netSales[i]) + fargoRevenue[i];
    grossProfit[i] = netRevenue[i] - allowance[i] - tiCogs[i] - fargoCogs[i];
    ebitda[i] = grossProfit[i] - opexTotal[i];
    const jan = monthOfYear[i] === 1;
    profitYtd[i] = (i === 0 ? O.profitYtd : jan ? 0 : profitYtd[i - 1]) + ebitda[i];
    taxYtd[i] = Math.max(0, profitYtd[i]) * I.profitTaxRate;
    profitTax[i] = taxYtd[i] - (i === 0 ? Math.max(0, O.profitYtd) * I.profitTaxRate : jan ? 0 : taxYtd[i - 1]); // charge, positive
    netProfit[i] = ebitda[i] - profitTax[i];
    netCum[i] = (i === 0 ? (O.profitSinceOrigin ?? 0) : netCum[i - 1]) + netProfit[i];
  }

  // ── Fargo pays: last month's sales, plus its old balance in equal parts ─────
  const fargoPaid = z(H);
  const oldParts = Math.max(1, I.fargoOldMonths);
  for (let i = 0; i < H; i++) {
    const typed = at(M.fargoPaid, i, null);
    if (typed !== null) { fargoPaid[i] = typed; continue; }
    const lastMonth = i === 0 ? (O.fargoAccruedPrev ?? 0) : fargoAccrued[i - 1];
    const oldBase = O.fargoOwes + O.fargoCustomersOwe - (i === 0 ? lastMonth : fargoPaid[0]);
    fargoPaid[i] = lastMonth + (i >= 1 && i <= I.fargoOldMonths ? oldBase / oldParts : 0);
  }

  // ── VAT, profit tax, cash ───────────────────────────────────────────────
  const vatOnSales = z(H), vatNet = z(H), vatCreditIn = z(H), vatDue = z(H), vatCreditOut = z(H), vatPaid = z(H);
  const taxPaid = z(H), taxPayable = z(H);
  const cashOpen = z(H), cashOps = z(H), netCash = z(H), cash = z(H), reserve = z(H), aboveReserve = z(H);
  const loans = z(H), priorOwnerPaid = z(H), capital = z(H);
  for (let i = 0; i < H; i++) {
    vatOnSales[i] = outputVat[i] + vatOnTiInvoices[i];
    vatNet[i] = vatOnSales[i] - importVat[i];
    vatCreditIn[i] = i === 0 ? O.vatCredit : vatCreditOut[i - 1];
    vatDue[i] = Math.max(0, vatNet[i] - vatCreditIn[i]);
    vatCreditOut[i] = Math.max(0, vatCreditIn[i] - vatNet[i]);
    vatPaid[i] = i === 0 ? O.vatPayable : vatDue[i - 1];
    taxPaid[i] = Math.max(0, i === 0 ? O.profitTaxPayable : taxPayable[i - 1]);
    taxPayable[i] = (i === 0 ? O.profitTaxPayable : taxPayable[i - 1]) + profitTax[i] - taxPaid[i];
    loans[i] = at(M.loans, i, 0);
    priorOwnerPaid[i] = at(M.priorOwnerPaid, i, 0);
    capital[i] = at(M.plannedCapital, i, 0);
    cashOpen[i] = i === 0 ? O.cash : cash[i - 1];
    cashOps[i] = collected[i] - paidHq[i] - importCosts[i] - (i === 0 ? (O.importUnpaid ?? 0) : 0) - importVat[i] - opexTotal[i] - vatPaid[i] - taxPaid[i];
    netCash[i] = cashOps[i] + fargoPaid[i] - priorOwnerPaid[i] + loans[i] + capital[i];
    cash[i] = cashOpen[i] + netCash[i];
    reserve[i] = I.reserveMonths * opexTotal[i];
    aboveReserve[i] = cash[i] - reserve[i];
  }

  // ── Balance sheet ───────────────────────────────────────────────────────
  const fargoOwes = z(H), assets = z(H), loanBal = z(H), priorOwner = z(H), liabilities = z(H), capitalCum = z(H), equity = z(H), check = z(H);
  const openAssets = O.cash + O.customersOwe + O.stockValue + O.transitPaid + O.vatCredit + O.fargoStockValue + O.fargoOwes + O.fargoCustomersOwe;
  const otherLiabilities = O.otherLiabilities ?? 0;
  const openLiabilities = O.vatPayable + O.profitTaxPayable + O.loans + O.priorOwner + (O.importUnpaid ?? 0) + otherLiabilities;
  const ownFunds = openAssets - openLiabilities - (O.capitalAdded ?? 0) - (O.profitSinceOrigin ?? 0);
  for (let i = 0; i < H; i++) {
    fargoOwes[i] = (i === 0 ? O.fargoOwes + O.fargoCustomersOwe : fargoOwes[i - 1]) + fargoAccrued[i] - fargoPaid[i];
    assets[i] = cash[i] + customersOwe[i] + tiCloseVal[i] + transit[i] + vatCreditOut[i] + fgCloseVal[i] + fargoOwes[i];
    loanBal[i] = (i === 0 ? O.loans : loanBal[i - 1]) + loans[i];
    priorOwner[i] = (i === 0 ? O.priorOwner : priorOwner[i - 1]) - priorOwnerPaid[i];
    liabilities[i] = vatDue[i] + taxPayable[i] + loanBal[i] + priorOwner[i] + otherLiabilities;
    capitalCum[i] = (i === 0 ? (O.capitalAdded ?? 0) : capitalCum[i - 1]) + capital[i];
    equity[i] = ownFunds + capitalCum[i] + netCum[i];
    check[i] = Math.round(assets[i] - liabilities[i] - equity[i]) || 0; // no "−0"
  }

  const cut = (a: Line) => a.slice(0, H);
  return {
    months,
    start,
    opening: O,
    averages: { listPrice: avgList, hqEur: avgEur, discount: avgDiscount, openCover, shares, paymentWeights: [w0, w1, w2] as const },
    sales: {
      planUnits: cut(planUnits), spike: cut(spike), marketUnits: cut(marketUnits), tiShare: cut(tiShare), tiUnits: cut(tiUnits), fargoUnits: cut(fargoUnits), price: cut(price),
      marketAtList, tiAtList, fargoAtList, fargoAccrued, invoiced, invoicedTotal, discounts, outputVat, netSales, grossExVat, allowance,
      owed, customersOwe, daysInMarket, collected,
    },
    stock: {
      tiUnits: cut(tiUnits), toFargo: cut(toFargo), leaving: cut(leaving), targetCover: cut(targetCover), targetUnits: cut(targetUnits), tiOpen: cut(tiOpen), fromFargo: cut(fromFargo),
      arrivals: cut(arrivals), tiClose: cut(tiClose), cover: cut(cover), trucks: cut(trucks),
      fgOpen: cut(fgOpen), fgReceived: cut(toFargo), fgSold: cut(fargoUnits), fgReturned: cut(fromFargo), fgClose: cut(fgClose),
      fgOpenVal: cut(fgOpenVal), fgReceivedVal: cut(fgReceivedVal), fgAvgCost: cut(fgAvgCost), fargoCogs: cut(fargoCogs), fgReturnedVal: cut(fgReturnedVal), fgCloseVal: cut(fgCloseVal),
      hqUnit: cut(hqUnit), landedUnit: cut(landedUnit), hqArriving: cut(hqArriving), paidHq: cut(paidHq), transit: cut(transit), importCosts: cut(importCosts), importVat: cut(importVat),
      tiOpenVal: cut(tiOpenVal), arrivalsLanded: cut(arrivalsLanded), fgReturnedToTiVal: cut(fgReturnedVal), tiAvgCost: cut(tiAvgCost), tiCogs: cut(tiCogs), toFargoVal: cut(toFargoVal), tiCloseVal: cut(tiCloseVal), vatOnTiInvoices: cut(vatOnTiInvoices),
      lowestUnits: Math.min(...cut(tiClose), ...cut(fgClose)),
    },
    opex: {
      humanaSales: invoicedTotal, nutriben, splitKey, medical, mrPayroll: z(H).fill(I.mrPayroll), officePayroll: z(H).fill(I.officePayroll), payrollTaxes: z(H).fill(I.payrollTaxes),
      officeCosts: z(H).fill(I.officeCosts), marketing: z(H).fill(I.marketing), promo, smartUp, vehicles, certificates, bankFees, ownTotal, sharedLines, sharedTotal, total: opexTotal,
      groupMedical, groupSales, groupAdmin, groupMarketing,
    },
    pnl: {
      tiUnits: cut(tiUnits), fargoUnits: cut(fargoUnits), grossExVat, discounts: grossExVat.map((g, i) => -(g - netSales[i])), fargoRevenue, netRevenue,
      returns: allowance.map((x) => -x), tiCogs: cut(tiCogs).map((x) => -x), fargoCogs: cut(fargoCogs).map((x) => -x), grossProfit,
      grossMargin: grossProfit.map((g, i) => div(g, netRevenue[i])),
      medical: groupMedical.map((x) => -x), sales: groupSales.map((x) => -x), admin: groupAdmin.map((x) => -x), marketing: groupMarketing.map((x) => -x), opex: opexTotal.map((x) => -x),
      ebitda, ebitdaMargin: ebitda.map((e, i) => div(e, netRevenue[i])), profitYtd, taxYtd, profitTax: profitTax.map((x) => -x), netProfit,
      netMargin: netProfit.map((n, i) => div(n, netRevenue[i])), netCum,
    },
    cash: {
      open: cashOpen, collected, paidHq: cut(paidHq).map((x) => -x), importCosts: cut(importCosts).map((x, i) => -x - (i === 0 ? (O.importUnpaid ?? 0) : 0)), importVat: cut(importVat).map((x) => -x), opex: opexTotal.map((x) => -x),
      vatPaid: vatPaid.map((x) => -x), taxPaid: taxPaid.map((x) => -x), operations: cashOps, fargoPaid, priorOwnerPaid: priorOwnerPaid.map((x) => -x), loans, capital, net: netCash, close: cash, reserve, aboveReserve,
    },
    vat: { onSales: vatOnSales, importOffset: cut(importVat).map((x) => -x), net: vatNet, creditIn: vatCreditIn, due: vatDue, creditOut: vatCreditOut, paid: vatPaid },
    tax: { charge: profitTax, paid: taxPaid, payable: taxPayable },
    balance: {
      cash, customersOwe, stock: cut(tiCloseVal), transit: cut(transit), vatCredit: vatCreditOut, fargoStock: cut(fgCloseVal), fargoOwes, assets,
      vatPayable: vatDue, taxPayable, loans: loanBal, priorOwner, otherLiabilities, liabilities, ownFunds, capitalAdded: capitalCum, profitSinceOrigin: netCum, equity, check,
      openAssets, openLiabilities,
    },
  };
}

/** Values in a calendar year of the run, for the yearly totals. */
export function yearIndexes(run: Pick<BudgetRun, "months">, year: number): number[] {
  return run.months.map((m, i) => (Number(m.slice(0, 4)) === year ? i : -1)).filter((i) => i >= 0);
}
export const total = (line: Line, idx: number[]) => idx.reduce((t, i) => t + line[i], 0);
export { sum };
