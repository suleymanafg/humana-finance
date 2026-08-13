"use client";

// Sales workspace redesigned around the map (owner request 2026-07-31):
// clicking a region — or one of the two pins («Сети», «Прочие продажи») that sit
// apart from the geography — recalculates EVERY figure on the page for that
// selection: metric tiles, the detail panel, monthly dynamics, product
// economics. No selection = whole country. Region ↔ channel is 1:1 today;
// district / retail-point drill-down comes later when the sync stores them.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { Badge, Button, Modal, Num, PageTitle } from "./ui";
import { IconChevronRight, IconDownload, IconUpload, IconX } from "./icons";
import {
  Collapsible,
  Delta,
  MetricStrip,
  Money,
  Section,
  ShareBar,
  Spark,
  Th,
  fmtN,
  fmtPct,
  useSort,
  type Metric,
} from "./analysis";
import { toNum } from "@/lib/format";
import UzMap, { type RegionStat } from "./UzMap";
import { UZ_REGIONS } from "@/lib/uz-map";
import MonthStrip from "./MonthStrip";
import { useT } from "@/lib/locale-context";
import type { ChannelIn, MonthIn, ProductIn, SaleIn } from "@/lib/engine/types";
import type { ImportRow, MatchedRow, RejectedRow } from "@/lib/import-sales";

interface Snapshot {
  revenue: number;
  cashRevenue: number;
  bankRevenue: number;
  retroBonus: number;
  totalQty: number;
  revenueByChannel: Record<string, number>;
  qtyByProduct: Record<string, number>;
  revenueByProduct: Record<string, number>;
  cogs: number;
  grossProfit: number;
  gpMarginPct: number;
}
interface PriorSnapshot {
  revenue: number;
  totalQty: number;
  revenueByChannel: Record<string, number>;
  qtyByProduct: Record<string, number>;
  revenueByProduct: Record<string, number>;
  gpMarginPct: number;
}
interface TrendPoint {
  monthId: string;
  revenue: number;
  qty: number;
  gpMarginPct: number;
  byChannel: Record<string, number>;
}

type Selection =
  | { kind: "region"; iso: string }
  | { kind: "chains" }
  | { kind: "other" }
  | { kind: "channel"; id: string }
  | null;

// non-territory channels that are NOT supermarket chains — wholesale, internal,
// unclassified. Everything else outside the map regions counts as «Сети».
const OTHER_CHANNEL_NAMES = new Set([
  "Дилеры Бондюэль",
  "DARVOZA SAVDO",
  "ТИИН ОПТОМ",
  "Внутреннее",
  "Прочие",
]);

