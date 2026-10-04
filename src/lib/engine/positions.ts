// Month-end positions: what Fargo owes TI, and the balance sheets of TI, Fargo
// and the group.
//
// What Fargo owes is calculated twice and must agree:
//   by cash      — everything Fargo collected, less its costs, the VAT it paid,
//                  its turnover tax, the payments it made to TI and what
//                  customers still owe it;
//   by the act   — the reconciliation act (TI invoices incl. VAT − every bank
//                  payment from Fargo's account), plus the bank payments that
//                  were not for goods, plus Fargo's Humana profit less the goods
//                  and receivables it still holds.
import { isImportVat, monthOf } from "./costing";
import type {
  BalanceMonth,
  Dataset,
  FargoMonth,
  GroupMonth,
  InvoiceLineCost,
  ProductFifo,
  SettlementMonth,
  ShipmentCost,
  TiMonth,
  WriteOffCost,
} from "./types";

const sumWhere = <T>(rows: T[], pick: (r: T) => number, keep: (r: T) => boolean) =>
  rows.reduce((s, r) => (keep(r) ? s + pick(r) : s), 0);

export function computeSettlement(
  ds: Dataset,
  monthIds: string[],
  fargo: FargoMonth[],
  invoices: InvoiceLineCost[],
  fifo: Record<string, ProductFifo>
): SettlementMonth[] {
  const rows: SettlementMonth[] = [];
  let dueCum = 0;
  let cashCum = 0;
  let bankCum = 0;
  let invoicesInclVatCum = 0;
  let fargoNetCum = 0;
  let writeOffsDeductedCum = 0;
  let prevReceivables = 0;
  monthIds.forEach((m, i) => {
    const f = fargo[i];
    const writeOffsDeducted = ds.taxes.writeOffDeduct ? f.writeOffsRecorded : 0;
    const accrued = f.salesAtPrice - f.opex - writeOffsDeducted - f.vat.paid - f.incomeTax;
    const transfersCash = sumWhere(ds.transfers, (t) => t.cashAmount, (t) => monthOf(t.date) === m);
    const transfersBank = sumWhere(ds.transfers, (t) => t.bankAmount, (t) => monthOf(t.date) === m);
    dueCum += accrued;
    cashCum += transfersCash;
    bankCum += transfersBank;
    const receivables = sumWhere(ds.arEntries, (a) => a.amount, (a) => a.monthId === m);
    const owes = dueCum - cashCum - bankCum - receivables;

    invoicesInclVatCum += sumWhere(invoices, (l) => l.amount + l.vat, (l) => l.monthId === m);
    const viaFargo = ds.contributions.filter((c) => c.viaFargo && monthOf(c.date) <= m);
    const fargoCapitalViaFargo = viaFargo.reduce((s, c) => s + c.fargoAmount, 0);
    const tiCapitalViaFargo = viaFargo.reduce((s, c) => s + c.tiAmount, 0);
    const priorOwnerViaFargo = sumWhere(ds.priorOwner, (p) => p.received, (p) => p.viaFargo && monthOf(p.date) <= m);
    const allBankCum = bankCum + fargoCapitalViaFargo + tiCapitalViaFargo + priorOwnerViaFargo;
    const actBalance = invoicesInclVatCum - allBankCum;
    const notGoods = fargoCapitalViaFargo + tiCapitalViaFargo + priorOwnerViaFargo;

    fargoNetCum += f.netProfit;
    writeOffsDeductedCum += writeOffsDeducted;
    const fargoStock = Object.values(fifo).reduce((s, p) => s + (p.months[m]?.fargoStock ?? 0), 0);
    const vatCredit = f.vat.creditOut;
    const partnership = fargoNetCum - fargoStock - receivables - writeOffsDeductedCum - vatCredit - cashCum;
    const owesByAct = actBalance + notGoods + partnership;
    const byBank = Math.min(Math.max(owes, 0), Math.max(actBalance, 0));

    rows.push({
      monthId: m,
      salesAtPrice: f.salesAtPrice,
      fargoOpex: f.opex,
      writeOffsDeducted,
      vatPaid: f.vat.paid,
      incomeTax: f.incomeTax,
      accrued,
      transfersCash,
      transfersBank,
      dueCum,
      cashCum,
      bankCum,
      receivables,
      owes,
      invoicesInclVatCum,
      allBankCum,
      actBalance,
      fargoCapitalViaFargo,
      tiCapitalViaFargo,
      priorOwnerViaFargo,
      notGoods,
      fargoNetCum,
      fargoStock,
      writeOffsDeductedCum,
      vatCredit,
      partnership,
      owesByAct,
      check: owes - owesByAct,
      byBank,
      inCash: owes - byBank,
      change: accrued - transfersCash - transfersBank - (receivables - prevReceivables),
    });
    prevReceivables = receivables;
  });
  return rows;
}

