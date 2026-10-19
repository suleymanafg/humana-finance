// Shapes the supply plan (plan-data.ts) into what each screen shows — plain,
// serialisable props, built on the server.
import { addMonths } from "./compute";
import type { PlanData } from "./plan-data";
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
      cover: Object.fromEntries(months.slice(1).map((m) => [m, p.plan.cover[s.id]?.[m] ?? 0])),
      lost: Object.fromEntries(months.slice(1).map((m) => [m, p.plan.lost[s.id]?.[m] ?? 0])),
    };
  });
}

/** The IBP entry due next: the first ship month still open (the one after the frozen ones), closing on the 20th of its month − 4. */
export function dueIbp(p: PlanData): { shipMonth: string; deadline: string; daysLeft: number; load: LoadView | null } {
  const shipMonth = addMonths(p.frozenThrough, 1);
  const deadline = deadlineOf(shipMonth);
  const daysLeft = Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${p.today}T00:00:00Z`)) / 86_400_000);
  const l = p.plan.loads.find((x) => x.shipMonth === shipMonth);
  return { shipMonth, deadline, daysLeft, load: l ? loadView(p, l) : null };
}

/** months shown in the stock table (after this month) */
export function coverMonths(p: PlanData, monthsAhead = 7): string[] {
  const out: string[] = [];
  for (let m = addMonths(p.thisMonth, 1); out.length < monthsAhead; m = addMonths(m, 1)) out.push(m);
  return out;
}
