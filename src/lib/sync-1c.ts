// DB-facing half of the 1C sync: preview aggregation against current data and
// the full-snapshot commit. Pure logic (fetch, classifier, types) lives in
// sync-1c-core.ts so it can be unit-tested without a database.
import { prisma } from "./db";
import {
  classifyChannel,
  norm,
  type Api1cItem,
  type BatchSyncMonthRow,
  type BatchSyncReport,
  type ClassifyRule,
  type ReconcileMonthRow,
  type ReconcileReport,
  type SyncProductRow,
  type SyncReport,
} from "./sync-1c-core";
import { monthRange } from "./sync-1c-core";

export * from "./sync-1c-core";

interface AggKey {
  productId: string;
  channelName: string;
  qty: number;
  salesDocs: number;
  returnDocs: number;
}

export async function buildSync(
  monthId: string,
  items: Api1cItem[],
  byClientName: boolean
): Promise<{
  report: SyncReport;
  matched: Array<{ productId: string; channelId: string; qty: number }>;
  learned: Array<{ productId: string; code: string }>;
}> {
  const [products, channels, currentSales] = await Promise.all([
    prisma.product.findMany({ where: { active: true } }),
    prisma.channel.findMany({ where: { active: true } }),
    prisma.sale.findMany({ where: { monthId }, include: { product: true } }),
  ]);

  const byCode = new Map<string, string>();
  const byArticle = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const p of products) {
    if (p.codeSales1c) byCode.set(norm(p.codeSales1c), p.id);
    if (p.article) byArticle.set(norm(p.article), p.id);
    byName.set(norm(p.nameRu), p.id);
    if (p.nameEn) byName.set(norm(p.nameEn), p.id);
  }
  const channelByName = new Map(channels.map((c) => [c.name, c]));
  const productById = new Map(products.map((p) => [p.id, p]));

  const { dateFrom, dateTo } = monthRange(monthId);
  const agg = new Map<string, AggKey>();
  const unknownSkus = new Map<string, { code: string; name: string; qty: number }>();
  const fallback = new Map<string, { client: string; qty: number; docs: number }>();
  const byRule: Record<ClassifyRule, number> = { district: 0, region: 0, client: 0, fallback: 0 };
  const learnedMap = new Map<string, { productId: string; code: string }>();
  let sales = 0,
    returns = 0,
    outsidePeriod = 0;

  for (const it of items) {
    // the API filters by date, but rows outside the requested month must never
    // silently land in it
    if (String(it.Дата ?? "").slice(0, 7) !== monthId) {
      outsidePeriod++;
      continue;
    }
    const isReturn = norm(String(it.ТипОперации ?? "")) === "возврат";
    const rawQty = Number(it.Количество) || 0;
    // returns arrive as negative qty already; guard against a positive-qty return
    const qty = isReturn && rawQty > 0 ? -rawQty : rawQty;
    if (isReturn) returns++;
    else sales++;

    const code = norm(String(it.КодСКЮ ?? ""));
    const skuText = norm(String(it.СКЮ ?? ""));
    const productId = byCode.get(code) ?? byArticle.get(skuText) ?? byName.get(skuText);
    if (!productId) {
      const key = code || skuText;
      const u = unknownSkus.get(key) ?? { code: String(it.КодСКЮ ?? ""), name: String(it.СКЮ ?? ""), qty: 0 };
      u.qty += qty;
      unknownSkus.set(key, u);
      continue;
    }
    // matched via артикул/name while the product has no stored КодСКЮ → learn it
    if (code && !byCode.has(code)) {
      byCode.set(code, productId);
      if (!productById.get(productId)?.codeSales1c && !learnedMap.has(code))
        learnedMap.set(code, { productId, code: String(it.КодСКЮ) });
    }

    const cls = classifyChannel(it.Район, String(it.Контрагент ?? ""), byClientName);
    byRule[cls.rule] += qty;
    if (cls.rule === "fallback") {
      const client = String(it.Контрагент ?? "").trim() || "(без имени)";
      const f = fallback.get(client) ?? { client, qty: 0, docs: 0 };
      f.qty += qty;
      f.docs++;
      fallback.set(client, f);
    }

    const aggKey = `${productId}|${cls.channel}`;
    const a =
      agg.get(aggKey) ??
      ({ productId, channelName: cls.channel, qty: 0, salesDocs: 0, returnDocs: 0 } as AggKey);
    a.qty += qty;
    if (isReturn) a.returnDocs++;
    else a.salesDocs++;
    agg.set(aggKey, a);
  }

  // resolve channel names → ids; build commit rows. Net-negative cells (a
  // month's returns exceeding its sales — typically returns against prior-month
  // sales) ARE written with negative qty, same as the Excel-imported data;
  // they're also surfaced in the report so the user sees why.
  const matched: Array<{ productId: string; channelId: string; qty: number }> = [];
  const negativeKeys: SyncReport["negativeKeys"] = [];
  const channelTotals = new Map<string, { qty: number; clients: Set<string> }>();
  for (const a of agg.values()) {
    const ch = channelByName.get(a.channelName);
    if (!ch) continue; // classifier only emits names present in the DB
    const t = channelTotals.get(ch.id) ?? { qty: 0, clients: new Set<string>() };
    t.qty += a.qty;
    channelTotals.set(ch.id, t);
    if (a.qty !== 0) matched.push({ productId: a.productId, channelId: ch.id, qty: a.qty });
    if (a.qty < 0)
      negativeKeys.push({
        product: productById.get(a.productId)?.nameRu ?? a.productId,
        channel: a.channelName,
        qty: a.qty,
      });
  }
  for (const f of fallback.values()) {
    const ch = channelByName.get("Прочие");
    if (ch) channelTotals.get(ch.id)?.clients.add(f.client);
  }

  const productTotals = new Map<string, SyncProductRow>();
  for (const a of agg.values()) {
    const p = productById.get(a.productId)!;
    const row =
      productTotals.get(a.productId) ??
      ({ productId: a.productId, name: p.nameRu, qtyNew: 0, qtyCur: 0, salesDocs: 0, returnDocs: 0 } as SyncProductRow);
    row.qtyNew += a.qty;
    row.salesDocs += a.salesDocs;
    row.returnDocs += a.returnDocs;
    productTotals.set(a.productId, row);
  }
  for (const s of currentSales) {
    const row =
      productTotals.get(s.productId) ??
      ({ productId: s.productId, name: s.product.nameRu, qtyNew: 0, qtyCur: 0, salesDocs: 0, returnDocs: 0 } as SyncProductRow);
    row.qtyCur += s.qty;
    productTotals.set(s.productId, row);
  }

  const report: SyncReport = {
    monthId,
    dateFrom,
    dateTo,
    fetched: { total: items.length, sales, returns, outsidePeriod },
    products: [...productTotals.values()].sort(
      (a, b) =>
        (productById.get(a.productId)?.sortOrder ?? 0) - (productById.get(b.productId)?.sortOrder ?? 0)
    ),
    channels: [...channelTotals.entries()]
      .map(([channelId, t]) => ({
        channelId,
        name: channels.find((c) => c.id === channelId)?.name ?? channelId,
        qty: t.qty,
        clients: t.clients.size,
      }))
      .filter((c) => c.qty !== 0 || c.clients > 0)
      .sort((a, b) => b.qty - a.qty),
    byRule,
    fallbackClients: [...fallback.values()].sort((a, b) => b.qty - a.qty),
    unknownSkus: [...unknownSkus.values()].sort((a, b) => b.qty - a.qty),
    learnedCodes: [...learnedMap.values()].map((l) => ({
      code: l.code,
      product: productById.get(l.productId)?.nameRu ?? l.productId,
    })),
    negativeKeys,
    current: {
      rows: currentSales.length,
      qty: currentSales.reduce((s, x) => s + x.qty, 0),
      withAmount: currentSales.filter((x) => x.amount != null).length,
      sources: [...new Set(currentSales.map((x) => x.source))],
    },
  };
  return { report, matched, learned: [...learnedMap.values()] };
}

