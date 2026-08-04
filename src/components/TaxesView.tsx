"use client";

// Tax workspace, ordered by decision value:
//   effective burden → filing reconciliation (the risk) → burden composition →
//   the cash/bank VAT mechanic → per-product VAT detail (reference).
import { useMemo } from "react";
import { Badge, Num, PageTitle } from "./ui";
import { IconAlert, IconCheck } from "./icons";
import { Collapsible, MetricStrip, Money, Section, ShareBar, fmtN, fmtPct, type Metric } from "./analysis";
import EntryGrid, { type Col } from "./EntryGrid";
import MonthStrip from "./MonthStrip";
import { useT } from "@/lib/locale-context";
import type { MonthIn, QuarterAudit, TaxFilingIn, TaxSettings, VatRow } from "@/lib/engine/types";

interface TaxPoint {
  monthId: string;
  revenue: number;
  cashRevenue: number;
  fargoVat: number;
  bankVat: number;
  cashVat: number;
  fargoIncomeTax: number;
  tiIncomeTax: number;
  taxesTotal: number;
}

export default function TaxesView({
  months,
  monthId,
  current,
  prior,
  trend,
  ytd,
  taxes,
  productNames,
  taxFilings,
  quarterAudits,
  readOnly,
}: {
  months: MonthIn[];
  monthId: string;
  current: (TaxPoint & { vatRows: VatRow[] }) | null;
  prior: TaxPoint | null;
  trend: TaxPoint[];
  ytd: {
    revenue: number;
    fargoVat: number;
    bankVat: number;
    cashVat: number;
    fargoIncomeTax: number;
    tiIncomeTax: number;
    taxesTotal: number;
    netProfit: number;
  };
  taxes: TaxSettings;
  productNames: Record<string, string>;
  taxFilings: TaxFilingIn[];
  quarterAudits: QuarterAudit[];
  readOnly: boolean;
}) {
  const { t, locale } = useT();

  const cur = current;
  const effRate = cur && cur.revenue !== 0 ? cur.taxesTotal / cur.revenue : 0;
  const priorEffRate = prior && prior.revenue !== 0 ? prior.taxesTotal / prior.revenue : 0;
  const cashShare = cur && cur.revenue !== 0 ? cur.cashRevenue / cur.revenue : 0;

  const metrics: Metric[] = [
    {
      label: t("effectiveTaxRate"),
      value: fmtPct(effRate),
      delta: prior ? { current: effRate, previous: priorEffRate, pp: true, invert: true } : undefined,
      series: trend.map((p) => (p.revenue !== 0 ? p.taxesTotal / p.revenue : 0)),
      hint: `${t("ytd")} ${fmtPct(ytd.revenue !== 0 ? ytd.taxesTotal / ytd.revenue : 0)}`,
    },
    {
      label: t("taxesTotal"),
      value: fmtN(cur?.taxesTotal ?? 0),
      delta: prior ? { current: cur?.taxesTotal ?? 0, previous: prior.taxesTotal, invert: true } : undefined,
      series: trend.map((p) => p.taxesTotal),
    },
    {
      label: t("fargoVat"),
      value: fmtN(cur?.fargoVat ?? 0),
      delta: prior ? { current: cur?.fargoVat ?? 0, previous: prior.fargoVat, invert: true } : undefined,
      hint: `${t("bankVat")} ${fmtPct(cur && cur.fargoVat !== 0 ? cur.bankVat / cur.fargoVat : 0)}`,
    },
    {
      label: t("fargoIncomeTax"),
      value: fmtN(cur?.fargoIncomeTax ?? 0),
      hint: `${fmtPct(taxes.fargoIncomeTaxRate)} ${t("ofRevenueBare")}`,
    },
    {
      label: t("cashShareLabel"),
      value: fmtPct(cashShare),
      hint: `${t("cash")} ${fmtN(cur?.cashRevenue ?? 0)}`,
    },
  ];

  // ── filing reconciliation: the highest-risk item on the page ──
  const auditRows = useMemo(
    () =>
      quarterAudits.map((q) => ({
        ...q,
        variancePct: q.computedTax !== 0 ? q.taxVariance / q.computedTax : 0,
        material: Math.abs(q.taxVariance) >= 1000,
      })),
    [quarterAudits]
  );
  const materialCount = auditRows.filter((r) => r.material).length;
  const totalVariance = auditRows.reduce((a, r) => a + r.taxVariance, 0);

  // ── burden composition by month ──
  const maxBurden = Math.max(1, ...trend.map((p) => p.taxesTotal));

  // ── VAT mechanics: what the deemed 3% cash margin actually does ──
  const vatCounterfactual = useMemo(() => {
    if (!cur) return null;
    // if the cash portion were taxed on its real margin like bank sales
    const asIfBank = cur.vatRows.reduce(
      (a, r) => a + r.qtyCash * (r.sellPrice - r.fargoUnitCost) * taxes.vatRate,
      0
    );
    return { asIfBank, actual: cur.cashVat, saving: asIfBank - cur.cashVat };
  }, [cur, taxes.vatRate]);

  const filingCols: Col[] = [
    { field: "quarterLabel", labelKey: "quarter", type: "text", width: "120px" },
    { field: "taxAmount", labelKey: "taxAmount", type: "number" },
    {
      field: "bookedMonthId",
      labelKey: "bookedMonth",
      type: "select",
      options: months.map((m) => ({ value: m.id, label: locale === "ru" ? m.nameRu : m.nameEn })),
    },
    { field: "declaredExpenses", labelKey: "declaredExpenses", type: "number" },
  ];

  const monthShort = (id: string) => {
    const m = months.find((x) => x.id === id);
    const name = m ? (locale === "ru" ? m.nameRu : m.nameEn) : id;
    return `${name.split(" ")[0].slice(0, 3)} '${id.slice(2, 4)}`;
  };

  return (
    <div>
      <PageTitle
        title={t("navTaxes")}
        subtitle={t("descTaxes")}
      />

      <MonthStrip
        months={months}
        monthId={monthId}
        hasData={new Set(months.filter((m) => m.id <= monthId).map((m) => m.id))}
      />

      <MetricStrip metrics={metrics} />

      {/* filing reconciliation first — this is where money is at risk */}
      <Section
        title={t("auditFirst")}
        note={t("descAuditCalc")}
        right={
          auditRows.length > 0 && (
            <span className="flex items-center gap-2">
              {materialCount === 0 ? (
                <Badge tone="ok">
                  <IconCheck size={11} /> {locale === "ru" ? "расхождений нет" : "no variance"}
                </Badge>
              ) : (
                <Badge tone="warn">
                  <IconAlert size={11} /> {materialCount}{" "}
                  {locale === "ru" ? "кварт. с расхождением" : "quarters differ"}
                </Badge>
              )}
              <span className="num text-[12px] text-muted">{fmtN(totalVariance)}</span>
            </span>
          )
        }
      >
        {auditRows.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] text-muted">{t("noData")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl min-w-max">
              <thead>
                <tr>
                  <th>{t("quarter")}</th>
                  <th className="text-right">{t("fargoValue")}</th>
                  <th className="text-right">{t("grossProfit")}</th>
                  <th className="text-right">{t("declaredExpenses")}</th>
                  <th className="text-right">{t("taxableProfit")}</th>
                  <th className="text-right">{t("computedTax")}</th>
                  <th className="text-right">{t("filedTax")}</th>
                  <th className="text-right">{t("variance")}</th>
                </tr>
              </thead>
              <tbody>
                {auditRows.map((q) => (
                  <tr key={q.quarterLabel}>
                    <td>
                      <div className="font-medium">{q.quarterLabel}</div>
                      {q.shipmentCodes.length > 0 && (
                        <div className="max-w-[220px] truncate text-[11px] text-muted" title={q.shipmentCodes.join(", ")}>
                          {q.shipmentCodes.join(", ")}
                        </div>
                      )}
                    </td>
                    <td className="text-right">
                      <Num v={q.fargoValue} />
                    </td>
                    <td className="text-right">
                      <Num v={q.grossProfit} />
                    </td>
                    <td className="text-right">
                      <Num v={q.declaredExpenses} />
                    </td>
                    <td className="text-right">
                      <Num v={q.taxableProfit} />
                    </td>
                    <td>
                      <Money v={q.computedTax} />
                    </td>
                    <td>
                      <Money v={q.filedTax} />
                    </td>
                    <td>
                      {!q.material ? (
                        <div className="text-right">
                          <Badge tone="ok">
                            <IconCheck size={11} /> 0
                          </Badge>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <Badge tone="warn">{fmtPct(q.variancePct)}</Badge>
                          <Money v={q.taxVariance} strong />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* burden composition */}
      <Section title={t("taxBurden")} note={t("taxBurdenNote")}>
        <div className="overflow-x-auto">
          <table className="tbl min-w-max">
            <thead>
              <tr>
                <th>{t("month")}</th>
                <th className="text-right">{t("revenue")}</th>
                <th className="text-right">{t("fargoVat")}</th>
                <th className="text-right">{t("fargoIncomeTax")}</th>
                <th className="text-right">{t("tiIncomeTax")}</th>
                <th className="text-right">{t("taxesTotal")}</th>
                <th className="w-28"></th>
                <th className="text-right">{t("effectiveTaxRate")}</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((p) => {
                const rate = p.revenue !== 0 ? p.taxesTotal / p.revenue : 0;
                const isCur = p.monthId === monthId;
                return (
                  <tr key={p.monthId} className={isCur ? "!bg-accent-soft/60" : ""}>
                    <td className={isCur ? "font-medium text-accent" : ""}>{monthShort(p.monthId)}</td>
                    <td className="text-right text-muted">
                      <Num v={p.revenue} />
                    </td>
                    <td className="text-right">
                      <Num v={p.fargoVat} />
                    </td>
                    <td className="text-right">
                      <Num v={p.fargoIncomeTax} />
                    </td>
                    <td className="text-right">
                      {p.tiIncomeTax !== 0 ? <Num v={p.tiIncomeTax} /> : <span className="text-muted">—</span>}
                    </td>
                    <td>
                      <Money v={p.taxesTotal} strong />
                    </td>
                    <td>
                      <ShareBar value={p.taxesTotal} max={maxBurden} />
                    </td>
                    <td className="text-right">
                      <span className="num font-medium">{fmtPct(rate)}</span>
                    </td>
                  </tr>
                );
              })}
              <tr className="row-section font-semibold">
                <td>{t("ytd")}</td>
                <td className="text-right">
                  <Num v={ytd.revenue} strong />
                </td>
                <td className="text-right">
                  <Num v={ytd.fargoVat} strong />
                </td>
                <td className="text-right">
                  <Num v={ytd.fargoIncomeTax} strong />
                </td>
                <td className="text-right">
                  <Num v={ytd.tiIncomeTax} strong />
                </td>
                <td>
                  <Money v={ytd.taxesTotal} strong />
                </td>
                <td />
                <td className="text-right">
                  <span className="num">{fmtPct(ytd.revenue !== 0 ? ytd.taxesTotal / ytd.revenue : 0)}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* the cash/bank VAT mechanic */}
      <Section title={t("vatMechanics")} note={t("vatMechanicsNote")}>
        <div className="grid gap-0 md:grid-cols-3 md:divide-x md:divide-border">
          <div className="border-b border-border px-4 py-3 md:border-b-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-muted">
              {t("bankVat")} · {fmtPct(taxes.vatRate)} {locale === "ru" ? "с реальной маржи" : "on real margin"}
            </div>
            <div className="num mt-1 text-[18px] font-semibold">{fmtN(cur?.bankVat ?? 0)}</div>
            <div className="mt-1 text-[11px] text-muted">
              {fmtPct(cur && cur.fargoVat !== 0 ? cur.bankVat / cur.fargoVat : 0)} {t("ofTotal")}
            </div>
          </div>
          <div className="border-b border-border px-4 py-3 md:border-b-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-muted">
              {t("cashVat")} · {fmtPct(taxes.deemedCashMargin)}{" "}
              {locale === "ru" ? "условная маржа" : "deemed margin"}
            </div>
            <div className="num mt-1 text-[18px] font-semibold">{fmtN(cur?.cashVat ?? 0)}</div>
            <div className="mt-1 text-[11px] text-muted">
              {fmtPct(cur && cur.fargoVat !== 0 ? cur.cashVat / cur.fargoVat : 0)} {t("ofTotal")}
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-muted">{t("vatSaving")}</div>
            <div className="num mt-1 text-[18px] font-semibold text-ok">
              {fmtN(vatCounterfactual?.saving ?? 0)}
            </div>
            <div className="mt-1 text-[11px] text-muted">
              {t("vatIfAllBank")}: {fmtN(vatCounterfactual?.asIfBank ?? 0)}
            </div>
          </div>
        </div>
      </Section>

      {/* reference: per-product VAT detail and the filings grid */}
      <Collapsible
        title={t("taxesVatDetail")}
        note={`${cur?.vatRows.length ?? 0} ${locale === "ru" ? "товаров" : "products"} · ${fmtN(cur?.fargoVat ?? 0)}`}
      >
        <div className="overflow-x-auto">
          <table className="tbl min-w-max">
            <thead>
              <tr>
                <th>{t("product")}</th>
                <th className="text-right">{t("qty")}</th>
                <th className="text-right">{t("qtyCash")}</th>
                <th className="text-right">{t("qtyBank")}</th>
                <th className="text-right">{t("price")}</th>
                <th className="text-right">{t("fargoUnitCost")}</th>
                <th className="text-right">{t("bankVat")}</th>
                <th className="text-right">{t("cashVat")}</th>
                <th className="text-right">{t("total")}</th>
              </tr>
            </thead>
            <tbody>
              {(cur?.vatRows ?? []).map((r) => (
                <tr key={r.productId}>
                  <td className="max-w-[240px] truncate" title={productNames[r.productId] ?? r.productId}>
                    {productNames[r.productId] ?? r.productId}
                  </td>
                  <td className="text-right">
                    <Num v={r.qty} />
                  </td>
                  <td className="text-right text-muted">
                    <Num v={r.qtyCash} decimals={1} />
                  </td>
                  <td className="text-right text-muted">
                    <Num v={r.qtyBank} decimals={1} />
                  </td>
                  <td className="text-right">
                    <Num v={r.sellPrice} />
                  </td>
                  <td className="text-right">
                    {r.fargoUnitCost !== 0 ? <Num v={r.fargoUnitCost} /> : <Badge tone="warn">—</Badge>}
                  </td>
                  <td className="text-right">
                    <Num v={r.bankVat} />
                  </td>
                  <td className="text-right">
                    <Num v={r.cashVat} />
                  </td>
                  <td>
                    <Money v={r.totalVat} strong />
                  </td>
                </tr>
              ))}
              {cur && cur.vatRows.length > 0 && (
                <tr className="row-section font-semibold">
                  <td>{t("total")}</td>
                  <td colSpan={5} />
                  <td className="text-right">
                    <Num v={cur.bankVat} strong />
                  </td>
                  <td className="text-right">
                    <Num v={cur.cashVat} strong />
                  </td>
                  <td>
                    <Money v={cur.fargoVat} strong />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Collapsible>

      <Collapsible title={t("taxesTiFilings")} note={t("descFilings")}>
        <EntryGrid
          entity="taxFiling"
          cols={filingCols}
          rows={taxFilings.map((f) => ({ ...f }))}
          readOnly={readOnly}
          sumFields={["taxAmount"]}
        />
      </Collapsible>
    </div>
  );
}
