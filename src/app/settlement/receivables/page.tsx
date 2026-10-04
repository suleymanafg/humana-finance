import { pageContext, type SearchParams } from "@/lib/page-context";
import { fmtN } from "@/lib/format";
import { Figure, SectionTitle } from "@/components/statement";
import EntryGrid from "@/components/EntryGrid";
import MonthTotals from "@/components/MonthTotals";

export default async function ReceivablesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const rows = ctx.dataset.arEntries
    .filter((a) => a.monthId === ctx.monthId)
    .map((a) => ({ id: a.id, customerName: a.customerName, amount: a.amount }));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const months = [...new Set(ctx.dataset.arEntries.map((a) => a.monthId))].filter((m) => m <= ctx.monthId).sort();
  const i = ctx.computed.monthIds.indexOf(ctx.monthId);
  const prevTotal = i > 0 ? ctx.computed.settlement[i - 1].receivables : 0;
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label={ctx.l({ ru: "Долги покупателей на конец месяца", en: "Owed by customers at month-end" })} value={fmtN(total)} />
        <Figure label={ctx.l({ ru: "Изменение за месяц", en: "Change in the month" })} value={fmtN(total - prevTotal)} />
      </div>
      <SectionTitle>{ctx.l({ ru: "Покупатели", en: "Customers" })}</SectionTitle>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <EntryGrid
          entity="arEntry"
          rows={rows}
          readOnly={!ctx.canEdit}
          defaults={{ monthId: ctx.monthId }}
          sumFields={["amount"]}
          cols={[
            { field: "customerName", label: ctx.l({ ru: "Покупатель", en: "Customer" }), type: "text" },
            { field: "amount", label: ctx.l({ ru: "Долг на конец месяца", en: "Owed at month-end" }), type: "number", width: "220px" },
          ]}
          emptyLabel={ctx.l({ ru: "Долги покупателей за этот месяц не внесены", en: "No receivables entered for this month" })}
        />
      </div>
      <SectionTitle>{ctx.l({ ru: "По месяцам", en: "By month" })}</SectionTitle>
      <MonthTotals
        months={ctx.months}
        rows={months.map((m) => ({
          monthId: m,
          values: [ctx.dataset.arEntries.filter((a) => a.monthId === m).reduce((s, a) => s + a.amount, 0)],
        }))}
        columns={[{ ru: "Долги покупателей", en: "Customer receivables" }]}
      />
    </>
  );
}
