"use client";

// Sales: one model behind four pages. A region, a group of channels or one
// channel (picked on the map or in the selector) is kept in the URL as ?sel=
// and filters every figure on every sales page; without it the figures cover
// the whole country.
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Papa from "papaparse";
import { Badge, Button, Modal } from "./ui";
import { Delta, MetricStrip, Section, ShareBar, Spark, Th, useSort, type Metric } from "./analysis";
import { ButtonLink } from "./statement";
import MonthBars from "./MonthBars";
import UzMap, { type RegionStat } from "./UzMap";
import { UZ_REGIONS } from "@/lib/uz-map";
import { fmtN, fmtPct, toNum } from "@/lib/format";
import { useT } from "@/lib/locale-context";
import { shortMonth } from "@/lib/statement-ui";
import type { ChannelIn, SaleIn } from "@/lib/engine/types";
import type { SalesProps } from "@/lib/sales-data";
import type { ImportRow, MatchedRow, RejectedRow } from "@/lib/import-sales";

export type SalesTab = "overview" | "products" | "channels" | "data";

type Selection =
  | { kind: "region"; iso: string }
  | { kind: "chains" }
  | { kind: "other" }
  | { kind: "channel"; id: string }
  | null;

// non-territory channels that are not supermarket chains: wholesale, internal,
// unclassified. Every other channel outside the map regions counts as a chain.
const OTHER_CHANNEL_NAMES = new Set(["Дилеры Бондюэль", "DARVOZA SAVDO", "ТИИН ОПТОМ", "Внутреннее", "Прочие"]);

function decodeSelection(v: string): Selection {
  if (v === "chains") return { kind: "chains" };
  if (v === "other") return { kind: "other" };
  const [kind, id] = v.split(":");
  if (kind === "region" && id) return { kind: "region", iso: id };
  if (kind === "channel" && id) return { kind: "channel", id };
  return null;
}

function encodeSelection(s: Selection): string {
  if (!s) return "";
  if (s.kind === "region") return `region:${s.iso}`;
  if (s.kind === "channel") return `channel:${s.id}`;
  return s.kind;
}

/** The selection lives in the URL; changing it does not reload the page. */
function useSelection(): [string, Selection, (s: Selection) => void] {
  const params = useSearchParams();
  const pathname = usePathname();
  const key = params.get("sel") ?? "";
  const selection = useMemo(() => decodeSelection(key), [key]);
  const set = (s: Selection) => {
    const p = new URLSearchParams(params.toString());
    const v = encodeSelection(s);
    if (v) p.set("sel", v);
    else p.delete("sel");
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  };
  return [key, selection, set];
}

interface UnitCosts {
  group: Record<string, number>;
  fargo: Record<string, number>;
}

export default function SalesView(props: SalesProps & { tab: SalesTab }) {
  const m = useSalesModel(props);
  if (props.tab === "overview") return <OverviewTab m={m} />;
  if (props.tab === "products") return <ProductsTab m={m} />;
  if (props.tab === "channels") return <ChannelsTab m={m} />;
  return <DataTab m={m} />;
}

type SalesModel = ReturnType<typeof useSalesModel>;

