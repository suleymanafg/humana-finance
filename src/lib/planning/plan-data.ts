// Supply plan as the owner runs it (from v17): the stage engine forecasts
// each SKU from verified prescriptions and actual sales; the order planner
// turns the forecast, the stock and what is ordered into each month's load in
// whole pallets and full trucks, and the IBP numbers to enter.
//
// Everything comes from the books: sales (1C), month-end stock (the Stock
// page: TI + Fargo), prescriptions (foil tracking), the IBP (DMK's export),
// trucks with their status, plus the owner's say (PlanningInput) and the
// engine settings (Setting "planning.engine").
import { cache } from "react";
import { prisma } from "@/lib/db";
import { getComputed } from "@/lib/data";
import { loadPlanning, type PlanningData } from "./data";
import { addMonths, monthKeyOf, truckShipMonth } from "./compute";
import { runStageEngine, type EngineProduct, type Stage, type StageEngineResult } from "./stage-engine";
import { planOrders, type KnownLoad, type OrderPlan } from "./order-planner";

export interface PlanSettings {
  /** tins a month one recruited baby adds on each stage */
  tinsPerBaby: Record<Stage, number>;
  /** prescriptions a month ahead; null = average of the last three entered */
  rxAhead: number | null;
  /** days from dispatch at DMK to sellable in the warehouse */
  leadDays: number;
  /** the day of the ship month a load is assumed to leave DMK */
  dispatchDay: number;
  /** HQ's truck: places, and the share of them a truck is loaded to (minimum, maximum) */
  truckPlaces: number;
  minFill: number;
  maxFill: number;
  /** months ahead in which more can be asked from HQ on top of the IBP */
  pickupMonths: number;
  /** months of stock below which a product is in danger */
  dangerLine: number;
  /** months of stock to hold where no target is set for a ship month */
  defaultTarget: number;
}

export const DEFAULT_PLAN_SETTINGS: PlanSettings = {
  tinsPerBaby: { P1: 0.435, P2: 0.2, P3: 0.1 },
  rxAhead: null,
  leadDays: 45,
  dispatchDay: 15,
  truckPlaces: 33,
  minFill: 0.98,
  maxFill: 0.985,
  pickupMonths: 2,
  dangerLine: 1,
  defaultTarget: 2,
};

export const PLAN_SETTINGS_KEY = "planning.engine";

/** HQ's order form: layers that fit one truck place, by load category */
const LAYERS_PER_PLACE: Record<number, number> = { 1: 10, 2: 9, 3: 14, 4: 15 };

export const PIPELINE_STATUSES = ["PLANNED", "ORDERED", "TRANSIT", "CUSTOMS"] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export interface PlanSku {
  id: string;
  article: string;
  name: string;
  productId: string;
  pcsPerPallet: number;
  placesPerPallet: number;
  priceEur: number;
  stage: Stage | null;
  size800: boolean;
}

export interface PipelineTruck {
  id: string;
  code: string;
  status: PipelineStatus;
  shipMonth: string;
  dispatchDate: string | null;
  /** when its stock can be sold (expected) */
  sellDate: string;
  sellMonth: string;
  units: Record<string, number>;
  pallets: number;
  places: number;
}

export interface PlanData {
  today: string;
  thisMonth: string;
  lastClosed: string;
  monthDone: number;
  months: string[];
  skus: PlanSku[];
  settings: PlanSettings;
  engine: StageEngineResult;
  plan: OrderPlan;
  pipeline: PipelineTruck[];
  /** stock today (TI + Fargo, after this month's sales so far) */
  onHand: Record<string, number>;
  /** projected at the end of this month (with what becomes sellable in it) */
  stockEndThisMonth: Record<string, number>;
  ibpEntered: Record<string, Record<string, number>>;
  /** open at DMK: the app's count and the one the plan uses (HQ's where the owner corrected it) */
  openApp: Record<string, number>;
  openUsed: Record<string, number>;
  frozenThrough: string;
  extraThrough: string;
  targets: Record<string, number>;
  /** the owner's say: stock-out marks, own monthly numbers, own 800 g shares */
  overrides: {
    short: Record<string, Record<string, boolean>>;
    own: Record<string, number>;
    /** own sales for a product in one month */
    month: Record<string, Record<string, number>>;
    share: Partial<Record<Stage, number>>;
  };
  rx: Record<string, number>;
  eurRate: number;
  slot: PlanningData["slot"];
  ibpSyncedAt: string | null;
  /** the books, per SKU: month-end stock (TI + Fargo), trucks arrived by month, collected from DMK by dispatch month */
  actual: {
    stockEnd: Record<string, Record<string, number>>;
    arrived: Record<string, Record<string, number>>;
    pickedUp: Record<string, Record<string, number>>;
  };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => isoDay(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000));

