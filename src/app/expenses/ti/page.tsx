import { prisma } from "@/lib/db";
import { pageContext, type SearchParams } from "@/lib/page-context";
import OpexView from "@/components/OpexView";

export default async function ExpensesTiPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const [categories, rows] = await Promise.all([
    prisma.opexCategory.findMany({ where: { company: "TI" }, orderBy: { sortOrder: "asc" } }),
    prisma.opexTiEntry.findMany({ where: { deletedAt: null } }),
  ]);
  return (
    <OpexView
      variant="TI"
      entity="opexTi"
      months={ctx.dataset.months}
      monthId={ctx.monthId}
      categories={categories.map((c) => ({ id: c.id, name: c.name, plGroup: c.plGroup, active: c.active }))}
      entries={rows.map((r) => ({ id: r.id, monthId: r.monthId, categoryId: r.categoryId, bank: r.bankAmount, cash: r.cashAmount }))}
      readOnly={!ctx.canEdit}
      canManage={ctx.isAdmin}
    />
  );
}
