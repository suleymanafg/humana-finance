// Order planner — the owner's budget workbook (v17, «Заказы IBP» tab) as code,
// with each load sellable from its own month instead of always the next one.
//
// For every ship month, in order: the load is sized so that, at the end of the
// month it becomes sellable, stock covers the target months of the following
// month's demand (the target ramps: Nov–Dec 1, Feb–Jul 2027 1.5, Aug 1.75,
// then 2). Up to the last month whose IBP deadline has passed, what is entered
// in the IBP is taken whatever the need. Within the pick-up horizon more can
// be asked from HQ on top; after it, those months take only what is entered
// (plus filling the truck). What is still open at DMK is collected before anything new is
// ordered. Loads are whole pallets in whole trucks, measured as HQ's order form
// does: a truck has 33 places and a pallet takes layers ÷ layers-per-place of
// its category (0.8 for Platin and 800 g milks, 1.2 for AC/AR). A spill under a
// quarter truck is left out — one pallet off each product with the most stock,
// only from products that stay above the danger line — otherwise the last
// truck is filled, the spare space shared by next month's sales and the rest
// one pallet at a time to the products with the least stock, while it fits.
//
// The month before a take-only-the-IBP month also looks through it: that load
// cannot grow, so this one must carry the stock to the end of its sellable
// month. Each truck on its own is loaded between HQ's minimum (0.98) and the
// maximum: with 0.8 and 1.2 place pallets that is 32.4 places — an odd number
// of the bigger pallets in every truck. Pure — no DB; the caller assembles the inputs.
import { addMonths } from "./compute";
import { placeStep, splitIntoTrucks } from "./truck-split";

export { placeStep };

export interface PlannerSku {
  id: string;
  pcsPerPallet: number;
  priceEur: number;
  /** truck space one pallet takes (HQ: layers per pallet ÷ layers per place of its category); default 1 */
  placesPerPallet?: number;
}

/** a load already decided: a truck on its way, ordered, or agreed but not yet ordered */
export interface KnownLoad {
  shipMonth: string;
  /** the month its stock can first be sold */
  sellMonth: string;
  units: Record<string, number>;
  label?: string;
}

export interface OrderPlannerInput {
  skus: PlannerSku[];
  /** the plan starts after this month; stockEnd is sellable stock at its end */
  stockMonth: string;
  stockEnd: Record<string, number>;
  /** demand by product and month (must reach a few months past the last ship month) */
  demand: Record<string, Record<string, number>>;
  /** months to decide a load for, ascending (none may be a known load's ship month) */
  shipMonths: string[];
  known: KnownLoad[];
  /** what is entered in the IBP, by ship month */
  ibpEntered: Record<string, Record<string, number>>;
  /** IBP months up to and including this one can no longer change: what is entered is taken */
  frozenThrough: string;
  /** up to this month more can be asked from HQ on top of the IBP; later frozen months take only the IBP */
  extraThrough: string;
  /** still open at DMK before the first ship month */
  open: Record<string, number>;
  /** the month a load shipped in this month can first be sold */
  sellMonthOf: (shipMonth: string) => string;
  /** months of the following month's demand to hold at the end of the sell month */
  targetOf: (shipMonth: string) => number;
  /** space in one truck (HQ's order form: 33 places); default 33 */
  truckPlaces?: number;
  /** at most this many trucks in a ship month (cash or HQ limits); the need above it is left out, most-stocked products first */
  maxTrucksOf?: (shipMonth: string) => number | undefined;
  /** HQ: below this share of a truck, transport safety is not guaranteed (default 0.98) */
  minFill?: number;
  /** load a truck to at most this share of its places (HQ's form must show 0.98: 0.985); default 1 */
  maxFill?: number;
  /** a spill under this share of a truck is left out rather than ordered */
  spillShare?: number;
  /** a pallet is only taken off a product whose stock stays at least this many months */
  dangerLine?: number;
}

export interface PlannedLoad {
  shipMonth: string;
  sellMonth: string;
  /** takes only what is entered in the IBP (plus filling the truck) */
  onlyIbp: boolean;
  /** units per product in the load */
  units: Record<string, number>;
  pallets: number;
  trucks: number;
  /** truck space used, and the share of the trucks it fills (HQ: at least 0.98, at most 1) */
  places: number;
  fill: number;
  /** under HQ's minimum fill — transport safety at the buyer's risk */
  underFilled: boolean;
  /** of the load: entered in the IBP (frozen months) / taken from what is open at DMK / new */
  fromIbp: Record<string, number>;
  fromOpen: Record<string, number>;
  extra: Record<string, number>;
  /** what to have in the IBP for this ship month (load less what comes from open orders) */
  ibpToEnter: Record<string, number>;
  eur: number;
}

