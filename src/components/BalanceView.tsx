"use client";

// Balance page: a plain month-end balance sheet — assets | liabilities +
// equity — with a traceable breakdown behind every figure. Everything that is
// typed in by hand (monthly inputs, stock, AR, capital, Fargo↔TI payments and
// the settlement waterfall) lives in «Ввод данных» → /close/balance.
import { useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardHeader, Modal, Num, PageTitle } from "./ui";
import { IconAlert, IconChevronRight, IconDownload } from "./icons";
import MonthStrip from "./MonthStrip";
import { useT } from "@/lib/locale-context";
import { fmtN, fmtPct } from "@/lib/format";
import { monthIdOfDate } from "@/lib/engine/compute";
import type {
  BalanceSheetRow,
  ContributionIn,
  MonthBalanceIn,
  MonthIn,
  SettlementRow,
  WarehouseIn,
} from "@/lib/engine/types";
import type { DictKey } from "@/lib/i18n";
import type { MonthStatus } from "@/lib/month-status";

interface StockRowUI {
  productId: string;
  name: string;
  unitCost: number;
  byWarehouse: Record<string, number>;
}

interface Trace {
  title: string;
  rows: Array<{ label: string; value: number | null; strong?: boolean }>;
  note?: string;
  href?: string;
}

