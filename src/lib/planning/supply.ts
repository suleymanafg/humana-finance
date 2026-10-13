// Supply planning's two decisions, from one picture of stock and supply:
//   1. pick up from DMK now — goods already ordered and waiting at DMK: paid
//      and loaded this week, on the shelf about a month later;
//   2. the IBP order due by the deadline — production for the ship month
//      four months out, on the shelf the month after it ships, sized so the
//      owner's cover rule holds at the end of that month.
// Demand is actual sales (or the cohort model), never the IBP orders, which
// are supply. Stock runs month by month with lost sales: a month that runs
// short does not carry its shortfall into the next. Trucks go out ≥98% full.
// Pure — no DB imports — so it is unit-tested like the P&L engine.
import { addMonths, runRate, type OrderSlot, type PlanningSettings } from "./compute";

export type DemandBasis = "sales" | "model";

export interface SupplySku {
  id: string;
  name: string;
  article: string;
  pcsPerCarton: number;
  pcsPerPallet: number;
  grossKgPerUnit: number;
  priceEur: number;
}

export interface SupplyTruck {
  code: string;
  etaDate: string | null; // ISO date
  etaMonth: string; // month it is counted in (overdue trucks: this month)
  units: Record<string, number>; // skuId -> units
}

export interface SupplyInput {
  today: string; // ISO date, Tashkent
  skus: SupplySku[];
  onHand: Record<string, number>; // units now (TI + Fargo), net of this month's sales so far
  soldThisMonth: Record<string, number>;
  sales: Record<string, Record<string, number>>; // skuId -> month -> units sold
  model: Record<string, Record<string, number>>; // skuId -> month -> cohort-model demand
  transit: SupplyTruck[];
  atDmk: Record<string, number>; // ordered, not yet collected
  orders: Record<string, Record<string, number>>; // skuId -> ship month -> IBP order
  settings: PlanningSettings;
  slot: OrderSlot;
  leadDays: number; // pickup at DMK -> on the shelf
}

export interface PlanLine {
  skuId: string;
  units: number;
  pallets: number;
  eur: number;
  /** units added beyond the need only to fill the last truck */
  topUp: number;
}

export interface TruckPlan {
  trucks: number;
  units: number;
  pallets: number;
  grossKg: number;
  eur: number;
  /** load of the trucks, 0–1 (pallets against capacity) */
  fill: number;
  /** none: nothing needed · full: fits whole trucks · topped: filled up · trimmed: cut to whole trucks · partial: under one full truck */
  shape: "none" | "full" | "topped" | "trimmed" | "partial";
  lines: PlanLine[];
}

export interface Shortage {
  skuId: string;
  units: number; // sales lost before the next IBP order lands
  fromMonth: string;
}

export interface PickupDecision extends TruckPlan {
  arrivalMonth: string;
  sellableDate: string; // ISO date, estimate
  available: { units: number; pallets: number };
  leftAtDmk: Record<string, number>;
  /** runs short even with this pickup, before the IBP slot lands */
  stillShort: Shortage[];
}

export interface IbpDecision extends TruckPlan {
  shipMonth: string;
  arrivalMonth: string;
  deadline: string;
  daysLeft: number;
  enteredBySku: Record<string, number>; // already in IBP for this ship month
  entered: number;
  /** already entered for the ship months after the slot — still open, so not counted */
  laterEntered: number;
}

export interface Arrival {
  kind: "truck" | "pickup" | "dmk" | "ibp" | "new";
  label: string; // truck code or ship month
  units: number;
}

export interface GridCell {
  month: string;
  closing: number;
  short: number;
  cover: number; // months of the next months' demand the closing stock covers
  arrivals: Arrival[];
}

export interface GridRow {
  skuId: string;
  name: string;
  demand: number; // per month, the basis' average over the grid
  onHand: number;
  coverNow: number;
  cells: GridCell[];
}

export interface SupplyPlan {
  basis: DemandBasis;
  thisMonth: string;
  months: string[];
  pickup: PickupDecision;
  ibp: IbpDecision;
  rows: GridRow[];
}

const FILL = 0.98; // owner policy: no truck leaves under 98% full
const PICKUP_SAFETY_MONTHS = 1; // a pickup also holds a month's buffer at the IBP arrival
const TRIM_LIMIT = 0.25; // trim to whole trucks only when the spill is under a quarter truck
const GRID_MONTHS = 7;

const monthsFrom = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
};

export function palletsOf(sku: SupplySku, units: number): number {
  return sku.pcsPerPallet > 0 ? units / sku.pcsPerPallet : 0;
}