/** Share of the month's working days (Mon–Fri) done by today; today counts half. */
export function monthDoneShare(today: string): number {
  const [y, m, d] = today.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let all = 0, done = 0;
  for (let i = 1; i <= days; i++) {
    const wd = new Date(Date.UTC(y, m - 1, i)).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    all++;
    if (i < d) done++;
    else if (i === d) done += 0.5;
  }
  return all ? done / all : 0;
}

/** The month a load leaving DMK on `dispatch` can first be sold: dispatch + lead days; a date after the 15th counts from the next month. */
export function sellMonthOfDate(sellDate: string): string {
  const m = sellDate.slice(0, 7);
  return Number(sellDate.slice(8, 10)) > 15 ? addMonths(m, 1) : m;
}

export function parsePlanSettings(raw: string | undefined): PlanSettings {
  if (!raw) return DEFAULT_PLAN_SETTINGS;
  try {
    const v = JSON.parse(raw) as Partial<PlanSettings>;
    return { ...DEFAULT_PLAN_SETTINGS, ...v, tinsPerBaby: { ...DEFAULT_PLAN_SETTINGS.tinsPerBaby, ...v.tinsPerBaby } };
  } catch {
    return DEFAULT_PLAN_SETTINGS;
  }
}

/** A truck that is not in the app yet, for a what-if: its units by SKU id. */
export interface WhatIfTruck {
  code: string;
  dispatchDate: string;
  units: Record<string, number>;
}

/** The plan as the screens show it (one per request). */
export const loadPlan = cache(async (): Promise<PlanData> => buildPlan());

