// Pure supply-planning math: order-slot clock, stock projection ledger,
// months-of-cover, order recommendations and truck fill. No DB imports —
// unit-testable like the P&L engine.

export interface PlanningSkuIn {
  id: string;
  article: string;
  name: string; // display name (short)
  productId: string | null;
  pcsPerCarton: number;
  pcsPerLayer: number;
  pcsPerPallet: number;
  grossKgPerUnit: number;
  priceEur: number;
  active: boolean;
  /** committed to DMK, not yet delivered — LIVE backlog: the synced IBP
   *  "Open Orders" minus every shipment created since the sync. Pickable
   *  right away; no production lead applies. */
  openOrderQty: number;
}

/** Per-SKU inputs assembled by the server loader. */
export interface SkuSituation {
  skuId: string;
  currentStock: number; // units, as of stockAsOf
  stockAsOf: string | null; // monthKey the stock figure stands at (to date, in the current month)
  /** units already sold in the stock month: the stock figure is net of them,
   *  so that month's demand only counts what is still to be sold */
  soldToDate?: { monthKey: string; qty: number };
  forecast: Record<string, number>; // monthKey -> manual forecast qty (IBP Partner Forecast)
  model?: Record<string, number>; // monthKey -> cohort-model demand (advisory + fallback)
  actualSales: Record<string, number>; // monthKey -> actual sold qty (promo folded in)
  arrivals: Record<string, number>; // monthKey -> committed purchase qty landing
}

export interface PlanningSettings {
  minCoverMonths: number; // hard floor, owner policy = 4
  truckPallets: number; // nominal pallet capacity of one truck
  truckMaxKg: number; // nominal gross-weight capacity
  productionLeadMonths: number; // order -> ship, 4
  orderDeadlineDay: number; // 20th
}

export const DEFAULT_SETTINGS: PlanningSettings = {
  minCoverMonths: 4,
  truckPallets: 33,
  truckMaxKg: 21_500,
  productionLeadMonths: 4,
  orderDeadlineDay: 20,
};

// ── month-key arithmetic ("2026-09") ─────────────────────────────
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export const monthKeyOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** The next order slot as of `today`: order by the deadline day, ships
 *  +productionLeadMonths, sellable the month after shipping. */
export interface OrderSlot {
  deadline: string; // ISO date of the deadline
  daysLeft: number;
  orderMonth: string; // month the decision belongs to
  shipMonth: string;
  arrivalMonth: string;
}

export function nextOrderSlot(today: Date, s: PlanningSettings = DEFAULT_SETTINGS): OrderSlot {
  const thisMonth = monthKeyOf(today);
  const orderMonth = today.getDate() <= s.orderDeadlineDay ? thisMonth : addMonths(thisMonth, 1);
  const [y, m] = orderMonth.split("-").map(Number);
  const deadline = new Date(y, m - 1, s.orderDeadlineDay);
  const daysLeft = Math.max(0, Math.ceil((deadline.getTime() - today.getTime()) / 86_400_000));
  const shipMonth = addMonths(orderMonth, s.productionLeadMonths);
  // format in local time — toISOString would shift the date west of UTC+0
  const deadlineStr = `${orderMonth}-${String(s.orderDeadlineDay).padStart(2, "0")}`;
  return { deadline: deadlineStr, daysLeft, orderMonth, shipMonth, arrivalMonth: addMonths(shipMonth, 1) };
}

// ── open orders ──────────────────────────────────────────────────
// cumulative Open Orders start here — the owner confirmed 2025 nets to zero
export const BACKLOG_EPOCH = "2026-01";

/**
 * The month a truck's load and pickup count in: its ship month when set (an
 * order dispatched in a later month, e.g. October's order leaving on 3 Nov),
 * else its dispatch month, else its month.
 */
export function truckShipMonth(t: { shipMonth?: string | null; dispatchMonth?: string | null; monthId: string }): string {
  return t.shipMonth || t.dispatchMonth || t.monthId;
}

/**
 * Open Orders at the end of `month` — ONE rule for every month (the owner's
 * ruling): everything ordered (committed purchases by ship month) minus
 * everything collected (pickups by ship month — see truckShipMonth) since the
 * epoch. Positive = ordered but not collected; negative = collected beyond orders.
 */
