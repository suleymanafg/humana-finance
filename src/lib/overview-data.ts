// What the overview shows for one month: the pulse figures, twelve months of
// sales and stock cover for the chart, the products that moved, and supply.
import { prisma } from "./db";
import { pageContext } from "./page-context";
import { costProductIdOf } from "./engine/compute";
import { shortMonth } from "./statement-ui";
import { DEFAULT_SETTINGS, monthKeyOf, nextOrderSlot } from "./planning/compute";

/** Series a split shows in colour; the rest fold into «Прочие». */
const SERIES = 5;
export const OTHER = "other";

/** «Humana Platin 1 MP 400 гр х 4 шт» → «Platin 1 400». */
export function shortProductName(name: string): string {
  return name
    .replace(/^\(АКЦИЯ\)\s*/, "")
    .replace(/^Humana\s+/i, "")
    .replace(/\s+(MP|FS|DS|BIB)(?=\s)/, "")
    .replace(/\s*гр.*$/, "")
    .trim();
}

export interface OverviewSeries {
  key: string;
  name: string;
}

export type Split = Record<string, number>;

export interface OverviewMonth {
  monthId: string;
  short: string;
  long: string;
  /** the calendar month still running: its figures are so far */
  partial: boolean;
  sales: number;
  units: number;
  /** months of stock at month-end at the average of the last three months' sales */
  cover: number | null;
  stockUnits: number;
  avgUnits: number;
  by: { sales: { channel: Split; product: Split }; units: { channel: Split; product: Split } };
}

const add = (rec: Split, key: string, v: number) => {
  rec[key] = (rec[key] ?? 0) + v;
};

