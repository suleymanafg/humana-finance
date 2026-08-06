import { getComputed } from "@/lib/data";
import { getSession } from "@/lib/auth";
import { canEditData } from "@/lib/permissions";
import TaxesView from "@/components/TaxesView";
import { resolveMonthId } from "@/lib/month";

export default async function TaxesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const { dataset, computed } = await getComputed();
  const session = await getSession();

  const active = computed.monthly.filter((m) => m.revenue !== 0);
  const defaultMonth = active.at(-1)?.monthId ?? dataset.months[0]?.id ?? "";
  const monthId = await resolveMonthId(month, dataset.months, defaultMonth);

  const idx = computed.monthly.findIndex((m) => m.monthId === monthId);
  const monthly = idx >= 0 ? computed.monthly[idx] : null;
  const prior = idx > 0 ? computed.monthly[idx - 1] : null;

  const lite = (m: (typeof computed.monthly)[number]) => ({
    monthId: m.monthId,
    revenue: m.revenue,
    cashRevenue: m.cashRevenue,
    fargoVat: m.fargoVat,
    bankVat: m.bankVat,
    cashVat: m.cashVat,
    fargoIncomeTax: m.fargoIncomeTax,
    tiIncomeTax: m.tiIncomeTax,
    taxesTotal: m.taxesTotal,
  });

  return (
    <TaxesView
      months={dataset.months}
      monthId={monthId}
      current={monthly ? { ...lite(monthly), vatRows: monthly.vatRows } : null}
      prior={prior ? lite(prior) : null}
      trend={active.map(lite)}
      ytd={{
        revenue: computed.ytd.revenue,
        fargoVat: computed.ytd.fargoVat,
        bankVat: computed.ytd.bankVat,
        cashVat: computed.ytd.cashVat,
        fargoIncomeTax: computed.ytd.fargoIncomeTax,
        tiIncomeTax: computed.ytd.tiIncomeTax,
        taxesTotal: computed.ytd.taxesTotal,
        netProfit: computed.ytd.netProfit,
      }}
      taxes={dataset.taxes}
      productNames={Object.fromEntries(dataset.products.map((p) => [p.id, p.nameRu]))}
      taxFilings={dataset.taxFilings}
      quarterAudits={computed.quarterAudits}
      readOnly={!canEditData(session?.role)}
    />
  );
}
