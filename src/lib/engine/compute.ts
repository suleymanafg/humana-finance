// Calculation engine — replicates the Excel workbook exactly (see README §Formulas).
// Pure functions over a Dataset snapshot; every P&L/BS figure derives from raw inputs.

import type {
  BalanceSheetRow,
  CogsRow,
  Computed,
  Dataset,
  MonthlyResult,

  ProductCost,
  QuarterAudit,
  SettlementRow,
  ShipmentCost,
  VatRow,
} from "./types";
import { buildHealthChecks } from "./health";

/** "2025-08" -> "Q3 2025" */
export function quarterLabelOf(monthId: string): string {
  const [y, m] = monthId.split("-").map(Number);
  return `Q${Math.ceil(m / 3)} ${y}`;
}

/** transfers/contributions are dated; assign to a month bucket by calendar month */
export function monthIdOfDate(iso: string): string {
  return iso.slice(0, 7);
}

// 3.1 Landed cost: per-shipment load factor, per-line TI unit cost.
export function computeShipmentCosts(ds: Dataset): ShipmentCost[] {
  const expenseBySh = new Map<string, number>();
  for (const e of ds.importExpenses) {
    expenseBySh.set(e.shipmentId, (expenseBySh.get(e.shipmentId) ?? 0) + e.amount);
  }
  return ds.shipments.map((sh) => {
    const lines = sh.lines.map((l) => {
      const priceUzs = l.priceEur * l.rate;
      return { ...l, priceUzs, purchaseAmount: priceUzs * l.qty, tiUnitCost: 0 };
    });
    const purchaseTotal = lines.reduce((s, l) => s + l.purchaseAmount, 0);
    const expenseTotal = expenseBySh.get(sh.id) ?? 0;
    const loadFactor = purchaseTotal > 0 ? 1 + expenseTotal / purchaseTotal : 1;
    for (const l of lines) l.tiUnitCost = l.priceUzs * loadFactor;
    const fargoValue = lines.reduce((s, l) => s + l.qty * (l.fargoUnitCost ?? 0), 0);
    return {
      shipmentId: sh.id,
      code: sh.code,
      monthId: sh.monthId,
      purchaseTotal,
      expenseTotal,
      loadFactor,
      fargoValue,
      hasMissingFargoCost: lines.some((l) => l.fargoUnitCost == null),
      lines,
    };
  });
}

// 3.1 Weighted-average unit costs per (regular) product across ALL shipment lines.
export function computeProductCosts(shipmentCosts: ShipmentCost[]): Record<string, ProductCost> {
  const acc = new Map<string, { qty: number; tiSum: number; fargoQty: number; fargoSum: number }>();
  for (const sh of shipmentCosts) {
    for (const l of sh.lines) {
      const a = acc.get(l.productId) ?? { qty: 0, tiSum: 0, fargoQty: 0, fargoSum: 0 };
      a.qty += l.qty;
      a.tiSum += l.qty * l.tiUnitCost;
      if (l.fargoUnitCost != null) {
        a.fargoQty += l.qty;
        a.fargoSum += l.qty * l.fargoUnitCost;
      }
      acc.set(l.productId, a);
    }
  }
  const out: Record<string, ProductCost> = {};
  for (const [productId, a] of acc) {
    out[productId] = {
      productId,
      totalQty: a.qty,
      avgTiCost: a.qty > 0 ? a.tiSum / a.qty : 0,
      avgFargoCost: a.fargoQty > 0 ? a.fargoSum / a.fargoQty : 0,
      hasFargoCost: a.fargoQty > 0,
    };
  }
  return out;
}

/** Promo SKUs cost at their regular product's unit costs. */
export function costProductIdOf(productId: string, ds: Dataset): string {
  const p = ds.products.find((x) => x.id === productId);
  return p?.isPromo && p.regularProductId ? p.regularProductId : productId;
}

function emptyMonthly(monthId: string): MonthlyResult {
  return {
    monthId,
    revenueByChannel: {},
    revenue: 0,
    cashRevenue: 0,
    bankRevenue: 0,
    retroBonus: 0,
    retroByChannel: {},
    qtyByProduct: {},
    revenueByProduct: {},
    totalQty: 0,
    cogsRows: [],
    cogs: 0,
    grossProfit: 0,
    gpMarginPct: 0,
    opexTiByGroup: {},
    opexTiTotal: 0,
    opexFargoByGroup: {},
    opexFargoTotal: 0,
    totalOpex: 0,
    ebitda: 0,
    ebitdaMarginPct: 0,
    vatRows: [],
    fargoVat: 0,
    bankVat: 0,
    cashVat: 0,
    fargoIncomeTax: 0,
    tiIncomeTax: 0,
    taxesTotal: 0,
    netProfit: 0,
    netMarginPct: 0,
  };
}

