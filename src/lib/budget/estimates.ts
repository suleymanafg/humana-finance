// Keeps the estimate as it stands at the start of a month (Setting
// "budget.estimate.YYYY-MM"): taken when the month before closes, or by hand.
// The month's actual is later compared with it. An estimate already kept is
// not replaced on its own — only when the owner saves it again.
import { prisma } from "../db";
import { addMonths } from "../planning/compute";
import { loadBudget } from "./data";
import { ESTIMATE_PREFIX } from "./store";
import { snapshotFromRun } from "./statements";

export type SaveEstimateResult = { saved: true; monthId: string } | { saved: false; monthId: string | null; reason: "no-budget" | "no-balances" | "exists" };

/**
 * The estimate for the first month after the last closed one. `afterClosing` — called
 * from closing that month: kept only if the closed month has its balances (else the
 * estimate would still start earlier) and none is kept yet.
 */
export async function saveEstimate(username: string, opts: { afterClosing?: string; overwrite?: boolean } = {}): Promise<SaveEstimateResult> {
  const d = await loadBudget();
  if (d.empty || !d.plan || !d.planCapital) return { saved: false, monthId: null, reason: "no-budget" };
  const monthId = d.plan.months[0];
  if (opts.afterClosing && monthId !== addMonths(opts.afterClosing, 1)) return { saved: false, monthId, reason: "no-balances" };
  const key = `${ESTIMATE_PREFIX}${monthId}`;
  if (!opts.overwrite && (await prisma.setting.findUnique({ where: { key } }))) return { saved: false, monthId, reason: "exists" };
  const snap = snapshotFromRun(d.plan, { monthId, takenAt: new Date().toISOString(), takenBy: username, basedOn: d.working.name, ask: d.planCapital.ask });
  const value = JSON.stringify(snap);
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } }),
    prisma.auditLog.create({ data: { entity: "budget", entityId: `estimate ${monthId}`, action: "UPSERT", data: JSON.stringify({ basedOn: snap.basedOn, ask: snap.ask, afterClosing: opts.afterClosing ?? null }), username } }),
  ]);
  return { saved: true, monthId };
}
