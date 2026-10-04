import Link from "next/link";
import { pageContext, type SearchParams } from "@/lib/page-context";
import { balanceStatement, type Entity } from "@/lib/statements";
import {
  ButtonLink,
  Notice,
  Segmented,
  StatementTable,
  Toolbar,
} from "@/components/statement";
import { ENTITY_OPTIONS, SCALE_OPTIONS, VIEW_OPTIONS, parseScale } from "@/lib/statement-ui";

export default async function BalancePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const entity: Entity = sp.entity === "ti" || sp.entity === "fargo" ? sp.entity : "group";
  const view = sp.view === "months" ? "months" : "month";
  const scale = parseScale(sp.units);
  // a balance sheet needs the month-end cash figures; months without them are left out
  const withInputs = new Set(ctx.computed.balance.filter((b) => b.hasInputs).map((b) => b.monthId));
  const months =
    entity === "fargo" ? ctx.months : ctx.months.filter((m) => withInputs.has(m.id) || m.id === ctx.monthId);
  const missing = entity !== "fargo" && !withInputs.has(ctx.monthId);
  return (
    <>
      <Toolbar>
        <Segmented param="entity" value={entity} options={ENTITY_OPTIONS} />
        <Segmented param="view" value={view} options={VIEW_OPTIONS} />
        <Segmented param="units" value={String(scale)} options={SCALE_OPTIONS} />
        <div className="ml-auto">
          <ButtonLink href={`/api/export/statement?kind=balance&entity=${entity}&month=${ctx.monthId}&locale=${ctx.locale}`}>
            {ctx.l({ ru: "Скачать Excel", en: "Download Excel" })}
          </ButtonLink>
        </div>
      </Toolbar>
      {missing && (
        <Notice>
          {ctx.l({
            ru: "Денежные остатки на конец этого месяца не внесены, поэтому баланс неполный. ",
            en: "Month-end cash balances for this month are not entered, so the balance sheet is incomplete. ",
          })}
          <Link href="/funding/balances" className="underline">
            {ctx.l({ ru: "Внести остатки", en: "Enter balances" })}
          </Link>
        </Notice>
      )}
      <StatementTable
        statement={balanceStatement(entity, ctx.computed)}
        months={months}
        monthId={ctx.monthId}
        view={view}
        scale={scale}
        openMonths={ctx.openMonths}
      />
    </>
  );
}
