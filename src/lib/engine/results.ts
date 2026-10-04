// Monthly results for Turbo Impex, Fargo (Humana business only) and the group.
//
// Fargo sells at one VAT-inclusive price for cash and bank. Each channel's
// cash share splits its sales: bank sales carry VAT inside the price
// (price × 12/112); cash sales are declared at Fargo's FIFO cost × 1.03 with
// 12% VAT on that. Revenue never includes VAT.
import { isImportVat, monthOf } from "./costing";
import { FARGO_WRITEOFF_GROUP } from "../groups";
import type {
  Dataset,
  FargoMonth,
  GroupMonth,
  InvoiceLineCost,
  ProductFifo,
  TiMonth,
  WriteOffCost,
} from "./types";

const add = (rec: Record<string, number>, key: string, v: number) => {
  rec[key] = (rec[key] ?? 0) + v;
};

export function computeFargoMonths(
  ds: Dataset,
  monthIds: string[],
  invoices: InvoiceLineCost[],
  fifo: Record<string, ProductFifo>,
  costOf: (id: string) => string
): FargoMonth[] {
  const r = ds.taxes.vatRate;
  const products = new Map(ds.products.map((p) => [p.id, p]));
  const channels = new Map(ds.channels.map((c) => [c.id, c]));
  const months = new Map<string, FargoMonth>(
    monthIds.map((m) => [
      m,
      {
        monthId: m,
        salesAtPrice: 0,
        bankSales: 0,
        cashSales: 0,
        bankRevenue: 0,
        cashRevenue: 0,
        revenue: 0,
        cashDeclared: 0,
        declaredTotal: 0,
        units: 0,
        salesByChannel: {},
        salesByProduct: {},
        revenueByProduct: {},
        qtyByProduct: {},
        cogs: 0,
        stockLoss: 0,
        writeOffsRecorded: 0,
        grossProfit: 0,
        opexByGroup: {},
        opex: 0,
        ebitda: 0,
        incomeTax: 0,
        netProfit: 0,
        vat: { input: 0, outputBank: 0, outputCash: 0, net: 0, creditIn: 0, paid: 0, creditOut: 0 },
      },
    ])
  );

  for (const s of ds.sales) {
    const fm = months.get(s.monthId);
    const product = products.get(s.productId);
    const channel = channels.get(s.channelId);
    if (!fm || !product || !channel) continue;
    const sales = s.amount ?? s.qty * product.price;
    const cash = sales * channel.cashPct;
    const bank = sales - cash;
    const unit = fifo[costOf(s.productId)]?.months[s.monthId];
    const fargoUnitCost = unit?.fargoUnitCost ?? 0;
    const bankVat = (bank * r) / (1 + r);
    const declared = s.qty * channel.cashPct * fargoUnitCost * (1 + ds.taxes.deemedCashMargin);
    const cashVat = declared * r;
    fm.salesAtPrice += sales;
    fm.bankSales += bank;
    fm.cashSales += cash;
    fm.vat.outputBank += bankVat;
    fm.vat.outputCash += cashVat;
    fm.cashDeclared += declared;
    fm.incomeTax += sales * ds.taxes.fargoIncomeTaxRate;
    fm.cogs += s.qty * fargoUnitCost;
    fm.units += s.qty;
    add(fm.salesByChannel, s.channelId, sales);
    add(fm.salesByProduct, s.productId, sales);
    add(fm.revenueByProduct, s.productId, sales - bankVat - cashVat);
    add(fm.qtyByProduct, s.productId, s.qty);
  }

  for (const e of ds.opexFargo) {
    const fm = months.get(e.monthId);
    if (!fm) continue;
    const group = e.plGroup ?? "UNMAPPED";
    if (group === FARGO_WRITEOFF_GROUP) {
      fm.writeOffsRecorded += e.amount;
      continue;
    }
    add(fm.opexByGroup, group, e.amount);
    fm.opex += e.amount;
  }
  for (const line of invoices) {
    const fm = months.get(line.monthId);
    if (fm) fm.vat.input += line.vat;
  }

  let credit = 0;
  return monthIds.map((m) => {
    const fm = months.get(m)!;
    fm.bankRevenue = fm.bankSales - fm.vat.outputBank;
    fm.cashRevenue = fm.cashSales - fm.vat.outputCash;
    fm.revenue = fm.bankRevenue + fm.cashRevenue;
    fm.declaredTotal = fm.bankRevenue + fm.cashDeclared;
    for (const p of Object.values(fifo)) fm.stockLoss += p.months[m]?.fargoLoss ?? 0;
    fm.grossProfit = fm.revenue - fm.cogs - fm.stockLoss;
    fm.ebitda = fm.grossProfit - fm.opex;
    fm.netProfit = fm.ebitda - fm.incomeTax;
    fm.vat.net = fm.vat.outputBank + fm.vat.outputCash - fm.vat.input;
    fm.vat.creditIn = credit;
    fm.vat.paid = Math.max(0, fm.vat.net - credit);
    fm.vat.creditOut = Math.max(0, credit - fm.vat.net);
    credit = fm.vat.creditOut;
    return fm;
  });
}

/** VAT on TI's tax account accumulated before joint operations: the previous owner's. */
export function priorOwnerVatOpening(ds: Dataset, firstMonthId: string): number {
  return ds.vatAccount
    .filter((e) => e.period < firstMonthId)
    .reduce((s, e) => s + e.reduced - e.charged + e.paid - e.refunded, 0);
}

