// Shapes the supply plan (plan-data.ts) into what each screen shows — plain,
// serialisable props, built on the server. The screens show the advice
// (advice.ts): the outlook from the stock and the trucks in the app, and each
// ship month's number on its own.
import { addMonths } from "./compute";
import { sellMonthOfShip, type PlanData } from "./plan-data";
import type { PlannedLoad } from "./order-planner";
import { splitIntoTrucks } from "./truck-split";

export interface SkuHead {
  id: string;
  name: string;
  pcsPerPallet: number;
  placesPerPallet: number;
  priceEur: number;
}

export interface LoadView {
  shipMonth: string;
  sellMonth: string;
  kind: "pickup" | "ibp-frozen" | "ibp";
  /** the IBP deadline for this ship month (20th of month − 4) */
  deadline: string;
  units: Record<string, number>;
  ibpToEnter: Record<string, number>;
  ibpNow: Record<string, number>;
  fromOpen: Record<string, number>;
  extra: Record<string, number>;
  pallets: number;
  trucks: number;
  fill: number;
  underFilled: boolean;
  eur: number;
  /** truck by truck: units per SKU and places */
  split: { units: Record<string, number>; places: number }[];
}

export interface PipelineView {
  id: string;
  code: string;
  status: string;
  shipMonth: string;
  dispatchDate: string | null;
  sellDate: string;
  sellMonth: string;
  units: Record<string, number>;
  pallets: number;
  places: number;
}

export interface StockRow {
  id: string;
  onHand: number;
  soldThisMonth: number;
  runningAt: number;
  forecastThisMonth: number;
  endOfMonth: number;
  /** months of the next month's demand at each month-end */
  cover: Record<string, number>;
  lost: Record<string, number>;
}

const deadlineOf = (shipMonth: string) => `${addMonths(shipMonth, -4)}-20`;

export function skuHeads(p: PlanData): SkuHead[] {
  return p.skus.map((s) => ({ id: s.id, name: s.name, pcsPerPallet: s.pcsPerPallet, placesPerPallet: s.placesPerPallet, priceEur: s.priceEur }));
}

export function loadView(p: PlanData, l: PlannedLoad): LoadView {
  const ids = p.skus.map((s) => s.id);
  const kind = l.shipMonth <= p.extraThrough ? "pickup" : l.shipMonth <= p.frozenThrough ? "ibp-frozen" : "ibp";
  const split = splitIntoTrucks(l.units, p.skus, l.trucks, p.settings.truckPlaces).map((t) => ({ units: t.units, places: t.places }));
  return {
    shipMonth: l.shipMonth,
    sellMonth: l.sellMonth,
    kind,
    deadline: deadlineOf(l.shipMonth),
    units: l.units,
    ibpToEnter: l.ibpToEnter,
    ibpNow: Object.fromEntries(ids.map((id) => [id, p.ibpEntered[l.shipMonth]?.[id] ?? 0])),
    fromOpen: l.fromOpen,
    extra: l.extra,
    pallets: l.pallets,
    trucks: l.trucks,
    fill: l.fill,
    underFilled: l.underFilled,
    eur: l.eur,
    split,
  };
}

export function pipelineView(p: PlanData): PipelineView[] {
  return p.pipeline.map((t) => ({ id: t.id, code: t.code, status: t.status, shipMonth: t.shipMonth, dispatchDate: t.dispatchDate, sellDate: t.sellDate, sellMonth: t.sellMonth, units: t.units, pallets: t.pallets, places: t.places }));
}

export function stockRows(p: PlanData, monthsAhead = 7): StockRow[] {
  const months: string[] = [];
  for (let m = p.thisMonth; months.length <= monthsAhead; m = addMonths(m, 1)) months.push(m);
  return p.skus.map((s) => {
    const sold = p.engine.demand[s.id]?.[p.thisMonth] !== undefined ? (p.engine.thisMonth[s.id].runningAt * p.monthDone) : 0;
    return {
      id: s.id,
      onHand: p.onHand[s.id] ?? 0,
      soldThisMonth: sold,
      runningAt: p.engine.thisMonth[s.id].runningAt,
      forecastThisMonth: p.engine.thisMonth[s.id].forecast,
      endOfMonth: p.stockEndThisMonth[s.id] ?? 0,
      // from the stock and the trucks in the app — no proposed load is counted
      cover: Object.fromEntries(months.slice(1).map((m) => [m, p.advice.facts.cover[s.id]?.[m] ?? 0])),
      lost: Object.fromEntries(months.slice(1).map((m) => [m, p.advice.facts.lost[s.id]?.[m] ?? 0])),
    };
  });
}

