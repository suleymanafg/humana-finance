import { pageContext, type SearchParams } from "@/lib/page-context";
import { DROP_THRESHOLD, loadTransition, salesContinuity } from "@/lib/transition/data";
import { ROUTES } from "@/lib/transition/model";
import { fmtN, fmtPct } from "@/lib/format";
import { Notice, SectionTitle, Toolbar } from "@/components/statement";
import { Badge } from "@/components/ui";
import EntryGrid from "@/components/EntryGrid";
import ImportButton from "@/components/transition/ImportButton";

const short = (m: string) => `${m.slice(5, 7)}.${m.slice(2, 4)}`;
const fmtDate = (d: string) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}` : "—");

export default async function TransitionSales({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const data = await loadTransition();
  const s = await salesContinuity(data);
  const drops = s.rows.filter((r) => r.drop);
  const regionOptions = data.regions.map((r) => ({ value: r.id, label: r.name }));
  const tiRows = [...data.tiSales]
    .sort((a, b) => b.monthId.localeCompare(a.monthId))
    .map((t) => ({ id: t.id, monthId: t.monthId, regionId: t.regionId, amount: t.amount, units: t.units, notes: t.notes ?? "" }));
  const totals = s.months.map((_, i) => s.rows.reduce((sum, r) => sum + r.total[i], 0));
  const tiTotals = s.months.map((_, i) => s.rows.reduce((sum, r) => sum + r.ti[i], 0));

  return (
    <>
      <Toolbar>
        <p className="max-w-3xl text-[12.5px] text-muted">
          {ctx.l({
            ru: `Продажи по каналам за месяц: Fargo (из 1С) плюс TI (вносится ниже) — чтобы видеть, не проседает ли канал при переходе. Падение больше ${Math.round(-DROP_THRESHOLD * 100)}% к базе после перехода отмечается красным.`,
            en: `Monthly sales by channel: Fargo (from 1C) plus TI (entered below) — to see whether a channel dips across its switch. A drop of more than ${Math.round(-DROP_THRESHOLD * 100)}% against the baseline after the switch is flagged red.`,
          })}
        </p>
      </Toolbar>

      {drops.length > 0 && (
        <Notice>
          {ctx.l({ ru: "Просели после перехода: ", en: "Dipped after the switch: " })}
          {drops.map((r) => `${r.name} (${fmtPct(r.change)})`).join(", ")}
        </Notice>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="tbl">
          <thead>
            <tr>
              <th className="sticky left-0 bg-surface">{ctx.l({ ru: "Канал", en: "Channel" })}</th>
              <th>{ctx.l({ ru: "Маршрут", en: "Route" })}</th>
              <th className="text-right">{ctx.l({ ru: "Переход", en: "Switch" })}</th>
              {s.months.map((m) => (
                <th key={m} className="text-right">
                  {short(m)}
                </th>
              ))}
              <th className="text-right">{ctx.l({ ru: "База / мес.", en: "Baseline / mo" })}</th>
              <th className="text-right">{ctx.l({ ru: "Последний к базе", en: "Latest vs base" })}</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => {
              const switchMonth = r.switchDate.slice(0, 7);
              return (
                <tr key={r.regionId}>
                  <td className="sticky left-0 bg-surface">{r.name}</td>
                  <td>
                    <Badge tone={ROUTES[r.route]?.tone}>{ctx.l(ROUTES[r.route]?.label ?? { ru: r.route, en: r.route })}</Badge>
                  </td>
                  <td className="num text-right">{fmtDate(r.switchDate)}</td>
                  {s.months.map((m, i) => (
                    <td
                      key={m}
                      className={`num text-right ${switchMonth && m >= switchMonth ? "bg-accent-soft-bg" : ""}`}
                      title={r.ti[i] ? `Fargo ${fmtN(r.fargo[i])} · TI ${fmtN(r.ti[i])}` : undefined}
                    >
                      {r.total[i] ? fmtN(r.total[i]) : "—"}
                    </td>
                  ))}
                  <td className="num text-right">{fmtN(r.baseline)}</td>
                  <td className={`num text-right ${r.drop ? "font-semibold text-danger" : r.change !== null && r.change < 0 ? "text-danger" : ""}`}>
                    {fmtPct(r.change)}
                  </td>
                </tr>
              );
            })}
            <tr className="font-semibold">
              <td className="sticky left-0 bg-surface">{ctx.l({ ru: "Итого", en: "Total" })}</td>
              <td />
              <td />
              {totals.map((v, i) => (
                <td key={s.months[i]} className="num text-right">
                  {fmtN(v)}
                </td>
              ))}
              <td className="num text-right">{fmtN(s.rows.reduce((sum, r) => sum + (r.baseline ?? 0), 0))}</td>
              <td />
            </tr>
            <tr className="text-muted">
              <td className="sticky left-0 bg-surface">{ctx.l({ ru: "из них TI", en: "of which TI" })}</td>
              <td />
              <td />
              {tiTotals.map((v, i) => (
                <td key={s.months[i]} className="num text-right">
                  {v ? fmtN(v) : "—"}
                </td>
              ))}
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px] text-muted">
        {ctx.l({
          ru: "Подсвечены месяцы после перехода канала. Суммы по ценам с НДС; месяц, который ещё идёт, неполный.",
          en: "Months after a channel's switch are shaded. Amounts at prices incl. VAT; a month still running is incomplete.",
        })}
      </p>

      <SectionTitle
        right={
          <ImportButton
            kind="tiSales"
            title={{ ru: "Загрузить продажи TI", en: "Upload TI's sales" }}
            hint={{
              ru: "Продажи TI по регионам за месяц (например, из SmartUp). Регион находится по названию канала; строки месяц+регион перезаписываются.",
              en: "TI's sales by region for a month (e.g. from SmartUp). The region is matched by channel name; a month+region row is overwritten.",
            }}
            fields={[
              { key: "month", label: { ru: "Месяц (ГГГГ-ММ или дата)", en: "Month (YYYY-MM or a date)" }, required: true, synonyms: ["месяц", "период", "дата", "month", "period", "date"] },
              { key: "region", label: { ru: "Регион / канал", en: "Region / channel" }, required: true, synonyms: ["регион", "канал", "область", "region", "channel"] },
              { key: "amount", label: { ru: "Сумма с НДС", en: "Amount incl. VAT" }, required: true, synonyms: ["сумма", "выручка", "amount", "revenue", "sales"] },
              { key: "units", label: { ru: "Штук", en: "Units" }, synonyms: ["колич", "шт", "units", "qty"] },
            ]}
          />
        }
      >
        {ctx.l({ ru: "Продажи TI после перехода", en: "TI's sales after the switch" })}
      </SectionTitle>
      <div className="max-w-4xl overflow-hidden rounded-lg border border-border bg-surface">
        <EntryGrid
          entity="trTiSale"
          rows={tiRows}
          defaults={{ monthId: new Date().toISOString().slice(0, 7) }}
          sumFields={["amount", "units"]}
          cols={[
            { field: "monthId", label: ctx.l({ ru: "Месяц (ГГГГ-ММ)", en: "Month (YYYY-MM)" }), type: "text", width: "130px" },
            { field: "regionId", label: ctx.l({ ru: "Канал", en: "Channel" }), type: "select", options: regionOptions, width: "220px" },
            { field: "amount", label: ctx.l({ ru: "Сумма с НДС", en: "Amount incl. VAT" }), type: "number", width: "160px" },
            { field: "units", label: ctx.l({ ru: "Штук", en: "Units" }), type: "number", nullable: true, width: "100px" },
            { field: "notes", label: ctx.l({ ru: "Заметки", en: "Notes" }), type: "text" },
          ]}
          emptyLabel={ctx.l({ ru: "Пока нет продаж TI — появятся после первого перехода", en: "No TI sales yet — they start with the first switch" })}
        />
      </div>
    </>
  );
}
