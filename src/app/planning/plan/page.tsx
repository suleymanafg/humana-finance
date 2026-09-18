import { loadPlanning } from "@/lib/planning/data";
import { monthKeyOf, nextOrderSlot, projectSku } from "@/lib/planning/compute";
import { getSession } from "@/lib/auth";
import PlanningShell from "@/components/PlanningShell";
import PlanningView from "@/components/PlanningView";

export const dynamic = "force-dynamic";

// 14 future months in the grid (2 past months are prepended client-side)
const HORIZON = 14;

export default async function PlanningPage() {
  const data = await loadPlanning();
  const session = await getSession();
  const slot = nextOrderSlot(new Date(), data.settings);
  const startMonth = monthKeyOf(new Date());
  const projections = Object.fromEntries(
    data.skus.map((s) => [s.id, projectSku(data.situations[s.id], startMonth, HORIZON, data.settings)])
  );
  return (
    <PlanningShell slot={slot}>
      <PlanningView
        skus={data.skus}
        situations={data.situations}
        projections={projections}
        slot={slot}
        startMonth={startMonth}
        settings={data.settings}
        eurRate={data.eurRate}
        purchases={data.purchases}
        recruitment={data.recruitment}
        model={data.model}
        pickups={data.pickups}
        isAdmin={session?.role === "ADMIN"}
      />
    </PlanningShell>
  );
}
