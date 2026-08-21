// Assembles everything the planning pages need from the DB. Promo-variant
// sales and stock are folded into their regular product, since Germany only
// knows the physical SKU. Supply pipeline = committed purchases (закуп), the
// de facto IBP orders; demand = manual forecast, advised by the cohort model.
import { prisma } from "@/lib/db";
import {
  addMonths,
  DEFAULT_SETTINGS,
  monthKeyOf,
  type PlanningSettings,
  type PlanningSkuIn,
  type SkuSituation,
} from "./compute";
import { DEFAULT_COHORT, type CohortParams } from "./cohort";
import { buildDemandModel, type DemandModelResult } from "./model";

export interface TransitShipment {
  id: string;
  code: string;
  etaDate: string | null; // ISO date, if entered
  etaMonth: string; // monthKey the engine books the arrival into
  units: Record<string, number>; // skuId -> units
  totalUnits: number;
}

export interface PlanningData {
  skus: PlanningSkuIn[];
  situations: Record<string, SkuSituation>; // by skuId
  settings: PlanningSettings;
  cohortParams: CohortParams;
  eurRate: number; // UZS per EUR, for money cards
  recruitment: Record<string, number>; // monthKey -> verified prescriptions
  purchases: Record<string, Record<string, number>>; // skuId -> shipMonth -> qty
  model: DemandModelResult;
  /** actual truck arrivals per product per month (for committed-vs-actual) */
  actualArrivals: Record<string, Record<string, number>>; // skuId -> monthKey -> units
  /** trucks currently on the road — planning-only until marked ARRIVED */
  transit: TransitShipment[];
}

/** Germany's names are long; the app shows a compact form. */
export function shortSkuName(name: string): string {
  return name
    .replace(/^Humana\s+/i, "")
    .replace(/\s+MP\b/i, "")
    .replace(/\s+гр?\s*х\s*\d+\s*шт\.?$/i, "")
    .trim();
}

