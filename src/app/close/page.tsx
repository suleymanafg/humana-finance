import { getComputed } from "@/lib/data";
import { computeMonthStatus, defaultMonthId } from "@/lib/month-status";
import { resolveMonthId } from "@/lib/month";
import CloseView from "@/components/CloseView";

export default async function ClosePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const { dataset, computed } = await getComputed();
  const status = computeMonthStatus(dataset);
  const monthId = await resolveMonthId(
    month,
    dataset.months,
    defaultMonthId(status, dataset.months[0]?.id ?? "")
  );
  const cur = status.find((s) => s.monthId === monthId) ?? null;
  const monthly = computed.monthly.find((m) => m.monthId === monthId) ?? null;

  return (
    <CloseView
      months={dataset.months}
      monthId={monthId}
      status={cur}
      summary={{
        revenue: monthly?.revenue ?? 0,
        totalOpex: monthly?.totalOpex ?? 0,
        netProfit: monthly?.netProfit ?? 0,
      }}
    />
  );
}
