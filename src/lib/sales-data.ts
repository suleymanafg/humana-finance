// What every sales page needs: the month's sales, the month before, the monthly
// trend and the FIFO unit costs that value them.
import { prisma } from "./db";
import { pageContext } from "./page-context";
import { costProductIdOf } from "./engine/compute";
import type { Computed, Dataset } from "./engine/types";

/** FIFO cost per unit sold in a month, by product: the group's and Fargo's. */
function unitCosts(computed: Computed, dataset: Dataset, monthId: string | undefined) {
  const group: Record<string, number> = {};
  const fargo: Record<string, number> = {};
  if (!monthId) return { group, fargo };
  for (const p of dataset.products) {
    const fm = computed.fifo[costProductIdOf(p.id, dataset)]?.months[monthId];
    group[p.id] = fm?.groupUnitCost ?? 0;
    fargo[p.id] = fm?.fargoUnitCost ?? 0;
  }
  return { group, fargo };
}

export async function salesData(monthParam: string | undefined, opts: { withClients?: boolean } = {}) {
  const ctx = await pageContext(monthParam);
  const { dataset, computed, monthId } = ctx;
  const i = computed.monthIds.indexOf(monthId);
  const snapshot = (k: number) => {
    const f = computed.fargo[k];
    if (!f) return null;
    return {
      revenue: f.salesAtPrice,
      totalQty: f.units,
      revenueByChannel: f.salesByChannel,
      qtyByProduct: f.qtyByProduct,
    };
  };
  const priorMonthId = i > 0 ? computed.monthIds[i - 1] : undefined;
  const trend = computed.monthIds
    .map((m, k) => ({ m, f: computed.fargo[k] }))
    .filter(({ f }) => f.salesAtPrice !== 0)
    .map(({ m, f }) => ({ monthId: m, revenue: f.salesAtPrice, byChannel: f.salesByChannel }));

  const clientSales = opts.withClients
    ? await prisma.clientSale
        .findMany({
          where: { monthId },
          select: {
            productId: true,
            channelId: true,
            qty: true,
            clientMap: { select: { id: true, displayName: true } },
          },
        })
        .then((rows) =>
          rows.map((r) => ({
            clientMapId: r.clientMap.id,
            name: r.clientMap.displayName,
            productId: r.productId,
            channelId: r.channelId,
            qty: r.qty,
          }))
        )
    : [];

  return {
    ctx,
    props: {
      months: dataset.months,
      products: dataset.products,
      channels: dataset.channels,
      monthId,
      sales: dataset.sales.filter((s) => s.monthId === monthId),
      clientSales,
      priorSales: priorMonthId ? dataset.sales.filter((s) => s.monthId === priorMonthId) : [],
      current: i >= 0 ? snapshot(i) : null,
      prior: i > 0 ? snapshot(i - 1) : null,
      trend,
      costs: unitCosts(computed, dataset, monthId),
      priorCosts: unitCosts(computed, dataset, priorMonthId),
      vat: { rate: dataset.taxes.vatRate, deemedMargin: dataset.taxes.deemedCashMargin },
      readOnly: !ctx.canEdit,
    },
  };
}

export type SalesProps = Awaited<ReturnType<typeof salesData>>["props"];
