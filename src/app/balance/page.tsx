import { getComputed } from "@/lib/data";

import BalanceView from "@/components/BalanceView";
import { costProductIdOf } from "@/lib/engine/compute";
import { computeMonthStatus, defaultMonthId } from "@/lib/month-status";
import { resolveMonthId } from "@/lib/month";

export default async function BalancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const { dataset, computed } = await getComputed();


  const statusByMonth = computeMonthStatus(dataset);
  const monthId = await resolveMonthId(
    month,
    dataset.months,
    defaultMonthId(statusByMonth, dataset.months[0]?.id ?? "")
  );

  const monthly = computed.monthly.find((m) => m.monthId === monthId) ?? null;
  const regularProducts = dataset.products.filter((p) => !p.isPromo);

  return (
    <BalanceView
      months={dataset.months}
      monthId={monthId}
      statusByMonth={statusByMonth}
      sheet={computed.balanceSheets.find((b) => b.monthId === monthId) ?? null}
      settlement={computed.settlement.find((s) => s.monthId === monthId) ?? null}
      monthBalance={dataset.monthBalances.find((b) => b.monthId === monthId) ?? null}
      warehouses={dataset.warehouses}
      stock={regularProducts.map((p) => ({
        productId: p.id,
        name: p.nameRu,
        unitCost: computed.productCosts[costProductIdOf(p.id, dataset)]?.avgTiCost ?? 0,
        byWarehouse: Object.fromEntries(
          dataset.stockCounts
            .filter((s) => s.monthId === monthId && s.productId === p.id)
            .map((s) => [s.warehouseId, s.qty])
        ),
      }))}
      arEntries={dataset.arEntries
        .filter((a) => a.monthId === monthId)
        .map((a) => ({ id: a.id, customerName: a.customerName, amount: a.amount }))}
      contributions={dataset.contributions}
      monthlyNet={computed.monthly.map((m) => ({ monthId: m.monthId, netProfit: m.netProfit }))}
      taxParts={{
        fargoVat: monthly?.fargoVat ?? 0,
        tiIncomeTax: monthly?.tiIncomeTax ?? 0,
        fargoIncomeTax: monthly?.fargoIncomeTax ?? 0,
      }}
    />
  );
}