export function computeMonthly(
  ds: Dataset,
  productCosts: Record<string, ProductCost>
): MonthlyResult[] {
  const productById = new Map(ds.products.map((p) => [p.id, p]));
  const channelById = new Map(ds.channels.map((c) => [c.id, c]));

  return ds.months.map((month) => {
    const r = emptyMonthly(month.id);
    const sales = ds.sales.filter((s) => s.monthId === month.id);

    // 3.2 revenue + cash/bank/retro splits (per channel percentages).
    // Imported rows carry the invoiced amount, which reflects discounts,
    // returns and price corrections; manual rows fall back to qty × list price.
    for (const s of sales) {
      const p = productById.get(s.productId);
      const ch = channelById.get(s.channelId);
      if (!p || !ch) continue; // unknown refs surface in health checks
      const amount = s.amount ?? s.qty * p.price;
      r.revenueByChannel[ch.id] = (r.revenueByChannel[ch.id] ?? 0) + amount;
      r.qtyByProduct[s.productId] = (r.qtyByProduct[s.productId] ?? 0) + s.qty;
      r.revenueByProduct[s.productId] = (r.revenueByProduct[s.productId] ?? 0) + amount;
      r.totalQty += s.qty;
    }
    for (const [chId, amount] of Object.entries(r.revenueByChannel)) {
      const ch = channelById.get(chId)!;
      r.revenue += amount;
      r.cashRevenue += amount * ch.cashPct;
      r.bankRevenue += amount * (1 - ch.cashPct);
      const retro = amount * ch.retroPct;
      r.retroBonus += retro;
      if (retro !== 0) r.retroByChannel[chId] = retro;
    }

    // 3.3 COGS at weighted-average TI landed cost (promo -> regular cost)
    for (const [productId, qty] of Object.entries(r.qtyByProduct)) {
      const costId = costProductIdOf(productId, ds);
      const unitCost = productCosts[costId]?.avgTiCost ?? 0;
      const row: CogsRow = { productId, qty, unitCost, amount: qty * unitCost };
      r.cogsRows.push(row);
      r.cogs += row.amount;
    }
    r.grossProfit = r.revenue - r.cogs;
    r.gpMarginPct = r.revenue !== 0 ? r.grossProfit / r.revenue : 0;

    // 3.4 Fargo VAT: prorate each product's qty by the month's overall cash share
    const cashShare = r.revenue !== 0 ? r.cashRevenue / r.revenue : 0;
    for (const [productId, qty] of Object.entries(r.qtyByProduct)) {
      const p = productById.get(productId)!;
      const costId = costProductIdOf(productId, ds);
      const fargoCost = productCosts[costId]?.avgFargoCost ?? 0;
      const qtyCash = qty * cashShare;
      const qtyBank = qty - qtyCash;
      const bankVat = qtyBank * (p.price - fargoCost) * ds.taxes.vatRate;
      const cashVat = qtyCash * fargoCost * ds.taxes.deemedCashMargin * ds.taxes.vatRate;
      const row: VatRow = {
        productId,
        qty,
        qtyCash,
        qtyBank,
        sellPrice: p.price,
        fargoUnitCost: fargoCost,
        bankVat,
        cashVat,
        totalVat: bankVat + cashVat,
      };
      r.vatRows.push(row);
      r.fargoVat += row.totalVat;
      r.bankVat += bankVat;
      r.cashVat += cashVat;
    }

    // 3.5 / 3.6 income taxes
    r.fargoIncomeTax = r.revenue * ds.taxes.fargoIncomeTaxRate;
    r.tiIncomeTax = ds.taxFilings
      .filter((f) => f.bookedMonthId === month.id)
      .reduce((s, f) => s + f.taxAmount, 0);

    // OPEX by P&L group (unmapped kept visible under UNMAPPED)
    for (const e of ds.opexTi.filter((e) => e.monthId === month.id)) {
      const g = e.plGroup ?? "UNMAPPED";
      const amount = e.bankAmount + e.cashAmount;
      r.opexTiByGroup[g] = (r.opexTiByGroup[g] ?? 0) + amount;
      r.opexTiTotal += amount;
    }
    for (const e of ds.opexFargo.filter((e) => e.monthId === month.id)) {
      const g = e.plGroup ?? "UNMAPPED";
      r.opexFargoByGroup[g] = (r.opexFargoByGroup[g] ?? 0) + e.amount;
      r.opexFargoTotal += e.amount;
    }
    // 3.7 rollup
    r.totalOpex = r.opexTiTotal + r.opexFargoTotal + r.retroBonus;
    r.ebitda = r.grossProfit - r.totalOpex;
    r.ebitdaMarginPct = r.revenue !== 0 ? r.ebitda / r.revenue : 0;
    r.taxesTotal = r.fargoVat + r.tiIncomeTax + r.fargoIncomeTax;
    r.netProfit = r.ebitda - r.taxesTotal;
    r.netMarginPct = r.revenue !== 0 ? r.netProfit / r.revenue : 0;
    return r;
  });
}

