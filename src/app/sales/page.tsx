import { getComputed } from "@/lib/data";
import { getSession } from "@/lib/auth";
import SalesView from "@/components/SalesView";
import { costProductIdOf } from "@/lib/engine/compute";
import { resolveMonthId } from "@/lib/month";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const { dataset, computed } = await getComputed();
  const session = await getSession();

  const withSales = new Set(dataset.sales.filter((s) => s.qty !== 0).map((s) => s.monthId));
  const defaultMonth =
    dataset.months.filter((m) => withSales.has(m.id)).at(-1)?.id ?? dataset.months[0]?.id ?? "";
  const monthId = await resolveMonthId(month, dataset.months, defaultMonth);

  const idx = computed.monthly.findIndex((m) => m.monthId === monthId);
  const monthly = idx >= 0 ? computed.monthly[idx] : null;
  const prior = idx > 0 ? computed.monthly[idx - 1] : null;

  // months that actually carry sales, for trends and averages
  const activeMonths = computed.monthly.filter((m) => m.revenue !== 0);

  return (
    <SalesView
      months={dataset.months}
      products={dataset.products}
      channels={dataset.channels}
      monthId={monthId}
      sales={dataset.sales.filter((s) => s.monthId === monthId)}
      priorSales={prior ? dataset.sales.filter((s) => s.monthId === prior.monthId) : []}
      current={
        monthly && {
          revenue: monthly.revenue,
          cashRevenue: monthly.cashRevenue,
          bankRevenue: monthly.bankRevenue,
          retroBonus: monthly.retroBonus,
          totalQty: monthly.totalQty,
          revenueByChannel: monthly.revenueByChannel,
          qtyByProduct: monthly.qtyByProduct,
          revenueByProduct: monthly.revenueByProduct,
          cogs: monthly.cogs,
          grossProfit: monthly.grossProfit,
          gpMarginPct: monthly.gpMarginPct,
        }
      }
      prior={
        prior && {
          revenue: prior.revenue,
          totalQty: prior.totalQty,
          revenueByChannel: prior.revenueByChannel,
          qtyByProduct: prior.qtyByProduct,
          revenueByProduct: prior.revenueByProduct,
          gpMarginPct: prior.gpMarginPct,
        }
      }
      trend={activeMonths.map((m) => ({
        monthId: m.monthId,
        revenue: m.revenue,
        qty: m.totalQty,
        gpMarginPct: m.gpMarginPct,
        byChannel: m.revenueByChannel,
      }))}
      unitCosts={Object.fromEntries(
        dataset.products.map((p) => [
          p.id,
          computed.productCosts[costProductIdOf(p.id, dataset)]?.avgTiCost ?? 0,
        ])
      )}
      readOnly={session?.role !== "ADMIN"}
    />
  );
}
