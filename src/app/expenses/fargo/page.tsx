import { prisma } from "@/lib/db";
import { pageContext, type SearchParams } from "@/lib/page-context";
import { FARGO_WRITEOFF_GROUP } from "@/lib/groups";
import { SectionTitle } from "@/components/statement";
import EntryGrid from "@/components/EntryGrid";
import OpexView from "@/components/OpexView";

export default async function ExpensesFargoPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const [categories, rows] = await Promise.all([
    prisma.opexCategory.findMany({ where: { company: "FARGO" }, orderBy: { sortOrder: "asc" } }),
    prisma.opexFargoEntry.findMany({ where: { deletedAt: null } }),
  ]);
  // Fargo's recorded write-offs are part of the stock loss, not an operating cost
  const writeOffCats = categories.filter((c) => c.plGroup === FARGO_WRITEOFF_GROUP);
  const writeOffIds = new Set(writeOffCats.map((c) => c.id));
  const writeOffRows = rows
    .filter((r) => writeOffIds.has(r.categoryId) && r.monthId === ctx.monthId)
    .map((r) => ({ id: r.id, categoryId: r.categoryId, amount: r.amount }));
  return (
    <>
      <OpexView
        variant="FARGO"
        entity="opexFargo"
        months={ctx.dataset.months}
        monthId={ctx.monthId}
        categories={categories
          .filter((c) => !writeOffIds.has(c.id))
          .map((c) => ({ id: c.id, name: c.name, plGroup: c.plGroup, active: c.active }))}
        entries={rows
          .filter((r) => !writeOffIds.has(r.categoryId))
          .map((r) => ({ id: r.id, monthId: r.monthId, categoryId: r.categoryId, bank: r.amount, cash: 0 }))}
        readOnly={!ctx.canEdit}
        canManage={ctx.isAdmin}
      />
      {writeOffCats.length > 0 && (
        <>
          <SectionTitle>
            {ctx.l({
              ru: "Списания, учтённые Fargo (входят в потери по инвентаризации)",
              en: "Write-offs recorded by Fargo (part of the stock loss)",
            })}
          </SectionTitle>
          <div className="max-w-2xl overflow-hidden rounded-lg border border-border bg-surface">
            <EntryGrid
              entity="opexFargo"
              rows={writeOffRows}
              readOnly={!ctx.canEdit}
              defaults={{ monthId: ctx.monthId }}
              sumFields={["amount"]}
              cols={[
                {
                  field: "categoryId",
                  label: ctx.l({ ru: "Категория", en: "Category" }),
                  type: "select",
                  options: writeOffCats.map((c) => ({ value: c.id, label: c.name })),
                },
                { field: "amount", label: ctx.l({ ru: "Сумма", en: "Amount" }), type: "number", width: "200px" },
              ]}
              emptyLabel={ctx.l({ ru: "Списаний в этом месяце нет", en: "No write-offs this month" })}
            />
          </div>
        </>
      )}
    </>
  );
}
