import { pageContext, type SearchParams } from "@/lib/page-context";
import { fmtN } from "@/lib/format";
import { Figure, SectionTitle } from "@/components/statement";
import EntryGrid from "@/components/EntryGrid";
import MonthTotals from "@/components/MonthTotals";

export default async function ProfitTaxPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const { dataset, computed, monthId } = ctx;
  const b = computed.balance.find((x) => x.monthId === monthId);
  const booked = computed.ti.filter((t) => t.monthId <= monthId).reduce((s, t) => s + t.profitTax, 0);
  const turnover = computed.fargo.filter((f) => f.monthId <= monthId).reduce((s, f) => s + f.incomeTax, 0);
  const monthOptions = dataset.months.map((m) => ({ value: m.id, label: ctx.l({ ru: m.nameRu, en: m.nameEn }) }));
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label={ctx.l({ ru: "Налог на прибыль TI, начислено с начала", en: "TI profit tax booked to date" })} value={fmtN(booked)} />
        <Figure label={ctx.l({ ru: "К оплате на конец месяца", en: "Payable at month-end" })} value={fmtN(b?.ti.profitTaxPayable ?? 0)} />
        <Figure label={ctx.l({ ru: "Оборотный налог Fargo с начала", en: "Fargo turnover tax to date" })} value={fmtN(turnover)} />
      </div>
      <SectionTitle>{ctx.l({ ru: "Декларации Turbo Impex по налогу на прибыль", en: "Turbo Impex profit tax returns" })}</SectionTitle>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <EntryGrid
          entity="taxFiling"
          rows={dataset.taxFilings.map((f) => ({ ...f, paidMonthId: f.paidMonthId ?? "" }))}
          readOnly={!ctx.canEditAny}
          defaults={{ bookedMonthId: monthId }}
          sumFields={["taxAmount"]}
          cols={[
            { field: "quarterLabel", label: ctx.l({ ru: "Период декларации", en: "Return period" }), type: "text" },
            { field: "bookedMonthId", label: ctx.l({ ru: "Начислено в месяце", en: "Booked in" }), type: "select", options: monthOptions, width: "180px" },
            { field: "taxAmount", label: ctx.l({ ru: "Сумма налога", en: "Tax" }), type: "number", width: "170px" },
            {
              field: "paidMonthId",
              label: ctx.l({ ru: "Оплачено в месяце", en: "Paid in" }),
              type: "select",
              options: [{ value: "", label: ctx.l({ ru: "не оплачено", en: "not paid" }) }, ...monthOptions],
              width: "180px",
            },
          ]}
          emptyLabel={ctx.l({ ru: "Деклараций нет", en: "No returns" })}
        />
      </div>
      <SectionTitle>{ctx.l({ ru: "Оборотный налог Fargo по месяцам", en: "Fargo turnover tax by month" })}</SectionTitle>
      <MonthTotals
        months={ctx.months}
        rows={computed.fargo
          .filter((f) => f.monthId <= monthId && f.salesAtPrice !== 0)
          .map((f) => ({ monthId: f.monthId, values: [f.salesAtPrice, f.incomeTax] }))}
        columns={[
          { ru: "Продажи с НДС", en: "Sales incl. VAT" },
          { ru: "Налог 1,9%", en: "Tax 1.9%" },
        ]}
      />
    </>
  );
}
