// «Настройки» — the supply plan's engine numbers and the stock-target ramp.
import { loadPlan } from "@/lib/planning/plan-data";
import { addMonths } from "@/lib/planning/compute";
import { dueIbp } from "@/lib/planning/plan-view";
import { getSession } from "@/lib/auth";
import PlanningShell from "@/components/PlanningShell";
import PlanSettingsView from "@/components/planning/PlanSettingsView";

export const dynamic = "force-dynamic";

export default async function PlanSettingsPage() {
  const [p, session] = await Promise.all([loadPlan(), getSession()]);
  const due = dueIbp(p);
  const shipMonths = Array.from({ length: 15 }, (_, i) => addMonths(p.thisMonth, i));

  return (
    <PlanningShell slot={{ ...p.slot, deadline: due.deadline, daysLeft: due.daysLeft, shipMonth: due.shipMonth }}>
      <PlanSettingsView settings={p.settings} shipMonths={shipMonths} targets={p.targets} isAdmin={session?.role === "ADMIN"} />
    </PlanningShell>
  );
}
