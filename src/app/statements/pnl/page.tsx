import { pageContext, type SearchParams } from "@/lib/page-context";
import { pnlStatement, type Entity } from "@/lib/statements";
import {
  ButtonLink,
  Segmented,
  StatementTable,
  Toolbar,
} from "@/components/statement";
import { ENTITY_OPTIONS, SCALE_OPTIONS, VIEW_OPTIONS, parseScale } from "@/lib/statement-ui";

export default async function PnlPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const entity: Entity = sp.entity === "ti" || sp.entity === "fargo" ? sp.entity : "group";
  const view = sp.view === "months" ? "months" : "month";
  const scale = parseScale(sp.units);
  return (
    <>
      <Toolbar>
        <Segmented param="entity" value={entity} options={ENTITY_OPTIONS} />
        <Segmented param="view" value={view} options={VIEW_OPTIONS} />
        <Segmented param="units" value={String(scale)} options={SCALE_OPTIONS} />
        <div className="ml-auto">
          <ButtonLink href={`/api/export/statement?kind=pnl&entity=${entity}&month=${ctx.monthId}&locale=${ctx.locale}`}>
            {ctx.l({ ru: "Скачать Excel", en: "Download Excel" })}
          </ButtonLink>
        </div>
      </Toolbar>
      <StatementTable
        statement={pnlStatement(entity, ctx.computed)}
        months={ctx.months}
        monthId={ctx.monthId}
        view={view}
        scale={scale}
        openMonths={ctx.openMonths}
      />
    </>
  );
}
