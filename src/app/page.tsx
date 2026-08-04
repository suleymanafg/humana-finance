import { getComputed } from "@/lib/data";
import { dict } from "@/lib/i18n";
import { computeMonthStatus, defaultMonthId } from "@/lib/month-status";
import { resolveMonthId } from "@/lib/month";
import { UZ_REGIONS } from "@/lib/uz-map";
import { costProductIdOf } from "@/lib/engine/compute";
import DashboardView from "@/components/DashboardView";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const { dataset, computed } = await getComputed();
  const status = computeMonthStatus(dataset);
  const monthId = await resolveMonthId(
    month,
    dataset.months,
    defaultMonthId(status, dataset.months[0]?.id ?? "")
  );

  const idx = computed.monthly.findIndex((m) => m.monthId === monthId);
  const monthly = idx >= 0 ? computed.monthly[idx] : null;
  const prior = idx > 0 ? computed.monthly[idx - 1] : null;
  const active = computed.monthly.filter((m) => m.revenue !== 0);

  // ── attention list: missing data for the month + top health warnings ──
  const cur = status.find((s) => s.monthId === monthId);
  const attention: Array<{ text: { ru: string; en: string }; href: string; tone: "warn" | "danger" }> = [];
  if (cur) {
    const missing: Array<[boolean, { ru: string; en: string }, string]> = [
      [cur.hasSales, { ru: "Продажи за месяц не внесены", en: "Sales not entered" }, `/sales?month=${monthId}`],
      [cur.hasOpexTi, { ru: "Расходы Turbo Impex не внесены", en: "Turbo Impex expenses missing" }, `/opex-ti?month=${monthId}`],
      [cur.hasOpexFargo, { ru: "Расходы Fargo не внесены", en: "Fargo expenses missing" }, `/opex-fargo?month=${monthId}`],
      [cur.hasStock, { ru: "Остатки на складах не внесены", en: "Stock counts missing" }, `/close?month=${monthId}`],
      [cur.hasInputs, { ru: "Балансовые вводы не заполнены", en: "Balance inputs missing" }, `/close?month=${monthId}`],
    ];
    for (const [ok, text, href] of missing) {
      if (!ok) attention.push({ text, href, tone: "warn" });
    }
  }
  // informational checks don't belong on the dashboard action list
  const INFO_CHECKS = new Set(["goldenValues", "negativeSaleQty"]);
  for (const h of computed.healthChecks.filter((h) => h.status === "warn")) {
    if (INFO_CHECKS.has(h.key)) continue;
    const k = `hc_${h.key}` as keyof typeof dict;
    const label = k in dict ? dict[k] : { ru: h.key, en: h.key };
    attention.push({ text: { ru: label.ru, en: label.en }, href: h.href, tone: "danger" });
  }

  // ── region distribution for the month ──
  const channelByName = new Map(dataset.channels.map((c) => [c.name, c.id]));
  const seen = new Set<string>();
  const regions: Array<{ name: { ru: string; en: string }; revenue: number }> = [];
  for (const r of UZ_REGIONS) {
    if (r.channels.length === 0) continue;
    const sig = [...r.channels].sort().join("|");
    if (seen.has(sig)) continue;
    seen.add(sig);
    const revenue = r.channels.reduce(
      (a, name) => a + (monthly?.revenueByChannel[channelByName.get(name) ?? ""] ?? 0),
      0
    );
    if (revenue > 0) regions.push({ name: { ru: r.nameRu, en: r.nameEn }, revenue });
  }
  regions.sort((a, b) => b.revenue - a.revenue);
  const regionTotal = regions.reduce((a, r) => a + r.revenue, 0);
  const top3 = regions.slice(0, 3);
  const monthRevenue = monthly?.revenue ?? 0;
  const others = monthRevenue - top3.reduce((a, r) => a + r.revenue, 0);
  void regionTotal;

  // ── top products for the month ──
  const topProducts = Object.entries(monthly?.revenueByProduct ?? {})
    .map(([pid, revenue]) => {
      const p = dataset.products.find((x) => x.id === pid);
      const qty = monthly?.qtyByProduct[pid] ?? 0;
      const cost = computed.productCosts[costProductIdOf(pid, dataset)]?.avgTiCost ?? 0;
      const realised = qty !== 0 ? revenue / qty : 0;
      return {
        name: p?.nameRu ?? pid,
        qty,
        revenue,
        marginPct: realised !== 0 ? (realised - cost) / realised : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  return (
    <DashboardView
      months={dataset.months}
      monthId={monthId}
      netProfit={monthly?.netProfit ?? 0}
      priorNetProfit={prior?.netProfit ?? null}
      priorMonthId={prior?.monthId ?? null}
      netSeries={active.map((m) => m.netProfit)}
      revenue={monthRevenue}
      priorRevenue={prior?.revenue ?? null}
      gpMarginPct={monthly?.gpMarginPct ?? 0}
      priorGpMarginPct={prior?.gpMarginPct ?? null}
      expenses={monthly?.totalOpex ?? 0}
      expensesShare={monthRevenue !== 0 ? (monthly?.totalOpex ?? 0) / monthRevenue : 0}
      trend={active.map((m) => ({ monthId: m.monthId, revenue: m.revenue }))}
      attention={attention.slice(0, 3)}
      moreAttention={Math.max(0, attention.length - 3)}
      regions={[...top3, ...(others > 0 ? [{ name: { ru: "Другие каналы", en: "Other channels" }, revenue: others }] : [])]}
      settlement={
        computed.settlement.find((s) => s.monthId === monthId) ?? null
      }
      topProducts={topProducts}
    />
  );
}
