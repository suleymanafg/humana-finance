import { pageContext, type SearchParams } from "@/lib/page-context";
import { settlementSummary } from "@/lib/statements";
import { fmtN } from "@/lib/format";
import { ButtonLink, DocTable, Figure, Toolbar } from "@/components/statement";

export default async function SettlementPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const summary = settlementSummary(ctx.computed, ctx.monthId);
  const i = ctx.computed.monthIds.indexOf(ctx.monthId);
  const s = ctx.computed.settlement[i];
  const prev = i > 0 ? ctx.computed.settlement[i - 1] : null;
  const monthName = ctx.l({
    ru: ctx.dataset.months[i]?.nameRu ?? ctx.monthId,
    en: ctx.dataset.months[i]?.nameEn ?? ctx.monthId,
  });
  if (!summary || !s) return null;
  return (
    <>
      <Toolbar>
        <div className="text-[13px] text-muted">
          {ctx.l({ ru: `На конец месяца: ${monthName}`, en: `At the end of ${monthName}` })}
        </div>
        <div className="ml-auto">
          <ButtonLink href={`/api/export/statement?kind=settlement&month=${ctx.monthId}&locale=${ctx.locale}`}>
            {ctx.l({ ru: "Скачать Excel", en: "Download Excel" })}
          </ButtonLink>
        </div>
      </Toolbar>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure
          label={ctx.l({ ru: "Fargo должен TI", en: "Fargo owes TI" })}
          value={fmtN(s.owes)}
          sub={
            prev
              ? `${ctx.l({ ru: "за месяц", en: "in the month" })} ${s.owes - prev.owes >= 0 ? "+" : "−"}${fmtN(Math.abs(s.owes - prev.owes))}`
              : undefined
          }
        />
        <Figure label={ctx.l({ ru: "из них через банк", en: "of which by bank" })} value={fmtN(s.byBank)} />
        <Figure label={ctx.l({ ru: "из них наличными", en: "of which in cash" })} value={fmtN(s.inCash)} />
        <Figure
          label={ctx.l({ ru: "Получено за месяц", en: "Received in the month" })}
          value={fmtN(s.transfersCash + s.transfersBank)}
          sub={`${ctx.l({ ru: "наличные", en: "cash" })} ${fmtN(s.transfersCash)} · ${ctx.l({ ru: "банк", en: "bank" })} ${fmtN(s.transfersBank)}`}
        />
      </div>
      <div className="max-w-3xl">
        <DocTable sections={summary.sections} />
        <p className={`mt-3 text-[12.5px] ${Math.abs(summary.check) >= 1 ? "text-danger" : "text-muted"}`}>
          {Math.abs(summary.check) >= 1
            ? ctx.l({
                ru: `Расчёт по деньгам и расчёт от акта сверки расходятся на ${fmtN(summary.check)}.`,
                en: `The cash calculation and the reconciliation-act calculation differ by ${fmtN(summary.check)}.`,
              })
            : ctx.l({
                ru: "Расчёт по собранным деньгам и расчёт от акта сверки совпадают.",
                en: "The calculation from the money collected and the one from the reconciliation act agree.",
              })}
        </p>
      </div>
    </>
  );
}
