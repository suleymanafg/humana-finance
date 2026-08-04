"use client";

// P&L, two views sharing one row structure:
//  «Месяц»      — compact statement for the globally selected month; each line
//                 expands DOWNWARD into its components (revenue → channels,
//                 COGS → products, OPEX → groups, taxes → tax lines), with
//                 share bars and Δ vs the prior month. Insight cards below are
//                 computed from real data only — no invented figures.
//  «12 месяцев» — the same rows as a months × lines matrix with a YTD column;
//                 the same expansions add sub-rows across every month.
// Clicking an OPEX group / tax line (either view) opens the source-records modal.
import { useMemo, useState } from "react";
import { Badge, Button, Card, Modal, Num, PageTitle, Pct } from "./ui";
import { Delta, ShareBar } from "./analysis";
import { IconChevronDown, IconChevronRight, IconDownload } from "./icons";
import { useT } from "@/lib/locale-context";
import { GROUP_LABELS, TI_GROUPS, FARGO_GROUPS } from "@/lib/groups";
import type { MonthlyResult, OpexFargoIn, OpexTiIn, TaxFilingIn } from "@/lib/engine/types";
import { fmtN, fmtPct } from "@/lib/format";

interface MonthMeta {
  id: string;
  nameRu: string;
  nameEn: string;
}

type Drill = { title: string; monthId: string; rows: Array<{ label: string; value: number; note?: string }> };

/** A component line inside an expanded statement row. */
interface ChildRow {
  key: string;
  label: string;
  value: number;
  note?: string;
  drillKey?: string;
}

const hasData = (m: MonthlyResult) => m.revenue !== 0 || m.cogs !== 0 || m.totalOpex !== 0;

// ─────────────────── month view: one statement line ───────────────────

