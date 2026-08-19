import Link from "next/link";
import { cookies } from "next/headers";
import { getComputed } from "@/lib/data";
import { resolveMonthId } from "@/lib/month";
import { sumMonthly } from "@/lib/engine/compute";
import { dict, LOCALE_COOKIE } from "@/lib/i18n";
import PnlView from "@/components/PnlView";

export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const { dataset, computed } = await getComputed();

  // the P&L is the official statement: it shows closed months only
  const closedMonths = dataset.months.filter((m) => m.closedAt);
  if (closedMonths.length === 0) {
    const locale = (await cookies()).get(LOCALE_COOKIE)?.value === "en" ? "en" : "ru";
    return (
      <div className="mx-auto max-w-xl pt-20 text-center">
        <h1 className="font-display text-[22px] font-semibold">P&L</h1>
        <p className="mt-3 text-[14px] text-muted">{dict.pnlNoClosedMonths[locale]}</p>
        <Link
          href="/close"
          className="mt-6 inline-block rounded-lg bg-accent px-4 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          {dict.navClose[locale]}
        </Link>
      </div>
    );
  }

  const closedIds = new Set(closedMonths.map((m) => m.id));
  const closedMonthly = computed.monthly.filter((m) => closedIds.has(m.monthId));
  const withData = closedMonthly.filter((m) => m.revenue !== 0 || m.cogs !== 0 || m.totalOpex !== 0);
  const fallback = withData[withData.length - 1]?.monthId ?? closedMonths[0]?.id ?? "";
  const monthId = await resolveMonthId(month, closedMonths, fallback);
  return (
    <PnlView
      months={closedMonths}
      monthId={monthId}
      monthly={closedMonthly}
      ytd={sumMonthly(closedMonthly)}
      productNames={Object.fromEntries(dataset.products.map((p) => [p.id, p.nameRu]))}
      channelNames={Object.fromEntries(dataset.channels.map((c) => [c.id, c.name]))}
      opexTi={dataset.opexTi}
      opexFargo={dataset.opexFargo}
      taxFilings={dataset.taxFilings}
    />
  );
}
