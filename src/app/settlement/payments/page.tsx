import { pageContext, type SearchParams } from "@/lib/page-context";
import { fmtN } from "@/lib/format";
import { Figure, SectionTitle } from "@/components/statement";
import EntryGrid from "@/components/EntryGrid";
import MonthTotals from "@/components/MonthTotals";

export default async function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const i = ctx.computed.monthIds.indexOf(ctx.monthId);
  const s = ctx.computed.settlement[i];
  const rows = ctx.dataset.transfers
    .filter((t) => t.date.slice(0, 7) === ctx.monthId)
    .map((t) => ({ id: t.id, date: t.date.slice(0, 10), cashAmount: t.cashAmount, bankAmount: t.bankAmount, notes: t.notes ?? "" }));
  const byMonth = ctx.computed.settlement
    .filter((x) => x.monthId <= ctx.monthId)
    .map((x) => ({ monthId: x.monthId, values: [x.transfersCash, x.transfersBank, x.transfersCash + x.transfersBank, x.cashCum + x.bankCum] }));
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label={ctx.l({ ru: "Наличными за месяц", en: "Cash in the month" })} value={fmtN(s?.transfersCash ?? 0)} />
        <Figure label={ctx.l({ ru: "Через банк за месяц", en: "Bank in the month" })} value={fmtN(s?.transfersBank ?? 0)} />
        <Figure label={ctx.l({ ru: "Получено с начала", en: "Received to date" })} value={fmtN((s?.cashCum ?? 0) + (s?.bankCum ?? 0))} />
        <Figure label={ctx.l({ ru: "Fargo должен TI", en: "Fargo owes TI" })} value={fmtN(s?.owes ?? 0)} />
      </div>
      <SectionTitle>{ctx.l({ ru: "Платежи за месяц", en: "Payments in the month" })}</SectionTitle>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <EntryGrid
          entity="transfer"
          rows={rows}
          readOnly={!ctx.canEdit}
          defaults={{ date: `${ctx.monthId}-01` }}
          sumFields={["cashAmount", "bankAmount"]}
          cols={[
            { field: "date", label: ctx.l({ ru: "Дата", en: "Date" }), type: "date", width: "150px" },
            { field: "cashAmount", label: ctx.l({ ru: "Наличными", en: "Cash" }), type: "number", width: "180px" },
            { field: "bankAmount", label: ctx.l({ ru: "Через банк", en: "Bank" }), type: "number", width: "180px" },
            { field: "notes", label: ctx.l({ ru: "Примечание", en: "Note" }), type: "text" },
          ]}
          emptyLabel={ctx.l({ ru: "В этом месяце платежей нет", en: "No payments this month" })}
        />
      </div>
      <SectionTitle>{ctx.l({ ru: "По месяцам", en: "By month" })}</SectionTitle>
      <MonthTotals
        months={ctx.months}
        rows={byMonth}
        columns={[
          { ru: "Наличными", en: "Cash" },
          { ru: "Через банк", en: "Bank" },
          { ru: "Итого за месяц", en: "Month total" },
          { ru: "С начала", en: "To date" },
        ]}
      />
    </>
  );
}