/** A clickable "map point" that lives apart from the geography. */
function MapPin({
  label,
  revenue,
  share,
  selected,
  onClick,
}: {
  label: string;
  revenue: number;
  share: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left shadow-[0_2px_8px_rgba(16,24,40,0.08)] transition-colors ${
        selected
          ? "border-accent bg-accent-soft"
          : "border-border bg-surface hover:border-accent"
      }`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          selected ? "bg-accent" : "bg-accent-soft"
        }`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${selected ? "bg-white" : "bg-accent"}`} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-semibold leading-tight">{label}</span>
        <span className="num block text-[11.5px] text-muted">
          {fmtN(revenue)} · {fmtPct(share)}
        </span>
      </span>
    </button>
  );
}

/** Monthly bar chart for the current selection; current month highlighted. */
function MonthBars({
  points,
  currentId,
  labelOf,
}: {
  points: Array<{ monthId: string; value: number }>;
  currentId: string;
  labelOf: (id: string) => string;
}) {
  const { locale } = useT();
  const max = Math.max(1, ...points.map((p) => p.value));
  const compact = (v: number) => {
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}${locale === "ru" ? " млрд" : "B"}`;
    if (v >= 1e6) return `${Math.round(v / 1e6)}${locale === "ru" ? " млн" : "M"}`;
    return v > 0 ? fmtN(v) : "";
  };
  return (
    <div className="flex items-end gap-1.5 px-4 pb-3 pt-5">
      {points.map((p) => {
        const active = p.monthId === currentId;
        return (
          <div
            key={p.monthId}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
            title={fmtN(p.value)}
          >
            <span className={`num whitespace-nowrap text-[10px] ${active ? "font-semibold text-accent" : "text-muted"}`}>
              {compact(p.value)}
            </span>
            <div
              className={`w-full rounded-t transition-all ${active ? "bg-accent" : "bg-accent-soft"}`}
              style={{ height: `${Math.max(p.value > 0 ? 3 : 0, (p.value / max) * 130)}px` }}
            />
            <span className={`truncate text-[10.5px] ${active ? "font-semibold text-accent" : "text-muted"}`}>
              {labelOf(p.monthId)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function SalesView({
  months,
  products,
  channels,
  monthId,
  sales,
  clientSales,
  priorSales,
  current,
  prior,
  trend,
  unitCosts,
  readOnly,
}: {
  months: MonthIn[];
  products: ProductIn[];
  channels: ChannelIn[];
  monthId: string;
  sales: SaleIn[];
  clientSales: Array<{ clientMapId: string; name: string; productId: string; channelId: string; qty: number }>;
  priorSales: SaleIn[];
  current: Snapshot | null;
  prior: PriorSnapshot | null;
  trend: TrendPoint[];
  unitCosts: Record<string, number>;
  readOnly: boolean;
}) {
  const { t, locale } = useT();
  const router = useRouter();
  const [showImport, setShowImport] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);

  // stable empty snapshot so the memos below don't re-run every render
  const cur = useMemo<Snapshot>(
    () =>
      current ?? {
        revenue: 0,
        cashRevenue: 0,
        bankRevenue: 0,
        retroBonus: 0,
        totalQty: 0,
        revenueByChannel: {},
        qtyByProduct: {},
        revenueByProduct: {},
        cogs: 0,
        grossProfit: 0,
        gpMarginPct: 0,
      },
    [current]
  );

  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const channelByName = useMemo(() => new Map(channels.map((c) => [c.name, c])), [channels]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // ── channel classification: regions vs chains vs other ────────
  const regionChannelNames = useMemo(() => new Set(UZ_REGIONS.flatMap((r) => r.channels)), []);
  const chainChannelIds = useMemo(
    () =>
      channels
        .filter((c) => !regionChannelNames.has(c.name) && !OTHER_CHANNEL_NAMES.has(c.name))
        .map((c) => c.id),
    [channels, regionChannelNames]
  );
  const otherChannelIds = useMemo(
    () => channels.filter((c) => OTHER_CHANNEL_NAMES.has(c.name)).map((c) => c.id),
    [channels]
  );

  const selectedChannelIds = useMemo<Set<string> | null>(() => {
    if (!selection) return null;
    if (selection.kind === "channel") return new Set([selection.id]);
    if (selection.kind === "chains") return new Set(chainChannelIds);
    if (selection.kind === "other") return new Set(otherChannelIds);
    const region = UZ_REGIONS.find((r) => r.iso === selection.iso);
    if (!region) return null;
    return new Set(
      region.channels.map((n) => channelByName.get(n)?.id).filter((x): x is string => !!x)
    );
  }, [selection, channelByName, chainChannelIds, otherChannelIds]);

  const selectionLabel = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === "chains") return t("salesChains");
    if (selection.kind === "other") return t("salesOther");
    if (selection.kind === "channel") return channelById.get(selection.id)?.name ?? null;
    const r = UZ_REGIONS.find((x) => x.iso === selection.iso);
    return r ? (locale === "ru" ? r.nameRu : r.nameEn) : null;
  }, [selection, channelById, locale, t]);

  // ── selection-filtered aggregates ─────────────────────────────
  // revenue of a sale row = invoiced amount when known, else qty × list price
  // (the same preference the calc engine uses)
  const revenueOf = useMemo(
    () => (s: SaleIn) => s.amount ?? s.qty * (productById.get(s.productId)?.price ?? 0),
    [productById]
  );

  const aggregate = useMemo(
    () => (rows: SaleIn[], filter: Set<string> | null) => {
      let revenue = 0;
      let qty = 0;
      const byProduct = new Map<string, { qty: number; revenue: number }>();
      const byChannel = new Map<string, { qty: number; revenue: number }>();
      for (const s of rows) {
        if (filter && !filter.has(s.channelId)) continue;
        const r = revenueOf(s);
        revenue += r;
        qty += s.qty;
        const p = byProduct.get(s.productId) ?? { qty: 0, revenue: 0 };
        p.qty += s.qty;
        p.revenue += r;
        byProduct.set(s.productId, p);
        const c = byChannel.get(s.channelId) ?? { qty: 0, revenue: 0 };
        c.qty += s.qty;
        c.revenue += r;
        byChannel.set(s.channelId, c);
      }
      return { revenue, qty, byProduct, byChannel };
    },
    [revenueOf]
  );

  const sel = useMemo(() => aggregate(sales, selectedChannelIds), [aggregate, sales, selectedChannelIds]);
  const selPrior = useMemo(
    () => aggregate(priorSales, selectedChannelIds),
    [aggregate, priorSales, selectedChannelIds]
  );

  // per-month revenue series for the selection (sparkline + bar chart)
  const selSeries = useMemo(
    () =>
      trend.map((p) => {
        if (!selectedChannelIds) return { monthId: p.monthId, value: p.revenue };
        let v = 0;
        for (const id of selectedChannelIds) v += p.byChannel[id] ?? 0;
        return { monthId: p.monthId, value: v };
      }),
    [trend, selectedChannelIds]
  );

  const selGp = useMemo(() => {
    let gp = 0;
    for (const [pid, v] of sel.byProduct) gp += v.revenue - v.qty * (unitCosts[pid] ?? 0);
    return gp;
  }, [sel.byProduct, unitCosts]);
  const selPriorGp = useMemo(() => {
    let gp = 0;
    for (const [pid, v] of selPrior.byProduct) gp += v.revenue - v.qty * (unitCosts[pid] ?? 0);
    return gp;
  }, [selPrior.byProduct, unitCosts]);

  // ── headline metrics (follow the selection) ───────────────────
  const avgPrice = sel.qty !== 0 ? sel.revenue / sel.qty : 0;
  const priorAvgPrice = selPrior.qty !== 0 ? selPrior.revenue / selPrior.qty : 0;
  const promoRevenue = useMemo(() => {
    let v = 0;
    for (const [pid, x] of sel.byProduct) if (productById.get(pid)?.isPromo) v += x.revenue;
    return v;
  }, [sel.byProduct, productById]);
  const activeChannels = Object.values(cur.revenueByChannel).filter((v) => v !== 0).length;

  const metrics: Metric[] = [
    {
      label: t("revenue"),
      value: fmtN(sel.revenue),
      delta: prior ? { current: sel.revenue, previous: selPrior.revenue } : undefined,
      series: selSeries.map((p) => p.value),
      hint: selectionLabel ?? `${activeChannels} / ${channels.length} ${locale === "ru" ? "каналов" : "channels"}`,
    },
    {
      label: t("qty"),
      value: fmtN(sel.qty),
      delta: prior ? { current: sel.qty, previous: selPrior.qty } : undefined,
    },
    {
      label: `${t("realisedPrice")} / ${t("perUnit")}`,
      value: fmtN(avgPrice),
      delta: prior ? { current: avgPrice, previous: priorAvgPrice } : undefined,
    },
    {
      label: t("gpTotal"),
      value: fmtN(selGp),
      delta: prior ? { current: selGp, previous: selPriorGp } : undefined,
      hint: `${t("gpMargin")} ${fmtPct(sel.revenue !== 0 ? selGp / sel.revenue : 0)}`,
      negative: selGp < 0,
    },
    selection
      ? {
          label: t("salesShareOfTotal"),
          value: fmtPct(cur.revenue !== 0 ? sel.revenue / cur.revenue : 0),
          hint: `${locale === "ru" ? "от" : "of"} ${fmtN(cur.revenue)}`,
        }
      : {
          label: locale === "ru" ? "Доля акций" : "Promo share",
          value: fmtPct(sel.revenue !== 0 ? promoRevenue / sel.revenue : 0),
          hint: fmtN(promoRevenue),
        },
  ];

  // ── map choropleth stats (always whole-month, so the map stays stable) ──
  const qtyByChannel = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sales) m.set(s.channelId, (m.get(s.channelId) ?? 0) + s.qty);
    return m;
  }, [sales]);

  const statsByIso = useMemo(() => {
    const out: Record<string, RegionStat> = {};
    for (const r of UZ_REGIONS) {
      let revenue = 0;
      let qty = 0;
      for (const name of r.channels) {
        const ch = channelByName.get(name);
        if (!ch) continue;
        revenue += cur.revenueByChannel[ch.id] ?? 0;
        qty += qtyByChannel.get(ch.id) ?? 0;
      }
      out[r.iso] = { revenue, qty, share: cur.revenue !== 0 ? revenue / cur.revenue : 0 };
    }
    return out;
  }, [channelByName, cur.revenueByChannel, cur.revenue, qtyByChannel]);

  const pinStat = useMemo(
    () => (ids: string[]) => {
      const revenue = ids.reduce((a, id) => a + (cur.revenueByChannel[id] ?? 0), 0);
      return { revenue, share: cur.revenue !== 0 ? revenue / cur.revenue : 0 };
    },
    [cur.revenueByChannel, cur.revenue]
  );
  const chainsStat = useMemo(() => pinStat(chainChannelIds), [pinStat, chainChannelIds]);
  const otherStat = useMemo(() => pinStat(otherChannelIds), [pinStat, otherChannelIds]);

  // ── detail panel rows ─────────────────────────────────────────
  const detailSku = useMemo(
    () =>
      products
        .map((p) => ({
          product: p,
          qty: sel.byProduct.get(p.id)?.qty ?? 0,
          revenue: sel.byProduct.get(p.id)?.revenue ?? 0,
        }))
        .filter((r) => r.qty !== 0 || r.revenue !== 0)
        .sort((a, b) => b.revenue - a.revenue),
    [products, sel.byProduct]
  );
  const maxSkuRevenue = Math.max(1, ...detailSku.map((r) => Math.abs(r.revenue)));

  // per-client rows for the current selection — the drill-down layer synced
  // from 1C (list price valuation, same as API sales in the P&L)
  const clientRows = useMemo(() => {
    const byClient = new Map<
      string,
      { id: string; name: string; qty: number; revenue: number; byProduct: Map<string, number> }
    >();
    for (const cs of clientSales) {
      if (selectedChannelIds && !selectedChannelIds.has(cs.channelId)) continue;
      const price = productById.get(cs.productId)?.price ?? 0;
      const row =
        byClient.get(cs.clientMapId) ??
        { id: cs.clientMapId, name: cs.name, qty: 0, revenue: 0, byProduct: new Map<string, number>() };
      row.qty += cs.qty;
      row.revenue += cs.qty * price;
      row.byProduct.set(cs.productId, (row.byProduct.get(cs.productId) ?? 0) + cs.qty);
      byClient.set(cs.clientMapId, row);
    }
    return [...byClient.values()]
      .filter((r) => r.qty !== 0 || r.revenue !== 0)
      .sort((a, b) => b.revenue - a.revenue);
  }, [clientSales, selectedChannelIds, productById]);
  const maxClientRevenue = Math.max(1, ...clientRows.map((r) => Math.abs(r.revenue)));
  const clientRevenueTotal = clientRows.reduce((s, r) => s + r.revenue, 0);

  // member channels of the current selection (for chains/other/whole-country)
  const memberChannels = useMemo(() => {
    if (selection?.kind === "channel") return [];
    const rows = [...sel.byChannel.entries()]
      .map(([id, v]) => ({ channel: channelById.get(id), ...v }))
      .filter((r): r is { channel: ChannelIn; qty: number; revenue: number } => !!r.channel && r.revenue !== 0)
      .sort((a, b) => b.revenue - a.revenue);
    return rows.length > 1 ? rows : [];
  }, [sel.byChannel, channelById, selection]);
  const maxMemberRevenue = Math.max(1, ...memberChannels.map((r) => Math.abs(r.revenue)));

  // ── product economics (follows the selection) ─────────────────
  const productRows = useMemo(() => {
    return products
      .map((p) => {
        const qty = sel.byProduct.get(p.id)?.qty ?? 0;
        const revenue = sel.byProduct.get(p.id)?.revenue ?? 0;
        const priorRevenue = selPrior.byProduct.get(p.id)?.revenue ?? 0;
        const cost = unitCosts[p.id] ?? 0;
        const realised = qty !== 0 ? revenue / qty : 0;
        const gpUnit = realised !== 0 ? realised - cost : 0;
        return {
          product: p,
          qty,
          revenue,
          priorRevenue,
          share: sel.revenue !== 0 ? revenue / sel.revenue : 0,
          realised,
          cost,
          gpUnit,
          gpTotal: qty * gpUnit,
          gpPct: realised !== 0 ? gpUnit / realised : 0,
          vsList: p.price !== 0 && realised !== 0 ? realised / p.price - 1 : 0,
        };
      })
      .filter((r) => r.qty !== 0 || r.revenue !== 0);
  }, [products, sel, selPrior, unitCosts]);

  const prodSort = useSort(productRows, "gpTotal", {
    name: (r) => r.product.nameRu,
    qty: (r) => r.qty,
    revenue: (r) => r.revenue,
    realised: (r) => r.realised,
    gpUnit: (r) => r.gpUnit,
    gpTotal: (r) => r.gpTotal,
    gpPct: (r) => r.gpPct,
  });
  const maxGp = Math.max(1, ...productRows.map((r) => Math.abs(r.gpTotal)));
  const totalGp = productRows.reduce((a, r) => a + r.gpTotal, 0);

  // ── channel table (always all channels; rows select) ──────────
  const channelRows = useMemo(() => {
    return channels
      .map((c) => {
        const now = cur.revenueByChannel[c.id] ?? 0;
        const was = prior?.revenueByChannel[c.id] ?? 0;
        return {
          channel: c,
          now,
          was,
          diff: now - was,
          share: cur.revenue !== 0 ? now / cur.revenue : 0,
          series: trend.map((p) => p.byChannel[c.id] ?? 0),
        };
      })
      .filter((r) => r.now !== 0 || r.was !== 0);
  }, [channels, cur.revenueByChannel, cur.revenue, prior, trend]);

  const chanSort = useSort(channelRows, "now", {
    name: (r) => r.channel.name,
    now: (r) => r.now,
    was: (r) => r.was,
    diff: (r) => r.diff,
    share: (r) => r.share,
  });
  const maxChannelRevenue = Math.max(1, ...channelRows.map((r) => r.now));

  // ── grid ──────────────────────────────────────────────────────
  const qtyMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sales) m.set(`${s.productId}|${s.channelId}`, s.qty);
    return m;
  }, [sales]);

  async function saveCell(productId: string, channelId: string, qty: number) {
    await fetch("/api/sales/cell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthId, productId, channelId, qty }),
    });
    router.refresh();
  }

  const monthShort = (id: string) => {
    const m = months.find((x) => x.id === id);
    const name = m ? (locale === "ru" ? m.nameRu : m.nameEn) : id;
    return `${name.split(" ")[0].slice(0, 3)} '${id.slice(2, 4)}`;
  };

  const detailTitle = selectionLabel ?? t("salesAllUz");

  return (
    <div>
      <PageTitle
        title={t("salesTitle")}
        subtitle={t("descSales")}
        right={
          <div className="flex items-center gap-2">
            <a href={`/api/export/sales?month=${monthId}&locale=${locale}`}>
              <Button variant="secondary">
                <IconDownload size={14} /> {t("export")}
              </Button>
            </a>
            {!readOnly && (
              <Button variant="secondary" onClick={() => setShowImport(true)}>
                <IconUpload size={14} /> {t("salesImportCsv")}
              </Button>
            )}
          </div>
        }
      />

      <MonthStrip
        months={months}
        monthId={monthId}
        hasData={new Set(trend.filter((p) => p.revenue !== 0).map((p) => p.monthId))}
      />

      <MetricStrip metrics={metrics} />

      {/* map + selection detail */}
      <Section
        title={t("mapTitle")}
        note={t("salesMapHint")}
        right={
          selectionLabel && (
            <button
              onClick={() => setSelection(null)}
              className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-[12px] font-medium text-accent"
            >
              {selectionLabel} <IconX size={11} />
            </button>
          )
        }
      >
        <div className="grid lg:grid-cols-[3fr_2fr] lg:divide-x lg:divide-border">
          <div className="relative min-w-0 p-4">
            <UzMap
              statsByIso={statsByIso}
              selectedIso={selection?.kind === "region" ? selection.iso : null}
              onSelect={(iso) => setSelection(iso ? { kind: "region", iso } : null)}
            />
            {/* map points that live apart from the geography */}
            <div className="absolute right-4 top-4 flex flex-col items-end gap-2">
              <MapPin
                label={t("salesChains")}
                revenue={chainsStat.revenue}
                share={chainsStat.share}
                selected={selection?.kind === "chains"}
                onClick={() => setSelection(selection?.kind === "chains" ? null : { kind: "chains" })}
              />
              <MapPin
                label={t("salesOther")}
                revenue={otherStat.revenue}
                share={otherStat.share}
                selected={selection?.kind === "other"}
                onClick={() => setSelection(selection?.kind === "other" ? null : { kind: "other" })}
              />
            </div>
          </div>

          {/* detail panel */}
          <div className="min-w-0 p-4">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <h3 className="truncate font-display text-[16px] font-semibold">{detailTitle}</h3>
              {selection && (
                <button
                  onClick={() => setSelection(null)}
                  className="shrink-0 text-[12px] font-medium text-accent hover:underline"
                >
                  {t("salesResetSel")}
                </button>
              )}
            </div>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="num font-display text-[22px] font-bold tracking-tight">
                {fmtN(sel.revenue)}
              </span>
              {prior && (
                <span className="text-[12.5px]">
                  <Delta current={sel.revenue} previous={selPrior.revenue} />
                </span>
              )}
              <span className="text-[12.5px] text-muted">
                {fmtN(sel.qty)} {locale === "ru" ? "шт" : "pcs"}
              </span>
              {selection && (
                <span className="text-[12.5px] text-muted">
                  {fmtPct(cur.revenue !== 0 ? sel.revenue / cur.revenue : 0)} {t("ofRevenueBare")}
                </span>
              )}
            </div>

            {/* SKU breakdown */}
            <div className="label-caps mb-1.5">{t("product")}</div>
            <div className="max-h-64 overflow-auto pr-1">
              {detailSku.length === 0 ? (
                <div className="py-6 text-center text-[12px] text-muted">{t("noData")}</div>
              ) : (
                detailSku.map((r) => (
                  <div key={r.product.id} className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[12.5px]" title={r.product.nameRu}>
                          {r.product.nameRu}
                        </span>
                        {r.product.isPromo && <Badge tone="accent">promo</Badge>}
                      </div>
                      <div className="num text-[11px] text-muted">
                        {fmtN(r.qty)} {locale === "ru" ? "шт" : "pcs"} ·{" "}
                        {fmtPct(sel.revenue !== 0 ? r.revenue / sel.revenue : 0)}
                      </div>
                    </div>
                    <div className="w-16 shrink-0">
                      <ShareBar value={Math.abs(r.revenue)} max={maxSkuRevenue} />
                    </div>
                    <span className="num w-28 shrink-0 text-right text-[12.5px] font-medium">
                      {fmtN(r.revenue)}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* member channels (whole country / chains / other / multi-channel region) */}
            {memberChannels.length > 0 && (
              <>
                <div className="label-caps mb-1.5 mt-4">{t("salesByChannel")}</div>
                <div className="max-h-48 overflow-auto pr-1">
                  {memberChannels.map((r) => (
                    <button
                      key={r.channel.id}
                      onClick={() => setSelection({ kind: "channel", id: r.channel.id })}
                      className="flex w-full items-center gap-2 border-b border-border py-1.5 text-left transition-colors last:border-b-0 hover:text-accent"
                    >
                      <span className="min-w-0 flex-1 truncate text-[12.5px]" title={r.channel.name}>
                        {r.channel.name}
                      </span>
                      <span className="num shrink-0 text-[11px] text-muted">
                        {fmtPct(sel.revenue !== 0 ? r.revenue / sel.revenue : 0)}
                      </span>
                      <div className="w-16 shrink-0">
                        <ShareBar value={Math.abs(r.revenue)} max={maxMemberRevenue} />
                      </div>
                      <span className="num w-28 shrink-0 text-right text-[12.5px] font-medium">
                        {fmtN(r.revenue)}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* per-client drill-down (populated by the 1C sync) */}
            <div className="label-caps mb-1.5 mt-4">
              {t("salesClients")}
              {clientRows.length > 0 && (
                <span className="ml-1.5 normal-case tracking-normal text-muted">· {clientRows.length}</span>
              )}
            </div>
            {clientRows.length === 0 ? (
              <p className="py-2 text-[12px] leading-relaxed text-muted">{t("salesClientsHint")}</p>
            ) : (
              <div className="max-h-72 overflow-auto pr-1">
                {clientRows.map((r) => (
                  <div key={r.id} className="border-b border-border last:border-b-0">
                    <button
                      onClick={() => setExpandedClient(expandedClient === r.id ? null : r.id)}
                      className="flex w-full items-center gap-2 py-1.5 text-left transition-colors hover:text-accent"
                    >
                      <IconChevronRight
                        size={11}
                        className={`shrink-0 text-muted transition-transform ${
                          expandedClient === r.id ? "rotate-90" : ""
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate text-[12.5px]" title={r.name}>
                        {r.name}
                      </span>
                      <span className="num shrink-0 text-[11px] text-muted">
                        {fmtPct(clientRevenueTotal !== 0 ? r.revenue / clientRevenueTotal : 0)}
                      </span>
                      <div className="w-16 shrink-0">
                        <ShareBar value={Math.abs(r.revenue)} max={maxClientRevenue} />
                      </div>
                      <span className="num w-28 shrink-0 text-right text-[12.5px] font-medium">
                        {fmtN(r.revenue)}
                      </span>
                    </button>
                    {expandedClient === r.id && (
                      <div className="mb-1.5 ml-5 rounded-lg bg-surface-low/60 px-3 py-1.5">
                        {[...r.byProduct.entries()]
                          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                          .map(([pid, qty]) => (
                            <div
                              key={pid}
                              className="flex items-baseline justify-between gap-3 py-0.5 text-[12px]"
                            >
                              <span className="min-w-0 truncate text-muted">
                                {productById.get(pid)?.nameRu ?? pid}
                              </span>
                              <span className="num shrink-0">
                                {fmtN(qty)} {locale === "ru" ? "шт" : "pcs"}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* monthly dynamics for the selection */}
      <Section title={t("salesDynamics")} note={detailTitle}>
        <MonthBars points={selSeries} currentId={monthId} labelOf={monthShort} />
      </Section>

      {/* product economics — follows the selection */}
      <Section
        title={t("productPerf")}
        note={selection ? detailTitle : t("productPerfNote")}
      >
        <div className="overflow-x-auto">
          <table className="tbl min-w-max">
            <thead>
              <tr>
                <Th sortKey="name" sort={prodSort.sort} onSort={prodSort.onSort}>
                  {t("product")}
                </Th>
                <Th sortKey="qty" sort={prodSort.sort} onSort={prodSort.onSort} numeric>
                  {t("qty")}
                </Th>
                <Th sortKey="revenue" sort={prodSort.sort} onSort={prodSort.onSort} numeric>
                  {t("revenue")}
                </Th>
                <Th numeric>{t("change")}</Th>
                <Th sortKey="realised" sort={prodSort.sort} onSort={prodSort.onSort} numeric title={t("vsList")}>
                  {t("realisedPrice")}
                </Th>
                <Th numeric>{t("unitCost")}</Th>
                <Th sortKey="gpUnit" sort={prodSort.sort} onSort={prodSort.onSort} numeric>
                  {t("gpUnit")}
                </Th>
                <Th sortKey="gpPct" sort={prodSort.sort} onSort={prodSort.onSort} numeric>
                  {t("gpMargin")}
                </Th>
                <Th sortKey="gpTotal" sort={prodSort.sort} onSort={prodSort.onSort} numeric>
                  {t("contribution")}
                </Th>
              </tr>
            </thead>
            <tbody>
              {prodSort.sorted.map((r) => (
                <tr key={r.product.id}>
                  <td className="max-w-[260px]">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate" title={r.product.nameRu}>
                        {r.product.nameRu}
                      </span>
                      {r.product.isPromo && <Badge tone="accent">promo</Badge>}
                    </div>
                    <div className="text-[11px] text-muted">
                      {r.product.productLine ?? "—"} · {fmtPct(r.share)} {t("ofRevenueBare")}
                    </div>
                  </td>
                  <td className="text-right">
                    <Num v={r.qty} />
                  </td>
                  <td>
                    <Money v={r.revenue} />
                  </td>
                  <td className="text-right">
                    <Delta current={r.revenue} previous={r.priorRevenue} />
                  </td>
                  <td>
                    <Money
                      v={r.realised}
                      sub={Math.abs(r.vsList) > 0.001 ? `${r.vsList > 0 ? "+" : ""}${(r.vsList * 100).toFixed(1)}%` : "="}
                    />
                  </td>
                  <td className="text-right">
                    <Num v={r.cost} />
                  </td>
                  <td className="text-right">
                    <Num v={r.gpUnit} />
                  </td>
                  <td className="text-right">
                    <span className={`num ${r.gpPct < 0.25 ? "text-warn" : ""}`}>{fmtPct(r.gpPct)}</span>
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16">
                        <ShareBar value={Math.abs(r.gpTotal)} max={maxGp} />
                      </div>
                      <Money v={r.gpTotal} strong />
                    </div>
                  </td>
                </tr>
              ))}
              <tr className="row-section font-semibold">
                <td>{t("total")}</td>
                <td className="text-right">
                  <Num v={sel.qty} strong />
                </td>
                <td>
                  <Money v={sel.revenue} strong />
                </td>
                <td className="text-right">
                  {prior && <Delta current={sel.revenue} previous={selPrior.revenue} />}
                </td>
                <td>
                  <Money v={avgPrice} />
                </td>
                <td />
                <td />
                <td className="text-right">
                  <span className="num">{fmtPct(sel.revenue !== 0 ? totalGp / sel.revenue : 0)}</span>
                </td>
                <td>
                  <Money v={totalGp} strong />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* channel detail */}
      <Section title={t("channelPerf")}>
        <div className="overflow-x-auto">
          <table className="tbl min-w-max">
            <thead>
              <tr>
                <Th sortKey="name" sort={chanSort.sort} onSort={chanSort.onSort}>
                  {t("channel")}
                </Th>
                <Th sortKey="now" sort={chanSort.sort} onSort={chanSort.onSort} numeric>
                  {t("revenue")}
                </Th>
                <Th sortKey="share" sort={chanSort.sort} onSort={chanSort.onSort} numeric>
                  {t("ofRevenue")}
                </Th>
                <Th sortKey="was" sort={chanSort.sort} onSort={chanSort.onSort} numeric>
                  {t("prior")}
                </Th>
                <Th sortKey="diff" sort={chanSort.sort} onSort={chanSort.onSort} numeric>
                  {t("change")}
                </Th>
                <Th numeric>{t("retroPct")}</Th>
                <Th numeric>{t("trend12")}</Th>
              </tr>
            </thead>
            <tbody>
              {chanSort.sorted.map((r) => {
                const active = selectedChannelIds?.has(r.channel.id);
                return (
                  <tr
                    key={r.channel.id}
                    className={`cursor-pointer ${active ? "!bg-accent-soft/60" : ""}`}
                    onClick={() =>
                      setSelection(
                        selection?.kind === "channel" && selection.id === r.channel.id
                          ? null
                          : { kind: "channel", id: r.channel.id }
                      )
                    }
                  >
                    <td className={`max-w-[220px] truncate ${active ? "font-medium text-accent" : ""}`} title={r.channel.name}>
                      {r.channel.name}
                    </td>
                    <td>
                      <Money v={r.now} />
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-14">
                          <ShareBar value={r.now} max={maxChannelRevenue} />
                        </div>
                        <span className="num w-12">{fmtPct(r.share)}</span>
                      </div>
                    </td>
                    <td className="text-right">
                      <Num v={r.was} />
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-2">
                        <Money v={r.diff} />
                        <span className="w-14 text-right">
                          <Delta current={r.now} previous={r.was} />
                        </span>
                      </div>
                    </td>
                    <td className="text-right">
                      <span className="num text-muted">{fmtPct(r.channel.retroPct)}</span>
                    </td>
                    <td className="text-right">
                      <Spark values={r.series} tone="muted" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* data entry */}
      <Collapsible title={t("dataEntrySection")} note={`${t("salesGrid")} · ${monthShort(monthId)}`}>
        <div className="max-h-[70vh] overflow-auto">
          <table className="tbl min-w-max">
            <thead>
              <tr>
                <th className="sticky-col min-w-56">{t("product")}</th>
                {channels.map((c) => (
                  <th
                    key={c.id}
                    className={`max-w-28 text-right ${selectedChannelIds?.has(c.id) ? "col-hl" : ""}`}
                    title={c.name}
                  >
                    <span className="block truncate">{c.name}</span>
                  </th>
                ))}
                <th className="text-right font-semibold">{t("total")}</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="sticky-col">{p.nameRu}</td>
                  {channels.map((c) => (
                    <SaleCell
                      key={c.id}
                      value={qtyMap.get(`${p.id}|${c.id}`) ?? 0}
                      readOnly={readOnly}
                      highlighted={selectedChannelIds?.has(c.id) ?? false}
                      onCommit={(qty) => saveCell(p.id, c.id, qty)}
                    />
                  ))}
                  <td className="text-right font-semibold">
                    <Num v={cur.qtyByProduct[p.id] ?? 0} strong />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Collapsible>

      {showImport && <ImportDialog onClose={() => setShowImport(false)} />}
    </div>
  );
}

function SaleCell({
  value,
  readOnly,
  highlighted,
  onCommit,
}: {
  value: number;
  readOnly: boolean;
  highlighted: boolean;
  onCommit: (qty: number) => void;
}) {
  const [text, setText] = useState(value === 0 ? "" : fmtN(value));
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    setText(value === 0 ? "" : fmtN(value));
  }
  if (readOnly) {
    return (
      <td className={`text-right ${highlighted ? "col-hl" : ""}`}>
        <Num v={value === 0 ? null : value} />
      </td>
    );
  }
  return (
    <td className={`p-0 ${highlighted ? "col-hl" : ""}`}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = toNum(text);
          setText(v === 0 ? "" : fmtN(v));
          if (v !== value) onCommit(v);
        }}
        className="num h-full w-20 border-0 bg-transparent px-2 py-1.5 text-right text-[13px] outline-none focus:bg-accent-soft"
      />
    </td>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [preview, setPreview] = useState<{ matched: MatchedRow[]; rejected: RejectedRow[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  function parseText(text: string) {
    const res = Papa.parse<Record<string, string>>(text.trim(), {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
    });
    let parsed: ImportRow[] = [];
    if (res.meta.fields?.includes("month")) {
      parsed = res.data.map((r) => ({
        month: r["month"] ?? "",
        productName: r["productname"] ?? r["product"] ?? "",
        channelName: r["channelname"] ?? r["channel"] ?? "",
        qty: r["qty"] ?? "",
        productCode: r["productcode"] ?? undefined,
        channelCode: r["channelcode"] ?? undefined,
      }));
    } else {
      const plain = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true });
      parsed = plain.data.map((r) => ({
        month: r[0] ?? "",
        productName: r[1] ?? "",
        channelName: r[2] ?? "",
        qty: r[3] ?? "",
      }));
    }
    setRows(parsed);
    setPreview(null);
    setDone(false);
  }

  async function run(mode: "preview" | "commit") {
    setBusy(true);
    const res = await fetch("/api/import/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, rows }),
    });
    const body = await res.json();
    setBusy(false);
    setPreview(body);
    if (mode === "commit") {
      setDone(true);
      router.refresh();
    }
  }

  return (
    <Modal title={t("salesImportCsv")} onClose={onClose} wide>
      <p className="mb-2 text-[12px] text-muted">{t("salesImportHint")}</p>
      <textarea
        className="mb-2 h-32 w-full rounded-lg border border-border p-2 font-mono text-[12px] outline-none focus:border-accent"
        placeholder={"month;productName;channelName;qty\n2025-08;Humana Platin 1 MP 400 гр х 4 шт;Korzinka;120"}
        onChange={(e) => parseText(e.target.value)}
      />
      <div className="mb-3 flex items-center gap-2">
        <input
          type="file"
          accept=".csv,.txt"
          className="text-[12px]"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) f.text().then(parseText);
          }}
        />
        <span className="flex-1" />
        <Button variant="secondary" onClick={() => run("preview")} disabled={busy || rows.length === 0}>
          {t("salesImportPreview")} ({rows.length})
        </Button>
        <Button onClick={() => run("commit")} disabled={busy || !preview || preview.matched.length === 0 || done}>
          {t("salesImportCommit")}
        </Button>
      </div>

      {preview && (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[12px] font-medium">
              <Badge tone="ok">{t("salesImportMatched")}</Badge> {preview.matched.length}
              {done && <Badge tone="accent">✓ {t("saved")}</Badge>}
            </div>
            <div className="max-h-56 overflow-auto rounded-lg border border-border">
              <table className="tbl">
                <tbody>
                  {preview.matched.map((r, i) => (
                    <tr key={i}>
                      <td className="text-[12px]">{r.monthId}</td>
                      <td className="text-[12px]">{r.productName}</td>
                      <td className="text-[12px]">{r.channelName}</td>
                      <td className="text-right text-[12px]">{fmtN(r.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-2 text-[12px] font-medium">
              <Badge tone="warn">{t("salesImportRejected")}</Badge> {preview.rejected.length}
            </div>
            <div className="max-h-56 overflow-auto rounded-lg border border-border">
              <table className="tbl">
                <tbody>
                  {preview.rejected.map((r, i) => (
                    <tr key={i}>
                      <td className="text-[12px]">
                        {String(r.row.month)} / {String(r.row.productName)} / {String(r.row.channelName)}
                      </td>
                      <td className="text-[12px] text-warn">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <details className="mt-3 text-[12px] text-muted">
        <summary className="cursor-pointer font-medium">{t("salesApiDoc")}</summary>
        <pre className="mt-2 overflow-auto rounded-lg bg-background p-3 text-[11px]">
{`POST /api/import/1c
X-Api-Key: <ONEC_API_KEY>
Content-Type: application/json

{ "rows": [
  { "month": "2025-08",
    "productCode": "УТ-000123",
    "productName": "Humana Platin 1 MP 400 гр х 4 шт",
    "channelCode": "К-0001",
    "channelName": "Korzinka",
    "qty": 120 }
] }`}
        </pre>
      </details>
    </Modal>
  );
}
