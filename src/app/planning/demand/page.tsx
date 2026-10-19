// «Спрос» — the stage engine laid open: prescriptions, the learned levels,
// each product's sales against the forecast, and the owner's corrections.
import { loadPlan } from "@/lib/planning/plan-data";
import { addMonths } from "@/lib/planning/compute";
import { dueIbp } from "@/lib/planning/plan-view";
import PlanningShell from "@/components/PlanningShell";
import DemandView from "@/components/planning/DemandView";

export const dynamic = "force-dynamic";

const span = (from: string, n: number) => Array.from({ length: n }, (_, i) => addMonths(from, i));

export default async function DemandPage() {
  const p = await loadPlan();
  const due = dueIbp(p);
  const e = p.engine;

  return (
    <PlanningShell slot={{ ...p.slot, deadline: due.deadline, daysLeft: due.daysLeft, shipMonth: due.shipMonth }}>
      <DemandView
        thisMonth={p.thisMonth}
        monthDone={p.monthDone}
        past={span(addMonths(p.thisMonth, -8), 8)}
        ahead={span(addMonths(p.thisMonth, 1), 6)}
        products={p.skus.map((s) => ({ id: s.id, name: s.name, stage: s.stage, size800: s.size800 }))}
        demand={e.demand}
        short={e.short}
        overrides={p.overrides}
        thisMonthFc={e.thisMonth}
        stage={{ level: e.stageLevel, share800: e.share800, tins: p.settings.tinsPerBaby, babies: e.babies, forecast: e.stageForecast }}
        expert={e.expertLevel}
        rx={p.rx}
        rxUsed={e.rxUsed}
        rxAhead={e.rxAhead}
        rxAheadSetting={p.settings.rxAhead}
        rxMonths={span(addMonths(p.thisMonth, -9), 12)}
      />
    </PlanningShell>
  );
}
