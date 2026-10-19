// «Оценка и факт» — the supply plan against the books, product by product:
// a closed month's sales, month-end stock, trucks arrived and collected from
// DMK next to what the plan expected at the month's start; and sales month by
// month (closed months actual over their estimate, then the latest estimate).
import { loadPlan } from "@/lib/planning/plan-data";
import { loadPlanEstimates } from "@/lib/planning/estimates";
import { addMonths } from "@/lib/planning/compute";
import { dueIbp, skuHeads } from "@/lib/planning/plan-view";
import { actualOf, estimateOf, planEstimateSourceFor, reviewMonth } from "@/lib/planning/plan-review";
import { getSession } from "@/lib/auth";
import PlanningShell from "@/components/PlanningShell";
import ReviewView from "@/components/planning/ReviewView";

export const dynamic = "force-dynamic";

export default async function PlanReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const [p, estimates, session] = await Promise.all([loadPlan(), loadPlanEstimates(), getSession()]);
  const due = dueIbp(p);

  // closed months with sales, the last twelve
  const closed: string[] = [];
  for (let m = p.lastClosed; closed.length < 12; m = addMonths(m, -1)) {
    if (!p.skus.some((s) => (p.engine.demand[s.id]?.[m] ?? 0) > 0)) break;
    closed.unshift(m);
  }
  const asked = typeof sp.m === "string" && closed.includes(sp.m) ? sp.m : closed[closed.length - 1] ?? p.lastClosed;

  // sales by month: the last six closed months (actual over estimate), this month, three ahead (estimate)
  const trendMonths = [...closed.slice(-6), p.thisMonth, addMonths(p.thisMonth, 1), addMonths(p.thisMonth, 2), addMonths(p.thisMonth, 3)];
  const sources = Object.fromEntries(trendMonths.map((m) => [m, planEstimateSourceFor(m, estimates)]));
  const trend = p.skus.map((s) => ({
    id: s.id,
    cells: trendMonths.map((m) => {
      const src = sources[m];
      if (m <= p.lastClosed) return { v: actualOf(p, s.id, "sold", m), ref: estimateOf(p, src, s.id, "sold", m) };
      if (m === p.thisMonth) return { v: p.engine.demand[s.id]?.[m] ?? null, ref: src.kind === "hindsight" ? null : estimateOf(p, src, s.id, "sold", m), soFar: p.engine.thisMonth[s.id]?.runningAt * p.monthDone };
      return { v: Math.max(0, (p.engine.demand[s.id]?.[m] ?? 0) - (p.plan.lost[s.id]?.[m] ?? 0)) };
    }),
  }));
  const kept = estimates.find((e) => e.monthId === p.thisMonth) ?? null;

  return (
    <PlanningShell slot={{ ...p.slot, deadline: due.deadline, daysLeft: due.daysLeft, shipMonth: due.shipMonth }}>
      <ReviewView
        skus={skuHeads(p)}
        closed={closed}
        review={reviewMonth(p, asked, estimates)}
        trendMonths={trendMonths}
        trendSources={Object.fromEntries(trendMonths.map((m) => [m, { kind: sources[m].kind, month: sources[m].kind === "hindsight" ? null : (sources[m] as { est: { monthId: string } }).est.monthId }]))}
        trend={trend}
        thisMonth={p.thisMonth}
        lastClosed={p.lastClosed}
        monthDone={p.monthDone}
        keptAt={kept?.takenAt ?? null}
        isAdmin={session?.role === "ADMIN"}
      />
    </PlanningShell>
  );
}
