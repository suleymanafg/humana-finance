// «Заказы» — the IBP by ship month as it is entered, with the advice for the
// one month whose IBP is due and the stock each month would end with if the
// orders are taken; then the record: DMK's IBP export upload and the orders
// by ship month as entered.
import { loadPlanning } from "@/lib/planning/data";
import { loadPlan } from "@/lib/planning/plan-data";
import { addMonths, runRate } from "@/lib/planning/compute";
import { dueIbp, orderedCover, pipelineView, skuHeads } from "@/lib/planning/plan-view";
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
          pipeline={pipelineView(p)}
          ibpEntered={p.ibpEntered}
          dueShip={due.shipMonth}
          dueDeadline={due.deadline}
          dueAdvice={due.load?.ibpToEnter ?? {}}
          dueTrucks={due.load?.trucks ?? 0}
          frozenThrough={p.frozenThrough}
          cover={orderedCover(p, shipMonths)}
          eurRate={p.eurRate}
          dangerLine={p.settings.dangerLine}
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
