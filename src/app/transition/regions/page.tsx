import { pageContext, type SearchParams } from "@/lib/page-context";
import { loadTransition, salesContinuity } from "@/lib/transition/data";
import { REGION_KINDS, REGION_STATUS, ROUTES, isSignedOutlet, optionsOf, ymd } from "@/lib/transition/model";
import { fmtN, fmtPct } from "@/lib/format";
import { SectionTitle, Toolbar } from "@/components/statement";
import EntryGrid from "@/components/EntryGrid";
import { SeedPlanButton } from "@/components/transition/TrActions";

export default async function TransitionRegions({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const data = await loadTransition();
  const sales = await salesContinuity(data);
  const baselineOf = new Map(sales.rows.map((r) => [r.regionId, r.baseline ?? 0]));
  const total = sales.rows.reduce((s, r) => s + (r.baseline ?? 0), 0);

  const rows = data.regions.map((r) => {
    const outlets = data.outlets.filter((o) => o.regionId === r.id && o.status !== "INACTIVE" && o.status !== "LOST");
    const base = baselineOf.get(r.id) ?? 0;
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      route: r.route,
      partner: r.partner ?? "",
      switchDate: ymd(r.switchDate),
      status: r.status,
      notes: r.notes ?? "",
      baseline: base,
      share: total > 0 ? (base / total) * 100 : 0,
      outlets: `${outlets.filter((o) => isSignedOutlet(o.status)).length} / ${outlets.length}`,
    };
  });

  const byRoute = Object.keys(ROUTES).map((route) => {
    const rs = rows.filter((r) => r.route === route);
    const base = rs.reduce((s, r) => s + r.baseline, 0);
    const switched = rs.filter((r) => r.status === "SWITCHED").reduce((s, r) => s + r.baseline, 0);
    return { route, count: rs.length, base, share: total > 0 ? base / total : null, switched };
  });

  return (
    <>
      <Toolbar>
        <p className="max-w-3xl text-[12.5px] text-muted">
          {ctx.l({
            ru: "Каждый канал продаж Fargo — регион, сеть или прочее — и как он переходит к TI. До даты перехода Fargo продаёт там как сейчас. «Продажи в месяц» — среднее за три месяца до перехода (или за последние три), по ценам с НДС.",
            en: "Each of Fargo's sales channels — a region, a chain or other — and how it moves to TI. Until its switch date Fargo sells there as now. «Sales a month» is the average of the three months before the switch (or the last three), at prices incl. VAT.",
          })}
        </p>
        <div className="ml-auto">
          <SeedPlanButton empty={data.regions.length === 0} />
        </div>
      </Toolbar>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <EntryGrid
          entity="trRegion"
          rows={rows}
          defaults={{ kind: "REGION", route: "UNDECIDED", status: "NOT_STARTED" }}
          cols={[
            { field: "name", label: ctx.l({ ru: "Канал / регион", en: "Channel / region" }), type: "text" },
            { field: "kind", label: ctx.l({ ru: "Тип", en: "Kind" }), type: "select", options: optionsOf(REGION_KINDS, ctx.locale), width: "110px" },
            { field: "route", label: ctx.l({ ru: "Маршрут", en: "Route" }), type: "select", options: optionsOf(ROUTES, ctx.locale), width: "170px" },
            { field: "partner", label: ctx.l({ ru: "Партнёр", en: "Partner" }), type: "text", width: "150px" },
            { field: "switchDate", label: ctx.l({ ru: "Дата перехода", en: "Switch date" }), type: "date", width: "140px" },
            { field: "status", label: ctx.l({ ru: "Статус", en: "Status" }), type: "select", options: optionsOf(REGION_STATUS, ctx.locale), width: "160px" },
            { field: "baseline", label: ctx.l({ ru: "Продажи в месяц", en: "Sales a month" }), type: "number", readOnly: true, width: "140px" },
            { field: "share", label: ctx.l({ ru: "Доля, %", en: "Share, %" }), type: "number", decimals: 1, readOnly: true, width: "80px" },
            { field: "outlets", label: ctx.l({ ru: "Точки: договор / все", en: "Outlets: signed / all" }), type: "text", readOnly: true, width: "120px" },
            { field: "notes", label: ctx.l({ ru: "Заметки", en: "Notes" }), type: "text" },
          ]}
          emptyLabel={ctx.l({ ru: "Загрузите стартовый план — он создаст строку на каждый канал", en: "Load the starting plan — it adds a row per channel" })}
        />
      </div>

      <SectionTitle>{ctx.l({ ru: "Продажи по маршрутам", en: "Sales by route" })}</SectionTitle>
      <div className="max-w-3xl overflow-hidden rounded-lg border border-border bg-surface">
        <table className="tbl">
          <thead>
            <tr>
              <th>{ctx.l({ ru: "Маршрут", en: "Route" })}</th>
              <th className="text-right">{ctx.l({ ru: "Каналов", en: "Channels" })}</th>
              <th className="text-right">{ctx.l({ ru: "Продажи в месяц", en: "Sales a month" })}</th>
              <th className="text-right">{ctx.l({ ru: "Доля", en: "Share" })}</th>
              <th className="text-right">{ctx.l({ ru: "Уже у TI", en: "Already with TI" })}</th>
            </tr>
          </thead>
          <tbody>
            {byRoute
              .filter((r) => r.count > 0)
              .map((r) => (
                <tr key={r.route}>
                  <td className={r.route === "UNDECIDED" ? "text-warn" : ""}>{ctx.l(ROUTES[r.route].label)}</td>
                  <td className="num text-right">{r.count}</td>
                  <td className="num text-right">{fmtN(r.base)}</td>
                  <td className="num text-right">{fmtPct(r.share)}</td>
                  <td className="num text-right">{r.switched ? fmtN(r.switched) : "—"}</td>
                </tr>
              ))}
            <tr className="font-semibold">
              <td>{ctx.l({ ru: "Итого", en: "Total" })}</td>
              <td className="num text-right">{rows.length}</td>
              <td className="num text-right">{fmtN(total)}</td>
              <td className="num text-right">{total > 0 ? "100.0%" : "—"}</td>
              <td className="num text-right">{fmtN(byRoute.reduce((s, r) => s + r.switched, 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
