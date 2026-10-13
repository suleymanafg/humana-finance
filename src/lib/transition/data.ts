// Server-side read model for the distribution handover (/transition).
// Reads the module's own tables and, read-only, the app's existing data:
// Fargo's sales by channel and by client, stock at Fargo, TI→Fargo invoice
// prices and the settlement balance. Nothing here writes.
import { cache } from "react";
import { prisma } from "@/lib/db";
import { getComputed } from "@/lib/data";
import { costProductIdOf } from "@/lib/engine/compute";
import { computeMonthStatus, defaultMonthId } from "@/lib/month-status";
import {
  DEFAULT_GO_LIVE,
  SETTING_BRIEF,
  SETTING_GO_LIVE,
  daysBetween,
  isClosedTask,
  isSignedOutlet,
  todayYmd,
  ymd,
} from "./model";
import { DEFAULT_BRIEF } from "./seed-plan";
import { nextUp, type TaskView } from "./tasks";

export { nextUp, type TaskView };

export const loadTransition = cache(async () => {
  const [regions, tasks, outlets, lots, decisions, tiSales, settings] = await Promise.all([
    prisma.trRegion.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.trTask.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.trOutlet.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    prisma.trStockLot.findMany({ where: { deletedAt: null }, orderBy: [{ itemName: "asc" }, { expiry: "asc" }] }),
    prisma.trDecision.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.trTiSale.findMany({ orderBy: { monthId: "asc" } }),
    prisma.setting.findMany({ where: { key: { in: [SETTING_GO_LIVE, SETTING_BRIEF] } } }),
  ]);
  const setting = (key: string) => settings.find((s) => s.key === key)?.value;
  return {
    regions,
    tasks,
    outlets,
    lots,
    decisions,
    tiSales,
    goLive: setting(SETTING_GO_LIVE) || DEFAULT_GO_LIVE,
    brief: setting(SETTING_BRIEF) ?? DEFAULT_BRIEF,
  };
});

export type TransitionData = Awaited<ReturnType<typeof loadTransition>>;

// ───────────────────────────── Tasks ─────────────────────────────

export function taskViews(data: TransitionData, today = todayYmd()): TaskView[] {
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  return data.tasks.map((t) => {
    const due = ymd(t.dueDate);
    const open = !isClosedTask(t.status);
    const dep = t.dependsOnId ? byId.get(t.dependsOnId) : undefined;
    return {
      id: t.id,
      stream: t.stream,
      title: t.title,
      titleEn: t.titleEn,
      details: t.details,
      detailsEn: t.detailsEn,
      owner: t.owner,
      status: t.status,
      priority: t.priority,
      startDate: ymd(t.startDate),
      dueDate: due,
      doneAt: ymd(t.doneAt),
      dependsOnId: t.dependsOnId,
      regionId: t.regionId,
      notes: t.notes,
      overdue: open && !!due && due < today,
      dueIn: due ? daysBetween(today, due) : null,
      waiting: open && !!dep && !isClosedTask(dep.status),
    };
  });
}

// ───────────────────────────── Outlets ─────────────────────────────

/**
 * Fargo's sales to each 1C client over the last `n` months that have client
 * data, valued at the app's list prices (the same basis as the P&L).
 */
export const clientSales = cache(async (n = 3) => {
  const { dataset } = await getComputed();
  const months = (
    await prisma.clientSale.groupBy({ by: ["monthId"], _count: { _all: true }, orderBy: { monthId: "desc" }, take: n })
  ).map((m) => m.monthId);
  const rows = months.length
    ? await prisma.clientSale.findMany({
        where: { monthId: { in: months } },
        select: { clientMapId: true, productId: true, qty: true },
      })
    : [];
  const price = new Map(dataset.products.map((p) => [p.id, p.price]));
  const byClient = new Map<string, { qty: number; value: number }>();
  for (const r of rows) {
    const cur = byClient.get(r.clientMapId) ?? { qty: 0, value: 0 };
    cur.qty += r.qty;
    cur.value += r.qty * (price.get(r.productId) ?? 0);
    byClient.set(r.clientMapId, cur);
  }
  return { months: months.slice().sort(), byClient };
});

export interface OutletView {
  id: string;
  clientMapId: string | null;
  name: string;
  regionId: string;
  district: string;
  type: string;
  contact: string;
  phone: string;
  status: string;
  creditDays: number | null;
  contractNo: string;
  signedDate: string;
  firstOrderDate: string;
  source: string;
  notes: string;
  /** Fargo's sales to this outlet in the last months, at list prices */
  recentValue: number;
  recentQty: number;
}