export function sumMonthly(rows: MonthlyResult[], label = "YTD"): MonthlyResult {
  const t = emptyMonthly(label);
  const addRecord = (into: Record<string, number>, from: Record<string, number>) => {
    for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
  };
  for (const m of rows) {
    addRecord(t.revenueByChannel, m.revenueByChannel);
    addRecord(t.retroByChannel, m.retroByChannel);
    addRecord(t.qtyByProduct, m.qtyByProduct);
    addRecord(t.revenueByProduct, m.revenueByProduct);
    addRecord(t.opexTiByGroup, m.opexTiByGroup);
    addRecord(t.opexFargoByGroup, m.opexFargoByGroup);
    t.revenue += m.revenue;
    t.cashRevenue += m.cashRevenue;
    t.bankRevenue += m.bankRevenue;
    t.retroBonus += m.retroBonus;
    t.totalQty += m.totalQty;
    t.cogs += m.cogs;
    t.opexTiTotal += m.opexTiTotal;
    t.opexFargoTotal += m.opexFargoTotal;
    t.totalOpex += m.totalOpex;
    t.fargoVat += m.fargoVat;
    t.bankVat += m.bankVat;
    t.cashVat += m.cashVat;
    t.fargoIncomeTax += m.fargoIncomeTax;
    t.tiIncomeTax += m.tiIncomeTax;
    t.taxesTotal += m.taxesTotal;
  }
  t.grossProfit = t.revenue - t.cogs;
  t.gpMarginPct = t.revenue !== 0 ? t.grossProfit / t.revenue : 0;
  t.ebitda = t.grossProfit - t.totalOpex;
  t.ebitdaMarginPct = t.revenue !== 0 ? t.ebitda / t.revenue : 0;
  t.netProfit = t.ebitda - t.taxesTotal;
  t.netMarginPct = t.revenue !== 0 ? t.netProfit / t.revenue : 0;
  return t;
}

// 3.9 Fargo↔TI settlement, cumulative per month.
export function computeSettlement(ds: Dataset, monthly: MonthlyResult[]): SettlementRow[] {
  const rows: SettlementRow[] = [];
  let cumRevenue = 0,
    cumFargoOpex = 0,
    cumRetro = 0,
    cumFargoVat = 0,
    cumFargoIncomeTax = 0;
  const arByMonth = new Map<string, number>();
  for (const ar of ds.arEntries) {
    arByMonth.set(ar.monthId, (arByMonth.get(ar.monthId) ?? 0) + ar.amount);
  }
  for (const m of monthly) {
    cumRevenue += m.revenue;
    cumFargoOpex += m.opexFargoTotal;
    cumRetro += m.retroBonus;
    cumFargoVat += m.fargoVat;
    cumFargoIncomeTax += m.fargoIncomeTax;
    let cumTransfersCash = 0,
      cumTransfersBank = 0;
    for (const t of ds.transfers) {
      if (monthIdOfDate(t.date) <= m.monthId) {
        cumTransfersCash += t.cashAmount;
        cumTransfersBank += t.bankAmount;
      }
    }
    const dueToTi =
      cumRevenue - cumFargoOpex - cumRetro - cumFargoVat - cumFargoIncomeTax;
    const outstandingAr = arByMonth.get(m.monthId) ?? 0;
    rows.push({
      monthId: m.monthId,
      cumRevenue,
      cumFargoOpex,
      cumRetro,
      cumFargoVat,
      cumFargoIncomeTax,
      dueToTi,
      cumTransfersCash,
      cumTransfersBank,
      outstandingAr,
      remaining: dueToTi - cumTransfersCash - cumTransfersBank - outstandingAr,
    });
  }
  return rows;
}