function cartonsUp(sku: SupplySku, units: number): number {
  const c = sku.pcsPerCarton > 0 ? sku.pcsPerCarton : 1;
  return Math.ceil(units / c - 1e-9) * c;
}

function cartonsDown(sku: SupplySku, units: number): number {
  const c = sku.pcsPerCarton > 0 ? sku.pcsPerCarton : 1;
  return Math.floor(units / c + 1e-9) * c;
}

/** Demand per SKU per month on the chosen basis; the month in progress counts only what is still to sell. */
export function demandOf(input: SupplyInput, basis: DemandBasis) {
  const thisMonth = input.today.slice(0, 7);
  const rate = new Map(input.skus.map((s) => [s.id, runRate(input.sales[s.id] ?? {}, thisMonth, 3)]));
  const full = (skuId: string, month: string): number => {
    const rr = rate.get(skuId) ?? 0;
    if (basis === "sales") return rr;
    const m = input.model[skuId]?.[month];
    return m !== undefined && m > 0 ? m : rr;
  };
  return (skuId: string, month: string): number =>
    month === thisMonth ? Math.max(0, full(skuId, month) - (input.soldThisMonth[skuId] ?? 0)) : full(skuId, month);
}

/** Month-by-month stock with lost sales. */
function ledger(opening: number, months: string[], demand: (m: string) => number, arrivals: (m: string) => number) {
  let stock = opening;
  return months.map((m) => {
    const d = demand(m);
    const a = arrivals(m);
    const available = stock + a;
    const short = Math.max(0, d - available);
    stock = Math.max(0, available - d);
    return { month: m, demand: d, arrivals: a, closing: stock, short };
  });
}

/** Extra units needed so the stock never runs out over `months` and still holds `safety` at the end. */
function needOver(opening: number, months: string[], demand: (m: string) => number, arrivals: (m: string) => number, safety = 0): number {
  let cumD = 0;
  let cumS = 0;
  let need = 0;
  months.forEach((m, i) => {
    cumD += demand(m) + (i === months.length - 1 ? safety : 0);
    cumS += arrivals(m);
    need = Math.max(need, cumD - opening - cumS);
  });
  return need;
}

/**
 * Rounds a load to whole trucks at ≥98% full. A small spill is trimmed from
 * the SKUs that keep the most cover; otherwise the last truck is filled up,
 * pallet by pallet, with the SKUs that need it most — within `room`.
 */
export function fitTrucks(
  want: Record<string, number>,
  skus: SupplySku[],
  settings: PlanningSettings,
  room: (skuId: string) => number, // most units that may be added
  coverAfter: (skuId: string, units: number) => number // months of cover with this many units
): TruckPlan {
  const byId = new Map(skus.map((s) => [s.id, s]));
  const qty = new Map(Object.entries(want).filter(([, u]) => u > 0));
  const base = new Map(qty);
  const cap = settings.truckPallets;
  const pallets = () => [...qty].reduce((t, [id, u]) => t + palletsOf(byId.get(id)!, u), 0);

  let shape: TruckPlan["shape"] = "full";
  const P = pallets();
  if (P <= 1e-9) return summarize(qty, base, byId, settings, 0, "none");
  const up = Math.ceil(P / cap - 1e-9);
  const whole = Math.floor(P / cap + 1e-9);
  let trucks = up;

  if (P < FILL * cap * up - 1e-9) {
    const trimFirst = whole >= 1 && P - whole * cap <= TRIM_LIMIT * cap;
    const topUp = (): boolean => {
      const target = FILL * cap * up;
      const added = new Map<string, number>();
      for (let guard = 0; pallets() < target - 1e-9 && guard < 2000; guard++) {
        let best: string | null = null;
        let bestCover = Infinity;
        for (const s of skus) {
          const left = room(s.id) - (added.get(s.id) ?? 0);
          if (left < (s.pcsPerCarton || 1) || s.pcsPerPallet <= 0) continue;
          const c = coverAfter(s.id, qty.get(s.id) ?? 0);
          if (c < bestCover) {
            bestCover = c;
            best = s.id;
          }
        }
        if (!best) break;
        const s = byId.get(best)!;
        const missing = (target - pallets()) * s.pcsPerPallet;
        const step = cartonsDown(s, Math.min(s.pcsPerPallet, room(best) - (added.get(best) ?? 0), cartonsUp(s, missing)));
        if (step <= 0) break;
        qty.set(best, (qty.get(best) ?? 0) + step);
        added.set(best, (added.get(best) ?? 0) + step);
      }
      if (pallets() >= target - 1e-9) return true;
      for (const [id, a] of added) qty.set(id, (qty.get(id) ?? 0) - a); // undo
      return false;
    };
    const trim = () => {
      const limit = whole * cap;
      for (let guard = 0; pallets() > limit + 1e-9 && guard < 2000; guard++) {
        let worst: string | null = null;
        let worstCover = -Infinity;
        for (const [id, u] of qty) {
          if (u <= 0) continue;
          const c = coverAfter(id, u);
          if (c > worstCover) {
            worstCover = c;
            worst = id;
          }
        }
        if (!worst) break;
        const s = byId.get(worst)!;
        const excess = (pallets() - limit) * s.pcsPerPallet;
        const step = Math.min(qty.get(worst)!, cartonsUp(s, Math.min(s.pcsPerPallet, excess)));
        qty.set(worst, qty.get(worst)! - step);
      }
      trucks = whole;
    };
    if (trimFirst) {
      trim();
      shape = "trimmed";
    } else if (topUp()) {
      shape = "topped";
    } else if (whole >= 1) {
      trim();
      shape = "trimmed";
    } else {
      shape = "partial";
    }
  }
  return summarize(qty, base, byId, settings, trucks, shape);
}