function useSalesModel({
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
  costs,
  priorCosts,
  vat,
  readOnly,
}: SalesProps) {
  const { l, locale } = useT();
  const [selKey, selection, setSelection] = useSelection();
  const cur = useMemo(
    () => current ?? { revenue: 0, totalQty: 0, revenueByChannel: {}, qtyByProduct: {} },
    [current]
  );
  const monthName = (id: string) => {
    const m = months.find((x) => x.id === id);
    return m ? (locale === "ru" ? m.nameRu : m.nameEn) : id;
  };
  const pcs = locale === "ru" ? "шт" : "pcs";

  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const channelByName = useMemo(() => new Map(channels.map((c) => [c.name, c])), [channels]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // ── channel groups: regions on the map, chains, other ──
  const regionChannelNames = useMemo(() => new Set(UZ_REGIONS.flatMap((r) => r.channels)), []);
  const chainChannelIds = useMemo(
    () => channels.filter((c) => !regionChannelNames.has(c.name) && !OTHER_CHANNEL_NAMES.has(c.name)).map((c) => c.id),
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
    return new Set(region.channels.map((n) => channelByName.get(n)?.id).filter((x): x is string => !!x));
  }, [selection, channelByName, chainChannelIds, otherChannelIds]);

  const chainsLabel = l({ ru: "Сети (супермаркеты)", en: "Chains (supermarkets)" });
  const otherLabel = l({ ru: "Прочие продажи", en: "Other sales" });
  const allLabel = l({ ru: "Весь Узбекистан", en: "All Uzbekistan" });
  const selectionLabel = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === "chains") return chainsLabel;
    if (selection.kind === "other") return otherLabel;
    if (selection.kind === "channel") return channelById.get(selection.id)?.name ?? null;
    const r = UZ_REGIONS.find((x) => x.iso === selection.iso);
    return r ? (locale === "ru" ? r.nameRu : r.nameEn) : null;
  }, [selection, channelById, locale, chainsLabel, otherLabel]);
  const scopeLabel = selectionLabel ?? allLabel;

  // ── figures for the selection ──
  // sales at the selling price (VAT included); revenue without VAT the way the
  // statements count it: bank sales carry 12/112 of the price, cash sales are
  // declared at Fargo's cost × (1 + mark-up) with VAT on top
  const aggregate = useMemo(
    () => (rows: SaleIn[], filter: Set<string> | null, unit: UnitCosts) => {
      let revenue = 0;
      let qty = 0;
      let revenueEx = 0;
      let cost = 0;
      const byProduct = new Map<string, { qty: number; revenue: number; revenueEx: number; cost: number }>();
      const byChannel = new Map<string, { qty: number; revenue: number }>();
      for (const s of rows) {
        if (filter && !filter.has(s.channelId)) continue;
        const r = s.amount ?? s.qty * (productById.get(s.productId)?.price ?? 0);
        const cashShare = channelById.get(s.channelId)?.cashPct ?? 0;
        const bankVat = (r * (1 - cashShare) * vat.rate) / (1 + vat.rate);
        const cashVat = s.qty * cashShare * (unit.fargo[s.productId] ?? 0) * (1 + vat.deemedMargin) * vat.rate;
        const ex = r - bankVat - cashVat;
        const c0 = s.qty * (unit.group[s.productId] ?? 0);
        revenue += r;
        qty += s.qty;
        revenueEx += ex;
        cost += c0;
        const p = byProduct.get(s.productId) ?? { qty: 0, revenue: 0, revenueEx: 0, cost: 0 };
        p.qty += s.qty;
        p.revenue += r;
        p.revenueEx += ex;
        p.cost += c0;
        byProduct.set(s.productId, p);
        const c = byChannel.get(s.channelId) ?? { qty: 0, revenue: 0 };
        c.qty += s.qty;
        c.revenue += r;
        byChannel.set(s.channelId, c);
      }
      return { revenue, qty, revenueEx, cost, byProduct, byChannel };
    },
    [productById, channelById, vat]
  );

  const sel = useMemo(() => aggregate(sales, selectedChannelIds, costs), [aggregate, sales, selectedChannelIds, costs]);
  const selPrior = useMemo(
    () => aggregate(priorSales, selectedChannelIds, priorCosts),
    [aggregate, priorSales, selectedChannelIds, priorCosts]
  );
  const selGp = sel.revenueEx - sel.cost;
  const selPriorGp = selPrior.revenueEx - selPrior.cost;
  const avgPrice = sel.qty !== 0 ? sel.revenue / sel.qty : 0;
  const priorAvgPrice = selPrior.qty !== 0 ? selPrior.revenue / selPrior.qty : 0;

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

  // ── selector options ──
  const options = useMemo(() => {
    const regions = UZ_REGIONS.filter((r) => r.channels.some((n) => channelByName.has(n)))
      .map((r) => ({ value: `region:${r.iso}`, label: locale === "ru" ? r.nameRu : r.nameEn }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));
    const active = new Set([...sales, ...priorSales].map((s) => s.channelId));
    const chans = channels
      .filter((c) => active.has(c.id))
      .map((c) => ({ value: `channel:${c.id}`, label: c.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));
    return { regions, chans };
  }, [channelByName, channels, sales, priorSales, locale]);

  return {
    l,
    locale,
    months,
    products,
    channels,
    monthId,
    sales,
    clientSales,
    prior,
    trend,
    readOnly,
    cur,
    monthName,
    pcs,
    channelById,
    channelByName,
    productById,
    chainChannelIds,
    otherChannelIds,
    selKey,
    selection,
    setSelection,
    selectedChannelIds,
    chainsLabel,
    otherLabel,
    allLabel,
    scopeLabel,
    sel,
    selPrior,
    selGp,
    selPriorGp,
    avgPrice,
    priorAvgPrice,
    selSeries,
    options,
  };
}
/** Region, channel group or channel: the scope of every figure on the sales pages. */
function Selector({ m }: { m: SalesModel }) {
  const { l } = m;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <select
        value={m.selKey}
        onChange={(e) => m.setSelection(decodeSelection(e.target.value))}
        className="h-8 min-w-56 rounded-md border border-border bg-surface px-2 text-[13px] outline-none focus:border-accent"
        aria-label={l({ ru: "Регион или канал", en: "Region or channel" })}
      >
        <option value="">{m.allLabel}</option>
        <optgroup label={l({ ru: "Регионы", en: "Regions" })}>
          {m.options.regions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
        <optgroup label={l({ ru: "Группы каналов", en: "Channel groups" })}>
          <option value="chains">{m.chainsLabel}</option>
          <option value="other">{m.otherLabel}</option>
        </optgroup>
        <optgroup label={l({ ru: "Каналы", en: "Channels" })}>
          {m.options.chans.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
      </select>
      {m.selection && (
        <button onClick={() => m.setSelection(null)} className="text-[12.5px] text-accent hover:underline">
          {l({ ru: "Показать весь Узбекистан", en: "Show all Uzbekistan" })}
        </button>
      )}
    </div>
  );
}

// ───────────────────────── overview ─────────────────────────

function OverviewTab({ m }: { m: SalesModel }) {
  const { l, locale, sel, selPrior, prior, cur } = m;
  const promoRevenue = [...sel.byProduct].reduce(
    (s, [pid, x]) => s + (m.productById.get(pid)?.isPromo ? x.revenue : 0),
    0
  );
  const metrics: Metric[] = [
    {
      label: l({ ru: "Продажи с НДС", en: "Sales incl. VAT" }),
      value: fmtN(sel.revenue),
      delta: prior ? { current: sel.revenue, previous: selPrior.revenue } : undefined,
    },
    {
      label: l({ ru: "Продано, шт", en: "Units sold" }),
      value: fmtN(sel.qty),
      delta: prior ? { current: sel.qty, previous: selPrior.qty } : undefined,
    },
    {
      label: l({ ru: "Средняя цена за шт", en: "Average price per unit" }),
      value: fmtN(m.avgPrice),
      delta: prior ? { current: m.avgPrice, previous: m.priorAvgPrice } : undefined,
    },
    {
      label: l({ ru: "Валовая прибыль от продаж", en: "Gross profit on sales" }),
      value: fmtN(m.selGp),
      delta: prior ? { current: m.selGp, previous: m.selPriorGp } : undefined,
      hint: `${l({ ru: "маржа", en: "margin" })} ${fmtPct(sel.revenueEx !== 0 ? m.selGp / sel.revenueEx : 0)}`,
      negative: m.selGp < 0,
    },
    m.selection
      ? {
          label: l({ ru: "Доля в продажах", en: "Share of sales" }),
          value: fmtPct(cur.revenue !== 0 ? sel.revenue / cur.revenue : 0),
          hint: `${l({ ru: "из", en: "of" })} ${fmtN(cur.revenue)}`,
        }
      : {
          label: l({ ru: "Доля акционного товара", en: "Promo share" }),
          value: fmtPct(sel.revenue !== 0 ? promoRevenue / sel.revenue : 0),
          hint: fmtN(promoRevenue),
        },
  ];
  return (
    <div>
      <Selector m={m} />
      <MetricStrip metrics={metrics} />
      <Section
        title={l({ ru: "География продаж", en: "Sales geography" })}
        note={l({ ru: "регион или точку на карте можно выбрать", en: "click a region or a point to select it" })}
      >
        <MapAndDetail m={m} />
      </Section>
      <Section title={l({ ru: "Продажи по месяцам", en: "Sales by month" })} note={m.scopeLabel}>
        <div className="px-4 pb-3 pt-4">
          <MonthBars
            width={1100}
            height={190}
            label={l({ ru: "Продажи по месяцам", en: "Sales by month" })}
            points={m.selSeries.map((p) => ({
              key: p.monthId,
              short: shortMonth(p.monthId, locale),
              long: m.monthName(p.monthId),
              value: p.value,
              focus: p.monthId === m.monthId,
            }))}
          />
        </div>
      </Section>
    </div>
  );
}

function MapAndDetail({ m }: { m: SalesModel }) {
  const { l, sel, selPrior, cur, selection, pcs } = m;
  const [expandedClient, setExpandedClient] = useState<string | null>(null);

  // map colours always show the whole month, so the map stays stable
  const qtyByChannel = new Map<string, number>();
  for (const s of m.sales) qtyByChannel.set(s.channelId, (qtyByChannel.get(s.channelId) ?? 0) + s.qty);
  const statsByIso: Record<string, RegionStat> = {};
  for (const r of UZ_REGIONS) {
    let revenue = 0;
    let qty = 0;
    for (const name of r.channels) {
      const ch = m.channelByName.get(name);
      if (!ch) continue;
      revenue += cur.revenueByChannel[ch.id] ?? 0;
      qty += qtyByChannel.get(ch.id) ?? 0;
    }
    statsByIso[r.iso] = { revenue, qty, share: cur.revenue !== 0 ? revenue / cur.revenue : 0 };
  }
  const groupStat = (ids: string[]) => {
    const revenue = ids.reduce((a, id) => a + (cur.revenueByChannel[id] ?? 0), 0);
    return { revenue, share: cur.revenue !== 0 ? revenue / cur.revenue : 0 };
  };

  const skuRows = m.products
    .map((p) => ({ product: p, qty: sel.byProduct.get(p.id)?.qty ?? 0, revenue: sel.byProduct.get(p.id)?.revenue ?? 0 }))
    .filter((r) => r.qty !== 0 || r.revenue !== 0)
    .sort((a, b) => b.revenue - a.revenue);
  const maxSku = Math.max(1, ...skuRows.map((r) => Math.abs(r.revenue)));

  const memberRows =
    selection?.kind === "channel"
      ? []
      : [...sel.byChannel.entries()]
          .map(([id, v]) => ({ channel: m.channelById.get(id), ...v }))
          .filter((r): r is { channel: ChannelIn; qty: number; revenue: number } => !!r.channel && r.revenue !== 0)
          .sort((a, b) => b.revenue - a.revenue);
  const members = memberRows.length > 1 ? memberRows : [];
  const maxMember = Math.max(1, ...members.map((r) => Math.abs(r.revenue)));

  // per-client detail from the 1C sync, valued at list prices
  const byClient = new Map<string, { id: string; name: string; qty: number; revenue: number; byProduct: Map<string, number> }>();
  for (const cs of m.clientSales) {
    if (m.selectedChannelIds && !m.selectedChannelIds.has(cs.channelId)) continue;
    const row = byClient.get(cs.clientMapId) ?? {
      id: cs.clientMapId,
      name: cs.name,
      qty: 0,
      revenue: 0,
      byProduct: new Map<string, number>(),
    };
    row.qty += cs.qty;
    row.revenue += cs.qty * (m.productById.get(cs.productId)?.price ?? 0);
    row.byProduct.set(cs.productId, (row.byProduct.get(cs.productId) ?? 0) + cs.qty);
    byClient.set(cs.clientMapId, row);
  }
  const clients = [...byClient.values()].filter((r) => r.qty !== 0 || r.revenue !== 0).sort((a, b) => b.revenue - a.revenue);
  const clientTotal = clients.reduce((s, r) => s + r.revenue, 0);
  const maxClient = Math.max(1, ...clients.map((r) => Math.abs(r.revenue)));

  const subhead = "mb-1.5 mt-5 text-[12px] font-semibold text-muted";
  const row = "flex items-center gap-2 border-b border-border py-1.5 last:border-b-0";

  return (
    <div className="grid lg:grid-cols-[3fr_2fr] lg:divide-x lg:divide-border">
      <div className="relative min-w-0 p-4">
        <UzMap
          statsByIso={statsByIso}
          selectedIso={selection?.kind === "region" ? selection.iso : null}
          onSelect={(iso) => m.setSelection(iso ? { kind: "region", iso } : null)}
        />
        <div className="absolute right-4 top-4 flex flex-col items-end gap-2">
          <MapPoint
            label={m.chainsLabel}
            stat={groupStat(m.chainChannelIds)}
            selected={selection?.kind === "chains"}
            onClick={() => m.setSelection(selection?.kind === "chains" ? null : { kind: "chains" })}
          />
          <MapPoint
            label={m.otherLabel}
            stat={groupStat(m.otherChannelIds)}
            selected={selection?.kind === "other"}
            onClick={() => m.setSelection(selection?.kind === "other" ? null : { kind: "other" })}
          />
        </div>
      </div>

      <div className="min-w-0 p-4">
        <h3 className="truncate text-[15px] font-semibold">{m.scopeLabel}</h3>
        <div className="mb-1 mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="figure-num text-[20px] font-semibold tracking-[-0.02em]">{fmtN(sel.revenue)}</span>
          {m.prior && (
            <span className="text-[12.5px]">
              <Delta current={sel.revenue} previous={selPrior.revenue} />
            </span>
          )}
          <span className="text-[12.5px] text-muted">
            {fmtN(sel.qty)} {pcs}
          </span>
          {selection && (
            <span className="text-[12.5px] text-muted">
              {fmtPct(cur.revenue !== 0 ? sel.revenue / cur.revenue : 0)} {l({ ru: "всех продаж", en: "of all sales" })}
            </span>
          )}
        </div>

        <div className={subhead}>{l({ ru: "Товары", en: "Products" })}</div>
        <div className="max-h-64 overflow-auto pr-1">
          {skuRows.length === 0 ? (
            <div className="py-6 text-center text-[12px] text-muted">{l({ ru: "Продаж нет", en: "No sales" })}</div>
          ) : (
            skuRows.map((r) => (
              <div key={r.product.id} className={row}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px]" title={r.product.nameRu}>
                      {r.product.nameRu}
                    </span>
                  </div>
                  <div className="num text-[11.5px] text-muted">
                    {fmtN(r.qty)} {pcs} · {fmtPct(sel.revenue !== 0 ? r.revenue / sel.revenue : 0)}
                  </div>
                </div>
                <div className="w-16 shrink-0">
                  <ShareBar value={Math.abs(r.revenue)} max={maxSku} />
                </div>
                <span className="num w-28 shrink-0 text-right text-[12.5px]">{fmtN(r.revenue)}</span>
              </div>
            ))
          )}
        </div>

        {members.length > 0 && (
          <>
            <div className={subhead}>{l({ ru: "Каналы", en: "Channels" })}</div>
            <div className="max-h-48 overflow-auto pr-1">
              {members.map((r) => (
                <button
                  key={r.channel.id}
                  onClick={() => m.setSelection({ kind: "channel", id: r.channel.id })}
                  className={`${row} w-full text-left transition-colors hover:text-accent`}
                >
                  <span className="min-w-0 flex-1 truncate text-[12.5px]" title={r.channel.name}>
                    {r.channel.name}
                  </span>
                  <span className="num shrink-0 text-[11.5px] text-muted">
                    {fmtPct(sel.revenue !== 0 ? r.revenue / sel.revenue : 0)}
                  </span>
                  <div className="w-16 shrink-0">
                    <ShareBar value={Math.abs(r.revenue)} max={maxMember} />
                  </div>
                  <span className="num w-28 shrink-0 text-right text-[12.5px]">{fmtN(r.revenue)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className={subhead}>
          {l({ ru: "Клиенты", en: "Clients" })}
          {clients.length > 0 && <span className="ml-1.5 font-normal">{clients.length}</span>}
        </div>
        {clients.length === 0 ? (
          <p className="py-1 text-[12px] leading-relaxed text-muted">
            {l({
              ru: "Детализация по клиентам появляется после синхронизации месяца с 1С (Продажи → Данные).",
              en: "The client breakdown appears once the month is synced from 1C (Sales → Data).",
            })}
          </p>
        ) : (
          <div className="max-h-72 overflow-auto pr-1">
            {clients.map((r) => (
              <div key={r.id} className="border-b border-border last:border-b-0">
                <button
                  onClick={() => setExpandedClient(expandedClient === r.id ? null : r.id)}
                  title={l({ ru: "Показать товары", en: "Show products" })}
                  className={`flex w-full items-center gap-2 py-1.5 text-left transition-colors hover:text-accent ${
                    expandedClient === r.id ? "text-accent" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-[12.5px]" title={r.name}>
                    {r.name}
                  </span>
                  <span className="num shrink-0 text-[11.5px] text-muted">
                    {fmtPct(clientTotal !== 0 ? r.revenue / clientTotal : 0)}
                  </span>
                  <div className="w-16 shrink-0">
                    <ShareBar value={Math.abs(r.revenue)} max={maxClient} />
                  </div>
                  <span className="num w-28 shrink-0 text-right text-[12.5px]">{fmtN(r.revenue)}</span>
                </button>
                {expandedClient === r.id && (
                  <div className="mb-1.5 rounded-md bg-surface-low px-3 py-1.5">
                    {[...r.byProduct.entries()]
                      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                      .map(([pid, qty]) => (
                        <div key={pid} className="flex items-baseline justify-between gap-3 py-0.5 text-[12px]">
                          <span className="min-w-0 truncate text-muted">{m.productById.get(pid)?.nameRu ?? pid}</span>
                          <span className="num shrink-0">
                            {fmtN(qty)} {pcs}
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
  );
}

// ───────────────────────── products ─────────────────────────

function ProductsTab({ m }: { m: SalesModel }) {
  const { l, sel, selPrior, prior } = m;
  const rows = m.products
    .map((p) => {
      const x = sel.byProduct.get(p.id);
      const qty = x?.qty ?? 0;
      const revenueEx = x?.revenueEx ?? 0;
      const cost = x?.cost ?? 0;
      return {
        product: p,
        qty,
        revenue: x?.revenue ?? 0,
        priorRevenue: selPrior.byProduct.get(p.id)?.revenue ?? 0,
        revenueEx,
        cost,
        gp: revenueEx - cost,
        gpPct: revenueEx !== 0 ? (revenueEx - cost) / revenueEx : 0,
        gpUnit: qty !== 0 ? (revenueEx - cost) / qty : 0,
      };
    })
    .filter((r) => r.qty !== 0 || r.revenue !== 0);
  const { sorted, sort, onSort } = useSort(rows, "gp", {
    name: (r) => r.product.nameRu,
    qty: (r) => r.qty,
    revenue: (r) => r.revenue,
    revenueEx: (r) => r.revenueEx,
    cost: (r) => r.cost,
    gp: (r) => r.gp,
    gpPct: (r) => r.gpPct,
    gpUnit: (r) => r.gpUnit,
  });
  const s = { sort, onSort };
  return (
    <div>
      <Selector m={m} />
      <Section
        title={l({ ru: "Экономика товаров", en: "Product economics" })}
        note={`${m.scopeLabel} · ${m.monthName(m.monthId)}`}
      >
        <div className="overflow-x-auto">
          <table className="stmt is-compact">
            <thead>
              <tr>
                <Th sortKey="name" {...s}>
                  {l({ ru: "Товар", en: "Product" })}
                </Th>
                <Th sortKey="qty" numeric {...s}>
                  {l({ ru: "Продано, шт", en: "Units" })}
                </Th>
                <Th sortKey="revenue" numeric {...s}>
                  {l({ ru: "Продажи с НДС", en: "Sales incl. VAT" })}
                </Th>
                <Th numeric>{l({ ru: "К прошлому месяцу", en: "Vs last month" })}</Th>
                <Th sortKey="revenueEx" numeric {...s}>
                  {l({ ru: "Выручка без НДС", en: "Revenue ex-VAT" })}
                </Th>
                <Th sortKey="cost" numeric {...s}>
                  {l({ ru: "Себестоимость FIFO", en: "FIFO cost" })}
                </Th>
                <Th sortKey="gp" numeric {...s}>
                  {l({ ru: "Валовая прибыль", en: "Gross profit" })}
                </Th>
                <Th sortKey="gpPct" numeric {...s}>
                  {l({ ru: "Маржа", en: "Margin" })}
                </Th>
                <Th sortKey="gpUnit" numeric {...s}>
                  {l({ ru: "Прибыль за шт", en: "Profit per unit" })}
                </Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.product.id}>
                  <td>{r.product.nameRu}</td>
                  <td>{fmtN(r.qty)}</td>
                  <td>{fmtN(r.revenue)}</td>
                  <td>{prior ? <Delta current={r.revenue} previous={r.priorRevenue} /> : "—"}</td>
                  <td>{fmtN(r.revenueEx)}</td>
                  <td>{fmtN(-r.cost)}</td>
                  <td className={r.gp < 0 ? "text-danger" : ""}>{fmtN(r.gp)}</td>
                  <td>{fmtPct(r.gpPct)}</td>
                  <td>{fmtN(r.gpUnit)}</td>
                </tr>
              ))}
              <tr className="is-subtotal">
                <td>{l({ ru: "Итого", en: "Total" })}</td>
                <td>{fmtN(sel.qty)}</td>
                <td>{fmtN(sel.revenue)}</td>
                <td>{prior ? <Delta current={sel.revenue} previous={selPrior.revenue} /> : "—"}</td>
                <td>{fmtN(sel.revenueEx)}</td>
                <td>{fmtN(-sel.cost)}</td>
                <td className={m.selGp < 0 ? "text-danger" : ""}>{fmtN(m.selGp)}</td>
                <td>{fmtPct(sel.revenueEx !== 0 ? m.selGp / sel.revenueEx : 0)}</td>
                <td>{fmtN(sel.qty !== 0 ? m.selGp / sel.qty : 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
      <p className="max-w-3xl text-[12px] leading-relaxed text-muted">
        {l({
          ru: "Выручка без НДС считается так же, как в отчётности: в банковских продажах НДС входит в цену, наличные продажи декларируются по себестоимости Fargo с наценкой. Себестоимость — FIFO по стоимости TI.",
          en: "Revenue ex-VAT is counted as in the statements: VAT is inside the price of bank sales, cash sales are declared at Fargo's cost plus the mark-up. Cost is FIFO at TI cost.",
        })}
      </p>
    </div>
  );
}

// ───────────────────────── channels ─────────────────────────

function ChannelsTab({ m }: { m: SalesModel }) {
  const { l, cur, prior } = m;
  const rows = m.channels
    .filter((c) => !m.selectedChannelIds || m.selectedChannelIds.has(c.id))
    .map((c) => {
      const now = cur.revenueByChannel[c.id] ?? 0;
      const was = prior?.revenueByChannel[c.id] ?? 0;
      return {
        channel: c,
        now,
        was,
        diff: now - was,
        share: cur.revenue !== 0 ? now / cur.revenue : 0,
        series: m.trend.map((p) => p.byChannel[c.id] ?? 0),
      };
    })
    .filter((r) => r.now !== 0 || r.was !== 0);
  const { sorted, sort, onSort } = useSort(rows, "now", {
    name: (r) => r.channel.name,
    now: (r) => r.now,
    was: (r) => r.was,
    diff: (r) => r.diff,
    share: (r) => r.share,
  });
  const s = { sort, onSort };
  const total = rows.reduce((t, r) => ({ now: t.now + r.now, was: t.was + r.was }), { now: 0, was: 0 });
  const priorId = m.months[m.months.findIndex((x) => x.id === m.monthId) - 1]?.id;
  return (
    <div>
      <Selector m={m} />
      <Section
        title={l({ ru: "Продажи по каналам", en: "Sales by channel" })}
        note={`${m.scopeLabel} · ${l({ ru: "с НДС", en: "incl. VAT" })}`}
      >
        <div className="overflow-x-auto">
          <table className="stmt">
            <thead>
              <tr>
                <Th sortKey="name" {...s}>
                  {l({ ru: "Канал", en: "Channel" })}
                </Th>
                <Th sortKey="now" numeric {...s}>
                  {m.monthName(m.monthId)}
                </Th>
                <Th sortKey="share" numeric {...s}>
                  {l({ ru: "Доля", en: "Share" })}
                </Th>
                <Th sortKey="was" numeric {...s}>
                  {priorId ? m.monthName(priorId) : l({ ru: "Прошлый месяц", en: "Last month" })}
                </Th>
                <Th sortKey="diff" numeric {...s}>
                  {l({ ru: "Изменение", en: "Change" })}
                </Th>
                <Th numeric>%</Th>
                <Th numeric>{l({ ru: "По месяцам", en: "By month" })}</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.channel.id}>
                  <td>
                    <Link href={`/sales?sel=channel:${r.channel.id}`} className="hover:text-accent hover:underline">
                      {r.channel.name}
                    </Link>
                  </td>
                  <td>{fmtN(r.now)}</td>
                  <td>{fmtPct(r.share)}</td>
                  <td>{fmtN(r.was)}</td>
                  <td className={r.diff < 0 ? "text-danger" : ""}>{fmtN(r.diff)}</td>
                  <td>
                    <Delta current={r.now} previous={r.was} />
                  </td>
                  <td>
                    <Spark values={r.series} tone="muted" />
                  </td>
                </tr>
              ))}
              <tr className="is-subtotal">
                <td>{l({ ru: "Итого", en: "Total" })}</td>
                <td>{fmtN(total.now)}</td>
                <td>{fmtPct(cur.revenue !== 0 ? total.now / cur.revenue : 0)}</td>
                <td>{fmtN(total.was)}</td>
                <td className={total.now - total.was < 0 ? "text-danger" : ""}>{fmtN(total.now - total.was)}</td>
                <td>
                  <Delta current={total.now} previous={total.was} />
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

// ───────────────────────── data ─────────────────────────

function DataTab({ m }: { m: SalesModel }) {
  const { l, locale } = m;
  const router = useRouter();
  const [showImport, setShowImport] = useState(false);
  const qtyMap = new Map<string, number>();
  for (const s of m.sales) qtyMap.set(`${s.productId}|${s.channelId}`, s.qty);

  async function saveCell(productId: string, channelId: string, qty: number) {
    await fetch("/api/sales/cell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthId: m.monthId, productId, channelId, qty }),
    });
    router.refresh();
  }

  return (
    <div>
      <Section
        title={`${l({ ru: "Количество за", en: "Units for" })} ${m.monthName(m.monthId)}`}
        note={l({ ru: "товары по каналам, штук", en: "products by channel, units" })}
        right={
          <>
            {!m.readOnly && (
              <Button variant="secondary" onClick={() => setShowImport(true)}>
                {l({ ru: "Загрузить CSV", en: "Upload CSV" })}
              </Button>
            )}
            <ButtonLink href={`/api/export/sales?month=${m.monthId}&locale=${locale}`}>
              {l({ ru: "Excel за месяц", en: "Excel for the month" })}
            </ButtonLink>
            <ButtonLink href={`/api/export/sales?month=all&locale=${locale}`}>
              {l({ ru: "Excel за все месяцы", en: "Excel for all months" })}
            </ButtonLink>
          </>
        }
      >
        <div className="max-h-[70vh] overflow-auto">
          <table className="tbl min-w-max">
            <thead>
              <tr>
                <th className="sticky-col min-w-56">{l({ ru: "Товар", en: "Product" })}</th>
                {m.channels.map((c) => (
                  <th key={c.id} className="max-w-28 text-right" title={c.name}>
                    <span className="block truncate">{c.name}</span>
                  </th>
                ))}
                <th className="text-right">{l({ ru: "Итого", en: "Total" })}</th>
              </tr>
            </thead>
            <tbody>
              {m.products.map((p) => (
                <tr key={p.id}>
                  <td className="sticky-col">{p.nameRu}</td>
                  {m.channels.map((c) => (
                    <SaleCell
                      key={c.id}
                      value={qtyMap.get(`${p.id}|${c.id}`) ?? 0}
                      readOnly={m.readOnly}
                      onCommit={(qty) => saveCell(p.id, c.id, qty)}
                    />
                  ))}
                  <td className="num text-right font-semibold">{fmtN(m.cur.qtyByProduct[p.id] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      {showImport && <ImportDialog onClose={() => setShowImport(false)} />}
    </div>
  );
}

/** A point on the map for channels that have no territory. */
function MapPoint({
  label,
  stat,
  selected,
  onClick,
}: {
  label: string;
  stat: { revenue: number; share: number };
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-lg border bg-surface px-3 py-2 text-left transition-colors ${
        selected ? "border-accent" : "border-border hover:border-accent"
      }`}
    >
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${selected ? "bg-accent" : "bg-accent/60"}`} />
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-medium leading-tight">{label}</span>
        <span className="num block text-[11.5px] text-muted">
          {fmtN(stat.revenue)} · {fmtPct(stat.share)}
        </span>
      </span>
    </button>
  );
}

function SaleCell({
  value,
  readOnly,
  onCommit,
}: {
  value: number;
  readOnly: boolean;
  onCommit: (qty: number) => void;
}) {
  const [text, setText] = useState(value === 0 ? "" : fmtN(value));
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    setText(value === 0 ? "" : fmtN(value));
  }
  if (readOnly) {
    return <td className="num text-right">{value === 0 ? "" : fmtN(value)}</td>;
  }
  return (
    <td className="p-0">
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
        className="mb-2 h-32 w-full rounded-lg border border-border p-2 text-[12px] outline-none focus:border-accent"
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
              {done && <Badge tone="accent">{t("saved")}</Badge>}
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