export function openOrdersAt(
  purchases: Record<string, number> | undefined,
  pickups: Record<string, number> | undefined,
  month: string
): number {
  let cum = 0;
  for (let t = BACKLOG_EPOCH; t <= month; t = addMonths(t, 1)) {
    cum += purchases?.[t] ?? 0;
    cum -= pickups?.[t] ?? 0;
  }
  return cum;
}

// ── demand: forecast first, run-rate fallback ────────────────────
/** Average of the last `n` months of actual sales strictly before `fromMonth`. */
export function runRate(actual: Record<string, number>, fromMonth: string, n = 3): number {
  const keys = Object.keys(actual)
    .filter((k) => k < fromMonth && actual[k] > 0)
    .sort()
    .slice(-n);
  if (keys.length === 0) return 0;
  return keys.reduce((s, k) => s + actual[k], 0) / keys.length;
}

/** Demand for one month: explicit forecast wins; else the cohort model; else run-rate. */
export function demandFor(sit: SkuSituation, monthKey: string, fallback: number): { qty: number; fromForecast: boolean } {
  const f = sit.forecast[monthKey];
  if (f !== undefined && f > 0) return { qty: f, fromForecast: true };
  const m = sit.model?.[monthKey];
  if (m !== undefined && m > 0) return { qty: m, fromForecast: false };
  return { qty: fallback, fromForecast: false };
}

// ── projection ledger ────────────────────────────────────────────
export interface LedgerCell {
  monthKey: string;
  demand: number;
  fromForecast: boolean;
  arrivals: number;
  closing: number; // projected end-of-month stock
  coverMonths: number; // forward months of demand the closing stock covers
}

export interface SkuProjection {
  skuId: string;
  currentStock: number;
  stockAsOf: string | null;
  runRatePerMonth: number;
  avgDemandPerMonth: number;
  cells: LedgerCell[];
  currentCover: number; // cover of today's stock, months
  stockoutMonth: string | null; // first month projected below zero
  riskMonth: string | null; // first month cover < minCover
}

/** Cover of `stock` looking forward from (exclusive) `fromMonth`; `share` is
 *  how much of a month is still ahead (below 1 only for the month in progress). */
function coverOf(
  stock: number,
  months: string[],
  demandOf: (m: string) => number,
  share: (m: string) => number = () => 1
): number {
  if (stock <= 0) return 0;
  let remaining = stock;
  let cover = 0;
  for (const m of months) {
    const d = demandOf(m);
    if (d <= 0) {
      cover += share(m); // a zero-demand month is a free month of cover
      if (cover >= 24) return 24;
      continue;
    }
    if (remaining >= d) {
      remaining -= d;
      cover += share(m);
    } else {
      cover += share(m) * Math.max(0, remaining / d);
      return cover;
    }
    if (cover >= 24) return 24;
  }
  return cover; // ran out of horizon — at least this many
}

export function projectSku(
  sit: SkuSituation,
  startMonth: string,
  horizonMonths: number,
  settings: PlanningSettings = DEFAULT_SETTINGS
): SkuProjection {
  const rr = runRate(sit.actualSales, startMonth);
  const months = Array.from({ length: horizonMonths }, (_, i) => addMonths(startMonth, i));
  // demand still to come: the stock month's sales so far are already out of stock
  const sold = sit.soldToDate;
  const demandOf = (m: string) => {
    const d = demandFor(sit, m, rr).qty;
    return sold && m === sold.monthKey ? Math.max(0, d - sold.qty) : d;
  };
  // the month in progress counts for the part of its demand still to come
  const share = (m: string) => {
    if (!sold || m !== sold.monthKey) return 1;
    const full = demandFor(sit, m, rr).qty;
    return full > 0 ? Math.max(0, full - sold.qty) / full : 1;
  };

  const cells: LedgerCell[] = [];
  let stock = sit.currentStock;
  let stockoutMonth: string | null = null;
  let riskMonth: string | null = null;

  for (const [i, m] of months.entries()) {
    const { fromForecast } = demandFor(sit, m, rr);
    const demand = demandOf(m);
    const arrivals = sit.arrivals[m] ?? 0;
    stock = stock + arrivals - demand;
    const forward = months.slice(i + 1);
    const coverMonths = coverOf(Math.max(0, stock), forward, demandOf);
    if (stock < 0 && !stockoutMonth) stockoutMonth = m;
    if (coverMonths < settings.minCoverMonths && !riskMonth) riskMonth = m;
    cells.push({ monthKey: m, demand, fromForecast, arrivals, closing: stock, coverMonths });
  }

  // the average is a monthly rate: a part-month left over would understate it
  const demands = cells.filter((c) => c.monthKey !== sold?.monthKey).map((c) => c.demand).filter((d) => d > 0);
  const avg = demands.length > 0 ? demands.reduce((s, d) => s + d, 0) / demands.length : 0;
  return {
    skuId: sit.skuId,
    currentStock: sit.currentStock,
    stockAsOf: sit.stockAsOf,
    runRatePerMonth: rr,
    avgDemandPerMonth: avg,
    cells,
    currentCover: coverOf(sit.currentStock, months, demandOf, share),
    stockoutMonth,
    riskMonth,
  };
}

