// Whether prescriptions pay off in a territory (or for a rep): the period
// against the one before it. Good only when sales grow AND the tins sold per
// prescription grow — sales rising slower than prescriptions is growth bought
// at a higher price, and prescriptions paid for without sales growing is spend
// without return. Shared by the medical page and the reps' reports.

export interface Totals {
  tins: number;
  foils: number;
  /** UZS paid for the foils */
  paid: number;
}

export type Verdict = "good" | "costly" | "noReturn" | "noRx";

export interface Effect {
  now: Totals;
  before: Totals;
  /** sales now against before (0.12 = +12%); null — nothing sold before */
  salesChange: number | null;
  /** tins sold per prescription */
  perRx: number | null;
  perRxBefore: number | null;
  /** UZS paid per tin sold */
  costPerTin: number | null;
  verdict: Verdict;
}

/** below this a change in sales is noise */
export const FLAT = 0.05;

export function effectOf(now: Totals, before: Totals): Effect {
  const salesChange = before.tins > 0 ? now.tins / before.tins - 1 : null;
  const perRx = now.foils > 0 ? now.tins / now.foils : null;
  const perRxBefore = before.foils > 0 ? before.tins / before.foils : null;
  const costPerTin = now.tins > 0 && now.paid > 0 ? now.paid / now.tins : null;
  const growing = salesChange == null ? now.tins > 0 : salesChange > FLAT;
  let verdict: Verdict;
  if (now.foils <= 0) verdict = "noRx";
  else if (growing) verdict = perRxBefore == null || (perRx ?? 0) >= perRxBefore ? "good" : "costly";
  else verdict = "noReturn";
  return { now, before, salesChange, perRx, perRxBefore, costPerTin, verdict };
}

export const VERDICTS: Record<Verdict, { ru: string; en: string; whyRu: string; whyEn: string; tone: "ok" | "warn" | "danger" | "muted" }> = {
  good: { ru: "Эффективно", en: "Effective", whyRu: "продажи растут, банок на рецепт больше", whyEn: "sales up, more tins per prescription", tone: "ok" },
  costly: { ru: "Рост дорогой", en: "Costly growth", whyRu: "продажи растут медленнее рецептов", whyEn: "sales grow slower than prescriptions", tone: "warn" },
  noReturn: { ru: "Нет отдачи", en: "No return", whyRu: "рецепты есть, а продажи не растут", whyEn: "prescriptions paid for, sales not growing", tone: "danger" },
  noRx: { ru: "Без рецептов", en: "No prescriptions", whyRu: "рецептов за период нет", whyEn: "no prescriptions in the period", tone: "muted" },
};

export const sumMonths = (by: Record<string, number> | undefined, months: string[]) => months.reduce((t, m) => t + (by?.[m] ?? 0), 0);
