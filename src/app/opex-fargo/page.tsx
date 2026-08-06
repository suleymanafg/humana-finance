import { prisma } from "@/lib/db";
import { getComputed } from "@/lib/data";
import { getSession } from "@/lib/auth";
import { canEditData, canEditStructure } from "@/lib/permissions";
import { resolveMonthId } from "@/lib/month";
import OpexView from "@/components/OpexView";

export default async function OpexFargoPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;
  const { dataset } = await getComputed();
  const session = await getSession();

  // inactive categories come along too — OpexView still shows them in months
  // where they hold an amount, so the table total always ties to the P&L
  const categories = await prisma.opexCategory.findMany({
    where: { company: "FARGO" },
    orderBy: { sortOrder: "asc" },
  });
  const rows = await prisma.opexFargoEntry.findMany({ where: { deletedAt: null } });

  const withData = new Set(rows.map((r) => r.monthId));
  const fallback =
    dataset.months.filter((m) => withData.has(m.id)).at(-1)?.id ?? dataset.months[0]?.id ?? "";
  const monthId = await resolveMonthId(monthParam, dataset.months, fallback);

  return (
    <OpexView
      variant="FARGO"
      entity="opexFargo"
      titleKey="navOpexFargo"
      descKey="descOpexFargo"
      months={dataset.months}
      monthId={monthId}
      categories={categories.map((c) => ({
        id: c.id,
        name: c.name,
        plGroup: c.plGroup,
        active: c.active,
      }))}
      entries={rows.map((r) => ({
        id: r.id,
        monthId: r.monthId,
        categoryId: r.categoryId,
        bank: r.amount,
        cash: 0,
      }))}
      readOnly={!canEditData(session?.role)}
      canManage={canEditStructure(session?.role)}
    />
  );
}
