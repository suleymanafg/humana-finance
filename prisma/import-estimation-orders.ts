import "dotenv/config";
// Imports the "Uzbekistan_estimation Aug-Dec-2026" file: the owner's ruling —
// the two owner files (GAP Jan-Jul + this one) are what the app shows, NOT
// the IBP download (which may carry cancelled products/orders). For
// 2026-08..2026-12 both Partner Order AND Partner Forecast = this file's
// Partner Forecast Input Qty. Rows in the range that the file zeroes are
// deleted/zeroed. 2027 forecasts (outside the file's range) are untouched.
//
// Usage: npx tsx prisma/import-estimation-orders.ts "<file.xlsx>" [--commit]
import * as XLSX from "xlsx";
import { newPrismaClient } from "../src/lib/prisma-factory";

const SHEET = "FC Aug-Dec-26";
const MONTHS = ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];
const FIRST_MONTH_COL = 6; // "Aug-26"

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error('Usage: npx tsx prisma/import-estimation-orders.ts "<file.xlsx>" [--commit]');
    process.exit(1);
  }

  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[SHEET];
  if (!ws) {
    console.error(`Sheet "${SHEET}" not found; sheets: ${wb.SheetNames.join(", ")}`);
    process.exit(1);
  }
  const rows: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const fcByArticle = new Map<string, Record<string, number>>();
  for (const r of rows.slice(1)) {
    const article = String(r[2] ?? "").trim();
    const fig = String(r[4] ?? "").trim();
    if (!article || fig !== "Partner Forecast Input Qty.") continue;
    const fc = fcByArticle.get(article) ?? {};
    MONTHS.forEach((m, i) => {
      const v = r[FIRST_MONTH_COL + i];
      if (v !== null && v !== undefined && v !== "") fc[m] = (fc[m] ?? 0) + Math.round(Number(v));
    });
    fcByArticle.set(article, fc);
  }

  const prisma = newPrismaClient();
  const skus = await prisma.planningSku.findMany({
    include: {
      purchases: { where: { shipMonth: { in: MONTHS } } },
      forecasts: { where: { monthKey: { in: MONTHS } } },
    },
  });
  const skuByArticle = new Map<string, (typeof skus)[number]>();
  for (const s of skus) {
    skuByArticle.set(s.article, s);
    for (const alt of (s.altArticles ?? "").split(",").map((x) => x.trim()).filter(Boolean))
      skuByArticle.set(alt, s);
  }

  const bySku = new Map<string, Record<string, number>>();
  for (const [article, fc] of fcByArticle) {
    const sku = skuByArticle.get(article);
    if (!sku) {
      if (Object.values(fc).some((v) => v > 0)) console.log(`  note: UNMATCHED article ${article}`);
      continue;
    }
    const agg = bySku.get(sku.id) ?? {};
    for (const [m, v] of Object.entries(fc)) agg[m] = (agg[m] ?? 0) + v;
    bySku.set(sku.id, agg);
  }

  let up = 0, add = 0, del = 0, fcUp = 0, fcNew = 0;
  for (const sku of skus) {
    const fc = bySku.get(sku.id);
    if (!fc) continue;

    // forecasts: the file wins inside its range (0 only overwrites)
    const fcExisting = new Map(sku.forecasts.map((f) => [f.monthKey, f]));
    for (const m of MONTHS) {
      const qty = fc[m] ?? 0;
      const ex = fcExisting.get(m);
      if (ex) {
        if (ex.qty !== qty) {
          fcUp++;
          console.log(`  forecast ${sku.name} ${m}: ${ex.qty} -> ${qty}`);
          if (commit) await prisma.planningForecast.update({ where: { id: ex.id }, data: { qty } });
        }
      } else if (qty > 0) {
        fcNew++;
        console.log(`  forecast ${sku.name} ${m}: (none) -> ${qty}`);
        if (commit) await prisma.planningForecast.create({ data: { skuId: sku.id, monthKey: m, qty } });
      }
    }

    const existing = new Map(sku.purchases.map((p) => [p.shipMonth, p]));
    for (const m of MONTHS) {
      const qty = fc[m] ?? 0;
      const ex = existing.get(m);
      if (ex && qty > 0) {
        if (ex.qty !== qty) {
          up++;
          console.log(`  order ${sku.name} ${m}: ${ex.qty} -> ${qty}`);
          if (commit) await prisma.planningPurchase.update({ where: { id: ex.id }, data: { qty } });
        }
      } else if (ex && qty === 0) {
        del++;
        console.log(`  order ${sku.name} ${m}: ${ex.qty} -> (deleted; no order in the estimation file)`);
        if (commit) await prisma.planningPurchase.delete({ where: { id: ex.id } });
      } else if (!ex && qty > 0) {
        add++;
        console.log(`  order ${sku.name} ${m}: (none) -> ${qty}`);
        if (commit) await prisma.planningPurchase.create({ data: { skuId: sku.id, shipMonth: m, qty } });
      }
    }
  }

  console.log(`\nforecast: ${fcUp} updated, ${fcNew} new · orders: ${up} updated, ${add} new, ${del} deleted`);
  console.log(commit ? "\nCommitted." : "\nDry run — pass --commit to write.");
  process.exit(0);
}
main();