/** Full-snapshot replace of the month's sales + code learning + audit log. */
export async function commitSync(
  monthId: string,
  matched: Array<{ productId: string; channelId: string; qty: number }>,
  learned: Array<{ productId: string; code: string }>,
  summary: object,
  username: string
): Promise<{ deleted: number; inserted: number }> {
  const result = await prisma.$transaction(async (tx) => {
    const del = await tx.sale.deleteMany({ where: { monthId } });
    for (const r of matched) {
      await tx.sale.create({
        data: { monthId, productId: r.productId, channelId: r.channelId, qty: r.qty, source: "API" },
      });
    }
    for (const l of learned) {
      await tx.product.update({ where: { id: l.productId }, data: { codeSales1c: l.code } });
    }
    await tx.auditLog.create({
      data: {
        entity: "sale",
        entityId: monthId,
        action: "SYNC_1C",
        data: JSON.stringify(summary),
        username,
      },
    });
    return { deleted: del.count, inserted: matched.length };
  });
  return result;
}

/**
 * Quantity-only reconciliation of every month that has sales in the app
 * against the same period in 1C. Matched SKUs are compared per month;
 * out-of-range SKUs (excluded on both sides by design) are listed separately.
 * Read-only.
 */
export async function buildReconcile(
  items: Api1cItem[],
  dateFrom: string,
  dateTo: string
): Promise<ReconcileReport> {
  const [products, sales, monthRows] = await Promise.all([
    prisma.product.findMany({ where: { active: true } }),
    prisma.sale.findMany({ select: { monthId: true, productId: true, qty: true } }),
    prisma.month.findMany({ select: { id: true } }),
  ]);
  const validMonths = new Set(monthRows.map((m) => m.id));

  const byCode = new Map<string, string>();
  const byArticle = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const p of products) {
    if (p.codeSales1c) byCode.set(norm(p.codeSales1c), p.id);
    if (p.article) byArticle.set(norm(p.article), p.id);
    byName.set(norm(p.nameRu), p.id);
    if (p.nameEn) byName.set(norm(p.nameEn), p.id);
  }
  const productById = new Map(products.map((p) => [p.id, p]));

  // app side: month → product → qty
  const app = new Map<string, Map<string, number>>();
  for (const s of sales) {
    const m = app.get(s.monthId) ?? new Map<string, number>();
    m.set(s.productId, (m.get(s.productId) ?? 0) + s.qty);
    app.set(s.monthId, m);
  }

  // 1C side, same matching as the sync
  const api = new Map<string, Map<string, number>>();
  const unknownSkus = new Map<string, { code: string; name: string; qty: number }>();
  for (const it of items) {
    const monthId = String(it.Дата ?? "").slice(0, 7);
    if (!validMonths.has(monthId)) continue;
    const qty = Number(it.Количество) || 0;
    const code = norm(String(it.КодСКЮ ?? ""));
    const skuText = norm(String(it.СКЮ ?? ""));
    const productId = byCode.get(code) ?? byArticle.get(skuText) ?? byName.get(skuText);
    if (!productId) {
      const key = code || skuText;
      const u =
        unknownSkus.get(key) ?? { code: String(it.КодСКЮ ?? ""), name: String(it.СКЮ ?? ""), qty: 0 };
      u.qty += qty;
      unknownSkus.set(key, u);
      continue;
    }
    const m = api.get(monthId) ?? new Map<string, number>();
    m.set(productId, (m.get(productId) ?? 0) + qty);
    api.set(monthId, m);
  }

  const monthIds = [...new Set([...app.keys(), ...api.keys()])].sort();
  const months: ReconcileMonthRow[] = monthIds.map((monthId) => {
    const a = app.get(monthId) ?? new Map<string, number>();
    const b = api.get(monthId) ?? new Map<string, number>();
    const productIds = [...new Set([...a.keys(), ...b.keys()])];
    const diffs = productIds
      .filter((pid) => (a.get(pid) ?? 0) !== (b.get(pid) ?? 0))
      .map((pid) => ({
        name: productById.get(pid)?.nameRu ?? pid,
        appQty: a.get(pid) ?? 0,
        apiQty: b.get(pid) ?? 0,
      }))
      .sort((x, y) => Math.abs(y.apiQty - y.appQty) - Math.abs(x.apiQty - x.appQty));
    return {
      monthId,
      appQty: [...a.values()].reduce((s, q) => s + q, 0),
      apiQty: [...b.values()].reduce((s, q) => s + q, 0),
      products: diffs,
    };
  });

  return {
    dateFrom,
    dateTo,
    fetchedTotal: items.length,
    months,
    unknownSkus: [...unknownSkus.values()].sort((x, y) => Math.abs(y.qty) - Math.abs(x.qty)),
  };
}

