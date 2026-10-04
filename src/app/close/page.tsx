import { pageContext, type SearchParams } from "@/lib/page-context";
import CloseView from "@/components/CloseView";

export default async function ClosePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const { dataset, monthId } = ctx;
  const monthRow = dataset.months.find((m) => m.id === monthId);
  return (
    <CloseView
      months={dataset.months}
      monthId={monthId}
      status={ctx.status.find((s) => s.monthId === monthId) ?? null}
      closedInfo={{
        closed: !!monthRow?.closedAt,
        closedBy: monthRow?.closedBy ?? null,
        closedAt: monthRow?.closedAt ? monthRow.closedAt.toISOString() : null,
      }}
      isAdmin={ctx.isAdmin}
    />
  );
}