/** The plan, optionally with trucks that are not in the app yet (what-if; nothing is written). */
export async function buildPlan(opts: { addTrucks?: WhatIfTruck[] } = {}): Promise<PlanData> {
  const [data, { computed }, rawSkus, products, shipments, inputs, settingRow] = await Promise.all([
    loadPlanning(),
    getComputed(),
    prisma.planningSku.findMany({ where: { active: true, productId: { not: null } }, orderBy: { sortOrder: "asc" } }),
    prisma.product.findMany({ select: { id: true, regularProductId: true, isPromo: true } }),
    prisma.shipment.findMany({
      where: { deletedAt: null, status: { in: [...PIPELINE_STATUSES] } },
      include: { lines: { where: { deletedAt: null } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.planningInput.findMany(),
    prisma.setting.findUnique({ where: { key: PLAN_SETTINGS_KEY } }),
  ]);
  const settings = parsePlanSettings(settingRow?.value);
  const today = data.today;
  const thisMonth = today.slice(0, 7);
  const lastClosed = addMonths(thisMonth, -1);
  const monthDone = monthDoneShare(today);
  const regularOf = new Map(products.map((p) => [p.id, p.isPromo && p.regularProductId ? p.regularProductId : p.id]));

  const skus: PlanSku[] = rawSkus.map((s) => {
    const short = data.skus.find((x) => x.id === s.id)?.name ?? s.name;
    const stage = (short.match(/Platin\s*([123])/i)?.[1] ? (`P${short.match(/Platin\s*([123])/i)![1]}` as Stage) : null);
    const layersPerPlace = LAYERS_PER_PLACE[s.loadCategory] ?? 10;
    return {
      id: s.id,
      article: s.article,
      name: short,
      productId: s.productId!,
      pcsPerPallet: s.pcsPerPallet,
      placesPerPallet: s.layersPerPallet > 0 ? s.layersPerPallet / layersPerPlace : 1,
      priceEur: s.priceEur,
      stage,
      size800: /800\s*g/i.test(short),
    };
  });
  const skuByProduct = new Map(skus.map((s) => [s.productId, s.id]));
  const ids = skus.map((s) => s.id);

  // timeline: from the first month with sales to 20 months ahead
  const firstSale = ids.flatMap((id) => Object.keys(data.situations[id]?.actualSales ?? {})).sort()[0] ?? addMonths(thisMonth, -12);
  const months: string[] = [];
  for (let m = firstSale; m <= addMonths(thisMonth, 20); m = addMonths(m, 1)) months.push(m);

  // month-end stock as the Stock page counts it: TI + Fargo, promo folded in
  const stockEnd: Record<string, Record<string, number>> = Object.fromEntries(ids.map((id) => [id, {}]));
  for (const [productId, fifo] of Object.entries(computed.fifo)) {
    const id = skuByProduct.get(regularOf.get(productId) ?? productId);
    if (!id) continue;
    for (const [m, pos] of Object.entries(fifo.months)) {
      if (m > lastClosed) continue;
      stockEnd[id][m] = (stockEnd[id][m] ?? 0) + pos.tiStockUnits + pos.fargoStockUnits;
    }
  }

  // trucks that arrived, by their month in the books (promo folded in)
  const arrived: Record<string, Record<string, number>> = Object.fromEntries(ids.map((id) => [id, {}]));
  for (const sh of computed.shipments) {
    if (sh.status !== "ARRIVED") continue;
    for (const l of sh.lines) {
      const id = skuByProduct.get(regularOf.get(l.productId) ?? l.productId);
      if (id) arrived[id][sh.monthId] = (arrived[id][sh.monthId] ?? 0) + l.qty;
    }
  }

  const byKind = (kind: string) => inputs.filter((r) => r.kind === kind);
  const shortOverride: Record<string, Record<string, boolean>> = {};
  for (const r of byKind("SHORT")) (shortOverride[r.skuId] ??= {})[r.monthKey] = r.value >= 0.5;
  const productOverride = Object.fromEntries(byKind("OWN_DEMAND").map((r) => [r.skuId, r.value]));
  const monthOverride: Record<string, Record<string, number>> = {};
  for (const r of byKind("OWN_MONTH")) (monthOverride[r.skuId] ??= {})[r.monthKey] = r.value;
  const shareOverride = Object.fromEntries(byKind("OWN_SHARE").map((r) => [r.skuId, r.value])) as Partial<Record<Stage, number>>;
  const targets = Object.fromEntries(byKind("TARGET").map((r) => [r.monthKey, r.value]));

  const engine = runStageEngine({
    months,
    lastClosed,
    monthDone,
    products: skus.map((s): EngineProduct => ({ id: s.id, stage: s.stage, size800: s.size800 })),
    sales: Object.fromEntries(ids.map((id) => [id, data.situations[id]?.actualSales ?? {}])),
    stockEnd,
    rx: data.recruitment,
    shortOverride,
    productOverride,
    monthOverride,
    shareOverride,
    params: { tinsPerBaby: settings.tinsPerBaby, rxAhead: settings.rxAhead },
  });

  // trucks on their way or agreed: sellable from their expected date, else dispatch + lead days;
  // a truck belongs to its ship month's load even when it leaves DMK later
  const pipeline: PipelineTruck[] = shipments.map((sh) => {
    const dispatchDate = sh.dispatchDate ? isoDay(sh.dispatchDate) : null;
    const shipMonth = truckShipMonth({ shipMonth: sh.shipMonth, dispatchMonth: dispatchDate?.slice(0, 7), monthId: sh.monthId });
    let sellDate = sh.etaDate ? isoDay(sh.etaDate) : addDays(dispatchDate ?? `${shipMonth}-${String(settings.dispatchDay).padStart(2, "0")}`, settings.leadDays);
    if (sellDate < today) sellDate = today; // overdue: any day now
    const units: Record<string, number> = {};
    for (const l of sh.lines) {
      const id = skuByProduct.get(regularOf.get(l.productId) ?? l.productId);
      if (id) units[id] = (units[id] ?? 0) + l.qty;
    }
    const pallets = skus.reduce((t, s) => t + (units[s.id] ?? 0) / (s.pcsPerPallet || 1), 0);
    const places = skus.reduce((t, s) => t + ((units[s.id] ?? 0) / (s.pcsPerPallet || 1)) * s.placesPerPallet, 0);
    // a truck due this month sells this month; a later date after the 15th counts from the month after
    const sellMonth = sellDate.slice(0, 7) <= thisMonth ? thisMonth : sellMonthOfDate(sellDate);
    return { id: sh.id, code: sh.code, status: sh.status as PipelineStatus, shipMonth, dispatchDate, sellDate, sellMonth, units, pallets, places };
  });
  for (const t of opts.addTrucks ?? []) {
    let sellDate = addDays(t.dispatchDate, settings.leadDays);
    if (sellDate < today) sellDate = today;
    const pallets = skus.reduce((a, s) => a + (t.units[s.id] ?? 0) / (s.pcsPerPallet || 1), 0);
    const places = skus.reduce((a, s) => a + ((t.units[s.id] ?? 0) / (s.pcsPerPallet || 1)) * s.placesPerPallet, 0);
    const sellMonth = sellDate.slice(0, 7) <= thisMonth ? thisMonth : sellMonthOfDate(sellDate);
    pipeline.push({ id: `what-if:${t.code}`, code: t.code, status: "PLANNED", shipMonth: t.dispatchDate.slice(0, 7), dispatchDate: t.dispatchDate, sellDate, sellMonth, units: t.units, pallets, places });
  }

  // stock at the end of this month: today's stock, less the rest of this month's sales, plus what becomes sellable in it
  const onHand = Object.fromEntries(ids.map((id) => [id, data.situations[id]?.currentStock ?? 0]));
  const stockEndThisMonth = Object.fromEntries(
    ids.map((id) => {
      const arriving = pipeline.filter((t) => t.sellMonth === thisMonth).reduce((s, t) => s + (t.units[id] ?? 0), 0);
      return [id, Math.max(0, onHand[id] + arriving - (1 - monthDone) * engine.thisMonth[id].forecast)];
    })
  );

  const ibpEntered: Record<string, Record<string, number>> = {};
  for (const id of ids) for (const [m, q] of Object.entries(data.purchases[id] ?? {})) (ibpEntered[m] ??= {})[id] = q;
  // a what-if truck collects from what waits at DMK like a real one (in its dispatch month)
  const openApp = Object.fromEntries(
    ids.map((id) => {
      const taken = (opts.addTrucks ?? []).filter((t) => t.dispatchDate.slice(0, 7) <= thisMonth).reduce((a, t) => a + (t.units[id] ?? 0), 0);
      return [id, Math.max(0, (data.skus.find((s) => s.id === id)?.openOrderQty ?? 0) - taken)];
    })
  );
  // the owner's correction from HQ's open-quantity table, kept as the difference to the app's count —
  // so trucks added after it still collect from it
  const openFix = Object.fromEntries(byKind("OPEN_FIX").map((r) => [r.skuId, r.value]));
  const openUsed = Object.fromEntries(ids.map((id) => [id, Math.max(0, openApp[id] + (openFix[id] ?? 0))]));

  // the IBP for ship month M closes on the 20th of M − 4
  const deadlineDay = data.settings.orderDeadlineDay;
  const frozenThrough = addMonths(thisMonth, Number(today.slice(8, 10)) > deadlineDay ? 4 : 3);
  const extraThrough = addMonths(thisMonth, settings.pickupMonths);
  const knownShip = new Set(pipeline.map((t) => t.shipMonth));
  const shipMonths: string[] = [];
  for (let m = thisMonth; m <= addMonths(thisMonth, 15); m = addMonths(m, 1)) if (!knownShip.has(m)) shipMonths.push(m);
  const sellMonthOf = (m: string) => sellMonthOfDate(addDays(`${m}-${String(settings.dispatchDay).padStart(2, "0")}`, settings.leadDays));

  const plan = planOrders({
    skus: skus.map((s) => ({ id: s.id, pcsPerPallet: s.pcsPerPallet, priceEur: s.priceEur, placesPerPallet: s.placesPerPallet })),
    stockMonth: thisMonth,
    stockEnd: stockEndThisMonth,
    demand: engine.demand,
    shipMonths: shipMonths.filter((m) => m > thisMonth || !knownShip.has(thisMonth)),
    known: pipeline.filter((t) => t.sellMonth > thisMonth).map((t): KnownLoad => ({ shipMonth: t.shipMonth, sellMonth: t.sellMonth, units: t.units, label: t.code })),
    ibpEntered,
    frozenThrough,
    extraThrough,
    open: openUsed,
    sellMonthOf,
    targetOf: (m) => targets[m] ?? settings.defaultTarget,
    truckPlaces: settings.truckPlaces,
    minFill: settings.minFill,
    maxFill: settings.maxFill,
    dangerLine: settings.dangerLine,
  });

  return {
    today,
    thisMonth,
    lastClosed,
    monthDone,
    months,
    skus,
    settings,
    engine,
    plan,
    pipeline,
    onHand,
    stockEndThisMonth,
    ibpEntered,
    openApp,
    openUsed,
    frozenThrough,
    extraThrough,
    targets,
    overrides: { short: shortOverride, own: productOverride, share: shareOverride, month: monthOverride },
    rx: data.recruitment,
    eurRate: data.eurRate,
    slot: data.slot,
    ibpSyncedAt: data.ibpSyncedAt,
    actual: { stockEnd, arrived, pickedUp: data.pickups },
  };
}

export { monthKeyOf };
