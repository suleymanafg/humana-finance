// Supply planning as estimate and actual, per product: what the plan expected
// for a month — sales, month-end stock, trucks arriving, collected from DMK —
// next to what the books say once the month is closed. The estimate is kept at
// the start of each month (when the month before closes, `estimates.ts`); for
// months before the first kept one, sales are compared with the stage engine
// run in hindsight (today's model on that month's prescriptions). Pure — no DB.
import { addMonths } from "./compute";
import type { PlanData } from "./plan-data";

export const PLAN_MEASURES = ["sold", "stockEnd", "arrivals", "pickups"] as const;
export type PlanMeasure = (typeof PLAN_MEASURES)[number];

/** The plan's estimate as it stood at the start of a month, per SKU, for that month and the ones after. */
export interface PlanEstimate {
  monthId: string;
  takenAt: string;
  takenBy: string;
  months: string[];
  /** sku -> measure -> one figure per month; "demand" = before what runs short */
  values: Record<string, Partial<Record<PlanMeasure | "demand", (number | null)[]>>>;
}

export function planEstimateFrom(p: PlanData, meta: { monthId: string; takenAt: string; takenBy: string }, monthsAhead = 12): PlanEstimate {
  const months = Array.from({ length: monthsAhead }, (_, i) => addMonths(meta.monthId, i));
  const values: PlanEstimate["values"] = {};
  for (const s of p.skus) {
    const id = s.id;
    const at = (f: (m: string) => number | null) => months.map(f);
    values[id] = {
      demand: at((m) => p.engine.demand[id]?.[m] ?? null),
      sold: at((m) => (p.engine.demand[id]?.[m] == null ? null : Math.max(0, p.engine.demand[id][m] - (p.plan.lost[id]?.[m] ?? 0)))),
      stockEnd: at((m) => (m === p.thisMonth ? p.stockEndThisMonth[id] ?? null : p.plan.stock[id]?.[m] ?? null)),
      arrivals: at((m) =>
        p.pipeline.filter((t) => t.sellMonth === m).reduce((a, t) => a + (t.units[id] ?? 0), 0) +
        p.plan.loads.filter((l) => l.sellMonth === m).reduce((a, l) => a + (l.units[id] ?? 0), 0)
      ),
      pickups: at((m) =>
        p.pipeline.filter((t) => t.shipMonth === m).reduce((a, t) => a + (t.units[id] ?? 0), 0) +
        p.plan.loads.filter((l) => l.shipMonth === m).reduce((a, l) => a + (l.units[id] ?? 0), 0)
      ),
    };
  }
  return { ...meta, months, values };
}

/** Which estimate a month is compared with: the one kept at its start, an earlier one, or (sales only) the model in hindsight. */
export type PlanEstimateSource = { kind: "start"; est: PlanEstimate } | { kind: "earlier"; est: PlanEstimate } | { kind: "hindsight" };

export function planEstimateSourceFor(monthId: string, estimates: PlanEstimate[]): PlanEstimateSource {
  const own = estimates.find((e) => e.monthId === monthId);
  if (own) return { kind: "start", est: own };
  const earlier = estimates.filter((e) => e.monthId < monthId && e.months.includes(monthId)).sort((a, b) => b.monthId.localeCompare(a.monthId))[0];
  return earlier ? { kind: "earlier", est: earlier } : { kind: "hindsight" };
}

/** The stage engine's figure for a product in a month, with today's levels — the model in hindsight. */
export function hindsightOf(p: PlanData, skuId: string, m: string): number | null {
  const s = p.skus.find((x) => x.id === skuId);
  if (!s) return null;
  if (s.stage === null) return p.engine.expertLevel[skuId]?.level ?? null;
  const f = p.engine.stageForecast[s.stage]?.[m];
  if (f == null) return null;
  const share = p.engine.share800[s.stage];
  return f * (s.size800 ? share : 1 - share);
}

export interface ReviewCell {
  est: number | null;
  act: number | null;
}

/** The actual of a closed month from the books. */
export function actualOf(p: PlanData, skuId: string, measure: PlanMeasure, m: string): number | null {
  if (m > p.lastClosed) return null;
  if (measure === "sold") return p.engine.demand[skuId]?.[m] ?? null;
  if (measure === "stockEnd") return p.actual.stockEnd[skuId]?.[m] ?? null;
  if (measure === "arrivals") return p.actual.arrived[skuId]?.[m] ?? 0;
  return p.actual.pickedUp[skuId]?.[m] ?? 0;
}

/** What a month was estimated at, from its source (hindsight covers sales only). */
export function estimateOf(p: PlanData, src: PlanEstimateSource, skuId: string, measure: PlanMeasure, m: string): number | null {
  if (src.kind === "hindsight") return measure === "sold" ? hindsightOf(p, skuId, m) : null;
  const i = src.est.months.indexOf(m);
  return i >= 0 ? src.est.values[skuId]?.[measure]?.[i] ?? null : null;
}

/** One closed month, product by product: each measure's estimate and actual. */
export function reviewMonth(p: PlanData, m: string, estimates: PlanEstimate[]) {
  const src = planEstimateSourceFor(m, estimates);
  const rows = p.skus.map((s) => ({
    id: s.id,
    cells: Object.fromEntries(PLAN_MEASURES.map((k) => [k, { est: estimateOf(p, src, s.id, k, m), act: actualOf(p, s.id, k, m) }])) as Record<PlanMeasure, ReviewCell>,
  }));
  return { month: m, source: src.kind, sourceMonth: src.kind === "hindsight" ? null : src.est.monthId, takenAt: src.kind === "hindsight" ? null : src.est.takenAt, rows };
}
