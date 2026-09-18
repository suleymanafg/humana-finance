import { loadPlanning } from "@/lib/planning/data";
import { monthKeyOf, nextOrderSlot, projectSku, recommendQty } from "@/lib/planning/compute";
import PlanningShell from "@/components/PlanningShell";
import OrderBuilderView from "@/components/OrderBuilderView";

export const dynamic = "force-dynamic";

const HORIZON = 14;

export default async function OrderBuilderPage() {
  const data = await loadPlanning();
  const slot = nextOrderSlot(new Date(), data.settings);
  const startMonth = monthKeyOf(new Date());
  const label = `sales ${slot.shipMonth.slice(5)}-${slot.shipMonth.slice(0, 4)}`;

  // committed purchase lines already saved for this slot's ship month
  const purchases: Record<string, number> = {};
  for (const s of data.skus) {
    const q = data.purchases[s.id]?.[slot.shipMonth];
    if (q !== undefined) purchases[s.id] = q;
  }

  // recommendations pretend this slot is not yet committed — otherwise a
  // saved закуп would cancel itself out of its own recommendation
  const projections = Object.fromEntries(
    data.skus.map((s) => {
      const sit = data.situations[s.id];
      const committed = purchases[s.id] ?? 0;
      const sanitized =
        committed > 0
          ? {
              ...sit,
              arrivals: {
                ...sit.arrivals,
                [slot.arrivalMonth]: Math.max(0, (sit.arrivals[slot.arrivalMonth] ?? 0) - committed),
              },
            }
          : sit;
      return [s.id, projectSku(sanitized, startMonth, HORIZON, data.settings)];
    })
  );
  const recommended = Object.fromEntries(
    data.skus.map((s) => [s.id, recommendQty(projections[s.id], s, slot.arrivalMonth, data.settings)])
  );

  return (
    <PlanningShell slot={slot}>
      <OrderBuilderView
        skus={data.skus}
        situations={data.situations}
        slot={slot}
        label={label}
        startMonth={startMonth}
        settings={data.settings}
        eurRate={data.eurRate}
        recommended={recommended}
        purchases={purchases}
      />
    </PlanningShell>
  );
}
