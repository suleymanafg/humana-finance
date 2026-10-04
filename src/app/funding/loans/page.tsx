import { pageContext, type SearchParams } from "@/lib/page-context";
import { fmtN } from "@/lib/format";
import { Figure, SectionTitle } from "@/components/statement";
import EntryGrid from "@/components/EntryGrid";

export default async function LoansPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const { dataset, monthId } = ctx;
  const upTo = dataset.loans.filter((l) => l.monthId <= monthId);
  const outstanding = upTo.reduce((s, l) => s + l.received - l.repaid, 0);
  const byLender = new Map<string, number>();
  for (const l of upTo) byLender.set(l.lender, (byLender.get(l.lender) ?? 0) + l.received - l.repaid);
  const monthOptions = dataset.months.map((m) => ({ value: m.id, label: ctx.l({ ru: m.nameRu, en: m.nameEn }) }));
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label={ctx.l({ ru: "Долг на конец месяца", en: "Owed at month-end" })} value={fmtN(outstanding)} />
        <Figure
          label={ctx.l({ ru: "Получено за месяц", en: "Received in the month" })}
          value={fmtN(dataset.loans.filter((l) => l.monthId === monthId).reduce((s, l) => s + l.received, 0))}
        />
        <Figure
          label={ctx.l({ ru: "Возвращено за месяц", en: "Repaid in the month" })}
          value={fmtN(dataset.loans.filter((l) => l.monthId === monthId).reduce((s, l) => s + l.repaid, 0))}
        />
      </div>
      <SectionTitle>{ctx.l({ ru: "Долг по кредиторам", en: "Owed by lender" })}</SectionTitle>
      <div className="max-w-3xl overflow-hidden rounded-lg border border-border bg-surface">
        <table className="stmt">
          <tbody>
            {[...byLender.entries()]
              .filter(([, v]) => Math.abs(v) >= 0.5)
              .map(([lender, v]) => (
                <tr key={lender}>
                  <td>{lender}</td>
                  <td className="w-48">{fmtN(v)}</td>
                </tr>
              ))}
            <tr className="is-subtotal">
              <td>{ctx.l({ ru: "Итого", en: "Total" })}</td>
              <td>{fmtN(outstanding)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <SectionTitle>{ctx.l({ ru: "Движение займов", en: "Loan movements" })}</SectionTitle>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <EntryGrid
          entity="loanMovement"
          rows={[...dataset.loans].sort((a, b) => (a.monthId < b.monthId ? -1 : 1)).map((l) => ({ ...l, notes: l.notes ?? "" }))}
          readOnly={!ctx.canEditAny}
          defaults={{ monthId }}
          sumFields={["received", "repaid"]}
          cols={[
            { field: "monthId", label: ctx.l({ ru: "Месяц", en: "Month" }), type: "select", options: monthOptions, width: "170px" },
            { field: "lender", label: ctx.l({ ru: "Кредитор", en: "Lender" }), type: "text" },
            { field: "received", label: ctx.l({ ru: "Получено", en: "Received" }), type: "number", width: "160px" },
            { field: "repaid", label: ctx.l({ ru: "Возвращено", en: "Repaid" }), type: "number", width: "160px" },
            { field: "notes", label: ctx.l({ ru: "Примечание", en: "Note" }), type: "text" },
          ]}
          emptyLabel={ctx.l({ ru: "Займов нет", en: "No loans" })}
        />
      </div>
    </>
  );
}
