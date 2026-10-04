import Link from "next/link";
import { pageContext, type SearchParams } from "@/lib/page-context";
import { fargoVatStatement } from "@/lib/statements";
import { fmtN, fmtPct } from "@/lib/format";
import { ButtonLink, Segmented, SectionTitle, StatementTable, Toolbar } from "@/components/statement";
import { SCALE_OPTIONS, VIEW_OPTIONS, parseScale } from "@/lib/statement-ui";
import EntryGrid from "@/components/EntryGrid";

export default async function FargoVatPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const { dataset, computed, monthId } = ctx;
  const view = sp.view === "months" ? "months" : "month";
  const scale = parseScale(sp.units);
  const f = computed.fargo.find((x) => x.monthId === monthId);
  const channels = dataset.channels
    .map((c) => {
      const sales = f?.salesByChannel[c.id] ?? 0;
      return { id: c.id, name: c.name, cashPct: c.cashPct, sales, cash: sales * c.cashPct, bank: sales * (1 - c.cashPct) };
    })
    .filter((c) => c.sales !== 0)
    .sort((a, b) => b.sales - a.sales);
  const totals = channels.reduce((t, c) => ({ sales: t.sales + c.sales, cash: t.cash + c.cash, bank: t.bank + c.bank }), { sales: 0, cash: 0, bank: 0 });
  const returns = dataset.fargoVatReturns.map((r) => ({ ...r, id: r.id ?? r.monthId }));
  const monthOptions = dataset.months.map((m) => ({ value: m.id, label: ctx.l({ ru: m.nameRu, en: m.nameEn }) }));
  const compared = dataset.fargoVatReturns
    .map((r) => ({ r, m: computed.fargo.find((x) => x.monthId === r.monthId) }))
    .filter((x) => x.m)
    .sort((a, b) => (a.r.monthId < b.r.monthId ? 1 : -1));

  return (
    <>
      <Toolbar>
        <Segmented param="view" value={view} options={VIEW_OPTIONS} />
        <Segmented param="units" value={String(scale)} options={SCALE_OPTIONS} />
        <div className="ml-auto">
          <ButtonLink href={`/api/export/statement?kind=fargo-vat&month=${monthId}&locale=${ctx.locale}`}>
            {ctx.l({ ru: "Скачать Excel", en: "Download Excel" })}
          </ButtonLink>
        </div>
      </Toolbar>
      <StatementTable statement={fargoVatStatement(computed)} months={ctx.months} monthId={monthId} view={view} scale={scale} openMonths={ctx.openMonths} />

      <SectionTitle
        right={
          ctx.isAdmin && (
            <Link href="/settings" className="text-[12.5px] text-accent hover:underline">
              {ctx.l({ ru: "Доли наличных — в справочниках", en: "Cash shares are in reference data" })}
            </Link>
          )
        }
      >
        {ctx.l({ ru: "Продажи по каналам: наличные и банк", en: "Sales by channel: cash and bank" })}
      </SectionTitle>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="stmt">
          <thead>
            <tr>
              <th>{ctx.l({ ru: "Канал", en: "Channel" })}</th>
              <th>{ctx.l({ ru: "Доля наличных", en: "Cash share" })}</th>
              <th>{ctx.l({ ru: "Продажи с НДС", en: "Sales incl. VAT" })}</th>
              <th>{ctx.l({ ru: "Наличными", en: "Cash" })}</th>
              <th>{ctx.l({ ru: "Через банк", en: "Bank" })}</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{fmtPct(c.cashPct, 0)}</td>
                <td>{fmtN(c.sales)}</td>
                <td>{fmtN(c.cash)}</td>
                <td>{fmtN(c.bank)}</td>
              </tr>
            ))}
            <tr className="is-subtotal">
              <td>{ctx.l({ ru: "Итого", en: "Total" })}</td>
              <td>{totals.sales !== 0 ? fmtPct(totals.cash / totals.sales) : "—"}</td>
              <td>{fmtN(totals.sales)}</td>
              <td>{fmtN(totals.cash)}</td>
              <td>{fmtN(totals.bank)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <SectionTitle>{ctx.l({ ru: "Декларации Fargo по НДС", en: "Fargo's VAT returns" })}</SectionTitle>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <EntryGrid
          entity="fargoVatReturn"
          rows={returns}
          readOnly={!ctx.canEditAny}
          defaults={{ monthId }}
          cols={[
            { field: "monthId", label: ctx.l({ ru: "Месяц", en: "Month" }), type: "select", options: monthOptions, width: "170px" },
            { field: "declaredSales", label: ctx.l({ ru: "Продажи без НДС", en: "Sales ex-VAT" }), type: "number" },
            { field: "outputVat", label: ctx.l({ ru: "Начислено", en: "Output VAT" }), type: "number" },
            { field: "inputVat", label: ctx.l({ ru: "Зачёт", en: "Input VAT" }), type: "number" },
            { field: "paid", label: ctx.l({ ru: "Уплачено", en: "Paid" }), type: "number" },
          ]}
          emptyLabel={ctx.l({ ru: "Декларации Fargo пока не внесены", en: "No returns from Fargo yet" })}
        />
      </div>
      {compared.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="stmt">
            <thead>
              <tr>
                <th>{ctx.l({ ru: "Месяц", en: "Month" })}</th>
                <th>{ctx.l({ ru: "Начислено: расчёт − декларация", en: "Output: model − return" })}</th>
                <th>{ctx.l({ ru: "Зачёт: расчёт − декларация", en: "Input: model − return" })}</th>
                <th>{ctx.l({ ru: "Уплачено: расчёт − декларация", en: "Paid: model − return" })}</th>
              </tr>
            </thead>
            <tbody>
              {compared.map(({ r, m }) => (
                <tr key={r.monthId}>
                  <td>{monthOptions.find((o) => o.value === r.monthId)?.label}</td>
                  <td>{fmtN(m!.vat.outputBank + m!.vat.outputCash - r.outputVat)}</td>
                  <td>{fmtN(m!.vat.input - r.inputVat)}</td>
                  <td>{fmtN(m!.vat.paid - r.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
