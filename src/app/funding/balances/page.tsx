import { pageContext, type SearchParams } from "@/lib/page-context";
import MonthBalanceGrid from "@/components/MonthBalanceGrid";

export default async function CashBalancesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const { dataset, monthId } = ctx;
  const months = dataset.months.filter((m) => m.id <= monthId);
  return (
    <MonthBalanceGrid
      months={months.map((m) => ({ id: m.id, nameRu: m.nameRu, nameEn: m.nameEn }))}
      monthId={monthId}
      balances={Object.fromEntries(dataset.monthBalances.map((b) => [b.monthId, b]))}
      closed={dataset.months.filter((m) => m.closedAt).map((m) => m.id)}
      canEdit={ctx.canEditAny}
      canEditClosed={ctx.isAdmin}
    />
  );
}
