// Keeps the supply plan's estimate as it stands at the start of a month
// (Setting "planning.estimate.YYYY-MM"), per product: taken when the month
// before closes, or by hand. Not replaced on its own once kept.
import { prisma } from "../db";
import { addMonths } from "./compute";
import { loadPlan } from "./plan-data";
import { planEstimateFrom, type PlanEstimate } from "./plan-review";

export const PLAN_ESTIMATE_PREFIX = "planning.estimate.";

export async function loadPlanEstimates(): Promise<PlanEstimate[]> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: PLAN_ESTIMATE_PREFIX } } });
  const out: PlanEstimate[] = [];
  for (const r of rows) {
    try {
      const e = JSON.parse(r.value) as PlanEstimate;
      if (/^\d{4}-\d{2}$/.test(e.monthId) && Array.isArray(e.months) && e.values && typeof e.values === "object") out.push(e);
    } catch {
      // a broken row is left out
    }
  }
  return out.sort((a, b) => a.monthId.localeCompare(b.monthId));
}

export type SavePlanEstimateResult = { saved: true; monthId: string } | { saved: false; monthId: string; reason: "late" | "exists" };

/**
 * The estimate for the plan's current month. `afterClosing` — called from closing that
 * month: kept only when the month closed is the one just before (a late close would keep
 * a month already half gone) and none is kept yet.
 */
export async function savePlanEstimate(username: string, opts: { afterClosing?: string; overwrite?: boolean } = {}): Promise<SavePlanEstimateResult> {
  const p = await loadPlan();
  const monthId = p.thisMonth;
  if (opts.afterClosing && addMonths(opts.afterClosing, 1) !== monthId) return { saved: false, monthId, reason: "late" };
  const key = `${PLAN_ESTIMATE_PREFIX}${monthId}`;
  if (!opts.overwrite && (await prisma.setting.findUnique({ where: { key } }))) return { saved: false, monthId, reason: "exists" };
  const est = planEstimateFrom(p, { monthId, takenAt: new Date().toISOString(), takenBy: username });
  const value = JSON.stringify(est);
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } }),
    prisma.auditLog.create({ data: { entity: "planning", entityId: `estimate ${monthId}`, action: "UPSERT", data: JSON.stringify({ afterClosing: opts.afterClosing ?? null }), username } }),
  ]);
  return { saved: true, monthId };
}
