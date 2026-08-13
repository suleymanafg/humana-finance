// Loads the full raw dataset from the DB and runs the calculation engine.
// Every page derives its figures from this single server-side computation.
import { cache } from "react";
import { prisma } from "./db";
import { compute } from "./engine/compute";
import type { Dataset, GoldenValues, TaxSettings } from "./engine/types";

const DEFAULT_TAXES: TaxSettings = {
  vatRate: 0.12,
  deemedCashMargin: 0.03,
  fargoIncomeTaxRate: 0.019,
  tiIncomeTaxRate: 0.15,
};

export const loadDataset = cache(async (): Promise<Dataset> => {
  const [
    products,
    channels,
    months,
    warehouses,
    sales,
    shipments,
    importExpenses,
    opexTi,
    opexFargo,
    taxFilings,
    contributions,
    transfers,
    stockCounts,
    monthBalances,
    arEntries,
    clientMaps,
    settings,
  ] = await Promise.all([
    prisma.product.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.channel.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.month.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.warehouse.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.sale.findMany({
      select: { monthId: true, productId: true, channelId: true, qty: true, amount: true },
    }),
    prisma.shipment.findMany({
      where: { deletedAt: null },
      include: { lines: { where: { deletedAt: null } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.importExpense.findMany({ where: { deletedAt: null }, include: { category: true } }),
    prisma.opexTiEntry.findMany({ where: { deletedAt: null }, include: { category: true } }),
    prisma.opexFargoEntry.findMany({ where: { deletedAt: null }, include: { category: true } }),
    prisma.tiTaxFiling.findMany({ where: { deletedAt: null } }),
    prisma.capitalContribution.findMany({ where: { deletedAt: null }, orderBy: { date: "asc" } }),
    prisma.fargoTransfer.findMany({ where: { deletedAt: null }, orderBy: { date: "asc" } }),
    prisma.stockCount.findMany(),
    prisma.monthBalance.findMany(),
    prisma.arEntry.findMany({ where: { deletedAt: null } }),
    prisma.clientChannelMap.findMany({
      where: { deletedAt: null },
      select: { id: true, displayName: true, channelId: true, source: true },
    }),
    prisma.setting.findMany(),
  ]);

  const settingOf = <T,>(key: string, fallback: T): T => {
    const row = settings.find((s) => s.key === key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
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
      lines: s.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        qty: l.qty,
        priceEur: l.priceEur,
        rate: l.rate,
        fargoUnitCost: l.fargoUnitCost,
      })),
    })),
    importExpenses: importExpenses.map((e) => ({
      id: e.id,
      shipmentId: e.shipmentId,
      monthId: e.monthId,
      categoryName: e.category.name,
      amount: e.amount,
    })),
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
    taxFilings,
    contributions: contributions.map((c) => ({
      id: c.id,
      date: c.date.toISOString(),
      tiAmount: c.tiAmount,
      fargoAmount: c.fargoAmount,
    })),
    transfers: transfers.map((t) => ({
      id: t.id,
      date: t.date.toISOString(),
      cashAmount: t.cashAmount,
      bankAmount: t.bankAmount,
    })),
    stockCounts,
    monthBalances,
    arEntries,
    clientMaps,
    taxes: settingOf<TaxSettings>("taxes", DEFAULT_TAXES),
    golden: settingOf<GoldenValues | null>("golden", null),
  };
});

export const getComputed = cache(async () => {
  const dataset = await loadDataset();
  return { dataset, computed: compute(dataset) };
});