function summarize(
  qty: Map<string, number>,
  base: Map<string, number>,
  byId: Map<string, SupplySku>,
  settings: PlanningSettings,
  trucks: number,
  shape: TruckPlan["shape"]
): TruckPlan {
  const lines: PlanLine[] = [];
  for (const [id, u] of qty) {
    if (u <= 0) continue;
    const s = byId.get(id)!;
    lines.push({ skuId: id, units: u, pallets: palletsOf(s, u), eur: u * s.priceEur, topUp: Math.max(0, u - (base.get(id) ?? 0)) });
  }
  const units = lines.reduce((t, l) => t + l.units, 0);
  const pallets = lines.reduce((t, l) => t + l.pallets, 0);
  return {
    trucks,
    units,
    pallets,
    grossKg: lines.reduce((t, l) => t + l.units * byId.get(l.skuId)!.grossKgPerUnit, 0),
    eur: lines.reduce((t, l) => t + l.eur, 0),
    fill: trucks > 0 ? pallets / (trucks * settings.truckPallets) : 0,
    shape,
    lines,
  };
}

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function buildSupplyPlan(input: SupplyInput, basis: DemandBasis): SupplyPlan {
  const thisMonth = input.today.slice(0, 7);
  const next = addMonths(thisMonth, 1);
  const { slot, settings } = input;
  const demand = demandOf(input, basis);

  // supply already on its way, before either decision: trucks on the road and
  // IBP orders for ship months after this one (the slot's own is the decision)
  const base: Record<string, Record<string, Arrival[]>> = {};
  const push = (skuId: string, month: string, a: Arrival) => {
    if (a.units <= 0) return;
    ((base[skuId] ??= {})[month] ??= []).push(a);
  };
  for (const t of input.transit) {
    for (const [skuId, u] of Object.entries(t.units)) push(skuId, t.etaMonth < thisMonth ? thisMonth : t.etaMonth, { kind: "truck", label: t.code, units: u });
  }
  for (const [skuId, byShip] of Object.entries(input.orders)) {
    for (const [ship, u] of Object.entries(byShip)) {
      if (ship > thisMonth && ship !== slot.shipMonth) push(skuId, addMonths(ship, 1), { kind: "ibp", label: ship, units: u });
    }
  }
  const sumAt = (list: Arrival[] | undefined) => (list ?? []).reduce((t, a) => t + a.units, 0);

  // ── 1. pick up now ──
  // enough that nothing runs out before the IBP slot can land, plus a month in hand
  const lastBeforeIbp = addMonths(slot.arrivalMonth, -1) < next ? next : addMonths(slot.arrivalMonth, -1);
  const pickupMonths = monthsFrom(next, lastBeforeIbp);
  const opening = (skuId: string) => {
    const now = (input.onHand[skuId] ?? 0) + sumAt(base[skuId]?.[thisMonth]);
    return Math.max(0, now - demand(skuId, thisMonth));
  };
  const pickupWant: Record<string, number> = {};
  const available = (skuId: string) => Math.max(0, Math.floor(input.atDmk[skuId] ?? 0));
  for (const s of input.skus) {
    const need = needOver(
      opening(s.id),
      pickupMonths,
      (m) => demand(s.id, m),
      (m) => sumAt(base[s.id]?.[m]),
      PICKUP_SAFETY_MONTHS * demand(s.id, addMonths(lastBeforeIbp, 1))
    );
    pickupWant[s.id] = Math.min(available(s.id), cartonsUp(s, need));
  }
  const coverAtSlot = (skuId: string, units: number) => {
    const rows = ledger(opening(skuId), pickupMonths, (m) => demand(skuId, m), (m) => sumAt(base[skuId]?.[m]) + (m === next ? units : 0));
    const d = demand(skuId, addMonths(lastBeforeIbp, 1));
    const short = rows.reduce((t, r) => t + r.short, 0);
    return d > 0 ? (rows[rows.length - 1].closing - short) / d : 99;
  };
  const pickupPlan = fitTrucks(pickupWant, input.skus, settings, (id) => available(id) - (pickupWant[id] ?? 0), coverAtSlot);
  const picked = Object.fromEntries(pickupPlan.lines.map((l) => [l.skuId, l.units]));
  const leftAtDmk: Record<string, number> = {};
  for (const s of input.skus) {
    const left = available(s.id) - (picked[s.id] ?? 0);
    if (left > 0) leftAtDmk[s.id] = left;
  }
  // what stays at DMK comes with a later truck — counted the month after the pickup lands
  const dmkRestMonth = addMonths(next, 1);
  for (const s of input.skus) {
    push(s.id, next, { kind: "pickup", label: "", units: picked[s.id] ?? 0 });
    push(s.id, dmkRestMonth, { kind: "dmk", label: "", units: leftAtDmk[s.id] ?? 0 });
  }

  const stillShort: Shortage[] = [];
  const beforeIbp = monthsFrom(thisMonth, lastBeforeIbp);
  for (const s of input.skus) {
    const rows = ledger(input.onHand[s.id] ?? 0, beforeIbp, (m) => demand(s.id, m), (m) => sumAt(base[s.id]?.[m]));
    const short = rows.reduce((t, r) => t + r.short, 0);
    const first = rows.find((r) => r.short > 0);
    if (short >= 1 && first) stillShort.push({ skuId: s.id, units: Math.round(short), fromMonth: first.month });
  }
  stillShort.sort((a, b) => a.fromMonth.localeCompare(b.fromMonth) || b.units - a.units);

  const pickup: PickupDecision = {
    ...pickupPlan,
    arrivalMonth: next,
    sellableDate: addDays(input.today, input.leadDays),
    available: {
      units: input.skus.reduce((t, s) => t + available(s.id), 0),
      pallets: input.skus.reduce((t, s) => t + palletsOf(s, available(s.id)), 0),
    },
    leftAtDmk,
    stillShort,
  };

  // ── 2. the IBP order for the slot ──
  // the owner's rule: at the end of the arrival month, minCover months of
  // sales still in stock. Only supply that is fixed counts — trucks, what
  // waits at DMK, and orders whose deadline has passed; entries for later
  // ship months are still open and get their own decision at their deadline.
  const toArrival = monthsFrom(thisMonth, addMonths(slot.arrivalMonth, -1));
  const fixedAt = (skuId: string, m: string) =>
    (base[skuId]?.[m] ?? []).filter((a) => a.kind !== "ibp" || a.label < slot.shipMonth).reduce((t, a) => t + a.units, 0);
  const atArrival = (skuId: string) => {
    const rows = ledger(input.onHand[skuId] ?? 0, toArrival, (m) => demand(skuId, m), (m) => fixedAt(skuId, m));
    return rows.length > 0 ? rows[rows.length - 1].closing : input.onHand[skuId] ?? 0;
  };
  const coverMonths = monthsFrom(addMonths(slot.arrivalMonth, 1), addMonths(slot.arrivalMonth, settings.minCoverMonths));
  const coverNeed = (skuId: string) => coverMonths.reduce((t, m) => t + demand(skuId, m), 0);
  const ibpWant: Record<string, number> = {};
  for (const s of input.skus) {
    const need = needOver(atArrival(s.id), [slot.arrivalMonth], (m) => demand(s.id, m), (m) => fixedAt(s.id, m), coverNeed(s.id));
    ibpWant[s.id] = need > 0 ? cartonsUp(s, need) : 0;
  }
  // months of the following sales held at the end of the arrival month
  const ibpCover = (skuId: string, units: number) => {
    const end = atArrival(skuId) + fixedAt(skuId, slot.arrivalMonth) + units - demand(skuId, slot.arrivalMonth);
    const perMonth = coverNeed(skuId) / Math.max(1, coverMonths.length);
    return perMonth > 0 ? end / perMonth : 99;
  };
  // a top-up never adds more than a month of the SKU's sales
  const ibpPlan = fitTrucks(ibpWant, input.skus, settings, (id) => Math.max(0, demand(id, slot.arrivalMonth)), ibpCover);
  const enteredBySku: Record<string, number> = {};
  for (const s of input.skus) {
    const q = input.orders[s.id]?.[slot.shipMonth] ?? 0;
    if (q > 0) enteredBySku[s.id] = q;
  }
  const laterShips = monthsFrom(addMonths(slot.shipMonth, 1), addMonths(slot.shipMonth, settings.minCoverMonths));
  const ibp: IbpDecision = {
    ...ibpPlan,
    shipMonth: slot.shipMonth,
    arrivalMonth: slot.arrivalMonth,
    deadline: slot.deadline,
    daysLeft: slot.daysLeft,
    enteredBySku,
    entered: Object.values(enteredBySku).reduce((t, q) => t + q, 0),
    laterEntered: input.skus.reduce((t, s) => t + laterShips.reduce((w, m) => w + (input.orders[s.id]?.[m] ?? 0), 0), 0),
  };
  for (const l of ibpPlan.lines) push(l.skuId, slot.arrivalMonth, { kind: "new", label: slot.shipMonth, units: l.units });

  // ── the picture: month-end stock per SKU with both decisions in ──
  const months = monthsFrom(thisMonth, addMonths(thisMonth, GRID_MONTHS - 1));
  const rows: GridRow[] = input.skus.map((s) => {
    const cells = ledger(input.onHand[s.id] ?? 0, months, (m) => demand(s.id, m), (m) => sumAt(base[s.id]?.[m]));
    const perMonth = months.slice(1).reduce((t, m) => t + demand(s.id, m), 0) / Math.max(1, months.length - 1);
    return {
      skuId: s.id,
      name: s.name,
      demand: perMonth,
      onHand: input.onHand[s.id] ?? 0,
      coverNow: perMonth > 0 ? (input.onHand[s.id] ?? 0) / perMonth : 99,
      cells: cells.map((c, i) => {
        const nextD = demand(s.id, months[i + 1] ?? addMonths(c.month, 1));
        return {
          month: c.month,
          closing: c.closing,
          short: c.short,
          cover: nextD > 0 ? c.closing / nextD : 99,
          arrivals: base[s.id]?.[c.month] ?? [],
        };
      }),
    };
  });

  return { basis, thisMonth, months, pickup, ibp, rows };
}