export async function outletViews(data: TransitionData) {
  const sales = await clientSales();
  const rows: OutletView[] = data.outlets.map((o) => {
    const s = o.clientMapId ? sales.byClient.get(o.clientMapId) : undefined;
    return {
      id: o.id,
      clientMapId: o.clientMapId,
      name: o.name,
      regionId: o.regionId ?? "",
      district: o.district ?? "",
      type: o.type,
      contact: o.contact ?? "",
      phone: o.phone ?? "",
      status: o.status,
      creditDays: o.creditDays,
      contractNo: o.contractNo ?? "",
      signedDate: ymd(o.signedDate),
      firstOrderDate: ymd(o.firstOrderDate),
      source: o.source,
      notes: o.notes ?? "",
      recentValue: s?.value ?? 0,
      recentQty: s?.qty ?? 0,
    };
  });
  return { rows, months: sales.months };
}

export function outletFunnel(rows: OutletView[]) {
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const active = rows.filter((r) => r.status !== "INACTIVE" && r.status !== "LOST");
  const signed = active.filter((r) => isSignedOutlet(r.status));
  const value = active.reduce((s, r) => s + r.recentValue, 0);
  const signedValue = signed.reduce((s, r) => s + r.recentValue, 0);
  return {
    total: rows.length,
    active: active.length,
    signed: signed.length,
    byStatus,
    /** share of the active outlets' recent sales that already sits with signed outlets */
    signedShare: value > 0 ? signedValue / value : null,
  };
}

// ───────────────────────────── Sales continuity ─────────────────────────────

export interface RegionSales {
  regionId: string;
  name: string;
  kind: string;
  route: string;
  status: string;
  switchDate: string;
  channelId: string | null;
  fargo: number[];
  ti: number[];
  total: number[];
  /** average monthly sales over the three months before the switch (or the last three) */
  baseline: number | null;
  /** latest month with sales against the baseline (−0.2 = 20% below) */
  change: number | null;
  latestMonth: string | null;
  /** switched and running more than 15% below the baseline */
  drop: boolean;
}

const BASE_MONTHS = 3;
export const DROP_THRESHOLD = -0.15;

export async function salesContinuity(data: TransitionData) {
  const { dataset, computed } = await getComputed();
  // months the app has Fargo sales for, plus any later TI-only months
  const fargoMonths = computed.monthIds.filter((m, i) => (computed.fargo[i]?.salesAtPrice ?? 0) > 0);
  const tiMonths = data.tiSales.map((s) => s.monthId);
  const all = [...new Set([...fargoMonths, ...tiMonths])].sort();
  const months = all.slice(-9);
  const nameOf = (id: string) => {
    const m = dataset.months.find((x) => x.id === id);
    return { ru: m?.nameRu ?? id, en: m?.nameEn ?? id };
  };
  const fargoOf = (channelId: string | null, monthId: string) => {
    if (!channelId) return 0;
    const i = computed.monthIds.indexOf(monthId);
    return i >= 0 ? (computed.fargo[i]?.salesByChannel[channelId] ?? 0) : 0;
  };

  const rows: RegionSales[] = data.regions.map((r) => {
    const tiOf = (monthId: string) =>
      data.tiSales.find((s) => s.regionId === r.id && s.monthId === monthId)?.amount ?? 0;
    const fargo = months.map((m) => fargoOf(r.channelId, m));
    const ti = months.map((m) => tiOf(m));
    const total = months.map((_, i) => fargo[i] + ti[i]);
    const switchMonth = r.switchDate ? ymd(r.switchDate).slice(0, 7) : null;
    const baseMonths = fargoMonths.filter((m) => !switchMonth || m < switchMonth).slice(-BASE_MONTHS);
    const baseline = baseMonths.length
      ? baseMonths.reduce((s, m) => s + fargoOf(r.channelId, m) + tiOf(m), 0) / baseMonths.length
      : null;
    let latestIdx = -1;
    for (let i = months.length - 1; i >= 0; i--) {
      if (total[i] !== 0) {
        latestIdx = i;
        break;
      }
    }
    const latestMonth = latestIdx >= 0 ? months[latestIdx] : null;
    const change = baseline && latestIdx >= 0 ? total[latestIdx] / baseline - 1 : null;
    const afterSwitch = !!switchMonth && !!latestMonth && latestMonth >= switchMonth;
    return {
      regionId: r.id,
      name: r.name,
      kind: r.kind,
      route: r.route,
      status: r.status,
      switchDate: ymd(r.switchDate),
      channelId: r.channelId,
      fargo,
      ti,
      total,
      baseline,
      change,
      latestMonth,
      drop: afterSwitch && change !== null && change < DROP_THRESHOLD,
    };
  });
  return { months, monthNames: months.map(nameOf), rows };
}

