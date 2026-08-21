// Assembles the per-SKU demand model: Platin SKUs get calibrated cohort
// demand split by pack size; Expert/specialty SKUs (stable, inelastic per the
// data) get their run-rate; items with no history fall back to the manual
// forecast alone.
import { addMonths, runRate } from "./compute";
import {
  calibrate,
  packSplit,
  stageDemand,
  type CohortParams,
  type Stage,
  type StageCalibration,
} from "./cohort";

export interface ModelSkuIn {
  id: string;
  name: string;
}

export function stageOf(name: string): Stage | null {
  const m = name.match(/Platin\s*([123])/i);
  return m ? (`P${m[1]}` as Stage) : null;
}

export interface DemandModelResult {
  /** skuId -> monthKey -> modeled demand (units) */
  series: Record<string, Record<string, number>>;
  calibrations: Record<Stage, StageCalibration>;
  /** skuId -> its share within its stage */
  splits: Record<string, number>;
  stageBySku: Record<string, Stage | null>;
  lastCompleteMonth: string;
}

export function buildDemandModel(
  skus: ModelSkuIn[],
  actualSales: Record<string, Record<string, number>>, // skuId -> monthKey -> qty
  recruitment: Record<string, number>,
  startMonth: string, // first projection month (current month)
  horizonMonths: number,
  params: CohortParams
): DemandModelResult {
  const lastCompleteMonth = addMonths(startMonth, -1);
  const months = Array.from({ length: horizonMonths + 1 }, (_, i) => addMonths(startMonth, i - 1));

  const stageBySku: Record<string, Stage | null> = {};
  for (const s of skus) stageBySku[s.id] = stageOf(s.name);

  // stage-level actuals (all pack sizes together, returns clamped at 0)
  const stageActuals: Record<Stage, Record<string, number>> = { P1: {}, P2: {}, P3: {} };
  for (const s of skus) {
    const st = stageBySku[s.id];
    if (!st) continue;
    for (const [m, q] of Object.entries(actualSales[s.id] ?? {})) {
      stageActuals[st][m] = (stageActuals[st][m] ?? 0) + Math.max(0, q);
    }
  }

  const calibrations = {
    P1: calibrate("P1", stageActuals.P1, recruitment, lastCompleteMonth, params),
    P2: calibrate("P2", stageActuals.P2, recruitment, lastCompleteMonth, params),
    P3: calibrate("P3", stageActuals.P3, recruitment, lastCompleteMonth, params),
  } as Record<Stage, StageCalibration>;

  // pack-size split inside each stage from recent actuals
  const splits: Record<string, number> = {};
  for (const st of ["P1", "P2", "P3"] as Stage[]) {
    const members = skus.filter((s) => stageBySku[s.id] === st).map((s) => s.id);
    Object.assign(splits, packSplit(members, actualSales, lastCompleteMonth));
  }

  const series: Record<string, Record<string, number>> = {};
  for (const s of skus) {
    const st = stageBySku[s.id];
    const out: Record<string, number> = {};
    if (st) {
      for (const m of months) {
        out[m] = stageDemand(st, m, recruitment, calibrations[st], params) * (splits[s.id] ?? 0);
      }
    } else {
      // specialty / planning-only: steady run-rate (0 when no history)
      const rr = runRate(actualSales[s.id] ?? {}, startMonth);
      for (const m of months) out[m] = rr;
    }
    series[s.id] = out;
  }

  return { series, calibrations, splits, stageBySku, lastCompleteMonth };
}
