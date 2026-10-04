import { pageContext, type SearchParams } from "@/lib/page-context";
import { fmtN } from "@/lib/format";
import { Figure, SectionTitle } from "@/components/statement";
import EntryGrid from "@/components/EntryGrid";

export default async function OtherReceiptsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const { dataset, monthId } = ctx;
  const toDate = dataset.otherReceipts.filter((o) => o.date.slice(0, 7) <= monthId).reduce((s, o) => s + o.amount, 0);
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label={ctx.l({ ru: "Получено с начала", en: "Received to date" })} value={fmtN(toDate)} />
      </div>
      <SectionTitle>{ctx.l({ ru: "Деньги других покупателей в кассе TI", en: "Other customers' money in TI's cash desk" })}</SectionTitle>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <EntryGrid
          entity="otherReceipt"
          rows={dataset.otherReceipts.map((o) => ({ ...o, date: o.date.slice(0, 10), notes: o.notes ?? "" }))}
          readOnly={!ctx.canEditAny}
          defaults={{ date: `${monthId}-01` }}
          sumFields={["amount"]}
          cols={[
            { field: "date", label: ctx.l({ ru: "Дата", en: "Date" }), type: "date", width: "140px" },
            { field: "payer", label: ctx.l({ ru: "От кого", en: "From" }), type: "text" },
            { field: "amount", label: ctx.l({ ru: "Сумма", en: "Amount" }), type: "number", width: "170px" },
            { field: "notes", label: ctx.l({ ru: "Примечание", en: "Note" }), type: "text" },
          ]}
          emptyLabel={ctx.l({ ru: "Поступлений нет", en: "No receipts" })}
        />
      </div>
    </>
  );
}