// 3.8 Balance sheet snapshots.
export function computeBalanceSheets(
  ds: Dataset,
  monthly: MonthlyResult[],
  settlement: SettlementRow[],
  productCosts: Record<string, ProductCost>
): BalanceSheetRow[] {
  const rows: BalanceSheetRow[] = [];
  let retained = 0;
  for (const [i, m] of monthly.entries()) {
    retained += m.netProfit;
    const mb = ds.monthBalances.find((b) => b.monthId === m.monthId);
    const stock = ds.stockCounts.filter((s) => s.monthId === m.monthId);
    const inventory = stock.reduce((sum, s) => {
      const costId = costProductIdOf(s.productId, ds);
      return sum + s.qty * (productCosts[costId]?.avgTiCost ?? 0);
    }, 0);
    const arTotal = ds.arEntries
      .filter((a) => a.monthId === m.monthId)
      .reduce((s, a) => s + a.amount, 0);
    const settlementReceivable = settlement[i]?.remaining ?? 0;

    let tiCapital = 0,
      fargoCapital = 0;
    for (const c of ds.contributions) {
      if (monthIdOfDate(c.date) <= m.monthId) {
        tiCapital += c.tiAmount;
        fargoCapital += c.fargoAmount;
      }
    }

    const assetsTotal =
      inventory +
      (mb?.goodsInTransit ?? 0) +
      arTotal +
      (mb?.tiBank ?? 0) +
      (mb?.vatPrepayment ?? 0) +
      settlementReceivable;
    // Assumption (documented in README): tax payable = current month's accrued taxes.
    const taxPayable = m.taxesTotal;
    const liabilitiesTotal = taxPayable + (mb?.priorVatBalance ?? 0) + (mb?.nutribenLoan ?? 0);
    const plug = assetsTotal - liabilitiesTotal - (tiCapital + fargoCapital + retained);
    rows.push({
      monthId: m.monthId,
      inventory,
      goodsInTransit: mb?.goodsInTransit ?? 0,
      arTotal,
      tiBank: mb?.tiBank ?? 0,
      vatPrepayment: mb?.vatPrepayment ?? 0,
      settlementReceivable,
      assetsTotal,
      taxPayable,
      priorVatBalance: mb?.priorVatBalance ?? 0,
      nutribenLoan: mb?.nutribenLoan ?? 0,
      liabilitiesTotal,
      tiCapital,
      fargoCapital,
      retainedEarnings: retained,
      plug,
      equityTotal: tiCapital + fargoCapital + retained + plug,
      hasInputs: !!mb || stock.length > 0 || arTotal !== 0,
    });
  }
  return rows;
}

// 3.6 TI quarterly tax & VAT audit: recompute what tax should be per quarter.
export function computeQuarterAudits(ds: Dataset, shipmentCosts: ShipmentCost[]): QuarterAudit[] {
  const byQuarter = new Map<string, { fargoValue: number; gp: number; codes: string[] }>();
  for (const sh of shipmentCosts) {
    const q = quarterLabelOf(sh.monthId);
    const margin = (sh.fargoValue / 1.12 / 1.03) * 0.03;
    const a = byQuarter.get(q) ?? { fargoValue: 0, gp: 0, codes: [] };
    a.fargoValue += sh.fargoValue;
    a.gp += margin;
    a.codes.push(sh.code);
    byQuarter.set(q, a);
  }
  const quarters = new Set<string>([...byQuarter.keys(), ...ds.taxFilings.map((f) => f.quarterLabel)]);
  return [...quarters]
    .sort((a, b) => {
      const [qa, ya] = [a.slice(1, 2), a.slice(3)];
      const [qb, yb] = [b.slice(1, 2), b.slice(3)];
      return ya === yb ? Number(qa) - Number(qb) : Number(ya) - Number(yb);
    })
    .map((q) => {
      const agg = byQuarter.get(q) ?? { fargoValue: 0, gp: 0, codes: [] };
      const filings = ds.taxFilings.filter((f) => f.quarterLabel === q);
      const declaredExpenses = filings.reduce((s, f) => s + f.declaredExpenses, 0);
      const filedTax = filings.reduce((s, f) => s + f.taxAmount, 0);
      const taxableProfit = agg.gp - declaredExpenses;
      const computedTax = ds.taxes.tiIncomeTaxRate * Math.max(0, taxableProfit);
      return {
        quarterLabel: q,
        shipmentCodes: agg.codes,
        fargoValue: agg.fargoValue,
        grossProfit: agg.gp,
        declaredExpenses,
        taxableProfit,
        computedTax,
        filedTax,
        taxVariance: filedTax - computedTax,
        computedVat: agg.gp * ds.taxes.vatRate,
      };
    });
}

export function compute(ds: Dataset): Computed {
  const shipmentCosts = computeShipmentCosts(ds);
  const productCosts = computeProductCosts(shipmentCosts);
  const monthly = computeMonthly(ds, productCosts);
  const ytd = sumMonthly(monthly);
  const settlement = computeSettlement(ds, monthly);
  const balanceSheets = computeBalanceSheets(ds, monthly, settlement, productCosts);
  const quarterAudits = computeQuarterAudits(ds, shipmentCosts);
  const healthChecks = buildHealthChecks(ds, {
    shipmentCosts,
    productCosts,
    monthly,
    ytd,
  });
  return {
    shipmentCosts,
    productCosts,
    monthly,
    ytd,
    settlement,
    balanceSheets,

    quarterAudits,
    healthChecks,
  };
}