export async function loadPlanning(): Promise<PlanningData> {
  const [skus, forecasts, purchases, recruitmentRows, settings, products, sales, stockCounts, shipments] =
    await Promise.all([
      prisma.planningSku.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.planningForecast.findMany(),
      prisma.planningPurchase.findMany(),
      prisma.planningRecruitment.findMany(),
      prisma.setting.findMany({ where: { key: { startsWith: "planning." } } }),
      prisma.product.findMany({ select: { id: true, regularProductId: true, isPromo: true } }),
      prisma.sale.groupBy({ by: ["monthId", "productId"], _sum: { qty: true } }),
      prisma.stockCount.findMany({ select: { monthId: true, productId: true, qty: true } }),
      prisma.shipment.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: { lines: { where: { deletedAt: null } } },
      }),
    ]);

  const settingOf = (key: string, fallback: number): number => {
    const row = settings.find((s) => s.key === key);
    if (!row) return fallback;
    const v = Number(JSON.parse(row.value));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  const cfg: PlanningSettings = {
    minCoverMonths: settingOf("planning.minCoverMonths", DEFAULT_SETTINGS.minCoverMonths),
    truckPallets: settingOf("planning.truckPallets", DEFAULT_SETTINGS.truckPallets),
    truckMaxKg: settingOf("planning.truckMaxKg", DEFAULT_SETTINGS.truckMaxKg),
    productionLeadMonths: settingOf("planning.productionLeadMonths", DEFAULT_SETTINGS.productionLeadMonths),
    orderDeadlineDay: settingOf("planning.orderDeadlineDay", DEFAULT_SETTINGS.orderDeadlineDay),
  };
  const cohortParams: CohortParams = {
    packsPerBaby: settingOf("planning.packsPerBaby", DEFAULT_COHORT.packsPerBaby),
    retention1: settingOf("planning.retention1", DEFAULT_COHORT.retention1),
    retention2: settingOf("planning.retention2", DEFAULT_COHORT.retention2),
    retention3: settingOf("planning.retention3", DEFAULT_COHORT.retention3),
    stage3FadePerMonth: settingOf("planning.stage3Fade", DEFAULT_COHORT.stage3FadePerMonth),
    recruitmentAhead: settingOf("planning.recruitmentAhead", DEFAULT_COHORT.recruitmentAhead),
  };
  const lastShipmentRate = shipments[0]?.lines[0]?.rate ?? 0;
  const eurRate = settingOf("planning.eurRate", lastShipmentRate);

  // promo product -> its regular product (physical SKU)
  const regularOf = new Map<string, string>();
  for (const p of products) regularOf.set(p.id, p.isPromo && p.regularProductId ? p.regularProductId : p.id);

  // regular productId -> planning sku
  const skuByProduct = new Map<string, string>();
  for (const s of skus) if (s.productId) skuByProduct.set(s.productId, s.id);

  const situations: Record<string, SkuSituation> = {};
  for (const s of skus) {
    situations[s.id] = { skuId: s.id, currentStock: 0, stockAsOf: null, forecast: {}, actualSales: {}, arrivals: {} };
  }

  for (const f of forecasts) {
    const sit = situations[f.skuId];
    if (sit) sit.forecast[f.monthKey] = f.qty;
  }

  for (const row of sales) {
    const regular = regularOf.get(row.productId) ?? row.productId;
    const skuId = skuByProduct.get(regular);
    if (!skuId) continue;
    const sit = situations[skuId];
    sit.actualSales[row.monthId] = (sit.actualSales[row.monthId] ?? 0) + (row._sum.qty ?? 0);
  }

  // current stock = the latest month that has any stock counts at all
  const latestStockMonth = stockCounts.reduce<string | null>(
    (max, r) => (r.qty !== 0 && (!max || r.monthId > max) ? r.monthId : max),
    null
  );
  if (latestStockMonth) {
    for (const r of stockCounts) {
      if (r.monthId !== latestStockMonth) continue;
      const regular = regularOf.get(r.productId) ?? r.productId;
      const skuId = skuByProduct.get(regular);
      if (!skuId) continue;
      situations[skuId].currentStock += r.qty;
      situations[skuId].stockAsOf = latestStockMonth;
    }
  }

  // committed purchases: supply pipeline; arrival ≈ ship + 1 month
  const purchasesBySku: Record<string, Record<string, number>> = {};
  const thisMonth = monthKeyOf(new Date());
  for (const p of purchases) {
    (purchasesBySku[p.skuId] ??= {})[p.shipMonth] = p.qty;
    const sit = situations[p.skuId];
    if (!sit || p.qty <= 0) continue;
    const arrival = ((k: string) => {
      const [y, m] = k.split("-").map(Number);
      return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    })(p.shipMonth);
    if (arrival >= thisMonth) sit.arrivals[arrival] = (sit.arrivals[arrival] ?? 0) + p.qty;
  }

  // actual truck arrivals per planning sku per month (committed-vs-actual);
  // TRANSIT trucks instead feed future arrivals at their ETA month
  const actualArrivals: Record<string, Record<string, number>> = {};
  const transit: TransitShipment[] = [];
  for (const sh of shipments) {
    if (sh.status === "TRANSIT") {
      const etaMonth = sh.etaDate ? monthKeyOf(sh.etaDate) : addMonths(thisMonth, 1);
      const t: TransitShipment = {
        id: sh.id,
        code: sh.code,
        etaDate: sh.etaDate ? sh.etaDate.toISOString().slice(0, 10) : null,
        etaMonth: etaMonth < thisMonth ? thisMonth : etaMonth, // overdue trucks count as "any day now"
        units: {},
        totalUnits: 0,
      };
      for (const l of sh.lines) {
        const regular = regularOf.get(l.productId) ?? l.productId;
        const skuId = skuByProduct.get(regular);
        if (!skuId) continue;
        t.units[skuId] = (t.units[skuId] ?? 0) + l.qty;
        t.totalUnits += l.qty;
        const sit = situations[skuId];
        if (sit) sit.arrivals[t.etaMonth] = (sit.arrivals[t.etaMonth] ?? 0) + l.qty;
      }
      transit.push(t);
      continue;
    }
    for (const l of sh.lines) {
      const regular = regularOf.get(l.productId) ?? l.productId;
      const skuId = skuByProduct.get(regular);
      if (!skuId) continue;
      (actualArrivals[skuId] ??= {})[sh.monthId] = ((actualArrivals[skuId] ?? {})[sh.monthId] ?? 0) + l.qty;
    }
  }

  const recruitment: Record<string, number> = Object.fromEntries(
    recruitmentRows.map((r) => [r.monthKey, r.babies])
  );

  const skuList: PlanningSkuIn[] = skus.map((s) => ({
    id: s.id,
    article: s.article,
    name: shortSkuName(s.name),
    productId: s.productId,
    pcsPerCarton: s.pcsPerCarton,
    pcsPerLayer: s.pcsPerLayer,
    pcsPerPallet: s.pcsPerPallet,
    grossKgPerUnit: s.grossKgPerUnit,
    priceEur: s.priceEur,
    active: s.active,
  }));

  const model = buildDemandModel(
    skuList,
    Object.fromEntries(skuList.map((s) => [s.id, situations[s.id].actualSales])),
    recruitment,
    thisMonth,
    18,
    cohortParams
  );
  for (const s of skuList) situations[s.id].model = model.series[s.id];

  return {
    skus: skuList,
    situations,
    settings: cfg,
    cohortParams,
    eurRate,
    recruitment,
    purchases: purchasesBySku,
    model,
    actualArrivals,
    transit,
  };
}
