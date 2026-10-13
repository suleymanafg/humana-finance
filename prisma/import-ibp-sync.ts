import "dotenv/config";
// Loads the ORDERS from DMK's IBP export ("Partner Forecast Input" SAPUI5
// sheet): "Partner Forecast Input Qty." per SKU per ship month becomes
// PlanningPurchase, from a ship month on (default: next month). DMK's Order
// History, Contract Volumes and Open Orders are not read — DMK cannot correct
// them, so what was collected and what is still due comes from the app's
// trucks. The same rule as the upload on «Заказы IBP».
//
// Usage: npx tsx prisma/import-ibp-sync.ts "<file.xlsx>" [--from YYYY-MM] [--commit]
import * as XLSX from "xlsx";
import { newPrismaClient } from "../src/lib/prisma-factory";
import { ibpChanges, ibpWrites, parseIbpExport, type Cell } from "../src/lib/planning/ibp-export";

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const fromAt = args.indexOf("--from");
  const file = args.find((a, i) => !a.startsWith("--") && i !== fromAt + 1);
  if (!file) {
    console.error('Usage: npx tsx prisma/import-ibp-sync.ts "<file.xlsx>" [--from YYYY-MM] [--commit]');
    process.exit(1);
  }
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tashkent" }));
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const from = fromAt >= 0 ? args[fromAt + 1] : `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(from ?? "")) {
    console.error("--from must be YYYY-MM");
    process.exit(1);
  }

  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  const parsed = parseIbpExport(rows);
  if ("error" in parsed) {
    console.error(parsed.error);
    process.exit(1);
  }

  const prisma = newPrismaClient();
  const [skus, purchases] = await Promise.all([
    prisma.planningSku.findMany({ select: { id: true, article: true, altArticles: true, name: true } }),
    prisma.planningPurchase.findMany({ select: { skuId: true, shipMonth: true, qty: true } }),
  ]);
  const current: Record<string, Record<string, number>> = {};
  for (const p of purchases) (current[p.skuId] ??= {})[p.shipMonth] = p.qty;
  const { changes, unmatched } = ibpChanges(parsed, skus, current, from);

  console.log(`IBP export: months ${parsed.months[0]} … ${parsed.months.at(-1)} · orders loaded from ship month ${from}`);
  const byMonth = new Map<string, { from: number; to: number }>();
  for (const c of changes) {
    console.log(`  ${c.shipMonth} ${c.name}: ${c.from} -> ${c.to}`);
    const t = byMonth.get(c.shipMonth) ?? { from: 0, to: 0 };
    byMonth.set(c.shipMonth, { from: t.from + c.from, to: t.to + c.to });
  }
  for (const [m, t] of byMonth) console.log(`  = ${m}: changed lines ${t.from} -> ${t.to}`);
  for (const u of unmatched) console.log(`  note: not in the SKU list, skipped: ${u}`);
  console.log(`\n${changes.length} change(s).`);

  if (commit && changes.length > 0) {
    const w = ibpWrites(changes);
    await prisma.$transaction([
      prisma.planningPurchase.deleteMany({ where: { OR: w.clear } }),
      prisma.planningPurchase.createMany({ data: w.create }),
    ]);
  }
  if (commit) {
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    await prisma.setting.upsert({
      where: { key: "planning.ibpSyncedAt" },
      create: { key: "planning.ibpSyncedAt", value: today },
      update: { value: today },
    });
  }
  console.log(commit ? "Committed." : "Dry run — pass --commit to write.");
  process.exit(0);
}
main();