// ── checks: only what changes the answer ──
export type SupplyCheck =
  | { kind: "truck-overdue"; code: string; etaDate: string }
  | { kind: "ibp-stale"; syncedAt: string | null }
  | { kind: "orders-vs-sales"; skuId: string; ordersPerMonth: number; salesPerMonth: number }
  | { kind: "weights"; skuIds: string[] }
  | { kind: "unlinked"; names: string[] };

export function supplyChecks(
  input: SupplyInput,
  extra: { ibpSyncedAt: string | null; unlinked: string[] }
): SupplyCheck[] {
  const out: SupplyCheck[] = [];
  const thisMonth = input.today.slice(0, 7);
  for (const t of input.transit) {
    if (t.etaDate && t.etaDate < input.today) out.push({ kind: "truck-overdue", code: t.code, etaDate: t.etaDate });
  }
  const ageDays = extra.ibpSyncedAt
    ? (Date.parse(`${input.today}T00:00:00Z`) - Date.parse(`${extra.ibpSyncedAt.slice(0, 10)}T00:00:00Z`)) / 86_400_000
    : Infinity;
  if (ageDays > 35) out.push({ kind: "ibp-stale", syncedAt: extra.ibpSyncedAt });
  // orders for the next six ship months against sales: a gap the IBP plan carries forward
  const ships = monthsFrom(addMonths(thisMonth, 1), addMonths(thisMonth, 6));
  for (const s of input.skus) {
    const sales = runRate(input.sales[s.id] ?? {}, thisMonth, 3);
    if (sales < 100) continue;
    const ordered = ships.reduce((t, m) => t + (input.orders[s.id]?.[m] ?? 0), 0) / ships.length;
    if (ordered < 0.6 * sales || ordered > 1.6 * sales) {
      out.push({ kind: "orders-vs-sales", skuId: s.id, ordersPerMonth: ordered, salesPerMonth: sales });
    }
  }
  // a tin's gross weight is at least half its pack size — else the logistics data is off
  const badWeight = input.skus.filter((s) => {
    const g = Number(s.name.match(/\b(\d{3,4})\s*(?:g|г|гр)\b/i)?.[1] ?? 0);
    return g > 0 && s.grossKgPerUnit < (0.5 * g) / 1000;
  });
  if (badWeight.length > 0) out.push({ kind: "weights", skuIds: badWeight.map((s) => s.id) });
  if (extra.unlinked.length > 0) out.push({ kind: "unlinked", names: extra.unlinked });
  return out;
}
