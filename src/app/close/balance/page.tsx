import { getComputed } from "@/lib/data";
import { getSession } from "@/lib/auth";
import { canEditData, canEditClosedMonth } from "@/lib/permissions";
import BalanceInputsView from "@/components/BalanceInputsView";
import { costProductIdOf } from "@/lib/engine/compute";
import { computeMonthStatus, defaultMonthId } from "@/lib/month-status";
import { resolveMonthId } from "@/lib/month";

export default async function BalanceInputsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const { dataset, computed } = await getComputed();
  const session = await getSession();

  const statusByMonth = computeMonthStatus(dataset);
  const monthId = await resolveMonthId(
    month,
    dataset.months,
    defaultMonthId(statusByMonth, dataset.months[0]?.id ?? "")
  );
  const idx = dataset.months.findIndex((m) => m.id === monthId);
  const priorMonthId = idx > 0 ? dataset.months[idx - 1].id : null;
  const regularProducts = dataset.products.filter((p) => !p.isPromo);

  const stockOf = (mid: string, productId: string) =>
    Object.fromEntries(
      dataset.stockCounts
        .filter((s) => s.monthId === mid && s.productId === productId)
        .map((s) => [s.warehouseId, s.qty])
    );

  return (
    <BalanceInputsView
      months={dataset.months}
      monthId={monthId}
      // months that already carry any manual balance input
      monthsWithData={[
        ...new Set([
          ...dataset.stockCounts.filter((s) => s.qty !== 0).map((s) => s.monthId),
          ...dataset.arEntries.map((a) => a.monthId),
          ...dataset.monthBalances.map((b) => b.monthId),
        ]),
      ]}
      priorMonthId={priorMonthId}
      settlement={computed.settlement.find((s) => s.monthId === monthId) ?? null}
      monthBalance={dataset.monthBalances.find((b) => b.monthId === monthId) ?? null}
      priorBalance={
        priorMonthId ? (dataset.monthBalances.find((b) => b.monthId === priorMonthId) ?? null) : null
      }
      warehouses={dataset.warehouses}
      stock={regularProducts.map((p) => ({
        productId: p.id,
        name: p.nameRu,
        unitCost: computed.productCosts[costProductIdOf(p.id, dataset)]?.avgTiCost ?? 0,
        byWarehouse: stockOf(monthId, p.id),
      }))}
      priorStock={
        priorMonthId
          ? Object.fromEntries(regularProducts.map((p) => [p.id, stockOf(priorMonthId, p.id)]))
          : {}
      }
      arEntries={dataset.arEntries
        .filter((a) => a.monthId === monthId)
        .map((a) => ({ id: a.id, customerName: a.customerName, amount: a.amount }))}
      priorAr={
        priorMonthId
          ? dataset.arEntries
              .filter((a) => a.monthId === priorMonthId)
              .map((a) => ({ id: a.id, customerName: a.customerName, amount: a.amount }))
          : []
      }
      contributions={dataset.contributions}
      transfers={dataset.transfers}
      readOnly={
        !canEditData(session?.role) ||
        (!!dataset.months.find((m) => m.id === monthId)?.closedAt && !canEditClosedMonth(session?.role))
      }
    />
  );
}