function StatementLine({
  label,
  value,
  negate,
  cur,
  prev,
  invert,
  band,
  marginPct,
  childRows,
  expanded,
  onToggle,
  onDrill,
}: {
  label: string;
  value: number;
  negate?: boolean;
  cur: number;
  prev: number | null;
  /** true when a rise is bad (costs, taxes) */
  invert?: boolean;
  band?: "sub" | "hero";
  marginPct?: number;
  childRows?: ChildRow[];
  expanded?: boolean;
  onToggle?: () => void;
  onDrill?: (key: string) => void;
}) {
  const expandable = !!childRows && childRows.length > 0;
  const maxChild = expandable ? Math.max(...childRows.map((c) => Math.abs(c.value))) : 0;

  if (band === "hero") {
    // Delta's usual green/red is unreadable on the colored band — everything
    // here renders in plain white on translucent chips. A loss flips the band
    // to red, relabels it, and shows an explicit minus — no accounting parens.
    const change = prev !== null && prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : null;
    const loss = value < 0;
    return (
      <div
        className="mt-1 flex items-center justify-between gap-4 rounded-xl px-6 py-5 text-white"
        style={{ background: loss ? "#b42318" : "var(--accent)" }}
      >
        <span className="font-display text-[16px] font-bold uppercase tracking-[0.06em]">{label}</span>
        <span className="flex items-center gap-3">
          {marginPct !== undefined && (
            <span className="rounded-full bg-white/25 px-3 py-1 text-[13.5px] font-bold text-white">
              {marginPct < 0 ? "−" : ""}
              {fmtPct(Math.abs(marginPct))}
            </span>
          )}
          {change !== null && Number.isFinite(change) && (
            <span className="rounded-full bg-white/25 px-3 py-1 text-[13.5px] font-bold text-white">
              {change >= 0 ? "↑" : "↓"} {Math.abs(change).toFixed(1)}%
            </span>
          )}
          <span className="num font-display text-[28px] font-bold tracking-tight">
            {loss ? "−" : ""}
            {fmtN(Math.abs(value))}
          </span>
        </span>
      </div>
    );
  }

  const rowCls =
    band === "sub"
      ? "flex items-center justify-between gap-4 rounded-lg bg-surface-low px-4 py-3"
      : "flex items-center justify-between gap-4 px-4 py-3";

  return (
    <div className={band ? "" : "border-b border-border last:border-b-0"}>
      <div className={rowCls}>
        {expandable ? (
          <button
            onClick={onToggle}
            className="flex items-center gap-2 text-[16px] font-semibold transition-colors hover:text-accent"
          >
            <span className="text-muted">
              {expanded ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}
            </span>
            {label}
          </button>
        ) : (
          <span className={`text-[16px] font-semibold ${band === "sub" ? "text-accent" : ""}`}>
            {label}
          </span>
        )}
        <span className="flex items-center gap-3">
          {marginPct !== undefined && <Pct v={marginPct} />}
          {prev !== null && (
            <span className="text-[13px]">
              <Delta current={cur} previous={prev} invert={invert} />
            </span>
          )}
          <span className={`num text-[16px] font-semibold ${band === "sub" ? "text-accent" : ""}`}>
            {fmtN(negate ? -value : value)}
          </span>
        </span>
      </div>
      {expandable && expanded && (
        <div className="space-y-0.5 pb-3 pl-10 pr-4">
          {childRows.map((c) => (
            <div key={c.key} className="flex items-center gap-3 py-1">
              <div className="min-w-0 flex-1">
                {c.drillKey && onDrill ? (
                  <button
                    onClick={() => onDrill(c.drillKey!)}
                    className="truncate text-[13.5px] underline-offset-2 transition-colors hover:text-accent hover:underline"
                  >
                    {c.label}
                  </button>
                ) : (
                  <div className="truncate text-[13.5px]">{c.label}</div>
                )}
                {c.note && <div className="text-[12px] text-muted">{c.note}</div>}
              </div>
              <div className="w-24 shrink-0">
                <ShareBar value={Math.abs(c.value)} max={maxChild} />
              </div>
              <span className="num w-32 shrink-0 text-right text-[13.5px] font-medium">{fmtN(negate ? -c.value : c.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────── matrix view: one table row ───────────────────

interface MatrixRowSpec {
  id: string;
  label: React.ReactNode;
  get: (m: MonthlyResult) => number;
  drill?: string;
  kind?: "normal" | "subtotal" | "total" | "pct";
  indent?: number;
  negate?: boolean;
  section?: boolean;
  toggle?: { expanded: boolean; onToggle: () => void };
}

function MatrixRow({
  spec,
  cols,
  onDrill,
}: {
  spec: MatrixRowSpec;
  cols: MonthlyResult[];
  onDrill: (key: string, m: MonthlyResult) => void;
}) {
  const { label, get, drill, kind = "normal", indent = 0, negate = false, section = false, toggle } = spec;
  const cls = [
    kind === "total" ? "row-grand font-semibold" : "",
    kind === "subtotal" ? "font-semibold" : "",
    kind === "pct" ? "text-[12px] text-muted" : "",
    section ? "row-section" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <tr className={cls}>
      <td className="sticky-col" style={{ paddingLeft: 12 + indent * 18 }}>
        {toggle ? (
          <button onClick={toggle.onToggle} className="flex items-center gap-1.5 transition-colors hover:text-accent">
            <span className="text-muted">
              {toggle.expanded ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
            </span>
            {label}
          </button>
        ) : (
          label
        )}
      </td>
      {cols.map((m) => {
        const v = get(m);
        const isYtd = m.monthId === "YTD";
        const clickable = drill && !isYtd && v !== 0;
        return (
          <td key={m.monthId} className={`text-right ${isYtd ? "col-hl" : ""}`}>
            {kind === "pct" ? (
              <Pct v={v} />
            ) : clickable ? (
              <button
                className="w-full text-right underline-offset-2 transition-colors hover:text-accent hover:underline"
                onClick={() => onDrill(drill, m)}
              >
                <Num v={negate ? -v : v} strong={kind !== "normal"} />
              </button>
            ) : (
              <Num v={negate ? -v : v} strong={kind !== "normal"} />
            )}
          </td>
        );
      })}
    </tr>
  );
}

// ─────────────────────────── the page ───────────────────────────

export default function PnlView({
  months,
  monthId,
  monthly,
  ytd,
  productNames,
  channelNames,
  opexTi,
  opexFargo,
  taxFilings,
}: {
  months: MonthMeta[];
  monthId: string;
  monthly: MonthlyResult[];
  ytd: MonthlyResult;
  productNames: Record<string, string>;
  channelNames: Record<string, string>;
  opexTi: OpexTiIn[];
  opexFargo: OpexFargoIn[];
  taxFilings: TaxFilingIn[];
}) {
  const { t, locale } = useT();
  const ru = locale === "ru";
  const [mode, setMode] = useState<"month" | "matrix">("month");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [drill, setDrill] = useState<Drill | null>(null);
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  const withData = useMemo(() => monthly.filter(hasData), [monthly]);
  const cur = useMemo(
    () => withData.find((m) => m.monthId === monthId) ?? withData[withData.length - 1] ?? ytd,
    [withData, monthId, ytd]
  );
  const prev = useMemo(() => {
    const i = withData.findIndex((m) => m.monthId === cur.monthId);
    return i > 0 ? withData[i - 1] : null;
  }, [withData, cur]);

  const monthName = (id: string) => {
    if (id === "YTD") return t("ytd");
    const m = months.find((x) => x.id === id);
    return m ? (ru ? m.nameRu : m.nameEn) : id;
  };

  // ── drill-down to source records (shared by both views) ──
  function drillFor(rowKey: string, m: MonthlyResult): Drill | null {
    if (m.monthId === "YTD") return null;
    const title = monthName(m.monthId);
    if (rowKey === "fargoVat") {
      return {
        title: `${t("fargoVat")} — ${title}`,
        monthId: m.monthId,
        rows: m.vatRows.map((r) => ({
          label: productNames[r.productId] ?? r.productId,
          value: r.totalVat,
          note: `${t("bankVat")}: ${fmtN(r.bankVat)} · ${t("cashVat")}: ${fmtN(r.cashVat)}`,
        })),
      };
    }
    if (rowKey === "tiIncomeTax") {
      return {
        title: `${t("tiIncomeTax")} — ${title}`,
        monthId: m.monthId,
        rows: taxFilings
          .filter((f) => f.bookedMonthId === m.monthId)
          .map((f) => ({ label: f.quarterLabel, value: f.taxAmount })),
      };
    }
    if (rowKey === "retro") {
      return {
        title: `${t("retroBonus")} — ${title}`,
        monthId: m.monthId,
        rows: Object.entries(m.retroByChannel).map(([ch, v]) => ({ label: channelNames[ch] ?? ch, value: v })),
      };
    }
    if (rowKey.startsWith("ti:")) {
      const g = rowKey.slice(3);
      return {
        title: `${GROUP_LABELS[g]?.[locale] ?? g} — ${title}`,
        monthId: m.monthId,
        rows: opexTi
          .filter((e) => e.monthId === m.monthId && (e.plGroup ?? "UNMAPPED") === g)
          .map((e) => ({ label: e.categoryName, value: e.bankAmount + e.cashAmount, note: e.notes ?? undefined })),
      };
    }
    if (rowKey.startsWith("fg:")) {
      const g = rowKey.slice(3);
      return {
        title: `${GROUP_LABELS[g]?.[locale] ?? g} — ${title}`,
        monthId: m.monthId,
        rows: opexFargo
          .filter((e) => e.monthId === m.monthId && (e.plGroup ?? "UNMAPPED") === g)
          .map((e) => ({ label: e.categoryName, value: e.amount, note: e.notes ?? undefined })),
      };
    }
    return null;
  }
  const onDrill = (key: string, m: MonthlyResult) => {
    const d = drillFor(key, m);
    if (d) setDrill(d);
  };

  // ── month view: component rows for each expandable line ──
  const revenueChildren: ChildRow[] = useMemo(
    () =>
      Object.entries(cur.revenueByChannel)
        .filter(([, v]) => v !== 0)
        .sort((a, b) => b[1] - a[1])
        .map(([ch, v]) => ({
          key: ch,
          label: channelNames[ch] ?? ch,
          value: v,
          note: cur.revenue !== 0 ? fmtPct(v / cur.revenue) : undefined,
        })),
    [cur, channelNames]
  );
  const cogsChildren: ChildRow[] = useMemo(
    () =>
      [...cur.cogsRows]
        .sort((a, b) => b.amount - a.amount)
        .map((r) => ({
          key: r.productId,
          label: productNames[r.productId] ?? r.productId,
          value: r.amount,
          note: `${fmtN(r.qty)} × ${fmtN(r.unitCost)}`,
        })),
    [cur, productNames]
  );
  const opexChildren: ChildRow[] = useMemo(() => {
    const rows: ChildRow[] = [];
    for (const g of [...TI_GROUPS, "UNMAPPED"])
      if (cur.opexTiByGroup[g])
        rows.push({ key: `ti:${g}`, label: `TI · ${GROUP_LABELS[g][locale]}`, value: cur.opexTiByGroup[g], drillKey: `ti:${g}` });
    for (const g of [...FARGO_GROUPS, "UNMAPPED"])
      if (cur.opexFargoByGroup[g])
        rows.push({ key: `fg:${g}`, label: `Fargo · ${GROUP_LABELS[g][locale]}`, value: cur.opexFargoByGroup[g], drillKey: `fg:${g}` });
    if (cur.retroBonus) rows.push({ key: "retro", label: t("retroBonus"), value: cur.retroBonus, drillKey: "retro" });
    return rows.sort((a, b) => b.value - a.value);
  }, [cur, locale, t]);
  const taxChildren: ChildRow[] = useMemo(() => {
    const rows: ChildRow[] = [];
    if (cur.bankVat) rows.push({ key: "bankVat", label: `${t("fargoVat")} — ${t("bank")}`, value: cur.bankVat, drillKey: "fargoVat" });
    if (cur.cashVat) rows.push({ key: "cashVat", label: `${t("fargoVat")} — ${t("cash")}`, value: cur.cashVat, drillKey: "fargoVat" });
    if (cur.fargoIncomeTax) rows.push({ key: "fargoTax", label: t("fargoIncomeTax"), value: cur.fargoIncomeTax });
    if (cur.tiIncomeTax) rows.push({ key: "tiTax", label: t("tiIncomeTax"), value: cur.tiIncomeTax, drillKey: "tiIncomeTax" });
    return rows.sort((a, b) => b.value - a.value);
  }, [cur, t]);

  // ── insight cards: only statements that are true by arithmetic ──
  const insight = useMemo(() => {
    const s: string[] = [];
    if (prev) {
      const g = prev.revenue !== 0 ? ((cur.revenue - prev.revenue) / Math.abs(prev.revenue)) * 100 : null;
      if (g !== null)
        s.push(
          ru
            ? `Выручка ${g >= 0 ? "выросла" : "снизилась"} на ${Math.abs(g).toFixed(1)}% к ${monthName(prev.monthId).toLowerCase()}.`
            : `Revenue ${g >= 0 ? "grew" : "fell"} ${Math.abs(g).toFixed(1)}% vs ${monthName(prev.monthId)}.`
        );
      let bestCh = "";
      let bestD = 0;
      const chIds = new Set([...Object.keys(cur.revenueByChannel), ...Object.keys(prev.revenueByChannel)]);
      for (const ch of chIds) {
        const d = (cur.revenueByChannel[ch] ?? 0) - (prev.revenueByChannel[ch] ?? 0);
        if (Math.abs(d) > Math.abs(bestD)) {
          bestD = d;
          bestCh = ch;
        }
      }
      if (bestCh)
        s.push(
          ru
            ? `Крупнейшее движение — ${channelNames[bestCh] ?? bestCh}: ${bestD >= 0 ? "+" : "−"}${fmtN(Math.abs(bestD))}.`
            : `Largest mover — ${channelNames[bestCh] ?? bestCh}: ${bestD >= 0 ? "+" : "−"}${fmtN(Math.abs(bestD))}.`
        );
      s.push(
        ru
          ? `Валовая маржа: ${fmtPct(prev.gpMarginPct)} → ${fmtPct(cur.gpMarginPct)}.`
          : `Gross margin: ${fmtPct(prev.gpMarginPct)} → ${fmtPct(cur.gpMarginPct)}.`
      );
    } else {
      s.push(ru ? "Нет предыдущего месяца для сравнения." : "No prior month to compare against.");
    }
    return s;
  }, [cur, prev, ru, channelNames]); // eslint-disable-line react-hooks/exhaustive-deps

  const risks = useMemo(() => {
    const s: string[] = [];
    if (prev) {
      const declines = Object.entries(cur.revenueByChannel)
        .map(([ch, v]) => ({ ch, d: v - (prev.revenueByChannel[ch] ?? 0) }))
        .filter((x) => x.d < 0)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      for (const x of declines)
        s.push(
          ru
            ? `Снижение по каналу ${channelNames[x.ch] ?? x.ch}: −${fmtN(Math.abs(x.d))}.`
            : `Decline in ${channelNames[x.ch] ?? x.ch}: −${fmtN(Math.abs(x.d))}.`
        );
      if (prev.totalOpex > 0 && cur.totalOpex > prev.totalOpex * 1.1)
        s.push(
          ru
            ? `Расходы выросли на ${(((cur.totalOpex - prev.totalOpex) / prev.totalOpex) * 100).toFixed(1)}% к предыдущему месяцу.`
            : `Expenses grew ${(((cur.totalOpex - prev.totalOpex) / prev.totalOpex) * 100).toFixed(1)}% vs prior month.`
        );
    }
    if ((cur.opexTiByGroup["UNMAPPED"] ?? 0) + (cur.opexFargoByGroup["UNMAPPED"] ?? 0) > 0)
      s.push(ru ? "Есть расходы без P&L-группы — проверьте категории." : "Some expenses have no P&L group — check categories.");
    if (cur.cogs === 0 && cur.revenue > 0)
      s.push(ru ? "Себестоимость месяца нулевая — прибыль завышена." : "COGS is zero this month — profit is overstated.");
    if (cur.revenue > 0 && (cur.opexTiTotal === 0 || cur.opexFargoTotal === 0))
      s.push(
        ru
          ? "OPEX за месяц не заполнен (TI и/или Fargo) — расходы занижены, прибыль завышена."
          : "This month's OPEX is not entered (TI and/or Fargo) — expenses understated, profit overstated."
      );
    if (cur.netProfit < 0) s.push(ru ? "Месяц убыточный." : "The month is loss-making.");
    return s;
  }, [cur, prev, ru, channelNames]);

  const ytdCard = useMemo(() => {
    const n = withData.length;
    const avgRev = n ? ytd.revenue / n : 0;
    const avgNet = n ? ytd.netProfit / n : 0;
    return { n, avgRev, avgNet };
  }, [withData, ytd]);

  // ── matrix view specs ──
  const matrixCols = useMemo(() => [...withData, ytd], [withData, ytd]);
  const channelIds = useMemo(
    () =>
      Object.entries(ytd.revenueByChannel)
        .filter(([, v]) => v !== 0)
        .sort((a, b) => b[1] - a[1])
        .map(([ch]) => ch),
    [ytd]
  );
  const cogsProductIds = useMemo(
    () => [...ytd.cogsRows].sort((a, b) => b.amount - a.amount).map((r) => r.productId),
    [ytd]
  );
  const matrixSpecs: MatrixRowSpec[] = useMemo(() => {
    const specs: MatrixRowSpec[] = [];
    specs.push({
      id: "revenue",
      label: t("revenue"),
      get: (m) => m.revenue,
      kind: "subtotal",
      toggle: { expanded: !!open["mx:rev"], onToggle: () => toggle("mx:rev") },
    });
    if (open["mx:rev"])
      for (const ch of channelIds)
        specs.push({ id: `rev:${ch}`, label: channelNames[ch] ?? ch, get: (m) => m.revenueByChannel[ch] ?? 0, indent: 1 });
    specs.push({
      id: "cogs",
      label: `− ${t("cogs")}`,
      get: (m) => m.cogs,
      negate: true,
      toggle: { expanded: !!open["mx:cogs"], onToggle: () => toggle("mx:cogs") },
    });
    if (open["mx:cogs"])
      for (const pid of cogsProductIds)
        specs.push({
          id: `cogs:${pid}`,
          label: productNames[pid] ?? pid,
          get: (m) => m.cogsRows.find((r) => r.productId === pid)?.amount ?? 0,
          negate: true,
          indent: 1,
        });
    specs.push({ id: "gp", label: t("grossProfit"), get: (m) => m.grossProfit, kind: "subtotal", section: true });
    specs.push({ id: "gpPct", label: t("gpMargin"), get: (m) => m.gpMarginPct, kind: "pct" });
    specs.push({
      id: "opex",
      label: `− ${t("totalOpex")}`,
      get: (m) => m.totalOpex,
      negate: true,
      section: true,
      toggle: { expanded: !!open["mx:opex"], onToggle: () => toggle("mx:opex") },
    });
    if (open["mx:opex"]) {
      for (const g of [...TI_GROUPS, "UNMAPPED"])
        if (matrixCols.some((c) => c.opexTiByGroup[g]))
          specs.push({
            id: `ti:${g}`,
            label: `TI · ${GROUP_LABELS[g][locale]}`,
            drill: `ti:${g}`,
            get: (m) => m.opexTiByGroup[g] ?? 0,
            negate: true,
            indent: 1,
          });
      for (const g of [...FARGO_GROUPS, "UNMAPPED"])
        if (matrixCols.some((c) => c.opexFargoByGroup[g]))
          specs.push({
            id: `fg:${g}`,
            label: `Fargo · ${GROUP_LABELS[g][locale]}`,
            drill: `fg:${g}`,
            get: (m) => m.opexFargoByGroup[g] ?? 0,
            negate: true,
            indent: 1,
          });
      specs.push({ id: "retro", label: t("retroBonus"), drill: "retro", get: (m) => m.retroBonus, negate: true, indent: 1 });
    }
    specs.push({ id: "ebitda", label: t("ebitda"), get: (m) => m.ebitda, kind: "subtotal", section: true });
    specs.push({ id: "ebitdaPct", label: t("ebitdaMargin"), get: (m) => m.ebitdaMarginPct, kind: "pct" });
    specs.push({
      id: "taxes",
      label: `− ${t("taxesTotal")}`,
      get: (m) => m.taxesTotal,
      negate: true,
      section: true,
      toggle: { expanded: !!open["mx:tax"], onToggle: () => toggle("mx:tax") },
    });
    if (open["mx:tax"]) {
      specs.push({ id: "bankVat", label: `${t("fargoVat")} — ${t("bank")}`, drill: "fargoVat", get: (m) => m.bankVat, negate: true, indent: 1 });
      specs.push({ id: "cashVat", label: `${t("fargoVat")} — ${t("cash")}`, drill: "fargoVat", get: (m) => m.cashVat, negate: true, indent: 1 });
      specs.push({ id: "fargoTax", label: t("fargoIncomeTax"), get: (m) => m.fargoIncomeTax, negate: true, indent: 1 });
      specs.push({ id: "tiTax", label: t("tiIncomeTax"), drill: "tiIncomeTax", get: (m) => m.tiIncomeTax, negate: true, indent: 1 });
    }
    specs.push({ id: "net", label: t("netProfit"), get: (m) => m.netProfit, kind: "total" });
    specs.push({ id: "netPct", label: t("netMargin"), get: (m) => m.netMarginPct, kind: "pct" });
    return specs;
     
  }, [open, channelIds, cogsProductIds, matrixCols, channelNames, productNames, locale, t]);

  const modeBtn = (m: "month" | "matrix", label: string) => (
    <button
      onClick={() => setMode(m)}
      className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
        mode === m ? "bg-accent text-white" : "text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="pb-16">
      <PageTitle
        title={t("navPnl")}
        subtitle={t("descPnl")}
        right={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 rounded-full border border-border p-1">
              {modeBtn("month", ru ? "Месяц" : "Month")}
              {modeBtn("matrix", ru ? "12 месяцев" : "12 months")}
            </div>
            <a href={`/api/export/pnl?locale=${locale}`}>
              <Button variant="secondary">
                <IconDownload size={14} /> {t("export")}
              </Button>
            </a>
          </div>
        }
      />

      {mode === "month" ? (
        <div className="space-y-6">
          {/* statement */}
          <Card className="p-2">
            <div className="px-4 pb-1 pt-3">
              <span className="label-caps">{monthName(cur.monthId)}</span>
            </div>
            <StatementLine
              label={t("revenue")}
              value={cur.revenue}
              cur={cur.revenue}
              prev={prev ? prev.revenue : null}
              childRows={revenueChildren}
              expanded={!!open["rev"]}
              onToggle={() => toggle("rev")}
            />
            <StatementLine
              label={`− ${t("cogs")}`}
              value={cur.cogs}
              negate
              cur={cur.cogs}
              prev={prev ? prev.cogs : null}
              invert
              childRows={cogsChildren}
              expanded={!!open["cogs"]}
              onToggle={() => toggle("cogs")}
            />
            <StatementLine
              label={t("grossProfit")}
              value={cur.grossProfit}
              cur={cur.grossProfit}
              prev={prev ? prev.grossProfit : null}
              band="sub"
              marginPct={cur.gpMarginPct}
            />
            <StatementLine
              label={`− ${t("totalOpex")}`}
              value={cur.totalOpex}
              negate
              cur={cur.totalOpex}
              prev={prev ? prev.totalOpex : null}
              invert
              childRows={opexChildren}
              expanded={!!open["opex"]}
              onToggle={() => toggle("opex")}
              onDrill={(k) => onDrill(k, cur)}
            />
            <StatementLine
              label={t("ebitda")}
              value={cur.ebitda}
              cur={cur.ebitda}
              prev={prev ? prev.ebitda : null}
              band="sub"
              marginPct={cur.ebitdaMarginPct}
            />
            <StatementLine
              label={`− ${t("taxesTotal")}`}
              value={cur.taxesTotal}
              negate
              cur={cur.taxesTotal}
              prev={prev ? prev.taxesTotal : null}
              invert
              childRows={taxChildren}
              expanded={!!open["tax"]}
              onToggle={() => toggle("tax")}
              onDrill={(k) => onDrill(k, cur)}
            />
            <StatementLine
              label={cur.netProfit < 0 ? (ru ? "Чистый убыток" : "Net loss") : t("netProfit")}
              value={cur.netProfit}
              cur={cur.netProfit}
              prev={prev ? prev.netProfit : null}
              band="hero"
              marginPct={cur.netMarginPct}
            />
          </Card>

          {/* insight cards — every figure is computed, nothing invented */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="quiet-card rounded-xl p-5">
              <div className="label-caps mb-2 text-accent">{ru ? "Инсайт месяца" : "Month insight"}</div>
              <div className="space-y-1.5 text-[13px] leading-relaxed">
                {insight.map((s, i) => (
                  <p key={i}>{s}</p>
                ))}
              </div>
            </div>
            <div className="quiet-card rounded-xl p-5">
              <div className="label-caps mb-2 text-warn">{ru ? "Внимание" : "Attention"}</div>
              <div className="space-y-1.5 text-[13px] leading-relaxed">
                {risks.length === 0 ? (
                  <p className="text-muted">{ru ? "Существенных отклонений не выявлено." : "No significant issues found."}</p>
                ) : (
                  risks.map((s, i) => <p key={i}>{s}</p>)
                )}
              </div>
            </div>
            <div className="quiet-card rounded-xl p-5">
              <div className="label-caps mb-2">{ru ? "С начала года" : "Year to date"}</div>
              <div className="space-y-1.5 text-[13px] leading-relaxed">
                <p>
                  {ru ? "Выручка" : "Revenue"}: <span className="num font-medium">{fmtN(ytd.revenue)}</span>
                </p>
                <p>
                  {ru ? "Чистая прибыль" : "Net profit"}:{" "}
                  <span className="num font-medium">{fmtN(ytd.netProfit)}</span>{" "}
                  <Badge tone={ytd.netProfit >= 0 ? "ok" : "warn"}>{fmtPct(ytd.netMarginPct)}</Badge>
                </p>
                <p className="text-muted">
                  {ru
                    ? `В среднем за месяц (${ytdCard.n} мес.): ${fmtN(ytdCard.avgRev)} выручки, ${fmtN(ytdCard.avgNet)} прибыли.`
                    : `Monthly average (${ytdCard.n} mo): ${fmtN(ytdCard.avgRev)} revenue, ${fmtN(ytdCard.avgNet)} profit.`}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="max-h-[76vh] overflow-auto">
            <table className="tbl min-w-max">
              <thead>
                <tr>
                  <th className="sticky-col min-w-60"></th>
                  {matrixCols.map((m) => (
                    <th key={m.monthId} className={`min-w-[108px] text-right ${m.monthId === "YTD" ? "col-hl" : ""}`}>
                      {monthName(m.monthId)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixSpecs.map((s) => (
                  <MatrixRow key={s.id} spec={s} cols={matrixCols} onDrill={onDrill} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {drill && (
        <Modal title={drill.title} onClose={() => setDrill(null)}>
          {drill.rows.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted">{t("noData")}</div>
          ) : (
            <table className="tbl">
              <tbody>
                {drill.rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <div>{r.label}</div>
                      {r.note && <div className="text-[11px] text-muted">{r.note}</div>}
                    </td>
                    <td className="text-right">
                      <Num v={r.value} />
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td>{t("total")}</td>
                  <td className="text-right">
                    <Num v={drill.rows.reduce((s, r) => s + r.value, 0)} strong />
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </Modal>
      )}
    </div>
  );
}
