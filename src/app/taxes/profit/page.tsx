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
        <Figure
          label={ctx.l({ ru: "Переплата на конец месяца (к возврату)", en: "Overpaid at month-end (to come back)" })}
          value={fmtN(b?.ti.profitTaxOverpaid ?? 0)}
        />
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
      <SectionTitle>{ctx.l({ ru: "Переплата налога на прибыль", en: "Profit tax overpaid" })}</SectionTitle>
      <p className="mb-3 max-w-3xl text-[12.5px] text-muted">
        {ctx.l({
          ru: "Деньги у налоговой сверх начисленного налога: оплачено по расчёту, который потом отменили, или пени, которые потом сняли. Это не расход: остаток стоит в балансе TI как актив, пока деньги не вернутся на счёт или не уйдут в зачёт другого налога — это колонка «Вернулось или зачтено».",
          en: "Money the tax office holds beyond the tax charged: paid against a return that was later cancelled, or penalties later removed. Not a cost: the balance sits in TI's balance sheet as an asset until it comes back to the bank or covers another tax — that is the «Came back or offset» column.",
        })}
      </p>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <EntryGrid
          entity="taxOverpayment"
          rows={(dataset.taxOverpayments ?? []).map((o) => ({ ...o, notes: o.notes ?? "" }))}
          readOnly={!ctx.canEditAny}
          defaults={{ monthId }}
          sumFields={["paid", "returned"]}
          cols={[
            { field: "monthId", label: ctx.l({ ru: "Месяц", en: "Month" }), type: "select", options: monthOptions, width: "170px" },
            { field: "description", label: ctx.l({ ru: "Что", en: "What" }), type: "text" },
            { field: "paid", label: ctx.l({ ru: "Оплачено сверх налога", en: "Paid beyond the tax" }), type: "number", width: "170px" },
            { field: "returned", label: ctx.l({ ru: "Вернулось или зачтено", en: "Came back or offset" }), type: "number", width: "170px" },
            { field: "notes", label: ctx.l({ ru: "Примечание", en: "Notes" }), type: "text" },
          ]}
          emptyLabel={ctx.l({ ru: "Переплаты нет", en: "No overpayment" })}
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
