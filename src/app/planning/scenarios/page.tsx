import { loadPlanning } from "@/lib/planning/data";
import { monthKeyOf, nextOrderSlot } from "@/lib/planning/compute";
import { getSession } from "@/lib/auth";
import ScenariosView from "@/components/ScenariosView";

export const dynamic = "force-dynamic";

export default async function ScenariosPage() {
  const data = await loadPlanning();
  const session = await getSession();
  const slot = nextOrderSlot(new Date(), data.settings);
  const startMonth = monthKeyOf(new Date());
  return (
    <ScenariosView
      skus={data.skus}
      situations={data.situations}
      recruitment={data.recruitment}
      cohortParams={data.cohortParams}
      settings={data.settings}
      slot={slot}
      startMonth={startMonth}
      eurRate={data.eurRate}
      purchases={data.purchases}
      isAdmin={session?.role === "ADMIN"}
    />
  );
}
