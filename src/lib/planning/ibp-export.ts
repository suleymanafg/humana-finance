// DMK's IBP export ("Partner Forecast Input" SAPUI5 sheet): one block of key
// figures per Product ID, one column per month ("Jul-26"). Only the ORDERS are
// read — "Partner Forecast Input Qty." per ship month, which is what was
// entered in IBP and becomes the order at the deadline. DMK's Order History,
// Contract Volumes and Open Orders are not reliable for us (DMK cannot correct
// them), so what was collected and what is still due comes from the app's own
// trucks. Pure: the app's upload and prisma/import-ibp-sync.ts both use it.

export type Cell = string | number | Date | null;

export interface IbpOrders {
  months: string[]; // every month column in the file, ascending
  byArticle: Record<string, { name: string; orders: Record<string, number> }>; // only filled cells
}

export interface IbpSku {
  id: string;
  article: string;
  altArticles: string | null;
  name: string;
}

export interface IbpChange {
  skuId: string;
  name: string;
  shipMonth: string;
  from: number;
  to: number;
}

export const ORDER_FIGURE = "Partner Forecast Input Qty.";
const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function monthOfHeader(h: Cell): string | null {
  if (h instanceof Date) return `${h.getUTCFullYear()}-${String(h.getUTCMonth() + 1).padStart(2, "0")}`;
  const m = String(h ?? "").trim().match(/^([A-Z][a-z]{2})-(\d{2})$/);
  return m && MONTHS[m[1]] ? `20${m[2]}-${MONTHS[m[1]]}` : null;
}

const text = (c: Cell) => (c instanceof Date ? c.toISOString() : String(c ?? "").trim());

export function parseIbpExport(rows: Cell[][]): IbpOrders | { error: string } {
  const headerAt = rows.findIndex((r) => r.some((c) => text(c) === "Key Figures") && r.some((c) => text(c) === "Product ID"));
  if (headerAt < 0) return { error: "no «Product ID» / «Key Figures» header — is this DMK's IBP export?" };
  const header = rows[headerAt];
  const col = (name: string) => header.findIndex((c) => text(c) === name);
  const idCol = col("Product ID");
  const descCol = col("Product Desc");
  const figCol = col("Key Figures");
  const monthCols = header.map((h, i) => ({ i, month: monthOfHeader(h) })).filter((x): x is { i: number; month: string } => !!x.month);
  if (monthCols.length === 0) return { error: "no month columns (like «Oct-26») in the header" };

  const byArticle: IbpOrders["byArticle"] = {};
  for (const r of rows.slice(headerAt + 1)) {
    if (text(r[figCol]) !== ORDER_FIGURE) continue;
    const article = text(r[idCol]);
    if (!article) continue;
    const orders: Record<string, number> = {};
    for (const { i, month } of monthCols) {
      const v = r[i];
      if (v === null || v === undefined || text(v) === "") continue;
      const n = Number(v);
      if (Number.isFinite(n)) orders[month] = Math.max(0, Math.round(n));
    }
    byArticle[article] = { name: descCol >= 0 ? text(r[descCol]) : article, orders };
  }
  return { months: monthCols.map((c) => c.month).sort(), byArticle };
}

/**
 * What loading the export changes: the order per SKU per ship month, from
 * `fromMonth` on, where the file has a value. Articles map through a SKU's
 * current number or its superseded ones.
 */
export function ibpChanges(
  parsed: IbpOrders,
  skus: IbpSku[],
  current: Record<string, Record<string, number>>, // skuId -> ship month -> qty
  fromMonth: string
): { changes: IbpChange[]; unmatched: string[] } {
  const byArticle = new Map<string, IbpSku>();
  for (const s of skus) {
    byArticle.set(s.article, s);
    for (const alt of (s.altArticles ?? "").split(",").map((x) => x.trim()).filter(Boolean)) byArticle.set(alt, s);
  }
  const changes: IbpChange[] = [];
  const unmatched: string[] = [];
  for (const [article, { name, orders }] of Object.entries(parsed.byArticle)) {
    const sku = byArticle.get(article);
    if (!sku) {
      if (Object.values(orders).some((q) => q > 0)) unmatched.push(`${article} ${name}`);
      continue;
    }
    for (const [month, to] of Object.entries(orders)) {
      if (month < fromMonth) continue;
      const from = current[sku.id]?.[month] ?? 0;
      if (from !== to) changes.push({ skuId: sku.id, name: sku.name, shipMonth: month, from, to });
    }
  }
  changes.sort((a, b) => a.shipMonth.localeCompare(b.shipMonth) || a.name.localeCompare(b.name));
  return { changes, unmatched };
}

/** Changes as two bulk writes — clear every touched line, then create the non-zero ones — so a
 *  year of orders stays one short transaction. */
export function ibpWrites(changes: IbpChange[]) {
  return {
    clear: changes.map((c) => ({ skuId: c.skuId, shipMonth: c.shipMonth })),
    create: changes.filter((c) => c.to > 0).map((c) => ({ skuId: c.skuId, shipMonth: c.shipMonth, qty: c.to })),
  };
}