// ── order recommendation ─────────────────────────────────────────
/**
 * Recommended quantity for the next slot: enough that, after the order lands
 * in `arrivalMonth`, stock covers demand until the next possible arrival
 * (1 month later) plus the safety floor. Rounded UP to full cartons.
 */
export function recommendQty(
  proj: SkuProjection,
  sku: PlanningSkuIn,
  arrivalMonth: string,
  settings: PlanningSettings = DEFAULT_SETTINGS
): number {
  const before = proj.cells.find((c) => c.monthKey === addMonths(arrivalMonth, -1));
  const projectedAtArrival = before ? Math.max(0, before.closing) : proj.currentStock;
  const arrivalsAlready = proj.cells.find((c) => c.monthKey === arrivalMonth)?.arrivals ?? 0;
  // demand over arrival month + (minCover) further months
  const horizon = Array.from({ length: settings.minCoverMonths + 1 }, (_, i) => addMonths(arrivalMonth, i));
  const rr = proj.runRatePerMonth;
  const need = horizon.reduce((s, m) => {
    const cell = proj.cells.find((c) => c.monthKey === m);
    return s + (cell ? cell.demand : rr);
  }, 0);
  const raw = need - projectedAtArrival - arrivalsAlready;
  if (raw <= 0) return 0;
  const carton = sku.pcsPerCarton > 0 ? sku.pcsPerCarton : 1;
  return Math.ceil(raw / carton) * carton;
}

// ── truck math ───────────────────────────────────────────────────
export interface TruckLine {
  skuId: string;
  qty: number;
}

export interface TruckStats {
  totalUnits: number;
  cartons: number;
  pallets: number;
  grossKg: number;
  eurTotal: number;
  utilization: number; // max of pallet share and weight share
  binding: "pallets" | "weight";
}

export function truckStats(
  lines: TruckLine[],
  skusById: Record<string, PlanningSkuIn>,
  settings: PlanningSettings = DEFAULT_SETTINGS
): TruckStats {
  let totalUnits = 0, cartons = 0, pallets = 0, grossKg = 0, eurTotal = 0;
  for (const l of lines) {
    const sku = skusById[l.skuId];
    if (!sku || l.qty <= 0) continue;
    totalUnits += l.qty;
    if (sku.pcsPerCarton > 0) cartons += l.qty / sku.pcsPerCarton;
    if (sku.pcsPerPallet > 0) pallets += l.qty / sku.pcsPerPallet;
    grossKg += l.qty * sku.grossKgPerUnit;
    eurTotal += l.qty * sku.priceEur;
  }
  const palletShare = settings.truckPallets > 0 ? pallets / settings.truckPallets : 0;
  const weightShare = settings.truckMaxKg > 0 ? grossKg / settings.truckMaxKg : 0;
  return {
    totalUnits,
    cartons,
    pallets,
    grossKg,
    eurTotal,
    utilization: Math.max(palletShare, weightShare),
    binding: palletShare >= weightShare ? "pallets" : "weight",
  };
}

/** Units of one SKU that fit in one pallet (for top-up suggestion chips). */
export const unitsPerPallet = (sku: PlanningSkuIn): number =>
  sku.pcsPerPallet > 0 ? sku.pcsPerPallet : sku.pcsPerCarton > 0 ? sku.pcsPerCarton * 10 : 0;