const MIX_COLORS = ["#2a78d6", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7", "#eb6834"];
/** Section heading with its total on the same right edge as the lines below. */
function SectionHead({ label, total }: { label: string; total: number }) {
  return (
    <div className="flex items-baseline gap-2 px-4 pb-1 pt-3">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </span>
      <span className="flex-1" />
      <span className="flex shrink-0 items-center gap-1">
        <Num v={total} strong className="text-[15px]" />
        <span className="w-3.5 shrink-0" />
      </span>
    </div>
  );
}

export default function BalanceView({
  months,
  monthId,
  statusByMonth,
  sheet,
  settlement,
  monthBalance,
  warehouses,
  stock,
  arEntries,
  contributions,
  monthlyNet,
  taxParts,
}: {
  months: MonthIn[];
  monthId: string;
  statusByMonth: MonthStatus[];
  sheet: BalanceSheetRow | null;
  settlement: SettlementRow | null;
  monthBalance: MonthBalanceIn | null;
  warehouses: WarehouseIn[];
  stock: StockRowUI[];
  arEntries: Array<{ id: string; customerName: string; amount: number }>;
  contributions: ContributionIn[];
  monthlyNet: Array<{ monthId: string; netProfit: number }>;
  taxParts: { fargoVat: number; tiIncomeTax: number; fargoIncomeTax: number };
}) {
  const { t, locale } = useT();
  const ru = locale === "ru";
  const [trace, setTrace] = useState<Trace | null>(null);

  const monthName = (id: string) => {
    const m = months.find((x) => x.id === id);
    return m ? (ru ? m.nameRu : m.nameEn) : id;
  };
  const current = statusByMonth.find((s) => s.monthId === monthId) ?? null;
  const entryHref = `/close/balance?month=${monthId}`;

  const stockQty = (s: StockRowUI) => warehouses.reduce((sum, w) => sum + (s.byWarehouse[w.id] ?? 0), 0);

  // ── traces (drill-downs behind each line) ─────────────────────
  const traces: Record<string, () => Trace> = {
    inventory: () => ({
      title: `${t("inventory")} — ${monthName(monthId)}`,
      rows: [
        ...stock
          .filter((s) => stockQty(s) !== 0)
          .map((s) => ({
            label: `${s.name} (${fmtN(stockQty(s))} × ${fmtN(s.unitCost)})`,
            value: stockQty(s) * s.unitCost,
          })),
        { label: t("total"), value: sheet?.inventory ?? 0, strong: true },
      ],
      note: t("stockApiHint"),
      href: entryHref,
    }),
    transit: () => ({
      title: t("goodsInTransit"),
      rows: [{ label: monthName(monthId), value: monthBalance?.goodsInTransit ?? 0 }],
      href: entryHref,
    }),
    ar: () => ({
      title: `${t("accountsReceivable")} — ${monthName(monthId)}`,
      rows: [
        ...arEntries.map((a) => ({ label: a.customerName, value: a.amount })),
        { label: t("total"), value: sheet?.arTotal ?? 0, strong: true },
      ],
      href: entryHref,
    }),
    tiBank: () => ({
      title: t("tiBankBalance"),
      rows: [{ label: monthName(monthId), value: monthBalance?.tiBank ?? 0 }],
      href: entryHref,
    }),
    vatPrepay: () => ({
      title: t("vatPrepayment"),
      rows: [{ label: monthName(monthId), value: monthBalance?.vatPrepayment ?? 0 }],
      href: entryHref,
    }),
    settlementReceivable: () => ({
      title: t("settlementReceivable"),
      rows: settlement
        ? [
            { label: t("revenue"), value: settlement.cumRevenue },
            { label: `− ${t("opexFargoTotal")}`, value: -settlement.cumFargoOpex },
            { label: `− ${t("retroBonus")}`, value: -settlement.cumRetro },
            { label: `− ${t("fargoVat")}`, value: -settlement.cumFargoVat },
            { label: `− ${t("fargoIncomeTax")}`, value: -settlement.cumFargoIncomeTax },
            { label: t("dueToTi"), value: settlement.dueToTi, strong: true },
            {
              label: `− ${t("transfersMade")}`,
              value: -(settlement.cumTransfersCash + settlement.cumTransfersBank),
            },
            { label: `− ${t("outstandingAr")}`, value: -settlement.outstandingAr },
            { label: t("remainingBalance"), value: settlement.remaining, strong: true },
          ]
        : [],
      note: t("cumulativeTotal"),
      href: entryHref,
    }),
    taxPayable: () => ({
      title: `${t("taxPayable")} — ${monthName(monthId)}`,
      rows: [
        { label: t("fargoVat"), value: taxParts.fargoVat },
        { label: t("tiIncomeTax"), value: taxParts.tiIncomeTax },
        { label: t("fargoIncomeTax"), value: taxParts.fargoIncomeTax },
        { label: t("total"), value: sheet?.taxPayable ?? 0, strong: true },
      ],
      href: `/taxes?month=${monthId}`,
    }),
    priorVat: () => ({
      title: t("priorVatBalance"),
      rows: [{ label: monthName(monthId), value: monthBalance?.priorVatBalance ?? 0 }],
      href: entryHref,
    }),
    loan: () => ({
      title: t("nutribenLoan"),
      rows: [{ label: monthName(monthId), value: monthBalance?.nutribenLoan ?? 0 }],
      href: entryHref,
    }),
    tiCapital: () => ({
      title: t("tiCapital"),
      rows: [
        ...contributions
          .filter((c) => monthIdOfDate(c.date) <= monthId && c.tiAmount !== 0)
          .map((c) => ({ label: c.date.slice(0, 10), value: c.tiAmount })),
        { label: t("total"), value: sheet?.tiCapital ?? 0, strong: true },
      ],
      href: entryHref,
    }),
    fargoCapital: () => ({
      title: t("fargoCapital"),
      rows: [
        ...contributions
          .filter((c) => monthIdOfDate(c.date) <= monthId && c.fargoAmount !== 0)
          .map((c) => ({ label: c.date.slice(0, 10), value: c.fargoAmount })),
        { label: t("total"), value: sheet?.fargoCapital ?? 0, strong: true },
      ],
      href: entryHref,
    }),
    retained: () => {
      const upto = monthlyNet.filter((m) => m.monthId <= monthId && m.netProfit !== 0);
      return {
        title: t("reByMonth"),
        rows: [
          ...upto.map((m) => ({ label: monthName(m.monthId), value: m.netProfit })),
          { label: t("cumulativeTotal"), value: sheet?.retainedEarnings ?? 0, strong: true },
        ],
        href: "/pnl",
      };
    },
    plug: () => ({
      title: t("plug"),
      rows: [{ label: monthName(monthId), value: sheet?.plug ?? 0 }],
      note: t("plugExplain"),
    }),
  };

  const line = (
    labelKey: DictKey,
    value: number,
    opts: { traceKey?: string; strong?: boolean; warnNonZero?: boolean } = {}
  ) => (
    <StatementLine
      label={t(labelKey)}
      value={value}
      strong={opts.strong}
      warn={!!opts.warnNonZero && Math.abs(value) > 1}
      traceTitle={t("sourceTitle")}
      onTrace={opts.traceKey ? () => setTrace(traces[opts.traceKey!]()) : undefined}
    />
  );

  const balanced = sheet ? Math.abs(sheet.assetsTotal - sheet.liabilitiesTotal - sheet.equityTotal) < 1 : true;

  const mix = sheet
    ? ([
        [t("inventory"), sheet.inventory],
        [t("settlementReceivable"), sheet.settlementReceivable],
        [t("goodsInTransit"), sheet.goodsInTransit],
        [t("accountsReceivable"), sheet.arTotal],
        [t("tiBankBalance"), sheet.tiBank],
        [t("vatPrepayment"), sheet.vatPrepayment],
      ] as Array<[string, number]>).filter(([, v]) => v > 0)
    : [];
  const mixTotal = mix.reduce((s, [, v]) => s + v, 0);

  const missingInputs = current ? !current.hasInputs || !current.hasStock : false;

  return (
    <div className="pb-16">
      <PageTitle
        title={t("navBalance")}
        subtitle={ru ? "Баланс на конец месяца" : "Month-end balance sheet"}
        right={
          <div className="flex items-center gap-2">
            <a href={`/api/export/balance?month=${monthId}&locale=${locale}`}>
              <Button variant="secondary">
                <IconDownload size={14} /> {t("export")}
              </Button>
            </a>
            <Link href={entryHref}>
              <Button variant="secondary">{ru ? "Заполнить данные" : "Enter data"} →</Button>
            </Link>
          </div>
        }
      />

      <MonthStrip
        months={months}
        monthId={monthId}
        hasData={new Set(statusByMonth.filter((s) => s.status !== "empty").map((s) => s.monthId))}
      />

      {missingInputs && (
        <Link
          href={entryHref}
          className="mb-4 flex items-center gap-2 rounded-xl border border-warn/25 bg-warn-soft px-4 py-3 text-[13px] text-warn transition-colors hover:border-warn/50"
        >
          <IconAlert size={15} />
          {ru
            ? "За этот месяц заполнены не все ручные данные — баланс может быть неполным."
            : "Some manual inputs are missing for this month — the sheet may be incomplete."}
          <span className="ml-auto font-medium">{ru ? "Заполнить" : "Fill in"} →</span>
        </Link>
      )}

      {sheet ? (
        <Card className="overflow-hidden">
          <CardHeader
            title={`${t("balanceStatement")} — ${monthName(monthId)}`}
            right={
              <Badge tone={balanced ? "ok" : "danger"}>
                {balanced ? `✓ ${t("balanceCheckOk")}` : t("balanceCheckFail")} · {t("balanceCheck")}
              </Badge>
            }
          />
          <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-border">
            {/* assets */}
            <div className="py-2">
              <SectionHead label={t("assets")} total={sheet.assetsTotal} />
              {line("inventory", sheet.inventory, { traceKey: "inventory" })}
              {line("settlementReceivable", sheet.settlementReceivable, { traceKey: "settlementReceivable" })}
              {line("goodsInTransit", sheet.goodsInTransit, { traceKey: "transit" })}
              {line("accountsReceivable", sheet.arTotal, { traceKey: "ar" })}
              {line("tiBankBalance", sheet.tiBank, { traceKey: "tiBank" })}
              {line("vatPrepayment", sheet.vatPrepayment, { traceKey: "vatPrepay" })}
              <div className="mx-4 mt-1 border-t-2 border-border-strong" />
              {line("total", sheet.assetsTotal, { strong: true })}

              {mixTotal > 0 && (
                <div className="px-4 pb-3 pt-2">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                    {t("assetsMix")}
                  </div>
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full">
                    {mix.map(([label, v], i) => (
                      <div
                        key={label}
                        title={`${label}: ${fmtN(v)} (${fmtPct(v / mixTotal)})`}
                        style={{ width: `${(v / mixTotal) * 100}%`, background: MIX_COLORS[i % MIX_COLORS.length] }}
                        className="border-r border-surface last:border-r-0"
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {mix.map(([label, v], i) => (
                      <span key={label} className="flex items-center gap-1.5 text-[11px] text-muted">
                        <span
                          className="h-2 w-2 rounded-sm"
                          style={{ background: MIX_COLORS[i % MIX_COLORS.length] }}
                        />
                        {label} · {fmtPct(v / mixTotal)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* liabilities + equity */}
            <div className="border-t border-border py-2 lg:border-t-0">
              <SectionHead label={t("liabilities")} total={sheet.liabilitiesTotal} />
              {line("taxPayable", sheet.taxPayable, { traceKey: "taxPayable" })}
              {line("priorVatBalance", sheet.priorVatBalance, { traceKey: "priorVat" })}
              {line("nutribenLoan", sheet.nutribenLoan, { traceKey: "loan" })}

              <SectionHead label={t("equity")} total={sheet.equityTotal} />
              {line("tiCapital", sheet.tiCapital, { traceKey: "tiCapital" })}
              {line("fargoCapital", sheet.fargoCapital, { traceKey: "fargoCapital" })}
              {line("retainedEarnings", sheet.retainedEarnings, { traceKey: "retained" })}
              {line("plug", sheet.plug, { traceKey: "plug", warnNonZero: true })}
              <div className="mx-4 mt-1 border-t-2 border-border-strong" />
              {line("liabilitiesAndEquity", sheet.liabilitiesTotal + sheet.equityTotal, { strong: true })}
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="py-10 text-center text-[13px] text-muted">{t("noData")}</div>
        </Card>
      )}

      {trace && (
        <Modal title={trace.title} onClose={() => setTrace(null)}>
          <table className="tbl">
            <tbody>
              {trace.rows.map((r, i) => (
                <tr key={i} className={r.strong ? "font-semibold" : ""}>
                  <td>{r.label}</td>
                  <td className="text-right">
                    <Num v={r.value} strong={r.strong} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {trace.note && <p className="mt-3 text-[12px] leading-relaxed text-muted">{trace.note}</p>}
          {trace.href && (
            <div className="mt-4 flex justify-end">
              <Link href={trace.href}>
                <Button variant="secondary">{t("whereEntered")} →</Button>
              </Link>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/** One line of the balance-sheet statement, with an optional drill-down. */
function StatementLine({
  label,
  value,
  strong = false,
  warn = false,
  traceTitle,
  onTrace,
}: {
  label: string;
  value: number;
  strong?: boolean;
  warn?: boolean;
  traceTitle?: string;
  onTrace?: () => void;
}) {
  // the chevron slot is always reserved — with it, every figure (and every
  // section total) ends on exactly the same right edge, traceable or not
  const figure = (
    <>
      <Num v={value} strong={strong} className={warn ? "text-warn" : ""} />
      <span className="w-3.5 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100">
        {onTrace && <IconChevronRight size={12} />}
      </span>
    </>
  );
  return (
    <div className={`group flex items-baseline gap-2 px-4 py-[7px] ${strong ? "font-semibold" : ""}`}>
      <span className={`min-w-0 shrink text-[13px] ${warn ? "text-warn" : ""}`}>{label}</span>
      <span className="mx-1 flex-1 border-b border-dotted border-border-strong/70 group-hover:border-accent/40" />
      {onTrace ? (
        <button
          onClick={onTrace}
          title={traceTitle}
          className="-mr-1 flex shrink-0 items-center gap-1 rounded pl-1 pr-1 transition-colors hover:bg-accent-soft hover:text-accent"
        >
          {figure}
        </button>
      ) : (
        <span className="-mr-1 flex shrink-0 items-center gap-1 pl-1 pr-1">{figure}</span>
      )}
    </div>
  );
}