// ───────────────────────────── Stock & buyback ─────────────────────────────

export interface LotView {
  id: string;
  productId: string;
  productName: string;
  itemName: string;
  batch: string;
  expiry: string;
  daysToExpiry: number | null;
  expiryBucket: "expired" | "lt90" | "lt180" | "ok" | "unknown";
  qty: number;
  location: string;
  countDate: string;
  preAug2025: boolean;
  unitPrice: number | null;
  /** latest TI→Fargo invoice price ex-VAT, the default buyback price */
  defaultPrice: number | null;
  priceUsed: number | null;
  value: number;
  /** TI's own unit cost of that invoice line, for reference */
  tiUnitCost: number | null;
  status: string;
  source: string;
  notes: string;
}

export async function stockViews(data: TransitionData, today = todayYmd()) {
  const { dataset, computed } = await getComputed();
  const productName = (id: string | null) => (id ? dataset.products.find((p) => p.id === id)?.nameRu ?? "" : "");
  const costOf = (id: string) => costProductIdOf(id, dataset);

  // latest TI→Fargo invoice line per cost product
  const latest = new Map<string, { price: number; tiUnitCost: number }>();
  for (const line of computed.invoices) {
    if (line.qty <= 0) continue;
    latest.set(costOf(line.productId), { price: line.price, tiUnitCost: line.tiUnitCost }); // invoices are date-ordered
  }

  const lots: LotView[] = data.lots.map((l) => {
    const expiry = ymd(l.expiry);
    const days = expiry ? daysBetween(today, expiry) : null;
    const ref = l.productId ? latest.get(costOf(l.productId)) : undefined;
    const priceUsed = l.unitPrice ?? ref?.price ?? null;
    return {
      id: l.id,
      productId: l.productId ?? "",
      productName: productName(l.productId),
      itemName: l.itemName,
      batch: l.batch ?? "",
      expiry,
      daysToExpiry: days,
      expiryBucket: days === null ? "unknown" : days < 0 ? "expired" : days < 90 ? "lt90" : days < 180 ? "lt180" : "ok",
      qty: l.qty,
      location: l.location ?? "",
      countDate: ymd(l.countDate),
      preAug2025: l.preAug2025,
      unitPrice: l.unitPrice,
      defaultPrice: ref?.price ?? null,
      priceUsed,
      value: l.preAug2025 || l.status === "WRITTEN_OFF" ? 0 : l.qty * (priceUsed ?? 0),
      tiUnitCost: ref?.tiUnitCost ?? null,
      status: l.status,
      source: l.source,
      notes: l.notes ?? "",
    };
  });

  // per SKU: counted lots against the app's book stock at Fargo, at the
  // latest month with data (later months in the table are still empty)
  const dataMonth = defaultMonthId(computeMonthStatus(dataset), computed.monthIds.at(-1) ?? "");
  const lastStock = computed.stock.find((s) => s.monthId === dataMonth) ?? computed.stock.at(-1);
  const lastCount = [...computed.stock].reverse().find((s) => s.isCountMonth && s.monthId <= dataMonth);
  const bySku = new Map<string, { productId: string; name: string; lotsQty: number; value: number }>();
  for (const l of lots) {
    if (l.preAug2025 || l.status === "WRITTEN_OFF") continue;
    const key = l.productId ? costOf(l.productId) : `?${l.itemName}`;
    const cur = bySku.get(key) ?? { productId: l.productId ? key : "", name: l.productId ? productName(key) : l.itemName, lotsQty: 0, value: 0 };
    cur.lotsQty += l.qty;
    cur.value += l.value;
    bySku.set(key, cur);
  }
  // add SKUs the book says Fargo holds but no lot covers
  for (const p of lastStock?.products ?? []) {
    if (p.fargoBook > 0.5 && !bySku.has(p.productId)) {
      bySku.set(p.productId, { productId: p.productId, name: productName(p.productId), lotsQty: 0, value: 0 });
    }
  }
  const skus = [...bySku.values()]
    .map((s) => {
      const book = s.productId ? lastStock?.products.find((p) => p.productId === s.productId)?.fargoBook ?? null : null;
      const counted = s.productId ? lastCount?.products.find((p) => p.productId === s.productId)?.counted ?? null : null;
      return { ...s, book, counted, difference: book === null ? null : s.lotsQty - book };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  const inScope = lots.filter((l) => !l.preAug2025 && l.status !== "WRITTEN_OFF");
  const sum = (xs: LotView[], f: (l: LotView) => number) => xs.reduce((s, l) => s + f(l), 0);
  const bucketQty = (b: LotView["expiryBucket"]) => sum(inScope.filter((l) => l.expiryBucket === b), (l) => l.qty);
  return {
    lots,
    skus,
    bookMonth: lastStock?.monthId ?? null,
    countMonth: lastCount?.monthId ?? null,
    totals: {
      qty: sum(inScope, (l) => l.qty),
      value: sum(inScope, (l) => l.value),
      unpriced: inScope.filter((l) => l.priceUsed === null).length,
      unmatched: lots.filter((l) => !l.productId).length,
      /** lots that need a look: no SKU in the app or no price */
      toClarify: lots.filter((l) => !l.productId || (l.priceUsed === null && !l.preAug2025)).length,
      preAugQty: sum(lots.filter((l) => l.preAug2025), (l) => l.qty),
      expiredQty: bucketQty("expired"),
      lt90Qty: bucketQty("lt90"),
      lt180Qty: bucketQty("lt180"),
      okQty: bucketQty("ok"),
      unknownQty: bucketQty("unknown"),
    },
  };
}

// ───────────────────────────── Settlement ─────────────────────────────

/** Fargo's balance owed to TI and payments received, from the settlement model. */
export async function settlementView() {
  const { dataset, computed } = await getComputed();
  const dataMonth = defaultMonthId(computeMonthStatus(dataset), computed.monthIds.at(-1) ?? "");
  const last = computed.settlement.find((x) => x.monthId === dataMonth) ?? computed.settlement.at(-1);
  const recent = dataset.transfers.slice(-6).reverse().map((t) => ({
    date: t.date.slice(0, 10),
    cash: t.cashAmount,
    bank: t.bankAmount,
    notes: t.notes ?? "",
  }));
  return {
    monthId: last?.monthId ?? null,
    owes: last?.owes ?? 0,
    receivedToDate: (last?.cashCum ?? 0) + (last?.bankCum ?? 0),
    recent,
  };
}

// ───────────────────────────── Overview ─────────────────────────────

export async function overview(data: TransitionData, today = todayYmd()) {
  const tasks = taskViews(data, today);
  const open = tasks.filter((t) => !isClosedTask(t.status));
  const live = tasks.filter((t) => t.status !== "DROPPED");
  const { rows: outlets } = await outletViews(data);
  const stock = await stockViews(data, today);
  const settlement = await settlementView();
  const streams = new Map<string, { total: number; done: number; overdue: number }>();
  for (const t of live) {
    const s = streams.get(t.stream) ?? { total: 0, done: 0, overdue: 0 };
    s.total++;
    if (t.status === "DONE") s.done++;
    if (t.overdue) s.overdue++;
    streams.set(t.stream, s);
  }
  return {
    today,
    goLive: data.goLive,
    daysToGoLive: daysBetween(today, data.goLive),
    tasks: {
      total: live.length,
      done: live.filter((t) => t.status === "DONE").length,
      overdue: open.filter((t) => t.overdue).length,
      blocked: open.filter((t) => t.status === "BLOCKED").length,
      urgent: open.filter((t) => t.priority === "URGENT").length,
    },
    streams: Object.fromEntries(streams),
    next: nextUp(tasks).slice(0, 12),
    regions: {
      total: data.regions.length,
      switched: data.regions.filter((r) => r.status === "SWITCHED").length,
      undecided: data.regions.filter((r) => r.route === "UNDECIDED").length,
      withoutDate: data.regions.filter((r) => !r.switchDate && r.status !== "SWITCHED").length,
    },
    outlets: outletFunnel(outlets),
    stock: stock.totals,
    decisions: {
      open: data.decisions.filter((d) => d.status === "OPEN").length,
      overdue: data.decisions.filter((d) => d.status === "OPEN" && d.dueDate && ymd(d.dueDate) < today).length,
    },
    settlement,
  };
}
