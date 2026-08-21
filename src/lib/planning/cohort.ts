// Medical-cohort demand model — the deck's retention arithmetic, made
// continuous. Each verified prescription recruits one baby; the baby consumes
// Platin 1 while 0-5 months into the programme, Platin 2 at 6-11, Platin 3 at
// 12-17 (fading), buying ~3 packs a month while retained. Retention absorbs
// everything we cannot model — breastfeeding returns, brand switches,
// tolerance — exactly as the budget deck computes it (July: 24,008 packs /
// 18,169 babies-in-window = 1.32 packs/baby ≈ 44% of the 3-pack ideal).
//
// The raw cohort output is then CALIBRATED per stage against recent actual
// sell-in, so the model inherits the true level (non-medical base demand,
// channel stocking) while contributing what history alone cannot see: the
// stage waves that follow the recruitment ramp.
import { addMonths } from "./compute";

export interface CohortParams {
  packsPerBaby: number; // packs/month a retained baby consumes (deck: ~3)
  retention1: number; // share of recruited babies active in stage 1 (0-5 mo)
  retention2: number; // share active in stage 2 (6-11 mo)
  retention3: number; // share entering stage 3 (12+)
  stage3FadePerMonth: number; // multiplicative fade during stage 3
  recruitmentAhead: number; // babies/month assumed for months after the data ends
}

export const DEFAULT_COHORT: CohortParams = {
  packsPerBaby: 3,
  retention1: 0.44, // deck's July estimate; calibration scales observed intensity
  // Conservative defaults for the unobserved stages: P1's OBSERVED per-baby
  // intensity is ~0.65 packs (0.44 × 3 × calibration ≈ 0.49), and stage
  // change loses switchers, breastfeeding returns and solid-food dilution —
  // so stage 2 assumes ~0.6 packs/baby, stage 3 ~0.3 fading. The scenario
  // page exists to test more optimistic retention.
  retention2: 0.2,
  retention3: 0.1,
  stage3FadePerMonth: 0.85,
  recruitmentAhead: 0, // 0 = hold the trailing-3-month average
}

export type Stage = "P1" | "P2" | "P3";

const STAGE_WINDOW: Record<Stage, [number, number]> = {
  P1: [0, 5],
  P2: [6, 11],
  P3: [12, 17],
};

/** Effective retained share for a cohort of age `a` months. */
export function retentionAt(a: number, p: CohortParams): number {
  if (a <= 5) return p.retention1;
  if (a <= 11) return p.retention2;
  if (a <= 17) return p.retention3 * Math.pow(p.stage3FadePerMonth, a - 12);
  return 0;
}

/** Recruitment for a month: recorded value, else the forward assumption. */
export function recruitmentFor(
  recruitment: Record<string, number>,
  monthKey: string,
  p: CohortParams
): number {
  if (recruitment[monthKey] !== undefined) return recruitment[monthKey];
  const keys = Object.keys(recruitment).sort();
  const last = keys.at(-1);
  if (!last || monthKey < last) return 0; // before the programme started
  if (p.recruitmentAhead > 0) return p.recruitmentAhead;
  const tail = keys.slice(-3);
  return tail.reduce((s, k) => s + recruitment[k], 0) / Math.max(1, tail.length);
}

/** Raw cohort packs for one stage in one month (before calibration). */
export function rawStageDemand(
  stage: Stage,
  monthKey: string,
  recruitment: Record<string, number>,
  p: CohortParams
): number {
  const [from, to] = STAGE_WINDOW[stage];
  let packs = 0;
  for (let a = from; a <= to; a++) {
    const born = addMonths(monthKey, -a);
    packs += recruitmentFor(recruitment, born, p) * retentionAt(a, p) * p.packsPerBaby;
  }
  return packs;
}

export interface StageCalibration {
  stage: Stage;
  /** additive non-medical base demand, units/month (≥ 0) */
  basePerMonth: number;
  /** multiplicative scale on the raw cohort wave (≤ 1) */
  scale: number;
  recentActualPerMonth: number;
  recentModelPerMonth: number;
}

/**
 * Calibrate each stage on the last `n` complete months of actual sell-in.
 * Hybrid identification — the only defensible one with aggregate data:
 * - raw cohort ≥ actual (programme dominates, or params overstate): scale
 *   the wave down multiplicatively, base = 0.  (P1 today.)
 * - raw cohort < actual (base market demand predates the programme): keep the
 *   wave at full size and add the residual as constant base demand — a pure
 *   multiplier here would insanely amplify the future wave.  (P2/P3 today.)
 */
export function calibrate(
  stage: Stage,
  actualByMonth: Record<string, number>, // stage sell-in per month (all pack sizes)
  recruitment: Record<string, number>,
  lastCompleteMonth: string,
  p: CohortParams,
  n = 3
): StageCalibration {
  const months = Array.from({ length: n }, (_, i) => addMonths(lastCompleteMonth, -i));
  const used = months.filter((m) => (actualByMonth[m] ?? 0) > 0);
  const actual = used.reduce((s, m) => s + actualByMonth[m], 0);
  const model = used.reduce((s, m) => s + rawStageDemand(stage, m, recruitment, p), 0);
  const k = used.length;
  if (k === 0) {
    return { stage, basePerMonth: 0, scale: 1, recentActualPerMonth: 0, recentModelPerMonth: 0 };
  }
  const scale = model > actual && model > 0 ? actual / model : 1;
  const basePerMonth = model >= actual ? 0 : (actual - model) / k;
  return {
    stage,
    basePerMonth,
    scale,
    recentActualPerMonth: actual / k,
    recentModelPerMonth: model / k,
  };
}

/** Calibrated stage demand for any month: base + scaled cohort wave. */
export const stageDemand = (
  stage: Stage,
  monthKey: string,
  recruitment: Record<string, number>,
  cal: StageCalibration,
  p: CohortParams
): number =>
  Math.max(0, cal.basePerMonth + rawStageDemand(stage, monthKey, recruitment, p) * cal.scale);

/**
 * Split one stage's demand across its pack sizes using recent actual shares
 * (e.g. P1 -> 400g 76% / 800g 24%). `skuActuals` maps skuId -> monthly sell-in.
 */
export function packSplit(
  skuIds: string[],
  skuActuals: Record<string, Record<string, number>>,
  lastCompleteMonth: string,
  n = 3
): Record<string, number> {
  const months = Array.from({ length: n }, (_, i) => addMonths(lastCompleteMonth, -i));
  const totals = skuIds.map((id) => ({
    id,
    qty: months.reduce((s, m) => s + Math.max(0, skuActuals[id]?.[m] ?? 0), 0),
  }));
  const sum = totals.reduce((s, t) => s + t.qty, 0);
  if (sum <= 0) {
    const even = 1 / Math.max(1, skuIds.length);
    return Object.fromEntries(skuIds.map((id) => [id, even]));
  }
  return Object.fromEntries(totals.map((t) => [t.id, t.qty / sum]));
}
