import { pageContext, type SearchParams } from "@/lib/page-context";
import { settlementStatement } from "@/lib/statements";
import { ButtonLink, Segmented, StatementTable, Toolbar } from "@/components/statement";
import { SCALE_OPTIONS, VIEW_OPTIONS, parseScale } from "@/lib/statement-ui";

export default async function SettlementMonthlyPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const view = sp.view === "month" ? "month" : "months";
  const scale = parseScale(sp.units);
  return (
    <>
      <Toolbar>
        <Segmented param="view" value={view} options={VIEW_OPTIONS} />
        <Segmented param="units" value={String(scale)} options={SCALE_OPTIONS} />
        <div className="ml-auto">
          <ButtonLink href={`/api/export/statement?kind=settlement&month=${ctx.monthId}&locale=${ctx.locale}`}>
            {ctx.l({ ru: "Скачать Excel", en: "Download Excel" })}
          </ButtonLink>
        </div>
      </Toolbar>
      <StatementTable
        statement={settlementStatement(ctx.computed)}
        months={ctx.months}
        monthId={ctx.monthId}
        view={view}
        scale={scale}
        openMonths={ctx.openMonths}
      />
    </>
  );
}
