import "dotenv/config";
// Syncs the app with DMK's own IBP state from the "Partner Forecast Input"
// SAPUI5 export. Per SKU it carries four key figures by month:
//   Order History   — orders DMK fulfilled (shipped), by ship month
//   Contract Volumes — contracted future shipments, by ship month
//   Open Orders     — committed but NOT delivered (our backlog; we could not
//                     pick everything up on time) — snapshot, not month-bound
//   Partner Forecast Input Qty. — the forecast entered into IBP
//
// Sync rules (the export is the authority for what it contains):
//   PlanningForecast  <- forecast values (upsert; a 0 only overwrites an
//                        existing row, it never creates one)
//   PlanningPurchase  <- Order History + Contract Volumes per ship month
//                        (upsert only months the file mentions; app-only
//                        future plans are left alone and reported).
//                        Open Orders deliberately do NOT land in purchases:
//                        DMK parks overdue quantities in the current month's
//                        bucket, which is not that month's own order. The
//                        overdue lives in PlanningSku.openOrderQty only.
//   PlanningSku.openOrderQty <- sum of the SKU's Open Orders row
//
// Usage: npx tsx prisma/import-ibp-sync.ts "<file.xlsx>" [--commit]
import * as XLSX from "xlsx";
import { newPrismaClient } from "../src/lib/prisma-factory";

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function monthKeyOf(header: string): string | null {
  const m = header.match(/^([A-Z][a-z]{2})-(\d{2})$/);
  return m && MONTHS[m[1]] ? `20${m[2]}-${MONTHS[m[1]]}` : null;
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error('Usage: npx tsx prisma/import-ibp-sync.ts "<file.xlsx>" [--commit]');
    process.exit(1);
  }

  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const header = rows[0].map(String);
  const monthCols: Array<{ col: number; key: string }> = [];
  header.forEach((h, i) => {
    const key = monthKeyOf(h);
    if (key) monthCols.push({ col: i, key });
  });

  // group the four key-figure rows per Product ID
  type Fig = Record<string, number>; // monthKey -> qty
  const byArticle = new Map<string, { name: string; figures: Record<string, Fig> }>();
  for (const r of rows.slice(1)) {
    const article = String(r[2] ?? "").trim();
    const fig = String(r[4] ?? "").trim();
    if (!article || !fig) continue;
    const entry = byArticle.get(article) ?? { name: String(r[3] ?? ""), figures: {} };
    const values: Fig = {};
    for (const { col, key } of monthCols) {
      const v = r[col];
      if (v !== null && v !== undefined && v !== "") values[key] = Math.round(Number(v));
    }
    entry.figures[fig] = values;
    byArticle.set(article, entry);
  }

  const prisma = newPrismaClient();
  const skus = await prisma.planningSku.findMany({
    include: { forecasts: true, purchases: true },
  });
  const skuByArticle = new Map<string, (typeof skus)[number]>();
  for (const s of skus) {
    skuByArticle.set(s.article, s);
    for (const alt of (s.altArticles ?? "").split(",").map((x) => x.trim()).filter(Boolean))
      skuByArticle.set(alt, s);
  }

  let fcUp = 0, fcNew = 0, poUp = 0, poNew = 0, ooUp = 0;
  const notes: string[] = [];

  for (const [article, { name, figures }] of byArticle) {
    const sku = skuByArticle.get(article);
    const forecast = figures["Partner Forecast Input Qty."] ?? {};
    const history = figures["Order History"] ?? {};
    const contracts = figures["Contract Volumes"] ?? {};
    const open = figures["Open Orders"] ?? {};
    const hasAny =
      Object.keys(forecast).length + Object.keys(history).length + Object.keys(contracts).length + Object.keys(open).length > 0;
    if (!sku) {
      if (hasAny) notes.push(`UNMATCHED article ${article} "${name}" — has data, no PlanningSku`);
      continue;
    }

    // ── forecasts ──
    const fcByMonth = new Map(sku.forecasts.map((f) => [f.monthKey, f]));
    for (const [m, qty] of Object.entries(forecast)) {
      const existing = fcByMonth.get(m);
      if (existing) {
        if (existing.qty !== qty) {
          fcUp++;
          console.log(`  forecast ${sku.name} ${m}: ${existing.qty} -> ${qty}`);
          if (commit)
            await prisma.planningForecast.update({ where: { id: existing.id }, data: { qty } });
        }
      } else if (qty > 0) {
        fcNew++;
        console.log(`  forecast ${sku.name} ${m}: (none) -> ${qty}`);
        if (commit) await prisma.planningForecast.create({ data: { skuId: sku.id, monthKey: m, qty } });
      }
    }

    // ── purchases: Order History + Contract Volumes per ship month ──
    const target: Record<string, number> = {};
    for (const [m, q] of Object.entries(history)) target[m] = (target[m] ?? 0) + q;
    for (const [m, q] of Object.entries(contracts)) target[m] = (target[m] ?? 0) + q;
    const poByMonth = new Map(sku.purchases.map((p) => [p.shipMonth, p]));
    for (const [m, qty] of Object.entries(target)) {
      const existing = poByMonth.get(m);
      if (existing) {
        if (existing.qty !== qty) {
          poUp++;
          console.log(`  order    ${sku.name} ship ${m}: ${existing.qty} -> ${qty}`);
          if (commit) await prisma.planningPurchase.update({ where: { id: existing.id }, data: { qty } });
        }
      } else if (qty > 0) {
        poNew++;
        console.log(`  order    ${sku.name} ship ${m}: (none) -> ${qty}`);
        if (commit) await prisma.planningPurchase.create({ data: { skuId: sku.id, shipMonth: m, qty } });
      }
    }
    for (const p of sku.purchases) {
      if (p.qty > 0 && !(p.shipMonth in target))
        notes.push(`app-only order kept: ${sku.name} ship ${p.shipMonth} = ${p.qty} (not in the export)`);
    }

    // ── open orders (backlog snapshot) ──
    const openTotal = Object.values(open).reduce((s, q) => s + q, 0);
    if (sku.openOrderQty !== openTotal) {
      ooUp++;
      console.log(`  backlog  ${sku.name}: ${sku.openOrderQty} -> ${openTotal}`);
      if (commit)
        await prisma.planningSku.update({ where: { id: sku.id }, data: { openOrderQty: openTotal } });
    }
  }

  if (commit) {
    await prisma.setting.upsert({
      where: { key: "planning.ibpSyncedAt" },
      create: { key: "planning.ibpSyncedAt", value: new Date().toISOString().slice(0, 10) },
      update: { value: new Date().toISOString().slice(0, 10) },
    });
  }

  console.log(`\nforecast: ${fcUp} updated, ${fcNew} new · orders: ${poUp} updated, ${poNew} new · backlog: ${ooUp} changed`);
  for (const n of notes) console.log(`  note: ${n}`);
  console.log(commit ? "\nCommitted." : "\nDry run — pass --commit to write.");
  process.exit(0);
}
main();
