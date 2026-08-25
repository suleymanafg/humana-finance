import "dotenv/config";
// Imports the "Uzbekistan_GAP Jan-Jul-2026" file: the owner's ruling is that
// for 2026-01..2026-07 Partner Order = Partner Forecast (orders were placed
// exactly per forecast; Apr–Jul had no orders), and deliveries are already
// covered by the Shipments module (trucks match DMK's Delivery Hist. YTD at a
// one-month arrival lag — validated 2026-08-24).
//
// Writes, scoped STRICTLY to 2026-01..2026-07:
//   PlanningForecast <- Partner Forecast Input Qty. (file wins)
//   PlanningPurchase <- the same values (order = forecast); rows in the range
//                       that the rule does not produce are DELETED — e.g. the
//                       May/Jul dispatch-month rows from the IBP export, which
//                       are deliveries, not orders.
//
// Usage: npx tsx prisma/import-gap-history.ts "<file.xlsx>" [--commit]
import * as XLSX from "xlsx";
import { newPrismaClient } from "../src/lib/prisma-factory";

const SHEET = "FC & shipments Jan-Jul-26";
const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];
const FIRST_MONTH_COL = 7; // "Jan-26"

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error('Usage: npx tsx prisma/import-gap-history.ts "<file.xlsx>" [--commit]');
    process.exit(1);
  }

  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[SHEET];
  if (!ws) {
    console.error(`Sheet "${SHEET}" not found; sheets: ${wb.SheetNames.join(", ")}`);
    process.exit(1);
  }
  const rows: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // per article: forecast by month (70929 rows merge into 71292 via altArticles)
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
      forecasts: { where: { monthKey: { in: MONTHS } } },
      purchases: { where: { shipMonth: { in: MONTHS } } },
    },
  });
  const skuByArticle = new Map<string, (typeof skus)[number]>();
  for (const s of skus) {
    skuByArticle.set(s.article, s);
    for (const alt of (s.altArticles ?? "").split(",").map((x) => x.trim()).filter(Boolean))
      skuByArticle.set(alt, s);
  }

  // merge duplicate-article rows (70929 + 71292 -> one SKU)
  const fcBySku = new Map<string, Record<string, number>>();
  for (const [article, fc] of fcByArticle) {
    const sku = skuByArticle.get(article);
    if (!sku) {
      if (Object.values(fc).some((v) => v > 0)) console.log(`  note: UNMATCHED article ${article}`);
      continue;
    }
    const agg = fcBySku.get(sku.id) ?? {};
    for (const [m, v] of Object.entries(fc)) agg[m] = (agg[m] ?? 0) + v;
    fcBySku.set(sku.id, agg);
  }

  let fcUp = 0, fcNew = 0, poUp = 0, poNew = 0, poDel = 0;
  for (const sku of skus) {
    const fc = fcBySku.get(sku.id);
    if (!fc) continue;

    // forecasts: file wins for the covered months
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

    // orders = forecast; anything else in the range goes
    const poExisting = new Map(sku.purchases.map((p) => [p.shipMonth, p]));
    for (const m of MONTHS) {
      const qty = fc[m] ?? 0;
      const ex = poExisting.get(m);
      if (ex && qty > 0) {
        if (ex.qty !== qty) {
          poUp++;
          console.log(`  order    ${sku.name} ${m}: ${ex.qty} -> ${qty}`);
          if (commit) await prisma.planningPurchase.update({ where: { id: ex.id }, data: { qty } });
        }
      } else if (ex && qty === 0) {
        poDel++;
        console.log(`  order    ${sku.name} ${m}: ${ex.qty} -> (deleted; dispatch month, not an order)`);
        if (commit) await prisma.planningPurchase.delete({ where: { id: ex.id } });
      } else if (!ex && qty > 0) {
        poNew++;
        console.log(`  order    ${sku.name} ${m}: (none) -> ${qty}`);
        if (commit) await prisma.planningPurchase.create({ data: { skuId: sku.id, shipMonth: m, qty } });
      }
    }
  }

  console.log(
    `\nforecast: ${fcUp} updated, ${fcNew} new · orders: ${poUp} updated, ${poNew} new, ${poDel} deleted`
  );
  console.log(commit ? "\nCommitted." : "\nDry run — pass --commit to write.");
  process.exit(0);
}
main();
