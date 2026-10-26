// Assembles everything the planning pages need from the DB. Promo-variant
// sales and stock are folded into their regular product, since Germany only
// knows the physical SKU. Stock on hand is the books' figure (the Stock page):
// TI's own units plus Fargo's. Supply = trucks on the road, what is still to
// collect at DMK (ordered by ship month less collected by dispatch month, the
// Plan rule) and the IBP orders by ship month (PlanningPurchase, loaded from
// DMK's export). Demand = actual sales, or the cohort model.
import { prisma } from "@/lib/db";
import { getComputed } from "@/lib/data";
import {
  addMonths,
  DEFAULT_SETTINGS,
  monthKeyOf,
  nextOrderSlot,
  openOrdersAt,
  truckShipMonth,
  type OrderSlot,
  type PlanningSettings,
  type PlanningSkuIn,
  type SkuSituation,
} from "./compute";
import { DEFAULT_COHORT, type CohortParams } from "./cohort";
import { buildDemandModel, type DemandModelResult } from "./model";
import type { SupplyInput } from "./supply";

export interface TransitShipment {
  id: string;
  code: string;
  etaDate: string | null; // ISO date, if entered
  etaMonth: string; // monthKey the engine books the arrival into
  units: Record<string, number>; // skuId -> units
  totalUnits: number;
}

export interface PlanningData {
  /** today in Tashkent, ISO date */
  today: string;
  slot: OrderSlot;
  skus: PlanningSkuIn[];
  situations: Record<string, SkuSituation>; // by skuId
  settings: PlanningSettings;
  cohortParams: CohortParams;
  eurRate: number; // UZS per EUR, for money cards
  recruitment: Record<string, number>; // monthKey -> verified prescriptions
  purchases: Record<string, Record<string, number>>; // skuId -> shipMonth -> IBP order
  model: DemandModelResult;
  /** units picked up at DMK per SKU per SHIP month — the truck's shipMonth when
   *  set, else its real dispatchDate, else assumed arrival − 1 (ETA − 1 for transit) */
  pickups: Record<string, Record<string, number>>;
  /** trucks currently on the road — planning-only until marked ARRIVED */
  transit: TransitShipment[];
  /** days from pickup at DMK to arrival, from the trucks that have both dates */
  leadDays: number;
  /** date of the last IBP export load (Setting planning.ibpSyncedAt) */
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

/** The business runs on Tashkent time; the server runs on UTC. */
export function nowInTashkent(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tashkent" }));
}

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Today in Tashkent as an ISO date. */
export const todayInTashkent = (): string => isoDate(nowInTashkent());

// a truck takes about a month from DMK to the warehouse when no history says otherwise
const DEFAULT_LEAD_DAYS = 30;
// loading at DMK after the order is paid, and customs on arrival
const LOAD_DAYS = 5;
const CUSTOMS_DAYS = 7;

export async function loadPlanning(): Promise<PlanningData> {
  const [skus, purchases, recruitmentRows, settings, products, sales, shipments, { computed }] = await Promise.all([
    prisma.planningSku.findMany({ orderBy: { sortOrder: "asc" } }),
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

  const now = nowInTashkent();
  const today = isoDate(now);
  const thisMonth = monthKeyOf(now);
  const slot = nextOrderSlot(now, cfg);

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

  const purchasesBySku: Record<string, Record<string, number>> = {};
  for (const p of purchases) (purchasesBySku[p.skuId] ??= {})[p.shipMonth] = p.qty;

  // trucks: TRANSIT ones are supply on the way; every truck is a pickup at its
  // ship month (its dispatch month unless its order leaves later), which is
  // what Open Orders subtract
  const pickups: Record<string, Record<string, number>> = {};
  const transit: TransitShipment[] = [];
  const leads: number[] = [];
  for (const sh of shipments) {
    // road time from the trucks that have really arrived (planned and ordered trucks only have estimates)
    if (sh.status === "ARRIVED" && sh.dispatchDate && sh.etaDate) {
      leads.push((sh.etaDate.getTime() - sh.dispatchDate.getTime()) / 86_400_000);
    }
    const etaMonth = sh.etaDate ? monthKeyOf(sh.etaDate) : addMonths(thisMonth, 1);
    const dispatchMonth = sh.dispatchDate
      ? monthKeyOf(sh.dispatchDate)
      : addMonths(sh.status === "TRANSIT" ? etaMonth : sh.monthId, -1);
    const pickupMonth = truckShipMonth({ shipMonth: sh.shipMonth, dispatchMonth, monthId: sh.monthId });
    const t: TransitShipment | null =
      sh.status === "TRANSIT"
        ? {
            id: sh.id,
            code: sh.code,
            etaDate: sh.etaDate ? sh.etaDate.toISOString().slice(0, 10) : null,
            etaMonth: etaMonth < thisMonth ? thisMonth : etaMonth, // overdue trucks count as "any day now"
            units: {},
            totalUnits: 0,
          }
        : null;
    for (const l of sh.lines) {
      const skuId = skuByProduct.get(regularOf.get(l.productId) ?? l.productId);
      if (!skuId) continue;
      (pickups[skuId] ??= {})[pickupMonth] = (pickups[skuId][pickupMonth] ?? 0) + l.qty;
      if (t) {
        t.units[skuId] = (t.units[skuId] ?? 0) + l.qty;
        t.totalUnits += l.qty;
      }
    }
    if (t) transit.push(t);
  }
  const travelDays = leads.length > 0 ? leads.reduce((a, b) => a + b, 0) / leads.length : DEFAULT_LEAD_DAYS;
  const ibpSyncedAt = settings.find((s) => s.key === "planning.ibpSyncedAt")?.value ?? null;

  // still to collect at DMK: ordered for ship months up to this one, less
  // everything collected (clamped at 0) — the Plan page's Open Orders
  const atDmk: Record<string, number> = {};
  for (const s of skus) atDmk[s.id] = Math.max(0, openOrdersAt(purchasesBySku[s.id], pickups[s.id], thisMonth));

  const recruitment: Record<string, number> = Object.fromEntries(recruitmentRows.map((r) => [r.monthKey, r.babies]));

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
    openOrderQty: atDmk[s.id] ?? 0,
  }));

