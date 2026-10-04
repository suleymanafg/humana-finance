import { pageContext, type SearchParams } from "@/lib/page-context";
import { dict, type DictKey } from "@/lib/i18n";
import { shortMonth } from "@/lib/statement-ui";
import OverviewView from "@/components/OverviewView";

export default async function OverviewPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const { computed, monthId, status, dataset } = ctx;
  const i = computed.monthIds.indexOf(monthId);
  const prev = i > 0 ? i - 1 : -1;
  const g = computed.group[i];
  const s = computed.settlement[i];
  const b = computed.balance[i];
  const sumTo = (rows: Array<{ netProfit: number }>) => rows.slice(0, i + 1).reduce((t, r) => t + r.netProfit, 0);
  const month = dataset.months[i];

  const cur = status.find((x) => x.monthId === monthId);
  const attention: Array<{ text: { ru: string; en: string }; href: string }> = [];
  if (cur) {
    const gaps: Array<[boolean, { ru: string; en: string }, string]> = [
      [cur.hasSales, { ru: "Продажи за месяц не внесены", en: "Sales not entered" }, "/sales"],
      [cur.hasOpexTi, { ru: "Расходы Turbo Impex не внесены", en: "Turbo Impex expenses not entered" }, "/expenses/ti"],
      [cur.hasOpexFargo, { ru: "Расходы Fargo не внесены", en: "Fargo expenses not entered" }, "/expenses/fargo"],
      [cur.hasStock, { ru: "Пересчёт склада не внесён", en: "Warehouse count not entered" }, "/goods/stock"],
      [cur.hasInputs, { ru: "Денежные остатки на конец месяца не внесены", en: "Month-end cash balances not entered" }, "/funding/balances"],
      [cur.hasAr, { ru: "Долги покупателей не внесены", en: "Customer receivables not entered" }, "/settlement/receivables"],
    ];
    for (const [ok, text, href] of gaps) if (!ok) attention.push({ text, href });
  }
  for (const h of computed.healthChecks.filter((h) => h.status === "warn" && h.severity === "warn")) {
    const k = `hc_${h.key}` as DictKey;
    const label = k in dict ? dict[k] : { ru: h.key, en: h.key };
    attention.push({ text: { ru: label.ru, en: label.en }, href: h.href });
  }

  const recent = computed.monthIds.slice(Math.max(0, i - 11), i + 1);
  const points = (pick: (m: string) => number) =>
    recent.map((m) => {
      const row = dataset.months.find((x) => x.id === m);
      return {
        key: m,
        short: shortMonth(m, ctx.locale),
        long: row ? ctx.l({ ru: row.nameRu, en: row.nameEn }) : m,
        value: pick(m),
        focus: m === monthId,
      };
    });
  const groupOf = (m: string) => computed.group[computed.monthIds.indexOf(m)];

  return (
    <OverviewView
      monthName={month ? ctx.l({ ru: month.nameRu, en: month.nameEn }) : monthId}
      figures={{
        net: g?.netProfit ?? 0,
        netCum: sumTo(computed.group),
        revenue: g?.revenue ?? 0,
        revenuePrev: prev >= 0 ? computed.group[prev].revenue : null,
        margin: g && g.revenue !== 0 ? g.grossProfit / g.revenue : null,
        owes: s?.owes ?? 0,
        owesPrev: prev >= 0 ? computed.settlement[prev].owes : null,
        stock: b?.group.stock ?? 0,
        stockUnits: Object.values(computed.fifo).reduce(
          (t, p) => t + (p.months[monthId]?.fargoStockUnits ?? 0) + (p.months[monthId]?.tiStockUnits ?? 0),
          0
        ),
      }}
      results={[
        { label: { ru: "Turbo Impex", en: "Turbo Impex" }, month: computed.ti[i]?.netProfit ?? 0, cum: sumTo(computed.ti), href: "/statements/pnl?entity=ti" },
        { label: { ru: "Fargo, бизнес Humana", en: "Fargo, Humana business" }, month: computed.fargo[i]?.netProfit ?? 0, cum: sumTo(computed.fargo), href: "/statements/pnl?entity=fargo" },
        { label: { ru: "Группа", en: "Group" }, month: g?.netProfit ?? 0, cum: sumTo(computed.group), strong: true, href: "/statements/pnl" },
      ]}
      attention={attention}
      revenue={points((m) => groupOf(m)?.revenue ?? 0)}
      net={points((m) => groupOf(m)?.netProfit ?? 0)}
    />
  );
}