export interface OrderPlan {
  loads: PlannedLoad[];
  /** stock at month-end and months of the next month's demand it covers */
  stock: Record<string, Record<string, number>>;
  cover: Record<string, Record<string, number>>;
  /** demand that could not be served for want of stock */
  lost: Record<string, Record<string, number>>;
  /** still open at DMK after the last ship month */
  openLeft: Record<string, number>;
}

export function planOrders(input: OrderPlannerInput): OrderPlan {
  const CAP = input.truckPlaces ?? 33;
  const EPS = 1e-6;
  const spillShare = input.spillShare ?? 0.25;
  const minFill = input.minFill ?? 0.98;
  const danger = input.dangerLine ?? 1;
  const ids = input.skus.map((s) => s.id);
  const pal = Object.fromEntries(input.skus.map((s) => [s.id, s.pcsPerPallet]));
  const w = Object.fromEntries(input.skus.map((s) => [s.id, s.placesPerPallet ?? 1]));
  // whole pallets move a truck's places in steps (0.8 and 1.2 → 0.4): a truck holds the most
  // steps within the maximum (U) and at least the steps that reach HQ's minimum (L) — 32.4 both
  const step = placeStep(ids.filter((id) => pal[id] > 0).map((id) => w[id]));
  const maxPlaces = CAP * (input.maxFill ?? 1);
  const U = Math.floor(maxPlaces / step + EPS) * step;
  const L = Math.min(U, Math.ceil((minFill * CAP) / step - EPS) * step);
  const placesOf = (q: Record<string, number>) => ids.reduce((t, id) => t + q[id] * w[id], 0);
  const splitSkus = input.skus.map((s) => ({ id: s.id, pcsPerPallet: s.pcsPerPallet, placesPerPallet: w[s.id] }));
  // a truck of the smallest pallets alone cannot reach L within U (0.8: 32.0 or 32.8): each truck needs a bigger one
  const smallW = Math.min(...ids.filter((id) => pal[id] > 0).map((id) => w[id]));
  const bigPerTruck = Math.floor(U / smallW + EPS) * smallW < L - EPS ? 1 : 0;
  const bigCount = (q: Record<string, number>) => ids.reduce((t, id) => t + (w[id] > smallW + EPS ? q[id] : 0), 0);
  /** does the load split into trucks that are each between HQ's minimum and the maximum? */
  const trucksFit = (q: Record<string, number>, trucks: number) =>
    splitIntoTrucks(Object.fromEntries(ids.map((id) => [id, q[id] * pal[id]])), splitSkus, trucks, CAP).every(
      (t) => t.places >= minFill * CAP - EPS && t.places <= maxPlaces + EPS
    );
  // past the end of the demand data a product sells as in its last month (as the workbook holds it flat)
  const lastMonth = Object.fromEntries(ids.map((id) => [id, Object.keys(input.demand[id] ?? {}).sort().at(-1) ?? ""]));
  const d = (id: string, m: string) => input.demand[id]?.[m] ?? (lastMonth[id] && m > lastMonth[id] ? input.demand[id][lastMonth[id]] : 0);
  const sumD = (id: string, from: string, to: string) => {
    let t = 0;
    for (let m = from; m <= to; m = addMonths(m, 1)) t += d(id, m);
    return t;
  };
  const ibpFixed = (m: string) => m <= input.frozenThrough;
  const onlyIbp = (m: string) => m > input.extraThrough && m <= input.frozenThrough;

  const loads: { sellMonth: string; units: Record<string, number> }[] = input.known.map((k) => ({ sellMonth: k.sellMonth, units: k.units }));
  const arriving = (id: string, from: string, to: string) =>
    loads.reduce((t, l) => (l.sellMonth >= from && l.sellMonth <= to ? t + (l.units[id] ?? 0) : t), 0);

  const stock: OrderPlan["stock"] = Object.fromEntries(ids.map((id) => [id, {}]));
  const cover: OrderPlan["cover"] = Object.fromEntries(ids.map((id) => [id, {}]));
  const lost: OrderPlan["lost"] = Object.fromEntries(ids.map((id) => [id, {}]));
  const E: Record<string, number> = Object.fromEntries(ids.map((id) => [id, input.stockEnd[id] ?? 0]));
  let month = input.stockMonth;
  const advanceTo = (target: string) => {
    while (month < target) {
      month = addMonths(month, 1);
      for (const id of ids) {
        const e = E[id] + arriving(id, month, month) - d(id, month);
        lost[id][month] = Math.max(0, -e);
        E[id] = Math.max(0, e);
        stock[id][month] = E[id];
        cover[id][month] = E[id] / Math.max(1, d(id, addMonths(month, 1)));
      }
    }
  };

  const open = Object.fromEntries(ids.map((id) => [id, input.open[id] ?? 0]));
  const planned: PlannedLoad[] = [];
  for (const k of input.shipMonths) {
    advanceTo(k); // E = stock at the end of ship month k
    const a = input.sellMonthOf(k);
    const isOnlyIbp = onlyIbp(k);
    const fixed = Object.fromEntries(ids.map((id) => [id, ibpFixed(k) ? input.ibpEntered[k]?.[id] ?? 0 : 0]));
    const pending = (id: string, to: string) => arriving(id, addMonths(k, 1), to);
    const next = addMonths(k, 1);
    const need = Object.fromEntries(
      ids.map((id) => {
        if (isOnlyIbp) return [id, 0];
        let n = input.targetOf(k) * d(id, addMonths(a, 1)) + sumD(id, next, a) - E[id] - pending(id, a);
        if (onlyIbp(next)) {
          // the next load cannot grow: carry the stock to the end of its sell month
          const a2 = input.sellMonthOf(next);
          const nextLoad = input.ibpEntered[next]?.[id] ?? 0;
          n = Math.max(n, input.targetOf(k) * d(id, addMonths(a2, 1)) + sumD(id, next, a2) - E[id] - pending(id, a2) - nextLoad);
        }
        return [id, Math.max(0, n)];
      })
    );
    // a take-only-the-IBP month takes what is entered; any other month what it needs (at least what is entered)
    let p = Object.fromEntries(ids.map((id) => [id, Math.max(0, Math.ceil((isOnlyIbp ? fixed[id] : Math.max(fixed[id], need[id])) / pal[id] - 1e-9))]));
    const total = placesOf(p);
    const coverAfter = (id: string, pallets: number) =>
      (E[id] + pending(id, a) + pallets * pal[id] - sumD(id, next, a)) / Math.max(1, d(id, addMonths(a, 1)));
    const trimmable = Object.fromEntries(
      ids.map((id) => [id, p[id] >= 1 && (p[id] - 1) * pal[id] >= fixed[id] && coverAfter(id, p[id] - 1) >= danger])
    );
    const full = Math.floor(total / U + EPS);
    const spill = total - full * U;
    const cov = Object.fromEntries(ids.map((id, i) => [id, coverAfter(id, p[id]) + (i + 1) / 1e6]));
    // a small spill: one pallet off each product with the most stock that can spare it, until it fits
    const trimmed = () => {
      const q = { ...p };
      for (const id of ids.filter((x) => trimmable[x]).sort((x, y) => cov[y] - cov[x])) {
        if (placesOf(q) <= full * U + EPS) break;
        q[id] -= 1;
      }
      return placesOf(q) <= full * U + EPS ? q : null;
    };
    let trucks = total < EPS ? 0 : Math.ceil(total / U - EPS);
    if (!isOnlyIbp && full >= 1 && spill < U * spillShare) {
      const q = spill < EPS ? p : trimmed();
      if (q) { p = q; trucks = full; }
    }
    const cap = input.maxTrucksOf?.(k);
    if (cap !== undefined && trucks > cap) {
      // over the cap: take pallets off the products with the most stock until the load fits
      trucks = cap;
      while (placesOf(p) > trucks * U + EPS) {
        const id = ids.filter((x) => p[x] >= 1 && p[x] * pal[x] > fixed[x]).sort((x, y) => coverAfter(y, p[y]) - coverAfter(x, p[x]))[0];
        if (!id) break;
        p[id] -= 1;
      }
    }
    const room = trucks * U - placesOf(p);
    if (room > EPS) {
      // fill the last truck: the spare space shared by next month's sales, the rest one pallet at a time to the least stock
      const sw = Object.fromEntries(ids.map((id) => [id, d(id, next) / pal[id]]));
      const ws = ids.reduce((t, id) => t + sw[id], 0) || 1;
      for (const id of ids) p[id] += Math.floor((room * sw[id]) / ws / w[id] + EPS);
      const order = [...ids].sort((x, y) => cov[x] - cov[y]);
      for (let added = true; added; ) {
        added = false;
        for (const id of order) if (trucks * U - placesOf(p) >= w[id] - EPS) { p[id] += 1; added = true; }
      }
    }
    // still under HQ's minimum (pallets come in fixed sizes): swap a small pallet for a bigger one
    // — the bigger product with the least stock in, the smaller one with the most stock out — while it fits
    for (let guard = 0; trucks > 0 && placesOf(p) < trucks * L - EPS && guard < 20; guard++) {
      const room2 = trucks * U - placesOf(p);
      let best: [string, string] | null = null;
      for (const x of [...ids].sort((u, v) => coverAfter(u, p[u]) - coverAfter(v, p[v]))) {
        const y = ids
          .filter((z) => w[z] < w[x] - EPS && w[x] - w[z] <= room2 + EPS && p[z] >= 1 && (p[z] - 1) * pal[z] >= fixed[z])
          .sort((u, v) => coverAfter(v, p[v]) - coverAfter(u, p[u]))[0];
        if (y) { best = [x, y]; break; }
      }
      if (!best) break;
      p[best[0]] += 1;
      p[best[1]] -= 1;
    }
    // every truck on its own must reach the minimum: with 0.8 and 1.2 place pallets a truck
    // reaches 32.4 only with an odd number of the bigger ones, so each truck needs at least one —
    // where there are too few, the same space in bigger pallets (3 × 0.8 → 2 × 1.2), least stock in
    for (let guard = 0; trucks > 0 && guard < 20 && bigCount(p) < bigPerTruck * trucks; guard++) {
      const x = ids.filter((id) => w[id] > smallW + EPS && pal[id] > 0).sort((u, v) => coverAfter(u, p[u]) - coverAfter(v, p[v]))[0];
      if (!x) break;
      const g = placeStep([smallW, w[x]]);
      const nIn = Math.round(smallW / g);
      const nOut = Math.round(w[x] / g);
      const q = { ...p, [x]: p[x] + nIn };
      let left = nOut;
      for (const y of ids.filter((z) => Math.abs(w[z] - smallW) < EPS).sort((u, v) => coverAfter(v, q[v]) - coverAfter(u, q[u]))) {
        while (left > 0 && q[y] >= 1 && (q[y] - 1) * pal[y] >= fixed[y]) { q[y] -= 1; left -= 1; }
        if (left === 0) break;
      }
      if (left > 0) break;
      p = q;
    }
    const units = Object.fromEntries(ids.map((id) => [id, p[id] * pal[id]]));
    const fromOpen = Object.fromEntries(ids.map((id) => [id, Math.min(open[id], Math.max(0, units[id] - fixed[id]))]));
    for (const id of ids) open[id] -= fromOpen[id];
    loads.push({ sellMonth: a, units });
    planned.push({
      shipMonth: k,
      sellMonth: a,
      onlyIbp: isOnlyIbp,
      units,
      pallets: ids.reduce((t, id) => t + p[id], 0),
      trucks,
      places: placesOf(p),
      fill: trucks ? placesOf(p) / (trucks * CAP) : 0,
      // under HQ's minimum as a load, or some truck of it on its own
      underFilled: trucks > 0 && (placesOf(p) < minFill * trucks * CAP - EPS || !trucksFit(p, trucks)),
      fromIbp: fixed,
      fromOpen,
      extra: Object.fromEntries(ids.map((id) => [id, units[id] - fixed[id] - fromOpen[id]])),
      ibpToEnter: Object.fromEntries(ids.map((id) => [id, units[id] - fromOpen[id]])),
      eur: input.skus.reduce((t, s) => t + units[s.id] * s.priceEur, 0),
    });
  }
  // run the stock on to the last sell month
  const lastSell = loads.reduce((m, l) => (l.sellMonth > m ? l.sellMonth : m), month);
  advanceTo(lastSell);
  return { loads: planned, stock, cover, lost, openLeft: open };
}
