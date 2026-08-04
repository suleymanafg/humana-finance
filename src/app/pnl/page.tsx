import { getComputed } from "@/lib/data";
import { resolveMonthId } from "@/lib/month";
import PnlView from "@/components/PnlView";

export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const { dataset, computed } = await getComputed();
  const withData = computed.monthly.filter((m) => m.revenue !== 0 || m.cogs !== 0 || m.totalOpex !== 0);
  const fallback = withData[withData.length - 1]?.monthId ?? dataset.months[0]?.id ?? "";
  const monthId = await resolveMonthId(month, dataset.months, fallback);
  return (
    <PnlView
      months={dataset.months}
      monthId={monthId}
      monthly={computed.monthly}
      ytd={computed.ytd}
      productNames={Object.fromEntries(dataset.products.map((p) => [p.id, p.nameRu]))}
      channelNames={Object.fromEntries(dataset.channels.map((c) => [c.id, c.name]))}
      opexTi={dataset.opexTi}
      opexFargo={dataset.opexFargo}
      taxFilings={dataset.taxFilings}
    />
  );
}
