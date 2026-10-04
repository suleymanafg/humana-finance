import { pageContext, type SearchParams } from "@/lib/page-context";
import { tiVatStatement } from "@/lib/statements";
import { ButtonLink, Segmented, SectionTitle, StatementTable, Toolbar } from "@/components/statement";
import { SCALE_OPTIONS, VIEW_OPTIONS, parseScale } from "@/lib/statement-ui";
import EntryGrid from "@/components/EntryGrid";

export default async function TiVatPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const { dataset, computed, monthId } = ctx;
  const view = sp.view === "months" ? "months" : "month";
  const scale = parseScale(sp.units);
  const sorted = [...dataset.vatAccount].sort((a, b) =>
    a.period === b.period ? a.sortOrder - b.sortOrder : a.period < b.period ? -1 : 1
  );
  const account = [];
  let running = 0;
  for (const e of sorted) {
    running += e.reduced - e.charged + e.paid - e.refunded;
    account.push({
      id: e.id,
      period: e.period,
      date: e.date ? e.date.slice(0, 10) : "",
      description: e.description,
      charged: e.charged,
      reduced: e.reduced,
      paid: e.paid,
      refunded: e.refunded,
      running,
      balanceAfter: e.balanceAfter,
    });
  }
  const monthOptions = dataset.months.map((m) => ({ value: m.id, label: ctx.l({ ru: m.nameRu, en: m.nameEn }) }));
  return (
    <>
      <Toolbar>
        <Segmented param="view" value={view} options={VIEW_OPTIONS} />
        <Segmented param="units" value={String(scale)} options={SCALE_OPTIONS} />
        <div className="ml-auto">
          <ButtonLink href={`/api/export/statement?kind=ti-vat&month=${monthId}&locale=${ctx.locale}`}>
            {ctx.l({ ru: "Скачать Excel", en: "Download Excel" })}
          </ButtonLink>
        </div>
      </Toolbar>
      <StatementTable statement={tiVatStatement(computed)} months={ctx.months} monthId={monthId} view={view} scale={scale} openMonths={ctx.openMonths} />

      <SectionTitle>{ctx.l({ ru: "Лицевой счёт по НДС", en: "VAT tax account" })}</SectionTitle>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <EntryGrid
          entity="tiVatAccountEntry"
          rows={account}
          readOnly={!ctx.canEditAny}
          defaults={{ period: monthId, sortOrder: account.length }}
          cols={[
            { field: "period", label: ctx.l({ ru: "Период (ГГГГ-ММ)", en: "Period (YYYY-MM)" }), type: "text", width: "120px" },
            { field: "date", label: ctx.l({ ru: "Дата", en: "Date" }), type: "date", width: "130px" },
            { field: "description", label: ctx.l({ ru: "Операция", en: "Operation" }), type: "text" },
            { field: "charged", label: ctx.l({ ru: "Начислено", en: "Charged" }), type: "number" },
            { field: "reduced", label: ctx.l({ ru: "Уменьшено", en: "Reduced" }), type: "number" },
            { field: "paid", label: ctx.l({ ru: "Уплачено", en: "Paid" }), type: "number" },
            { field: "refunded", label: ctx.l({ ru: "Возвращено", en: "Refunded" }), type: "number" },
            { field: "running", label: ctx.l({ ru: "Сальдо", en: "Balance" }), type: "number", readOnly: true },
          ]}
          emptyLabel={ctx.l({ ru: "Операций по лицевому счёту нет", en: "No tax account operations" })}
        />
      </div>

      <SectionTitle>{ctx.l({ ru: "Прочий НДС на лицевом счёте", en: "Other VAT on the tax account" })}</SectionTitle>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <EntryGrid
          entity="tiVatCharge"
          rows={dataset.vatCharges.map((c) => ({ ...c }))}
          readOnly={!ctx.canEditAny}
          defaults={{ monthId }}
          sumFields={["amount"]}
          cols={[
            { field: "monthId", label: ctx.l({ ru: "Месяц", en: "Month" }), type: "select", options: monthOptions, width: "170px" },
            { field: "description", label: ctx.l({ ru: "Описание", en: "Description" }), type: "text" },
            { field: "amount", label: ctx.l({ ru: "Сумма НДС", en: "VAT amount" }), type: "number", width: "170px" },
            {
              field: "bearer",
              label: ctx.l({ ru: "За чей счёт", en: "Borne by" }),
              type: "select",
              width: "200px",
              options: [
                { value: "TI", label: ctx.l({ ru: "Turbo Impex (расход)", en: "Turbo Impex (a cost)" }) },
                { value: "PRIOR_OWNER", label: ctx.l({ ru: "Прежний владелец", en: "Previous owner" }) },
              ],
            },
          ]}
          emptyLabel={ctx.l({ ru: "Нет", en: "None" })}
        />
      </div>
    </>
  );
}
