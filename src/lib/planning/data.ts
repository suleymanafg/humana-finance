// Assembles everything the planning pages need from the DB. Promo-variant
// sales and stock are folded into their regular product, since Germany only
// knows the physical SKU. Stock on hand is the books' figure (the Stock page):
// TI's own units plus Fargo's. Supply pipeline = trucks on the road, Open
// Orders (ordered, not yet collected) and committed purchases (закуп) for
// later ship months; demand = manual forecast, advised by the cohort model.
import { prisma } from "@/lib/db";
import { getComputed } from "@/lib/data";
import {
  addMonths,
  DEFAULT_SETTINGS,
  monthKeyOf,
  openOrdersAt,
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
  /** units picked up at DMK per SKU per DISPATCH month — real dispatchDate
   *  when entered, else assumed arrival − 1 (ETA − 1 for transit) */
  pickups: Record<string, Record<string, number>>;
  /** trucks currently on the road — planning-only until marked ARRIVED */
  transit: TransitShipment[];
  /** date of the last IBP export sync (Setting planning.ibpSyncedAt) */
  ibpSyncedAt: string | null;
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
  const [skus, forecasts, purchases, recruitmentRows, settings, products, sales, shipments, { computed }] =
    await Promise.all([
      prisma.planningSku.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.planningForecast.findMany(),
      prisma.planningPurchase.findMany(),
      prisma.planningRecruitment.findMany(),
      prisma.setting.findMany({ where: { key: { startsWith: "planning." } } }),
      prisma.product.findMany({ select: { id: true, regularProductId: true, isPromo: true } }),
      prisma.sale.groupBy({ by: ["monthId", "productId"], _sum: { qty: true } }),
      prisma.shipment.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: { lines: { where: { deletedAt: null } } },
      }),
      getComputed(),
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

  // current stock = the Stock page's figure, as far as the books reach this
  // month: TI's own units (arrived, not invoiced or written off) plus Fargo's
  // (its latest count, rolled forward by invoices, sales and write-offs since).
  // Sales already recorded this month are out of it, so the projection counts
  // only the rest of the month's demand.
  const thisMonth = monthKeyOf(new Date());
  const stockMonth = computed.monthIds.filter((m) => m <= thisMonth).at(-1) ?? null;
  if (stockMonth) {
    for (const [productId, fifo] of Object.entries(computed.fifo)) {
      const pos = fifo.months[stockMonth];
      const skuId = skuByProduct.get(regularOf.get(productId) ?? productId);
      if (!pos || !skuId) continue;
      situations[skuId].currentStock += pos.tiStockUnits + pos.fargoStockUnits;
    }
    for (const sit of Object.values(situations)) {
      sit.currentStock = Math.max(0, sit.currentStock);
      sit.stockAsOf = stockMonth;
      const sold = sit.actualSales[stockMonth] ?? 0;
      if (stockMonth === thisMonth && sold > 0) sit.soldToDate = { monthKey: stockMonth, qty: sold };
    }
  }

  // committed purchases: supply pipeline; arrival ≈ ship + 1 month.
  // Only STRICTLY future ship months project arrivals — commitments at the
  // current month or earlier are either delivered (stock/transit) or still
  // open, and the open part is the Open Orders booked below.
  const purchasesBySku: Record<string, Record<string, number>> = {};
  for (const p of purchases) {
    (purchasesBySku[p.skuId] ??= {})[p.shipMonth] = p.qty;
    const sit = situations[p.skuId];
    if (!sit || p.qty <= 0 || p.shipMonth <= thisMonth) continue;
    const arrival = ((k: string) => {
      const [y, m] = k.split("-").map(Number);
      return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    })(p.shipMonth);
    sit.arrivals[arrival] = (sit.arrivals[arrival] ?? 0) + p.qty;
  }

  // actual truck arrivals per planning sku per month (committed-vs-actual);
  // TRANSIT trucks instead feed future arrivals at their ETA month
  const actualArrivals: Record<string, Record<string, number>> = {};
  const pickups: Record<string, Record<string, number>> = {};
  const transit: TransitShipment[] = [];
  const ibpSyncedAt = settings.find((s) => s.key === "planning.ibpSyncedAt")?.value ?? null;
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
      const dispatchMonth = sh.dispatchDate ? monthKeyOf(sh.dispatchDate) : addMonths(t.etaMonth, -1);
      for (const l of sh.lines) {
        const regular = regularOf.get(l.productId) ?? l.productId;
        const skuId = skuByProduct.get(regular);
        if (!skuId) continue;
        t.units[skuId] = (t.units[skuId] ?? 0) + l.qty;
        t.totalUnits += l.qty;
        (pickups[skuId] ??= {})[dispatchMonth] = ((pickups[skuId] ?? {})[dispatchMonth] ?? 0) + l.qty;
        const sit = situations[skuId];
        if (sit) sit.arrivals[t.etaMonth] = (sit.arrivals[t.etaMonth] ?? 0) + l.qty;
      }
      transit.push(t);
      continue;
    }
    const dispatchMonth = sh.dispatchDate ? monthKeyOf(sh.dispatchDate) : addMonths(sh.monthId, -1);
    for (const l of sh.lines) {
      const regular = regularOf.get(l.productId) ?? l.productId;
      const skuId = skuByProduct.get(regular);
      if (!skuId) continue;
      (actualArrivals[skuId] ??= {})[sh.monthId] = ((actualArrivals[skuId] ?? {})[sh.monthId] ?? 0) + l.qty;
      (pickups[skuId] ??= {})[dispatchMonth] = ((pickups[skuId] ?? {})[dispatchMonth] ?? 0) + l.qty;
    }
  }

  // live backlog = Open Orders as the Plan page shows them: everything ordered
  // for ship months up to this one, less everything collected (clamped at 0).
  // It updates with every purchase entered and every truck created. Booked as
  // supply arriving next month so recommendations never re-order what is
  // already committed — and since a pickup truck reduces it the moment it
  // exists, its transit units are never counted twice.
  const backlogMonth = addMonths(thisMonth, 1);
  const backlogLive: Record<string, number> = {};
  for (const s of skus) {
    const live = Math.max(0, openOrdersAt(purchasesBySku[s.id], pickups[s.id], thisMonth));
    backlogLive[s.id] = live;
    if (live > 0) {
      const sit = situations[s.id];
      sit.arrivals[backlogMonth] = (sit.arrivals[backlogMonth] ?? 0) + live;
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
    openOrderQty: backlogLive[s.id] ?? 0,
  }));

  const model = buildDemandModel(
    skuList,
    Object.fromEntries(skuList.map((s) => [s.id, situations[s.id].actualSales])),
    recruitment,
    thisMonth,
    18,
    cohortParams,
    13 // retrodict a year back so the План history months show the model too
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
    pickups,
    transit,
    ibpSyncedAt,
  };
}
