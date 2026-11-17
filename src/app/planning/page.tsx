// «Этот месяц» — supply planning's working screen, from the facts only: the
// stock and the trucks in the app, how long they last, and each ship month's
// advice counted on its own (advice.ts) up to the month whose IBP is due.
import { loadPlan } from "@/lib/planning/plan-data";
import { adviceViews, coverMonths, dueIbp, outlookMonths, pipelineView, skuHeads, stockRows } from "@/lib/planning/plan-view";
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
        advice={adviceViews(p)}
        due={{ shipMonth: due.shipMonth, deadline: due.deadline, daysLeft: due.daysLeft }}
        waitingAtDmk={Object.values(p.openUsed).reduce((t, v) => t + v, 0)}
        pipeline={pipelineView(p)}
        stock={stockRows(p)}
        coverMonths={coverMonths(p)}
        outlook={outlookMonths(p)}
        isAdmin={session?.role === "ADMIN"}
      />
    </PlanningShell>
  );
}