/** The IBP entry due next: the first ship month still open (the one after the frozen ones), closing on the 20th of its month − 4. */
export function dueIbp(p: PlanData): { shipMonth: string; deadline: string; daysLeft: number; load: LoadView | null } {
  const shipMonth = addMonths(p.frozenThrough, 1);
  const deadline = deadlineOf(shipMonth);
  const daysLeft = Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${p.today}T00:00:00Z`)) / 86_400_000);
  const l = p.advice.months.find((x) => x.shipMonth === shipMonth)?.load;
  return { shipMonth, deadline, daysLeft, load: l && l.trucks > 0 ? loadView(p, l) : null };
}

/** months shown in the stock table (after this month) */
export function coverMonths(p: PlanData, monthsAhead = 7): string[] {
  const out: string[] = [];
  for (let m = addMonths(p.thisMonth, 1); out.length < monthsAhead; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** One ship month's advice, counted on its own from the stock and the trucks in the app. */
export interface AdviceView {
  shipMonth: string;
  sellMonth: string;
  /** pickup: the IBP is closed — a truck to take; ibp: the number to enter in the IBP */
  kind: "pickup" | "ibp";
  deadline: string;
  target: number;
  /** the need before whole trucks, in trucks */
  needTrucks: number;
  /** the advised load on top of the trucks already in the app (trucks may be 0) */
  load: LoadView;
  /** pickup: ordered in the IBP up to this month and not on a truck, units; ibp: entered for this month */
  orderedUnits: number;
  /** trucks the app already has for this ship month */
  trucksIn: { code: string; status: string; units: number }[];
}

export function adviceViews(p: PlanData): AdviceView[] {
  return p.advice.months.map((a) => ({
    shipMonth: a.shipMonth,
    sellMonth: a.sellMonth,
    kind: a.kind,
    deadline: deadlineOf(a.shipMonth),
    target: a.target,
    needTrucks: a.needTrucks,
    load: loadView(p, a.load),
    orderedUnits: Object.values(a.ordered).reduce((t, v) => t + v, 0),
    trucksIn: p.pipeline
      .filter((t) => t.shipMonth === a.shipMonth)
      .map((t) => ({ code: t.code, status: t.status, units: Object.values(t.units).reduce((x, v) => x + v, 0) })),
  }));
}

/** A month of the outlook as one tile: all products together, and how many run out or run low. */
export interface OutlookMonth {
  month: string;
  /** month-end stock of all products in months of the next month's sales */
  cover: number;
  lostUnits: number;
  out: number;
  low: number;
}

export function outlookMonths(p: PlanData, monthsAhead = 7): OutlookMonth[] {
  const f = p.advice.facts;
  return coverMonths(p, monthsAhead).map((m) => {
    const next = addMonths(m, 1);
    const live = p.skus.filter((s) => (p.engine.demand[s.id]?.[m] ?? 0) > 0);
    const stock = p.skus.reduce((t, s) => t + (f.stock[s.id]?.[m] ?? 0), 0);
    const demandNext = p.skus.reduce((t, s) => t + (p.engine.demand[s.id]?.[next] ?? 0), 0);
    const out = live.filter((s) => (f.lost[s.id]?.[m] ?? 0) > 0.5);
    return {
      month: m,
      cover: stock / Math.max(1, demandNext),
      lostUnits: p.skus.reduce((t, s) => t + (f.lost[s.id]?.[m] ?? 0), 0),
      out: out.length,
      low: live.filter((s) => !out.includes(s) && (f.cover[s.id]?.[m] ?? 0) < p.settings.dangerLine).length,
    };
  });
}

/** By ship month: when its load is sellable, and the stock all products hold at the end of that month if everything ordered in the IBP is taken in its month. */
export function orderedCover(p: PlanData, shipMonths: string[]): Record<string, { sellMonth: string; cover: number; target: number }> {
  const o = p.advice.ordered;
  return Object.fromEntries(
    shipMonths.map((m) => {
      const sell = sellMonthOfShip(p.settings, m);
      const stock = p.skus.reduce((t, s) => t + (o.stock[s.id]?.[sell] ?? 0), 0);
      const demandNext = p.skus.reduce((t, s) => t + (p.engine.demand[s.id]?.[addMonths(sell, 1)] ?? 0), 0);
      return [m, { sellMonth: sell, cover: stock / Math.max(1, demandNext), target: p.targets[m] ?? p.settings.defaultTarget }];
    })
  );
}