export function computeTiMonths(
  ds: Dataset,
  monthIds: string[],
  invoices: InvoiceLineCost[],
  writeOffs: WriteOffCost[],
  priorOwnerOpening: number
): TiMonth[] {
  let priorOwnerCharges = 0;
  return monthIds.map((m) => {
    const lines = invoices.filter((l) => l.monthId === m);
    const revenue = lines.reduce((s, l) => s + l.amount, 0);
    const cogs = lines.reduce((s, l) => s + l.tiCost, 0);
    const giveaways = writeOffs.filter((w) => w.monthId === m).reduce((s, w) => s + w.value, 0);
    const grossProfit = revenue - cogs - giveaways;
    const opexByGroup: Record<string, number> = {};
    let opex = 0;
    for (const e of ds.opexTi) {
      if (e.monthId !== m) continue;
      const amount = e.bankAmount + e.cashAmount;
      add(opexByGroup, e.plGroup ?? "UNMAPPED", amount);
      opex += amount;
    }
    const ebitda = grossProfit - opex;
    const profitTax = ds.taxFilings.filter((f) => f.bookedMonthId === m).reduce((s, f) => s + f.taxAmount, 0);
    const charges = ds.vatCharges.filter((c) => c.monthId === m);
    const vatCost = charges.filter((c) => c.bearer === "TI").reduce((s, c) => s + c.amount, 0);
    priorOwnerCharges += charges.filter((c) => c.bearer === "PRIOR_OWNER").reduce((s, c) => s + c.amount, 0);

    const importVat = ds.importExpenses
      .filter((e) => e.monthId === m && isImportVat(e.categoryName))
      .reduce((s, e) => s + e.amount, 0);
    const outputInvoices = lines.reduce((s, l) => s + l.vat, 0);
    const outputOther = charges.reduce((s, c) => s + c.amount, 0);
    const netModel = outputInvoices + outputOther - importVat;
    const inPeriod = ds.vatAccount.filter((e) => e.period === m);
    const perAccount = inPeriod.reduce((s, e) => s + e.charged - e.reduced, 0);
    const accountBalance = ds.vatAccount
      .filter((e) => e.period <= m)
      .reduce((s, e) => s + e.reduced - e.charged + e.paid - e.refunded, 0);
    const priorOwnerPart = priorOwnerOpening - priorOwnerCharges;
    return {
      monthId: m,
      revenue,
      units: lines.reduce((s, l) => s + l.qty, 0),
      cogs,
      giveaways,
      grossProfit,
      opexByGroup,
      opex,
      ebitda,
      profitTax,
      vatCost,
      netProfit: ebitda - profitTax - vatCost,
      vat: {
        importVat,
        outputInvoices,
        outputOther,
        netModel,
        perAccount,
        difference: netModel - perAccount,
        accountBalance,
        priorOwnerPart,
        jvPosition: accountBalance - priorOwnerPart,
      },
    };
  });
}

export function computeGroupMonths(
  ds: Dataset,
  monthIds: string[],
  ti: TiMonth[],
  fargo: FargoMonth[],
  fifo: Record<string, ProductFifo>,
  costOf: (id: string) => string
): GroupMonth[] {
  const products = new Map(ds.products.map((p) => [p.id, p]));
  const channels = new Map(ds.channels.map((c) => [c.id, c]));
  const cogs = new Map<string, Record<string, number>>();
  for (const s of ds.sales) {
    if (!products.has(s.productId) || !channels.has(s.channelId)) continue;
    const unit = fifo[costOf(s.productId)]?.months[s.monthId]?.groupUnitCost ?? 0;
    const rec = cogs.get(s.monthId) ?? {};
    add(rec, s.productId, s.qty * unit);
    cogs.set(s.monthId, rec);
  }
  return monthIds.map((m, i) => {
    const t = ti[i];
    const f = fargo[i];
    const cogsByProduct = cogs.get(m) ?? {};
    const groupCogs = Object.values(cogsByProduct).reduce((s, v) => s + v, 0);
    let stockLoss = 0;
    let fargoLossTotal = 0;
    for (const p of Object.values(fifo)) {
      stockLoss += p.months[m]?.groupLoss ?? 0;
      fargoLossTotal += p.months[m]?.fargoLoss ?? 0;
    }
    const grossProfit = f.revenue - groupCogs - t.giveaways - stockLoss;
    const opex = t.opex + f.opex;
    const ebitda = grossProfit - opex;
    const taxes = f.incomeTax + t.profitTax + t.vatCost;
    const netProfit = ebitda - taxes;
    const marginInvoiced = -(t.revenue - t.cogs);
    const marginSold = f.cogs - groupCogs;
    const marginInLoss = fargoLossTotal - stockLoss;
    const total = t.netProfit + f.netProfit + marginInvoiced + marginSold + marginInLoss;
    return {
      monthId: m,
      bankRevenue: f.bankRevenue,
      cashRevenue: f.cashRevenue,
      revenue: f.revenue,
      units: f.units,
      cogs: groupCogs,
      cogsByProduct,
      giveaways: t.giveaways,
      stockLoss,
      grossProfit,
      opexTi: t.opex,
      opexFargo: f.opex,
      opex,
      ebitda,
      fargoIncomeTax: f.incomeTax,
      tiProfitTax: t.profitTax,
      tiVatCost: t.vatCost,
      taxes,
      netProfit,
      recon: {
        tiNet: t.netProfit,
        fargoNet: f.netProfit,
        marginInvoiced,
        marginSold,
        marginInLoss,
        total,
        check: total - netProfit,
      },
    };
  });
}

export { monthOf, FARGO_WRITEOFF_GROUP };