/**
 * Batch replace: split the fetched range by month and run the normal
 * build + commit for each month that has 1C data. Months with app data but
 * no 1C rows are left untouched and reported as skipped. Sequential on
 * purpose — codes learned in an early month are visible to later ones.
 */
export async function commitAllMonths(
  items: Api1cItem[],
  byClientName: boolean,
  username: string
): Promise<Omit<BatchSyncReport, "dateFrom" | "dateTo">> {
  const monthRows = await prisma.month.findMany({ select: { id: true } });
  const validMonths = new Set(monthRows.map((m) => m.id));
  const byMonth = new Map<string, Api1cItem[]>();
  for (const it of items) {
    const monthId = String(it.Дата ?? "").slice(0, 7);
    if (!validMonths.has(monthId)) continue;
    const list = byMonth.get(monthId) ?? [];
    list.push(it);
    byMonth.set(monthId, list);
  }

  const appMonths = await prisma.sale.groupBy({ by: ["monthId"] });
  const skipped = appMonths.map((m) => m.monthId).filter((id) => !byMonth.has(id)).sort();

  const months: BatchSyncMonthRow[] = [];
  const unknownAgg = new Map<string, { code: string; name: string; qty: number }>();
  const fallbackAgg = new Map<string, { client: string; qty: number }>();
  for (const monthId of [...byMonth.keys()].sort()) {
    const monthItems = byMonth.get(monthId)!;
    const { report, matched, learned } = await buildSync(monthId, monthItems, byClientName);
    const qtyNew = report.products.reduce((s, p) => s + p.qtyNew, 0);
    const committed = await commitSync(
      monthId,
      matched,
      learned,
      {
        batch: true,
        fetched: report.fetched,
        totalQty: qtyNew,
        replacedRows: report.current.rows,
        replacedWithAmount: report.current.withAmount,
        unknownSkus: report.unknownSkus,
        fallbackClients: report.fallbackClients.length,
        learnedCodes: report.learnedCodes,
      },
      username
    );
    months.push({ monthId, qtyCur: report.current.qty, qtyNew, ...committed });
    for (const u of report.unknownSkus) {
      const a = unknownAgg.get(u.code) ?? { code: u.code, name: u.name, qty: 0 };
      a.qty += u.qty;
      unknownAgg.set(u.code, a);
    }
    for (const f of report.fallbackClients) {
      const a = fallbackAgg.get(f.client) ?? { client: f.client, qty: 0 };
      a.qty += f.qty;
      fallbackAgg.set(f.client, a);
    }
  }

  return {
    months,
    skipped,
    unknownSkus: [...unknownAgg.values()].sort((a, b) => Math.abs(b.qty) - Math.abs(a.qty)),
    fallbackClients: [...fallbackAgg.values()].sort((a, b) => b.qty - a.qty),
  };
}