  const model = buildDemandModel(
    skuList,
    Object.fromEntries(skuList.map((s) => [s.id, situations[s.id].actualSales])),
    recruitment,
    thisMonth,
    18,
    cohortParams,
    13
  );
  for (const s of skuList) situations[s.id].model = model.series[s.id];

  return {
    today,
    slot,
    skus: skuList,
    situations,
    settings: cfg,
    cohortParams,
    eurRate,
    recruitment,
    purchases: purchasesBySku,
    model,
    pickups,
    transit,
    leadDays: Math.round(LOAD_DAYS + travelDays + CUSTOMS_DAYS),
    ibpSyncedAt,
  };
}

/** The planning picture as the supply plan reads it: active SKUs linked to a product. */
export function supplyInputOf(data: PlanningData): SupplyInput {
  const skus = data.skus.filter((s) => s.active && s.productId);
  return {
    today: data.today,
    skus: skus.map((s) => ({
      id: s.id,
      name: s.name,
      article: s.article,
      pcsPerCarton: s.pcsPerCarton,
      pcsPerPallet: s.pcsPerPallet,
      grossKgPerUnit: s.grossKgPerUnit,
      priceEur: s.priceEur,
    })),
    onHand: Object.fromEntries(skus.map((s) => [s.id, data.situations[s.id].currentStock])),
    soldThisMonth: Object.fromEntries(skus.map((s) => [s.id, data.situations[s.id].soldToDate?.qty ?? 0])),
    sales: Object.fromEntries(skus.map((s) => [s.id, data.situations[s.id].actualSales])),
    model: Object.fromEntries(skus.map((s) => [s.id, data.model.series[s.id] ?? {}])),
    transit: data.transit.map((t) => ({ code: t.code, etaDate: t.etaDate, etaMonth: t.etaMonth, units: t.units })),
    atDmk: Object.fromEntries(skus.map((s) => [s.id, s.openOrderQty])),
    orders: data.purchases,
    settings: data.settings,
    slot: data.slot,
    leadDays: data.leadDays,
  };
}

/** Active SKUs that cannot be planned: no P&L product, so no stock or sales. */
export const unlinkedSkus = (data: PlanningData): string[] =>
  data.skus.filter((s) => s.active && !s.productId).map((s) => s.name);
