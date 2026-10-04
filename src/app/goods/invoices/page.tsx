import { pageContext, type SearchParams } from "@/lib/page-context";
import InvoicesView from "@/components/InvoicesView";

export default async function InvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const { dataset, computed } = ctx;
  const lines = computed.invoices.filter((l) => l.monthId === ctx.monthId);
  const byMonth = computed.monthIds
    .filter((m) => m <= ctx.monthId)
    .map((m) => {
      const ls = computed.invoices.filter((l) => l.monthId === m);
      const amount = ls.reduce((s, l) => s + l.amount, 0);
      const cost = ls.reduce((s, l) => s + l.tiCost, 0);
      return {
        monthId: m,
        values: [ls.reduce((s, l) => s + l.qty, 0), amount, ls.reduce((s, l) => s + l.vat, 0), cost, amount - cost],
      };
    })
    .filter((r) => r.values.some((v) => v !== 0));
  return (
    <InvoicesView
      months={ctx.months}
      monthId={ctx.monthId}
      rows={[...lines]
        .sort((a, b) => (a.date === b.date ? a.sortOrder - b.sortOrder : a.date < b.date ? -1 : 1))
        .map((l) => ({
          id: l.id,
          date: l.date.slice(0, 10),
          number: l.number,
          productId: l.productId,
          qty: l.qty,
          price: l.price,
          amount: l.amount,
          vat: l.vat,
          ownUnitCost: l.ownUnitCost,
          notes: l.notes ?? null,
          sortOrder: l.sortOrder,
          tiCost: l.tiCost,
        }))}
      products={dataset.products.filter((p) => !p.isPromo).map((p) => ({ id: p.id, name: p.nameRu }))}
      byMonth={byMonth}
      vatRate={dataset.taxes.vatRate}
      nextSortOrder={dataset.invoices.reduce((m, l) => Math.max(m, l.sortOrder), 0) + 1}
      readOnly={!ctx.canEdit}
    />
  );
}