export async function overviewData(monthParam: string | undefined) {
  const ctx = await pageContext(monthParam);
  const { dataset, computed, monthId } = ctx;
  const ids = computed.monthIds;
  const i = ids.indexOf(monthId);
  const window = ids.slice(Math.max(0, i - 11), i + 1);
  const fargoOf = (m: string) => computed.fargo[ids.indexOf(m)];
  const regular = (pid: string) => costProductIdOf(pid, dataset);
  const monthRow = (m: string) => dataset.months.find((x) => x.id === m);
  const monthName = (m: string) => {
    const row = monthRow(m);
    return row ? ctx.l({ ru: row.nameRu, en: row.nameEn }) : m;
  };

  // today in Tashkent: the month still running shows its figures so far
  const tashkentNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tashkent" }));
  const thisMonth = monthKeyOf(tashkentNow);
  const isPartial = (m: string) => m === thisMonth && !monthRow(m)?.closedAt;

  // sales per month, by channel and by product (promo folded into its regular SKU);
  // only the rows the engine counts — a known product and channel
  const productIds = new Set(dataset.products.map((p) => p.id));
  const channelIds = new Set(dataset.channels.map((c) => c.id));
  const unitsByChannel = new Map<string, Split>();
  for (const s of dataset.sales) {
    if (!productIds.has(s.productId) || !channelIds.has(s.channelId)) continue;
    const rec = unitsByChannel.get(s.monthId) ?? {};
    add(rec, s.channelId, s.qty);
    unitsByChannel.set(s.monthId, rec);
  }
  const byProduct = (src: Split) => {
    const out: Split = {};
    for (const [pid, v] of Object.entries(src)) add(out, regular(pid), v);
    return out;
  };
  const raw = (m: string) => {
    const f = fargoOf(m);
    return {
      salesChannel: { ...(f?.salesByChannel ?? {}) },
      salesProduct: byProduct(f?.salesByProduct ?? {}),
      unitsChannel: { ...(unitsByChannel.get(m) ?? {}) },
      unitsProduct: byProduct(f?.qtyByProduct ?? {}),
    };
  };

  // stock cover: units on hand at month-end over the average of the last three
  // months with sales; a month still running is left out of the average
  const stockUnits = (m: string, pid?: string) =>
    Object.values(computed.fifo)
      .filter((p) => !pid || p.productId === pid)
      .reduce((t, p) => t + (p.months[m]?.fargoStockUnits ?? 0) + (p.months[m]?.tiStockUnits ?? 0), 0);
  const unitsSold = (m: string, pid?: string) => {
    const f = fargoOf(m);
    if (!f) return 0;
    return pid ? (byProduct(f.qtyByProduct)[pid] ?? 0) : f.units;
  };
  const avgUnits = (m: string, pid?: string) => {
    const k = ids.indexOf(m);
    const end = isPartial(m) ? k : k + 1;
    const recent = ids
      .slice(Math.max(0, end - 3), end)
      .map((x) => unitsSold(x, pid))
      .filter((v) => v > 0);
    return recent.length === 0 ? 0 : recent.reduce((s, v) => s + v, 0) / recent.length;
  };
  const coverOf = (m: string, pid?: string) => {
    const avg = avgUnits(m, pid);
    return avg > 0 ? stockUnits(m, pid) / avg : null;
  };

  // the colours follow the channels and products that lead the whole window
  const rank = (pick: (r: ReturnType<typeof raw>) => Split) => {
    const totals: Split = {};
    for (const m of window) for (const [k, v] of Object.entries(pick(raw(m)))) add(totals, k, v);
    return Object.entries(totals)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
  };
  const channelRank = rank((r) => r.salesChannel);
  const productRank = rank((r) => r.unitsProduct);
  const channelName = (id: string) => dataset.channels.find((c) => c.id === id)?.name ?? id;
  const productName = (id: string) => shortProductName(dataset.products.find((p) => p.id === id)?.nameRu ?? id);
  const seriesOf = (ranked: string[], name: (id: string) => string): OverviewSeries[] =>
    ranked.length <= SERIES
      ? ranked.map((key) => ({ key, name: name(key) }))
      : [
          ...ranked.slice(0, SERIES).map((key) => ({ key, name: name(key) })),
          { key: OTHER, name: ctx.l({ ru: "Прочие", en: "Other" }) },
        ];
  const channelSeries = seriesOf(channelRank, channelName);
  const productSeries = seriesOf(productRank, productName);
  const fold = (rec: Split, series: OverviewSeries[]) => {
    const keys = new Set(series.map((s) => s.key));
    const out: Split = {};
    for (const [k, v] of Object.entries(rec)) add(out, keys.has(k) ? k : OTHER, v);
    return out;
  };

  const months: OverviewMonth[] = window.map((m) => {
    const r = raw(m);
    const f = fargoOf(m);
    return {
      monthId: m,
      short: shortMonth(m, ctx.locale),
      long: monthName(m),
      partial: isPartial(m),
      sales: f?.salesAtPrice ?? 0,
      units: f?.units ?? 0,
      cover: coverOf(m),
      stockUnits: stockUnits(m),
      avgUnits: avgUnits(m),
      by: {
        sales: { channel: fold(r.salesChannel, channelSeries), product: fold(r.salesProduct, productSeries) },
        units: { channel: fold(r.unitsChannel, channelSeries), product: fold(r.unitsProduct, productSeries) },
      },
    };
  });

  const at = (k: number) => (k >= 0 ? ids[k] : undefined);
  const prevId = at(i - 1);
  const yearAgoId = at(i - 12);
  const now = raw(monthId);
  const salesNow = fargoOf(monthId)?.salesAtPrice ?? 0;
  const value = (m: string | undefined, pick: (f: NonNullable<ReturnType<typeof fargoOf>>) => number) => {
    const f = m ? fargoOf(m) : undefined;
    return f && f.units > 0 ? pick(f) : null;
  };

  // planning settings: the cover rule and the IBP order deadline
  const settings = await prisma.setting.findMany({
    where: { key: { in: ["planning.minCoverMonths", "planning.orderDeadlineDay", "planning.productionLeadMonths"] } },
  });
  const setting = (key: string, fallback: number) => {
    const row = settings.find((s) => s.key === key);
    const v = row ? Number(JSON.parse(row.value)) : NaN;
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  const coverRule = setting("planning.minCoverMonths", DEFAULT_SETTINGS.minCoverMonths);
  const slot = nextOrderSlot(tashkentNow, {
    ...DEFAULT_SETTINGS,
    minCoverMonths: coverRule,
    orderDeadlineDay: setting("planning.orderDeadlineDay", DEFAULT_SETTINGS.orderDeadlineDay),
    productionLeadMonths: setting("planning.productionLeadMonths", DEFAULT_SETTINGS.productionLeadMonths),
  });

  // products that moved most against the month before; while a month is
  // still running, its best sellers so far beside last month's whole figure
  const prevUnits = prevId ? raw(prevId).unitsProduct : {};
  const moverRows = prevId
    ? [...new Set([...Object.keys(now.unitsProduct), ...Object.keys(prevUnits)])].map((pid) => ({
        name: productName(pid),
        units: now.unitsProduct[pid] ?? 0,
        prev: prevUnits[pid] ?? 0,
      }))
    : [];
  const movers = (
    isPartial(monthId)
      ? moverRows.filter((r) => r.units > 0).sort((a, b) => b.units - a.units)
      : moverRows.filter((r) => r.units !== r.prev).sort((a, b) => Math.abs(b.units - b.prev) - Math.abs(a.units - a.prev))
  ).slice(0, 6);

  // products below the cover rule at month-end
  const lowCover = Object.keys(computed.fifo)
    .map((pid) => ({ name: productName(pid), cover: coverOf(monthId, pid), stock: stockUnits(monthId, pid) }))
    .filter((r): r is { name: string; cover: number; stock: number } => r.cover != null && r.cover < coverRule)
    .sort((a, b) => a.cover - b.cover)
    .slice(0, 5);

  const trucks = await prisma.shipment.findMany({
    where: { deletedAt: null, status: "TRANSIT" },
    include: { lines: { where: { deletedAt: null }, select: { qty: true } } },
    orderBy: [{ etaDate: "asc" }, { code: "asc" }],
  });

  const units = (rows: Array<{ monthId: string; qty: number }>) =>
    rows.filter((w) => w.monthId === monthId).reduce((s, w) => s + w.qty, 0);

  // what the month still lacks, as the month-close checklist counts it
  const status = ctx.status.find((s) => s.monthId === monthId);
  const required: Array<[boolean, { ru: string; en: string }, string]> = status
    ? [
        [status.hasSales, { ru: "продажи", en: "sales" }, "/sales"],
        [status.hasOpexTi, { ru: "расходы TI", en: "TI expenses" }, "/expenses/ti"],
        [status.hasOpexFargo, { ru: "расходы Fargo", en: "Fargo expenses" }, "/expenses/fargo"],
        [status.hasStock, { ru: "пересчёт склада", en: "stock count" }, "/goods/stock"],
        [status.hasInputs, { ru: "остатки денег", en: "cash balances" }, "/funding/balances"],
      ]
    : [];

  return {
    monthId,
    monthName: monthName(monthId),
    months,
    channelSeries,
    productSeries,
    coverRule,
    asOf: isPartial(monthId) ? `${thisMonth}-${String(tashkentNow.getDate()).padStart(2, "0")}` : null,
    pulse: {
      sales: { now: salesNow, prev: value(prevId, (f) => f.salesAtPrice), yearAgo: value(yearAgoId, (f) => f.salesAtPrice) },
      units: { now: fargoOf(monthId)?.units ?? 0, prev: value(prevId, (f) => f.units), yearAgo: value(yearAgoId, (f) => f.units) },
      prevId: prevId ?? null,
      yearAgoId: yearAgoId ?? null,
      channels: Object.entries(fold(now.salesChannel, channelSeries))
        .filter(([, v]) => v > 0)
        .sort((a, b) => (a[0] === OTHER ? 1 : b[0] === OTHER ? -1 : b[1] - a[1]))
        .map(([key, v]) => ({
          key,
          name: channelSeries.find((s) => s.key === key)?.name ?? key,
          share: salesNow > 0 ? v / salesNow : 0,
        })),
      cover: coverOf(monthId),
      stockUnits: stockUnits(monthId),
      order: { deadline: slot.deadline, daysLeft: slot.daysLeft, arrivalMonth: slot.arrivalMonth },
    },
    movers,
    lowCover,
    trucks: trucks.map((t) => ({
      id: t.id,
      code: t.code,
      eta: t.etaDate ? t.etaDate.toISOString().slice(0, 10) : null,
      units: t.lines.reduce((s, l) => s + l.qty, 0),
    })),
    writtenOff: units(computed.fargoWriteOffs) + units(computed.writeOffs),
    status: {
      missing: required.filter(([ok]) => !ok).map(([, label, href]) => ({ label: ctx.l(label), href })),
      required: required.length,
      closed: !!monthRow(monthId)?.closedAt,
      warnings: computed.healthChecks.filter((h) => h.status === "warn" && h.severity === "warn").length,
    },
    isAdmin: ctx.isAdmin,
  };
}

export type OverviewProps = Awaited<ReturnType<typeof overviewData>>;
