import { pageContext, type SearchParams } from "@/lib/page-context";
import { fmtN } from "@/lib/format";
import { Figure, SectionTitle } from "@/components/statement";
import EntryGrid from "@/components/EntryGrid";

export default async function CapitalPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const { dataset, monthId } = ctx;
  const upTo = dataset.contributions.filter((c) => c.date.slice(0, 7) <= monthId);
  const ti = upTo.reduce((s, c) => s + c.tiAmount, 0);
  const fargo = upTo.reduce((s, c) => s + c.fargoAmount, 0);
  const viaFargo = upTo.filter((c) => c.viaFargo).reduce((s, c) => s + c.tiAmount + c.fargoAmount, 0);
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label={ctx.l({ ru: "Капитал Turbo Impex", en: "Turbo Impex capital" })} value={fmtN(ti)} />
        <Figure label={ctx.l({ ru: "Капитал Fargo", en: "Fargo capital" })} value={fmtN(fargo)} />
        <Figure
          label={ctx.l({ ru: "Разница", en: "Difference" })}
          value={fmtN(Math.abs(ti - fargo))}
          sub={
            ti === fargo
              ? ctx.l({ ru: "вклады равны", en: "contributions are equal" })
              : ti > fargo
                ? ctx.l({ ru: "Fargo внёс меньше", en: "Fargo has contributed less" })
                : ctx.l({ ru: "Turbo Impex внёс меньше", en: "Turbo Impex has contributed less" })
          }
        />
        <Figure label={ctx.l({ ru: "Отправлено со счёта Fargo", en: "Sent from Fargo's account" })} value={fmtN(viaFargo)} />
      </div>
      <SectionTitle>{ctx.l({ ru: "Вклады в капитал", en: "Capital contributions" })}</SectionTitle>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <EntryGrid
          entity="contribution"
          rows={dataset.contributions.map((c) => ({ ...c, date: c.date.slice(0, 10), notes: c.notes ?? "" }))}
          readOnly={!ctx.canEditAny}
          defaults={{ date: `${monthId}-01`, viaFargo: false }}
          sumFields={["tiAmount", "fargoAmount"]}
          cols={[
            { field: "date", label: ctx.l({ ru: "Дата", en: "Date" }), type: "date", width: "140px" },
            { field: "tiAmount", label: "Turbo Impex", type: "number", width: "170px" },
            { field: "fargoAmount", label: "Fargo", type: "number", width: "170px" },
            { field: "viaFargo", label: ctx.l({ ru: "Со счёта Fargo", en: "From Fargo's account" }), type: "bool", width: "140px" },
            { field: "notes", label: ctx.l({ ru: "Примечание", en: "Note" }), type: "text" },
          ]}
          emptyLabel={ctx.l({ ru: "Вкладов нет", en: "No contributions" })}
        />
      </div>
    </>
  );
}
