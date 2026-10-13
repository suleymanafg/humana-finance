// «Что делать» — supply planning's working screen: what to pick up from DMK
// now and what to enter in IBP by the deadline, with whether the stock lasts.
// Both demand bases are computed here; the view only switches between them.
import { loadPlanning, supplyInputOf, unlinkedSkus } from "@/lib/planning/data";
import { runRate } from "@/lib/planning/compute";
import { buildSupplyPlan, supplyChecks } from "@/lib/planning/supply";
import { getSession } from "@/lib/auth";
import PlanningShell from "@/components/PlanningShell";
import SupplyView from "@/components/SupplyView";

export const dynamic = "force-dynamic";

export default async function PlanningPage() {
  const data = await loadPlanning();
  const session = await getSession();
  const input = supplyInputOf(data);
  const thisMonth = data.today.slice(0, 7);
  const plans = { sales: buildSupplyPlan(input, "sales"), model: buildSupplyPlan(input, "model") };
  const checks = supplyChecks(input, { ibpSyncedAt: data.ibpSyncedAt, unlinked: unlinkedSkus(data) });
  const ids = input.skus.map((s) => s.id);
  const sum = (pick: (id: string) => number) => ids.reduce((t, id) => t + pick(id), 0);

  return (
    <PlanningShell slot={data.slot}>
      <SupplyView
        plans={plans}
        names={Object.fromEntries(input.skus.map((s) => [s.id, s.name]))}
        checks={checks}
        eurRate={data.eurRate}
        today={data.today}
        summary={{
          onHand: sum((id) => input.onHand[id] ?? 0),
          transit: sum((id) => input.transit.reduce((t, x) => t + (x.units[id] ?? 0), 0)),
          atDmk: sum((id) => input.atDmk[id] ?? 0),
          salesPerMonth: sum((id) => runRate(input.sales[id] ?? {}, thisMonth, 3)),
        }}
        isAdmin={session?.role === "ADMIN"}
      />
    </PlanningShell>
  );
}
