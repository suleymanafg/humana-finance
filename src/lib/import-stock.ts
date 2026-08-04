// Inventory import from 1C: per-warehouse stock snapshots.
// Row schema: { warehouse, productName, qty, month? }
// - warehouse: matched against Warehouse.name or Warehouse.code1c
// - month: "2025-08" (defaults to the latest month whose start ≤ today — i.e. the current month)
// Snapshot semantics: matched rows REPLACE the qty for (month, product, warehouse);
// products of a warehouse that are absent from the payload are zeroed for that month
// when `fullSnapshot` is true (default) so stale rows don't linger.
import { prisma } from "./db";

export interface StockRow {
  warehouse: string;
  productName: string;
  qty: number | string;
  month?: string;
  productCode?: string; // 1C code — matched first, name is the fallback
}

export interface MatchedStockRow {
  monthId: string;
  productId: string;
  warehouseId: string;
  productName: string;
  warehouseName: string;
  qty: number;
}

export interface RejectedStockRow {
  row: StockRow;
  reason: string;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/ё/g, "е");

export async function matchStockRows(
  rows: StockRow[],
  defaultMonthId?: string
): Promise<{ matched: MatchedStockRow[]; rejected: RejectedStockRow[] }> {
  const [products, warehouses, months] = await Promise.all([
    prisma.product.findMany({ where: { active: true } }),
    prisma.warehouse.findMany({ where: { active: true } }),
    prisma.month.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  const productByName = new Map<string, string>();
  for (const p of products) {
    productByName.set(norm(p.nameRu), p.id);
    if (p.nameEn) productByName.set(norm(p.nameEn), p.id);
    if (p.code1c) productByName.set(norm(p.code1c), p.id);
  }
  const warehouseByKey = new Map<string, string>();
  for (const w of warehouses) {
    warehouseByKey.set(norm(w.name), w.id);
    if (w.code1c) warehouseByKey.set(norm(w.code1c), w.id);
  }
  const monthIds = new Set(months.map((m) => m.id));
  const today = new Date().toISOString().slice(0, 7);
  const fallbackMonth =
    defaultMonthId ?? months.filter((m) => m.id <= today).at(-1)?.id ?? months[0]?.id ?? "";

  const agg = new Map<string, MatchedStockRow>();
  const rejected: RejectedStockRow[] = [];
  for (const row of rows) {
    const monthId = row.month ? (monthIds.has(row.month) ? row.month : null) : fallbackMonth;
    const productId =
      (row.productCode ? productByName.get(norm(String(row.productCode))) : undefined) ??
      productByName.get(norm(String(row.productName ?? "")));
    const warehouseId = warehouseByKey.get(norm(String(row.warehouse ?? "")));
    const qty =
      typeof row.qty === "number" ? row.qty : Number(String(row.qty).replace(/\s/g, "").replace(",", "."));
    const problems: string[] = [];
    if (!monthId) problems.push(`unknown month "${row.month}"`);
    if (!productId) problems.push(`unknown product "${row.productName}"`);
    if (!warehouseId) problems.push(`unknown warehouse "${row.warehouse}"`);
    if (!Number.isFinite(qty)) problems.push(`invalid qty "${row.qty}"`);
    if (problems.length > 0) {
      rejected.push({ row, reason: problems.join("; ") });
      continue;
    }
    const key = `${monthId}|${productId}|${warehouseId}`;
    const existing = agg.get(key);
    if (existing) existing.qty += qty;
    else
      agg.set(key, {
        monthId: monthId!,
        productId: productId!,
        warehouseId: warehouseId!,
        productName: String(row.productName),
        warehouseName: String(row.warehouse),
        qty,
      });
  }
  return { matched: [...agg.values()], rejected };
}

export async function commitStockRows(
  matched: MatchedStockRow[],
  username: string,
  fullSnapshot = true
) {
  for (const r of matched) {
    await prisma.stockCount.upsert({
      where: {
        monthId_productId_warehouseId: {
          monthId: r.monthId,
          productId: r.productId,
          warehouseId: r.warehouseId,
        },
      },
      create: { monthId: r.monthId, productId: r.productId, warehouseId: r.warehouseId, qty: r.qty },
      update: { qty: r.qty },
    });
  }
  if (fullSnapshot && matched.length > 0) {
    // zero out products missing from the snapshot for each (month, warehouse) present
    const groups = new Map<string, Set<string>>();
    for (const r of matched) {
      const key = `${r.monthId}|${r.warehouseId}`;
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key)!.add(r.productId);
    }
    for (const [key, productIds] of groups) {
      const [monthId, warehouseId] = key.split("|");
      await prisma.stockCount.updateMany({
        where: { monthId, warehouseId, productId: { notIn: [...productIds] } },
        data: { qty: 0 },
      });
    }
  }
  await prisma.auditLog.create({
    data: {
      entity: "stockCount",
      entityId: "bulk",
      action: "IMPORT",
      data: JSON.stringify({ rows: matched.length, fullSnapshot }),
      username,
    },
  });
}
