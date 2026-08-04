// Shared matching logic for CSV upload and the 1C adapter.
// Input row schema (documented for 1C):
//   { month, productName, channelName, qty, productCode?, channelCode? }
// - month: "2025-08" or a month name (RU/EN, e.g. "Август 2025")
// - productCode / channelCode: 1C codes (Settings → "Код в 1С") — matched FIRST;
//   codes are stable across renames, so prefer sending them
// - productName / channelName: fallback match (trimmed, case-insensitive);
//   a code passed in the name field also matches
// Rows that don't match are rejected with a reason — never silently dropped.
import { prisma } from "./db";

export interface ImportRow {
  month: string;
  productName: string;
  channelName: string;
  qty: number | string;
  productCode?: string;
  channelCode?: string;
}

export interface MatchedRow {
  monthId: string;
  productId: string;
  channelId: string;
  productName: string;
  channelName: string;
  qty: number;
}

export interface RejectedRow {
  row: ImportRow;
  reason: string;
}

export interface ImportResult {
  matched: MatchedRow[];
  rejected: RejectedRow[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/ё/g, "е");

export async function matchRows(rows: ImportRow[]): Promise<ImportResult> {
  // only active products are matchable, so SKUs outside the approved range are
  // rejected with a reason rather than silently entering the calculations
  const [products, channels, months] = await Promise.all([
    prisma.product.findMany({ where: { active: true } }),
    prisma.channel.findMany({ where: { active: true } }),
    prisma.month.findMany(),
  ]);
  const productByName = new Map<string, string>();
  for (const p of products) {
    productByName.set(norm(p.nameRu), p.id);
    if (p.nameEn) productByName.set(norm(p.nameEn), p.id);
    if (p.code1c) productByName.set(norm(p.code1c), p.id);
  }
  const channelByName = new Map<string, string>();
  for (const c of channels) {
    channelByName.set(norm(c.name), c.id);
    if (c.code1c) channelByName.set(norm(c.code1c), c.id);
  }
  const monthByKey = new Map<string, string>();
  for (const m of months) {
    monthByKey.set(norm(m.id), m.id);
    monthByKey.set(norm(m.nameRu), m.id);
    monthByKey.set(norm(m.nameEn), m.id);
  }

  // dedupe by (month, product, channel): quantities for the same key are summed
  const agg = new Map<string, MatchedRow>();
  const rejected: RejectedRow[] = [];
  for (const row of rows) {
    const monthId = monthByKey.get(norm(String(row.month ?? "")));
    // code match wins; name is the fallback
    const productId =
      (row.productCode ? productByName.get(norm(String(row.productCode))) : undefined) ??
      productByName.get(norm(String(row.productName ?? "")));
    const channelId =
      (row.channelCode ? channelByName.get(norm(String(row.channelCode))) : undefined) ??
      channelByName.get(norm(String(row.channelName ?? "")));
    const qty = typeof row.qty === "number" ? row.qty : Number(String(row.qty).replace(/\s/g, "").replace(",", "."));
    const problems: string[] = [];
    if (!monthId) problems.push(`unknown month "${row.month}"`);
    if (!productId)
      problems.push(
        `unknown product "${row.productCode ? `${row.productCode} / ` : ""}${row.productName}"`
      );
    if (!channelId)
      problems.push(
        `unknown channel "${row.channelCode ? `${row.channelCode} / ` : ""}${row.channelName}"`
      );
    if (!Number.isFinite(qty)) problems.push(`invalid qty "${row.qty}"`);
    if (problems.length > 0) {
      rejected.push({ row, reason: problems.join("; ") });
      continue;
    }
    const key = `${monthId}|${productId}|${channelId}`;
    const existing = agg.get(key);
    if (existing) existing.qty += qty;
    else
      agg.set(key, {
        monthId: monthId!,
        productId: productId!,
        channelId: channelId!,
        productName: String(row.productName),
        channelName: String(row.channelName),
        qty,
      });
  }
  return { matched: [...agg.values()], rejected };
}

export async function commitRows(matched: MatchedRow[], source: "CSV" | "API", username: string) {
  for (const r of matched) {
    if (r.qty === 0) {
      await prisma.sale.deleteMany({
        where: { monthId: r.monthId, productId: r.productId, channelId: r.channelId },
      });
    } else {
      await prisma.sale.upsert({
        where: {
          monthId_productId_channelId: {
            monthId: r.monthId,
            productId: r.productId,
            channelId: r.channelId,
          },
        },
        create: { monthId: r.monthId, productId: r.productId, channelId: r.channelId, qty: r.qty, source },
        update: { qty: r.qty, source },
      });
    }
  }
  await prisma.auditLog.create({
    data: {
      entity: "sale",
      entityId: "bulk",
      action: "IMPORT",
      data: JSON.stringify({ source, rows: matched.length }),
      username,
    },
  });
}
