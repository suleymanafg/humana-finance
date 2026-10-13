// «Заказы IBP» — what is ordered from DMK by ship month: loaded from DMK's
// IBP export, adjustable by hand from the open slot on.
import { loadPlanning } from "@/lib/planning/data";
import { addMonths, runRate } from "@/lib/planning/compute";
import PlanningShell from "@/components/PlanningShell";
import OrdersView from "@/components/OrdersView";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const data = await loadPlanning();
  const thisMonth = data.today.slice(0, 7);
  const months: string[] = [];
  for (let m = addMonths(thisMonth, -3); m <= addMonths(data.slot.shipMonth, 4); m = addMonths(m, 1)) months.push(m);
  const skus = data.skus.filter((s) => s.active);

  return (
    <PlanningShell slot={data.slot}>
      <OrdersView
        skus={skus.map((s) => ({ id: s.id, name: s.name, pcsPerPallet: s.pcsPerPallet }))}
        months={months}
        orders={data.purchases}
        pickups={data.pickups}
        atDmk={Object.fromEntries(skus.map((s) => [s.id, s.openOrderQty]))}
        salesPerMonth={Object.fromEntries(skus.map((s) => [s.id, runRate(data.situations[s.id].actualSales, thisMonth, 3)]))}
        slotShip={data.slot.shipMonth}
        thisMonth={thisMonth}
        ibpSyncedAt={data.ibpSyncedAt}
        truckPallets={data.settings.truckPallets}
      />
    </PlanningShell>
  );
}
