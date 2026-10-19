// «Заказы» — the plan by ship month (what each load carries and what the IBP
// should hold for it), then the record: DMK's IBP export upload and the
// orders by ship month as entered.
import { loadPlanning } from "@/lib/planning/data";
import { loadPlan } from "@/lib/planning/plan-data";
import { addMonths, runRate } from "@/lib/planning/compute";
import { dueIbp, loadView, pipelineView, skuHeads } from "@/lib/planning/plan-view";
import PlanningShell from "@/components/PlanningShell";
import PlanOrdersView from "@/components/planning/PlanOrdersView";
import OrdersView from "@/components/OrdersView";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const [data, p] = await Promise.all([loadPlanning(), loadPlan()]);
  const due = dueIbp(p);
  const thisMonth = p.thisMonth;
  const shipMonths: string[] = [];
  for (let m = thisMonth; shipMonths.length < 15; m = addMonths(m, 1)) shipMonths.push(m);
  const months: string[] = [];
  for (let m = addMonths(thisMonth, -3); m <= addMonths(due.shipMonth, 4); m = addMonths(m, 1)) months.push(m);
  const skus = data.skus.filter((s) => s.active);

  return (
    <PlanningShell slot={{ ...p.slot, deadline: due.deadline, daysLeft: due.daysLeft, shipMonth: due.shipMonth }}>
      <div className="space-y-4">
        <PlanOrdersView
          shipMonths={shipMonths}
          skus={skuHeads(p)}
          loads={p.plan.loads.map((l) => loadView(p, l))}
          pipeline={pipelineView(p)}
          ibpEntered={p.ibpEntered}
          dueShip={due.shipMonth}
          frozenThrough={p.frozenThrough}
          extraThrough={p.extraThrough}
          eurRate={p.eurRate}
          minFill={p.settings.minFill}
        />
        <OrdersView
          skus={skus.map((s) => ({ id: s.id, name: s.name, pcsPerPallet: s.pcsPerPallet }))}
          months={months}
          orders={data.purchases}
          pickups={data.pickups}
          atDmk={Object.fromEntries(skus.map((s) => [s.id, p.openUsed[s.id] ?? s.openOrderQty]))}
          salesPerMonth={Object.fromEntries(skus.map((s) => [s.id, runRate(data.situations[s.id].actualSales, thisMonth, 3)]))}
          slotShip={due.shipMonth}
          thisMonth={thisMonth}
          ibpSyncedAt={data.ibpSyncedAt}
          truckPallets={data.settings.truckPallets}
        />
      </div>
    </PlanningShell>
  );
}
