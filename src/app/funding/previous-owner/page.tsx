import { pageContext, type SearchParams } from "@/lib/page-context";
import { fmtN } from "@/lib/format";
import { DocTable, Figure, SectionTitle } from "@/components/statement";
import EntryGrid from "@/components/EntryGrid";

export default async function PreviousOwnerPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const { dataset, computed, monthId } = ctx;
  const t = computed.ti.find((x) => x.monthId === monthId);
  const b = computed.balance.find((x) => x.monthId === monthId);
  const charges = dataset.vatCharges.filter((c) => c.bearer === "PRIOR_OWNER" && c.monthId <= monthId);
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label={ctx.l({ ru: "Переплата НДС, их часть", en: "VAT overpayment, their part" })} value={fmtN(t?.vat.priorOwnerPart ?? 0)} />
        <Figure label={ctx.l({ ru: "Их деньги у TI", en: "Their money held by TI" })} value={fmtN(b?.ti.priorOwnerCash ?? 0)} />
        <Figure
          label={ctx.l({ ru: "Итого TI должен прежнему владельцу", en: "TI owes the previous owner" })}
          value={fmtN((t?.vat.priorOwnerPart ?? 0) + (b?.ti.priorOwnerCash ?? 0))}
        />
      </div>
      <SectionTitle>{ctx.l({ ru: "Переплата НДС до совместной работы", en: "VAT overpayment before joint operations" })}</SectionTitle>
      <div className="max-w-3xl">
        <DocTable
          sections={[
            {
              title: { ru: "Лицевой счёт TI по НДС", en: "TI VAT tax account" },
              lines: [
                {
                  label: { ru: "Переплата на начало совместной работы", en: "Overpayment when joint operations began" },
                  value: computed.priorOwnerVatOpening,
                  href: "/taxes/ti-vat",
                },
                ...charges.map((c) => ({ label: { ru: c.description, en: c.description }, value: -c.amount })),
                {
                  label: { ru: "Остаётся за прежним владельцем", en: "Still owed to the previous owner" },
                  value: t?.vat.priorOwnerPart ?? 0,
                  kind: "total" as const,
                },
              ],
            },
          ]}
        />
      </div>
      <SectionTitle>{ctx.l({ ru: "Их деньги, прошедшие через TI", en: "Their money that passed through TI" })}</SectionTitle>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <EntryGrid
          entity="priorOwnerEntry"
          rows={dataset.priorOwner.map((p) => ({ ...p, date: p.date.slice(0, 10), notes: p.notes ?? "" }))}
          readOnly={!ctx.canEditAny}
          defaults={{ date: `${monthId}-01`, viaFargo: false }}
          sumFields={["received", "paid"]}
          cols={[
            { field: "date", label: ctx.l({ ru: "Дата", en: "Date" }), type: "date", width: "140px" },
            { field: "description", label: ctx.l({ ru: "Операция", en: "Operation" }), type: "text" },
            { field: "received", label: ctx.l({ ru: "Получено", en: "Received" }), type: "number", width: "160px" },
            { field: "paid", label: ctx.l({ ru: "Оплачено за них", en: "Paid for them" }), type: "number", width: "160px" },
            { field: "viaFargo", label: ctx.l({ ru: "Через счёт Fargo", en: "Via Fargo's account" }), type: "bool", width: "150px" },
          ]}
          emptyLabel={ctx.l({ ru: "Операций нет", en: "No operations" })}
        />
      </div>
    </>
  );
}
