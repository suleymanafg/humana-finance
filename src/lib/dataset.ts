// Reads every raw input from the database into the engine's Dataset shape.
// Shared by the app (src/lib/data.ts) and the scripts in prisma/.
import type { PrismaClient } from "@/generated/prisma/client";
import type { Dataset, TaxSettings } from "./engine/types";

export const DEFAULT_TAXES: TaxSettings = {
  vatRate: 0.12,
  deemedCashMargin: 0.03,
  fargoIncomeTaxRate: 0.019,
  tiIncomeTaxRate: 0.15,
  writeOffDeduct: false,
};

const iso = (d: Date) => d.toISOString();

export async function buildDataset(db: PrismaClient): Promise<Dataset> {
  const [
    products,
    channels,
    months,
    warehouses,
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
    clientMaps,
    settings,
  ] = await Promise.all([
    db.product.findMany({ orderBy: { sortOrder: "asc" } }),
    db.channel.findMany({ orderBy: { sortOrder: "asc" } }),
    db.month.findMany({ orderBy: { sortOrder: "asc" } }),
    db.warehouse.findMany({ orderBy: { sortOrder: "asc" } }),
    db.sale.findMany({ select: { monthId: true, productId: true, channelId: true, qty: true, amount: true } }),
    db.shipment.findMany({
      where: { deletedAt: null },
      include: { lines: { where: { deletedAt: null }, orderBy: { id: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
    db.importExpense.findMany({ where: { deletedAt: null }, include: { category: true } }),
    db.tiInvoiceLine.findMany({ where: { deletedAt: null }, orderBy: [{ date: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] }),
    db.tiWriteOff.findMany({ where: { deletedAt: null }, orderBy: { date: "asc" } }),
    db.opexTiEntry.findMany({ where: { deletedAt: null }, include: { category: true } }),
    db.opexFargoEntry.findMany({ where: { deletedAt: null }, include: { category: true } }),
    db.tiTaxFiling.findMany({ where: { deletedAt: null } }),
    db.tiVatAccountEntry.findMany({ where: { deletedAt: null }, orderBy: [{ period: "asc" }, { sortOrder: "asc" }] }),
    db.tiVatCharge.findMany({ where: { deletedAt: null } }),
    db.fargoVatReturn.findMany(),
    db.loanMovement.findMany({ where: { deletedAt: null }, orderBy: { monthId: "asc" } }),
    db.priorOwnerEntry.findMany({ where: { deletedAt: null }, orderBy: { date: "asc" } }),
    db.otherReceipt.findMany({ where: { deletedAt: null }, orderBy: { date: "asc" } }),
    db.capitalContribution.findMany({ where: { deletedAt: null }, orderBy: { date: "asc" } }),
    db.fargoTransfer.findMany({ where: { deletedAt: null }, orderBy: { date: "asc" } }),
    db.stockCount.findMany(),
    db.monthBalance.findMany(),
    db.arEntry.findMany({ where: { deletedAt: null } }),
    db.clientChannelMap.findMany({
      where: { deletedAt: null },
      select: { id: true, displayName: true, channelId: true, source: true },
    }),
    db.setting.findMany(),
  ]);

  const settingOf = <T,>(key: string, fallback: T): T => {
    const row = settings.find((s) => s.key === key);
    if (!row) return fallback;
    try {
      return { ...fallback, ...(JSON.parse(row.value) as T) };
    } catch {
      return fallback;
    }
  };

  return {
    products,
    channels,
    months,
    warehouses,
    sales,
    shipments: shipments.map((s) => ({
      id: s.id,
      code: s.code,
      monthId: s.monthId,
      status: s.status,
      lines: s.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        qty: l.qty,
        priceEur: l.priceEur,
        rate: l.rate,
        fixedUnitCost: l.fixedUnitCost,
      })),
    })),
    importExpenses: importExpenses.map((e) => ({
      id: e.id,
      shipmentId: e.shipmentId,
      monthId: e.monthId,
      categoryName: e.category.name,
      amount: e.amount,
      paidMonthId: e.paidMonthId,
    })),
    invoices: invoices.map((l) => ({
      id: l.id,
      date: iso(l.date),
      number: l.number,
      productId: l.productId,
      qty: l.qty,
      price: l.price,
      amount: l.amount,
      vat: l.vat,
      ownUnitCost: l.ownUnitCost,
      sortOrder: l.sortOrder,
      notes: l.notes,
    })),
    writeOffs: writeOffs.map((w) => ({ id: w.id, date: iso(w.date), productId: w.productId, qty: w.qty, reason: w.reason })),
    opexTi: opexTi.map((e) => ({
      id: e.id,
      monthId: e.monthId,
      categoryName: e.category.name,
      plGroup: e.category.plGroup,
      bankAmount: e.bankAmount,
      cashAmount: e.cashAmount,
      notes: e.notes,
    })),
    opexFargo: opexFargo.map((e) => ({
      id: e.id,
      monthId: e.monthId,
      categoryName: e.category.name,
      plGroup: e.category.plGroup,
      amount: e.amount,
      notes: e.notes,
    })),
    taxFilings: taxFilings.map((f) => ({
      id: f.id,
      quarterLabel: f.quarterLabel,
      taxAmount: f.taxAmount,
      bookedMonthId: f.bookedMonthId,
      paidMonthId: f.paidMonthId,
      declaredExpenses: f.declaredExpenses,
    })),
    vatAccount: vatAccount.map((e) => ({
      id: e.id,
      period: e.period,
      date: e.date ? iso(e.date) : null,
      description: e.description,
      charged: e.charged,
      reduced: e.reduced,
      paid: e.paid,
      refunded: e.refunded,
      balanceAfter: e.balanceAfter,
      sortOrder: e.sortOrder,
    })),
    vatCharges: vatCharges.map((c) => ({
      id: c.id,
      monthId: c.monthId,
      description: c.description,
      amount: c.amount,
      bearer: c.bearer,
    })),
    fargoVatReturns,
    loans,
    priorOwner: priorOwner.map((p) => ({
      id: p.id,
      date: iso(p.date),
      description: p.description,
      received: p.received,
      paid: p.paid,
      viaFargo: p.viaFargo,
      notes: p.notes,
    })),
    otherReceipts: otherReceipts.map((o) => ({ id: o.id, date: iso(o.date), payer: o.payer, amount: o.amount, notes: o.notes })),
    contributions: contributions.map((c) => ({
      id: c.id,
      date: iso(c.date),
      tiAmount: c.tiAmount,
      fargoAmount: c.fargoAmount,
      viaFargo: c.viaFargo,
      notes: c.notes,
    })),
    transfers: transfers.map((t) => ({
      id: t.id,
      date: iso(t.date),
      cashAmount: t.cashAmount,
      bankAmount: t.bankAmount,
      notes: t.notes,
    })),
    stockCounts,
    monthBalances: monthBalances.map((b) => ({
      monthId: b.monthId,
      tiBank: b.tiBank,
      tiCash: b.tiCash,
      goodsInTransit: b.goodsInTransit,
    })),
    arEntries,
    clientMaps,
    taxes: settingOf<TaxSettings>("taxes", DEFAULT_TAXES),
  };
}
