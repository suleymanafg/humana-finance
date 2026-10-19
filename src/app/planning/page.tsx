// «Этот месяц» — supply planning's working screen: the pick-ups for this
// month and next, the IBP numbers due by the 20th, the trucks on their way and
// whether the stock lasts. Everything comes from the plan (plan-data.ts).
import { loadPlan } from "@/lib/planning/plan-data";
import { coverMonths, dueIbp, loadView, pipelineView, skuHeads, stockRows } from "@/lib/planning/plan-view";
import { getSession } from "@/lib/auth";
import PlanningShell from "@/components/PlanningShell";
import PlanView from "@/components/planning/PlanView";

export const dynamic = "force-dynamic";

export default async function PlanningPage() {
  const [p, session] = await Promise.all([loadPlan(), getSession()]);
  const due = dueIbp(p);
  const s = p.settings;

  return (
    <PlanningShell slot={{ ...p.slot, deadline: due.deadline, daysLeft: due.daysLeft, shipMonth: due.shipMonth }}>
      <PlanView
        today={p.today}
        thisMonth={p.thisMonth}
        monthDone={p.monthDone}
        skus={skuHeads(p)}
        eurRate={p.eurRate}
        settings={{ truckPlaces: s.truckPlaces, minFill: s.minFill, maxFill: s.maxFill, dangerLine: s.dangerLine, leadDays: s.leadDays, dispatchDay: s.dispatchDay }}
        pickups={p.plan.loads.filter((l) => l.shipMonth <= p.extraThrough && l.trucks > 0).map((l) => loadView(p, l))}
        due={{ ...due, entered: p.ibpEntered[due.shipMonth] ?? {} }}
        pipeline={pipelineView(p)}
        stock={stockRows(p)}
        coverMonths={coverMonths(p)}
        isAdmin={session?.role === "ADMIN"}
      />
    </PlanningShell>
  );
}
