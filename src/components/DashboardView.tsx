"use client";

// Dashboard per the approved Stitch design: hero net-profit card with a ghost
// sparkline → three quiet KPI cards → revenue trend + attention list →
// sales by region + Fargo↔TI settlement → top products.
import Link from "next/link";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { useT } from "@/lib/locale-context";
import { fmtN, fmtPct } from "@/lib/format";
import { IconAlert, IconArrowDown, IconArrowUp, IconChevronRight } from "./icons";
import type { MonthIn, SettlementRow } from "@/lib/engine/types";

const INDIGO = "#1f108e";

interface Bi {
  ru: string;
  en: string;
}

export default function DashboardView({
  months,
  monthId,
  netProfit,
  cumNetProfit,
  priorNetProfit,
  priorMonthId,
  netSeries,
  revenue,
  priorRevenue,
  gpMarginPct,
  priorGpMarginPct,
  expenses,
  expensesShare,
  trend,
  attention,
  moreAttention,
  regions,
  settlement,
  topProducts,
}: {
  months: MonthIn[];
  monthId: string;
  netProfit: number;
  cumNetProfit: number;
  priorNetProfit: number | null;
  priorMonthId: string | null;
  netSeries: number[];
  revenue: number;
  priorRevenue: number | null;
  gpMarginPct: number;
  priorGpMarginPct: number | null;
  expenses: number;
  expensesShare: number;
  trend: Array<{ monthId: string; revenue: number }>;
  attention: Array<{ text: Bi; href: string; tone: "warn" | "danger" }>;
  moreAttention: number;
  regions: Array<{ name: Bi; revenue: number }>;
  settlement: SettlementRow | null;
  topProducts: Array<{ name: string; qty: number; revenue: number; marginPct: number }>;
}) {
  const { t, locale } = useT();
  const monthName = (id: string | null) => {
    const m = months.find((x) => x.id === id);
    return m ? (locale === "ru" ? m.nameRu : m.nameEn) : "";
  };
  // "Относительно" governs the genitive case in Russian
  const GENITIVE: Record<string, string> = {
    Январь: "Января", Февраль: "Февраля", Март: "Марта", Апрель: "Апреля",
    Май: "Мая", Июнь: "Июня", Июль: "Июля", Август: "Августа",
    Сентябрь: "Сентября", Октябрь: "Октября", Ноябрь: "Ноября", Декабрь: "Декабря",
  };
  const monthNameGen = (id: string | null) => {
    const name = monthName(id);
    if (locale !== "ru") return name;
    const [m, y] = name.split(" ");
    return `${GENITIVE[m] ?? m} ${y ?? ""}`.trim();
  };
  const short = (id: string) => monthName(id).split(" ")[0].slice(0, 3).toUpperCase();
  const bi = (v: Bi) => (locale === "ru" ? v.ru : v.en);

  const netChange =
    priorNetProfit != null && priorNetProfit !== 0
      ? ((netProfit - priorNetProfit) / Math.abs(priorNetProfit)) * 100
      : null;

  // ghost sparkline path for the hero card
  const sparkPath = (() => {
    if (netSeries.length < 2) return "";
    const w = 200;
    const h = 100;
    const min = Math.min(...netSeries);
    const max = Math.max(...netSeries);
    const span = max - min || 1;
    return netSeries
      .map((v, i) => {
        const x = (i / (netSeries.length - 1)) * w;
        const y = h - 10 - ((v - min) / span) * (h - 20);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  })();

  const maxRegion = Math.max(1, ...regions.map((r) => r.revenue));

  return (
    <div className="space-y-10 pb-16">
      {/* ── hero: net profit ── */}
      <section className="quiet-card relative flex flex-col justify-between overflow-hidden rounded-xl p-10 md:flex-row md:items-end">
        <div className="z-10 md:w-2/3">
          <div className="label-caps mb-2">
            {t("netProfitCum")} — {monthName(monthId)}
          </div>
          <div className="flex flex-wrap items-baseline gap-3">
            <span
              className={`font-display text-[44px] font-bold leading-[52px] tracking-[-0.02em] md:text-[48px] ${cumNetProfit < 0 ? "text-danger" : "text-accent"}`}
            >
              {fmtN(cumNetProfit)}
            </span>
            <span className="font-display text-[22px] font-semibold text-muted">UZS</span>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className="text-[13px] text-muted">
              {t("netProfitFor")} {monthNameGen(monthId)}:{" "}
              <span className={`num font-medium ${netProfit < 0 ? "text-danger" : "text-ink"}`}>
                {netProfit >= 0 ? "+" : ""}
                {fmtN(netProfit)}
              </span>
            </span>
            {netChange != null && (
              <>
                <span
                  className={`flex items-center gap-1 rounded-full px-3 py-1 text-[13px] font-medium ${
                    netChange >= 0 ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"
                  }`}
                >
                  {netChange >= 0 ? <IconArrowUp size={13} /> : <IconArrowDown size={13} />}
                  {Math.abs(netChange).toFixed(1)}%
                </span>
                <span className="text-[13px] text-muted">
                  {t("relativeTo")} {monthNameGen(priorMonthId)}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="mt-8 flex h-28 items-end justify-end md:mt-0 md:w-1/3">
          {sparkPath && (
            <svg viewBox="0 0 200 100" preserveAspectRatio="none" className="h-full w-full max-w-[240px] opacity-25">
              <path d={sparkPath} fill="none" stroke={INDIGO} strokeWidth="4" strokeLinecap="round" />
            </svg>
          )}
        </div>
        <div className="absolute -right-32 -top-32 h-64 w-64 rounded-full bg-accent/5 blur-3xl" />
      </section>

      {/* ── secondary KPIs ── */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="quiet-card flex min-h-[128px] flex-col justify-between gap-4 rounded-xl p-6">
          <div className="label-caps">{t("revenue")}</div>
          <div className="text-right">
            <div className="font-display text-[20px] font-semibold tracking-[-0.01em] xl:text-[24px]">
              {fmtN(revenue)} <span className="text-[13px] font-normal text-muted">UZS</span>
            </div>
            {priorRevenue != null && priorRevenue !== 0 && (
              <div className="mt-1 text-[12.5px] text-muted">
                {revenue >= priorRevenue ? "+" : ""}
                {(((revenue - priorRevenue) / Math.abs(priorRevenue)) * 100).toFixed(1)}%{" "}
                {t("relativeTo").toLowerCase()} {monthNameGen(priorMonthId)}
              </div>
            )}
          </div>
        </div>
        <div className="quiet-card flex min-h-[128px] flex-col justify-between gap-4 rounded-xl p-6">
          <div className="label-caps">{t("gpMargin")}</div>
          <div className="text-right">
            <div className="font-display text-[20px] font-semibold tracking-[-0.01em] xl:text-[24px]">
              {fmtPct(gpMarginPct)}
            </div>
            {priorGpMarginPct != null && (
              <div
                className={`mt-1 text-[12.5px] ${gpMarginPct >= priorGpMarginPct ? "text-ok" : "text-danger"}`}
              >
                {gpMarginPct >= priorGpMarginPct ? "+" : "−"}
                {Math.abs((gpMarginPct - priorGpMarginPct) * 100).toFixed(1)}{" "}
                {locale === "ru" ? "п.п. к пред. месяцу" : "pp vs prior"}
              </div>
            )}
          </div>
        </div>
        <div className="quiet-card flex min-h-[128px] flex-col justify-between gap-4 rounded-xl p-6">
          <div className="label-caps">{t("totalOpex")}</div>
          <div className="text-right">
            <div className="font-display text-[20px] font-semibold tracking-[-0.01em] text-danger xl:text-[24px]">
              ({fmtN(expenses)}) <span className="text-[13px] font-normal text-muted">UZS</span>
            </div>
            <div className="mt-1 text-[12.5px] text-muted">
              {fmtPct(expensesShare)} {locale === "ru" ? "от выручки" : "of revenue"}
            </div>
          </div>
        </div>
      </section>

      {/* ── trend + attention ── */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="quiet-card flex flex-col rounded-xl p-8 lg:col-span-2">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h4 className="font-display text-[20px] font-semibold">{t("chartMonthlyTrend")}</h4>
              <p className="mt-0.5 text-[13px] text-muted">
                {trend.length > 0 &&
                  `${monthName(trend[0].monthId)} — ${monthName(trend[trend.length - 1].monthId)}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-accent" />
              <span className="label-caps">{t("revenue")}</span>
            </div>
          </div>
          <div className="min-h-[280px] flex-1">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={trend.map((p) => ({ name: short(p.monthId), value: p.revenue, id: p.monthId }))}>
                <defs>
                  <linearGradient id="rev-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={INDIGO} stopOpacity={0.08} />
                    <stop offset="100%" stopColor={INDIGO} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10.5, fill: "#64748b", fontWeight: 600 }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <Tooltip
                  contentStyle={{
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v: unknown) => [fmtN(Number(v ?? 0)), t("revenue")]}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={INDIGO}
                  strokeWidth={2}
                  fill="url(#rev-grad)"
                  dot={false}
                  activeDot={{ r: 4, fill: INDIGO, strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="quiet-card flex flex-col rounded-xl bg-surface-low p-8">
          <div className="mb-6 flex items-center gap-2">
            <span className={attention.length > 0 ? "text-danger" : "text-ok"}>
              <IconAlert size={19} />
            </span>
            <h4 className="font-display text-[20px] font-semibold">{t("attention")}</h4>
          </div>
          {attention.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-8 text-center text-[13px] text-ok">
              {t("allGood")}
            </div>
          ) : (
            <div className="space-y-3">
              {attention.map((a, i) => (
                <Link
                  key={i}
                  href={a.href}
                  className="flex gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent/40"
                >
                  <span
                    className={`w-1.5 shrink-0 self-stretch rounded-full ${a.tone === "danger" ? "bg-danger" : "bg-warn"}`}
                  />
                  <div className="min-w-0">
                    <p className="text-[13.5px] leading-snug">{bi(a.text)}</p>
                    <span className="label-caps mt-1.5 inline-block !text-accent">{t("fillIn")} →</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
          <Link
            href="/health"
            className="mt-auto flex items-center justify-center gap-2 pt-6 text-[13.5px] text-accent transition-all hover:gap-3"
          >
            {t("viewAllChecks")}
            {moreAttention > 0 && <span className="text-muted">(+{moreAttention})</span>}
            <IconChevronRight size={14} />
          </Link>
        </div>
      </section>

      {/* ── regions + settlement ── */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="quiet-card flex flex-col rounded-xl p-8">
          <div className="mb-8">
            <h4 className="font-display text-[20px] font-semibold">{t("dashRegions")}</h4>
            <p className="mt-0.5 text-[13px] text-muted">{t("dashRegionsNote")}</p>
          </div>
          <div className="flex-1 space-y-7">
            {regions.map((r, i) => {
              const share = revenue !== 0 ? r.revenue / revenue : 0;
              return (
                <div key={bi(r.name)}>
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-[14.5px]">{bi(r.name)}</span>
                    <span className={`num text-[14px] ${i === 0 ? "font-semibold text-accent" : ""}`}>
                      {fmtN(r.revenue)} UZS
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-surface-low">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${(r.revenue / maxRegion) * 100}%`,
                        background: INDIGO,
                        opacity: 1 - i * 0.2,
                      }}
                    />
                  </div>
                  <div className="label-caps mt-1 text-right">
                    {fmtPct(share)} {t("ofTotalShare")}
                  </div>
                </div>
              );
            })}
            {regions.length === 0 && (
              <div className="py-10 text-center text-[13px] text-muted">{t("noData")}</div>
            )}
          </div>
          <Link
            href={`/sales?month=${monthId}`}
            className="mt-6 flex items-center gap-2 text-[13.5px] text-accent transition-all hover:gap-3"
          >
            {t("fullReport")}
            <IconChevronRight size={14} />
          </Link>
        </div>

        <div className="quiet-card flex flex-col rounded-xl p-8">
          <div className="mb-8">
            <h4 className="font-display text-[20px] font-semibold">{t("settlementShort")}</h4>
            <p className="mt-0.5 text-[13px] text-muted">{t("settlementShortNote")}</p>
          </div>
          {settlement ? (
            <>
              <div className="space-y-1">
                {(
                  [
                    [t("dueToTi"), settlement.dueToTi],
                    [t("transfersMade"), -(settlement.cumTransfersCash + settlement.cumTransfersBank)],
                    [t("outstandingAr"), -settlement.outstandingAr],
                  ] as Array<[string, number]>
                ).map(([label, v]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between border-b border-border/60 py-4"
                  >
                    <span className="text-[14.5px]">{label}</span>
                    <span className={`num text-[14px] ${v < 0 ? "text-danger" : ""}`}>{fmtN(v)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-auto pt-8">
                <div className="rounded-xl bg-accent p-6 text-white">
                  <div className="label-caps mb-1 !text-white/70">{t("remainingBalance")}</div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-[28px] font-bold tracking-[-0.01em]">
                      {fmtN(settlement.remaining)}
                    </span>
                    <span className="text-[14px] opacity-80">UZS</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="py-10 text-center text-[13px] text-muted">{t("noData")}</div>
          )}
        </div>
      </section>

      {/* ── top products ── */}
      <section className="quiet-card overflow-hidden rounded-xl p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h4 className="font-display text-[20px] font-semibold">{t("topProducts")}</h4>
            <p className="mt-0.5 text-[13px] text-muted">{t("topProductsNote")}</p>
          </div>
          <Link href={`/sales?month=${monthId}`} className="text-[13.5px] text-accent hover:underline">
            {t("fullReport")}
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="label-caps pb-3 text-left font-semibold">{t("product")}</th>
                <th className="label-caps pb-3 text-right font-semibold">{t("volume")}</th>
                <th className="label-caps pb-3 text-right font-semibold">{t("revenue")} (UZS)</th>
                <th className="label-caps pb-3 text-right font-semibold">{t("margin")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {topProducts.map((p, i) => (
                <tr key={p.name} className="transition-colors hover:bg-surface-low">
                  <td className="flex items-center gap-3 py-4">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded bg-surface-low font-display text-[14px] font-bold ${i === 0 ? "text-accent" : "text-muted"}`}
                    >
                      {i + 1}
                    </span>
                    <span className="text-[14.5px] font-medium">{p.name}</span>
                  </td>
                  <td className="num py-4 text-right">{fmtN(p.qty)}</td>
                  <td className="num py-4 text-right">{fmtN(p.revenue)}</td>
                  <td className="py-4 text-right">
                    <span
                      className={`rounded px-2 py-1 text-[12px] font-medium ${
                        p.marginPct < 0.3 ? "bg-warn-soft text-warn" : "bg-accent-soft-bg text-accent-hover"
                      }`}
                    >
                      {fmtPct(p.marginPct)}
                    </span>
                  </td>
                </tr>
              ))}
              {topProducts.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-[13px] text-muted">
                    {t("noData")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