export function computeBalances(
  ds: Dataset,
  monthIds: string[],
  arrived: ShipmentCost[],
  invoices: InvoiceLineCost[],
  writeOffs: WriteOffCost[],
  ti: TiMonth[],
  fargo: FargoMonth[],
  group: GroupMonth[],
  settlement: SettlementMonth[],
  fifo: Record<string, ProductFifo>
): BalanceMonth[] {
  const products = Object.values(fifo);
  let tiNetCum = 0;
  let fargoNetCum = 0;
  let groupNetCum = 0;
  let tiOpexCum = 0;
  let profitTaxBookedCum = 0;
  let fargoSalesCum = 0;
  let fargoOpexCum = 0;
  let fargoVatPaidCum = 0;
  let fargoIncomeTaxCum = 0;
  let groupLossCum = 0;
  let prevTiStock = 0;
  let prevFargoStock = 0;

  const landedUpTo = (m: string) => sumWhere(arrived, (s) => s.landedTotal, (s) => s.monthId <= m);
  const tiCostUpTo = (m: string) => sumWhere(invoices, (l) => l.tiCost, (l) => l.monthId <= m);
  const writtenUpTo = (m: string) => sumWhere(writeOffs, (w) => w.value, (w) => w.monthId <= m);

  return monthIds.map((m, i) => {
    const t = ti[i];
    const f = fargo[i];
    const g = group[i];
    const st = settlement[i];
    const mb = ds.monthBalances.find((b) => b.monthId === m);
    tiNetCum += t.netProfit;
    fargoNetCum += f.netProfit;
    groupNetCum += g.netProfit;
    tiOpexCum += t.opex;
    profitTaxBookedCum += t.profitTax;
    fargoSalesCum += f.salesAtPrice;
    fargoOpexCum += f.opex;
    fargoVatPaidCum += f.vat.paid;
    fargoIncomeTaxCum += f.incomeTax;
    groupLossCum += g.stockLoss;

    // ── Turbo Impex ──
    const bank = mb?.tiBank ?? 0;
    const cash = mb?.tiCash ?? 0;
    const goodsInTransit = mb?.goodsInTransit ?? 0;
    const transfersCum = st.cashCum + st.bankCum;
    const receivableFromFargo = st.invoicesInclVatCum - transfersCum;
    const landed = landedUpTo(m);
    const tiStock = landed - tiCostUpTo(m) - writtenUpTo(m);
    const vatOverpaid = Math.max(0, t.vat.accountBalance);
    const vatDebt = Math.max(0, -t.vat.accountBalance);
    const priorOwnerVat = t.vat.priorOwnerPart;
    const priorOwnerCash = sumWhere(ds.priorOwner, (p) => p.received - p.paid, (p) => monthOf(p.date) <= m);
    const loans = sumWhere(ds.loans, (l) => l.received - l.repaid, (l) => l.monthId <= m);
    const otherReceipts = sumWhere(ds.otherReceipts, (o) => o.amount, (o) => monthOf(o.date) <= m);
    const importUnpaid = sumWhere(
      ds.importExpenses,
      (e) => e.amount,
      (e) => !isImportVat(e.categoryName) && e.monthId <= m && !!e.paidMonthId && e.paidMonthId > m
    );
    const profitTaxPayable =
      profitTaxBookedCum - sumWhere(ds.taxFilings, (f2) => f2.taxAmount, (f2) => !!f2.paidMonthId && f2.paidMonthId <= m);
    const tiCapital = sumWhere(ds.contributions, (c) => c.tiAmount, (c) => monthOf(c.date) <= m);
    const fargoCapital = sumWhere(ds.contributions, (c) => c.fargoAmount, (c) => monthOf(c.date) <= m);
    const tiAssets = bank + cash + receivableFromFargo + tiStock + goodsInTransit + vatOverpaid;
    const tiLiabilities =
      vatDebt + priorOwnerVat + priorOwnerCash + loans + otherReceipts + importUnpaid + profitTaxPayable;
    const tiEquity = tiCapital + fargoCapital + tiNetCum;
    const tiVatChargesCum = sumWhere(ds.vatCharges, (c) => c.amount, (c) => c.bearer === "TI" && c.monthId <= m);
    const unreconciledCash =
      bank +
      cash +
      goodsInTransit -
      (tiCapital +
        fargoCapital +
        transfersCum +
        loans +
        importUnpaid +
        priorOwnerCash +
        otherReceipts -
        landed -
        tiOpexCum -
        (profitTaxBookedCum - profitTaxPayable));
    const invoiceVatCum = sumWhere(invoices, (l) => l.vat, (l) => l.monthId <= m);
    const unreconciledVat = invoiceVatCum + tiVatChargesCum + vatOverpaid - vatDebt - priorOwnerVat;

    // ── Fargo ──
    const fargoStock = products.reduce((s, p) => s + (p.months[m]?.fargoStock ?? 0), 0);
    const fargoStockTi = products.reduce((s, p) => s + (p.months[m]?.fargoStockTi ?? 0), 0);
    const receivables = st.receivables;
    const cashHeld = fargoSalesCum - receivables - fargoOpexCum - fargoVatPaidCum - fargoIncomeTaxCum - transfersCum;
    const fargoAssets = fargoStock + f.vat.creditOut + receivables + cashHeld;

    // ── group ──
    const groupStock = tiStock + fargoStockTi;
    const groupAssets =
      groupStock + goodsInTransit + vatOverpaid + f.vat.creditOut + receivables + bank + cash + cashHeld;
    const groupEquity = tiCapital + fargoCapital + groupNetCum;

    const result: BalanceMonth = {
      monthId: m,
      hasInputs: !!mb,
      ti: {
        bank,
        cash,
        receivableFromFargo,
        stock: tiStock,
        goodsInTransit,
        vatOverpaid,
        assets: tiAssets,
        vatDebt,
        priorOwnerVat,
        priorOwnerCash,
        loans,
        otherReceipts,
        importUnpaid,
        profitTaxPayable,
        liabilities: tiLiabilities,
        tiCapital,
        fargoCapital,
        retained: tiNetCum,
        equity: tiEquity,
        unreconciled: tiAssets - tiLiabilities - tiEquity,
        unreconciledCash,
        unreconciledVat,
        stockOpening: prevTiStock,
        stockArrived: sumWhere(arrived, (s) => s.landedTotal, (s) => s.monthId === m),
        stockInvoiced: t.cogs,
        stockWrittenOff: t.giveaways,
      },
      fargo: {
        stock: fargoStock,
        vatCredit: f.vat.creditOut,
        receivables,
        cashHeld,
        assets: fargoAssets,
        payableToTi: receivableFromFargo,
        liabilities: receivableFromFargo,
        retained: fargoNetCum,
        equity: fargoNetCum,
        check: fargoAssets - receivableFromFargo - fargoNetCum,
        stockOpening: prevFargoStock,
        stockBought: t.revenue,
        stockSold: f.cogs,
        stockLost: f.stockLoss,
        settlement: st.owes,
        capital: fargoCapital,
      },
      group: {
        stock: groupStock,
        stockAtTi: tiStock,
        stockAtFargo: fargoStockTi,
        goodsInTransit,
        vat: vatOverpaid + f.vat.creditOut,
        receivables,
        tiCash: bank + cash,
        cashHeldByFargo: cashHeld,
        assets: groupAssets,
        liabilities: tiLiabilities,
        tiCapital,
        fargoCapital,
        retained: groupNetCum,
        equity: groupEquity,
        unreconciled: groupAssets - tiLiabilities - groupEquity,
        tiMarginInStock: fargoStock - fargoStockTi,
        countedUnits: sumWhere(ds.stockCounts, (c) => c.qty, (c) => c.monthId === m),
        cumStockLoss: groupLossCum,
      },
    };
    prevTiStock = tiStock;
    prevFargoStock = fargoStock;
    return result;
  });
}
