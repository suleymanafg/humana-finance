import "dotenv/config";
// Seeds the medical-cohort planning data:
//   1. PlanningRecruitment from the foil-tracking workbook (verified Rx/month)
//   2. PlanningPurchase from the previously imported PlanningContract lines
//      (contract qty per ship month becomes the committed purchase; contracts
//      are then CLOSED — the purchase grid is the source of truth from here)
//
//   npx tsx prisma/seed-planning-v2.ts "<foil.xlsx>" [--commit]
import * as XLSX from "xlsx";
import { newPrismaClient } from "../src/lib/prisma-factory";

const COMMIT = process.argv.includes("--commit");
const FOIL = process.argv.slice(2).find((a) => a !== "--commit");
if (!FOIL) {
  console.error('usage: npx tsx prisma/seed-planning-v2.ts "<foil.xlsx>" [--commit]');
  process.exit(1);
}
const prisma = newPrismaClient();

function readRecruitment(path: string): Map<string, number> {
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets["Foil Tracking"];
  if (!ws) throw new Error('sheet "Foil Tracking" not found');
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  const MONTHS: Record<string, number> = {
    "январь": 1, "февраль": 2, "март": 3, "апрель": 4, "май": 5, "июнь": 6,
    "июль": 7, "август": 8, "сентябрь": 9, "октябрь": 10, "ноябрь": 11, "декабрь": 12,
  };
  const byMonth = new Map<string, number>();
  for (const row of rows.slice(1)) {
    const qty = Number(row[8]);
    if (!Number.isFinite(qty) || qty === 0) continue;
    let key: string | null = null;
    const d = row[0];
    if (typeof d === "number" && d > 40000) {
      const date = new Date(Date.UTC(1899, 11, 30) + d * 86400000);
      key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    } else {
      const m = String(d ?? "").match(/(\d{1,2})[.,/](\d{1,2})[.,/](\d{4})/);
      if (m) key = `${m[3]}-${m[2].padStart(2, "0")}`;
    }
    if (!key) {
      const mn = MONTHS[String(row[10] ?? "").trim().toLowerCase()];
      if (mn) key = `${mn >= 11 ? 2025 : 2026}-${String(mn).padStart(2, "0")}`;
    }
    if (!key) continue;
    byMonth.set(key, (byMonth.get(key) ?? 0) + qty);
  }
  return byMonth;
}

async function main() {
  console.log(COMMIT ? "=== COMMIT ===" : "=== DRY RUN (add --commit to write) ===");

  const recruitment = readRecruitment(FOIL!);
  console.log("\nVerified prescriptions per month:");
  for (const [k, v] of [...recruitment.entries()].sort()) console.log(`  ${k}  ${Math.round(v)}`);

  const contracts = await prisma.planningContract.findMany({ include: { lines: true } });
  // committed purchase per (sku, shipMonth) = sum of contract qty
  const purchases = new Map<string, number>();
  for (const c of contracts) {
    for (const l of c.lines) {
      const key = `${l.skuId}|${c.shipMonth}`;
      purchases.set(key, (purchases.get(key) ?? 0) + l.qty);
    }
  }
  const skus = await prisma.planningSku.findMany();
  const nameOf = (id: string) => skus.find((s) => s.id === id)?.name.slice(0, 30) ?? id;
  console.log(`\nCommitted purchases from ${contracts.length} contracts:`);
  for (const [key, qty] of [...purchases.entries()].sort((a, b) => a[0].split("|")[1].localeCompare(b[0].split("|")[1]))) {
    const [skuId, shipMonth] = key.split("|");
    console.log(`  ship ${shipMonth}  ${nameOf(skuId).padEnd(30)} ${Math.round(qty).toLocaleString("en-US")}`);
  }

  if (!COMMIT) {
    console.log("\nDry run — nothing written.");
    process.exit(0);
  }

  for (const [k, v] of recruitment) {
    await prisma.planningRecruitment.upsert({
      where: { monthKey: k },
      create: { monthKey: k, babies: v },
      update: { babies: v },
    });
  }
  for (const [key, qty] of purchases) {
    const [skuId, shipMonth] = key.split("|");
    await prisma.planningPurchase.upsert({
      where: { skuId_shipMonth: { skuId, shipMonth } },
      create: { skuId, shipMonth, qty },
      update: { qty },
    });
  }
  await prisma.planningContract.updateMany({ data: { status: "CLOSED" } });
  console.log("\nDone — recruitment + purchases written, contracts closed.");
  process.exit(0);
}
main();
