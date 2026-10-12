import "dotenv/config";
// Imports Fargo's 1C report «Ведомость по товарам на складах» (month-end
// balances by warehouse and month) as the app's month-end stock counts: one
// count per month, all warehouses added together into «Основной склад».
//
//   npx tsx prisma/import-stock-ledger.ts "<file.xlsx>" --from 2026-01 [--to 2026-09] [--commit]
//
// --to defaults to the last month the report covers in full. «АКЦИЯ» lines
// count towards their regular product, as everywhere in the app; lines for
// goods the app doesn't carry are listed and skipped. Dry run by default: shows
// each month next to the count already in the app. --commit replaces the
// counts of those months.
//
// Targets the database in .env (DATABASE_URL — the new version's).
import * as XLSX from "xlsx";
import { prisma } from "../src/lib/db";
import { productKey } from "../src/lib/didox-invoice";
import { monthEnd, parseStockLedger } from "../src/lib/stock-ledger";

const WAREHOUSE = "Основной склад";
const USAGE = 'usage: npx tsx prisma/import-stock-ledger.ts "<file.xlsx>" --from YYYY-MM [--to YYYY-MM] [--commit]';

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const commit = args.includes("--commit");
const from = option("--from");
const toFlag = option("--to");
const file = args.find((a) => !a.startsWith("--") && a !== from && a !== toFlag);

const plain = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const short = (nameRu: string) =>
  nameRu.replace(/^Humana /, "").replace(/\s+(MP|FS|DS|BIB)(?=\s)/, "").replace(/\s*гр.*$/, "");
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const signed = (n: number) => (Math.round(n) > 0 ? "+" : "") + fmt(n);

async function main() {
  if (!file || !from || !/^\d{4}-\d{2}$/.test(from) || (toFlag && !/^\d{4}-\d{2}$/.test(toFlag))) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const wb = XLSX.readFile(file);
  const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  const ledger = parseStockLedger(rows);

  const complete = ledger.months.filter((m) => !ledger.periodEnd || monthEnd(m) <= ledger.periodEnd);
  const to = toFlag ?? complete.at(-1);
  const range = ledger.months.filter((m) => m >= from && to !== undefined && m <= to);
  const partial = range.filter((m) => !complete.includes(m));
  if (range.length === 0) {
    console.error(`✗ The report has no month from ${from}${to ? ` to ${to}` : ""} (it has ${ledger.months[0]} – ${ledger.months.at(-1)}).`);
    process.exitCode = 1;
    return;
  }
  if (partial.length) {
    console.error(`✗ The report runs to ${ledger.periodEnd}, so ${partial.join(", ")} is not complete. Leave it out with --to.`);
    process.exitCode = 1;
    return;
  }

  const [all, months, existing, warehouse] = await Promise.all([
    prisma.product.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.month.findMany({ where: { id: { in: range } } }),
    prisma.stockCount.findMany({ where: { monthId: { in: range } } }),
    prisma.warehouse.findFirst({ where: { name: WAREHOUSE } }),
  ]);
  const missing = range.filter((m) => !months.some((x) => x.id === m));
  if (missing.length || !warehouse) {
    console.error(`✗ Not in the database: ${[...missing.map((m) => `month ${m}`), ...(warehouse ? [] : [`warehouse «${WAREHOUSE}»`])].join(", ")}.`);
    process.exitCode = 1;
    return;
  }
  const regular = all.filter((p) => p.active && !p.isPromo);
  const regularOf = new Map(all.map((p) => [p.id, p.isPromo && p.regularProductId ? p.regularProductId : p.id]));
  const productFor = (name: string) => {
    const base = name.replace(/^\s*\(\s*акция\s*\)\s*/iu, "");
    const same = regular.filter((p) => plain(p.nameRu) === plain(base) || (p.nameEn && plain(p.nameEn) === plain(base)));
    if (same.length === 1) return same[0];
    const key = productKey(base);
    const byKey = key ? regular.filter((p) => productKey(p.nameRu) === key) : [];
    return byKey.length === 1 ? byKey[0] : null;
  };

  // month → product → units (АКЦИЯ folded into the regular product)
  const counts = new Map(range.map((m) => [m, new Map<string, number>()]));
  const skipped: string[] = [];
  const used = new Set<string>();
  for (const item of ledger.items) {
    const p = productFor(item.name);
    if (!p) {
      const last = item.byMonth[range[range.length - 1]];
      if (range.some((m) => item.byMonth[m] !== 0)) skipped.push(`${item.name} (${fmt(last)} at ${range[range.length - 1]})`);
      continue;
    }
    used.add(item.name);
    for (const m of range) counts.get(m)!.set(p.id, (counts.get(m)!.get(p.id) ?? 0) + item.byMonth[m]);
  }
  const nowIn = (m: string, productId?: string) =>
    existing.filter((c) => c.monthId === m && (!productId || regularOf.get(c.productId) === productId)).reduce((s, c) => s + c.qty, 0);
  const total = (m: string) => [...counts.get(m)!.values()].reduce((s, q) => s + q, 0);

  const W = 10;
  const line = (label: string, cells: string[]) => console.log(label.padEnd(22) + cells.map((c) => c.padStart(W)).join(""));
  console.log(`\nFargo 1C «Ведомость по товарам на складах»${ledger.periodEnd ? `, to ${ledger.periodEnd}` : ""}`);
  console.log(`Warehouses ${ledger.warehouses.join(", ")} → «${WAREHOUSE}»\n`);
  line("Month-end stock", range);
  for (const p of regular) line(short(p.nameRu), range.map((m) => fmt(counts.get(m)!.get(p.id) ?? 0)));
  line("Total", range.map((m) => fmt(total(m))));
  line("In the app now", range.map((m) => (existing.some((c) => c.monthId === m && c.qty !== 0) ? fmt(nowIn(m)) : "–")));
  line("Change", range.map((m) => signed(total(m) - nowIn(m))));

  const changed = range
    .filter((m) => existing.some((c) => c.monthId === m && c.qty !== 0))
    .map((m) => {
      const diffs = regular
        .map((p) => ({ p, d: (counts.get(m)!.get(p.id) ?? 0) - nowIn(m, p.id) }))
        .filter(({ d }) => Math.abs(d) > 1e-9)
        .map(({ p, d }) => `${short(p.nameRu)} ${signed(d)}`);
      return diffs.length ? `${m}: ${diffs.join(", ")}` : null;
    })
    .filter(Boolean);
  if (changed.length) console.log(`\nChanges to counts already in the app:\n  ${changed.join("\n  ")}`);
  if (skipped.length) console.log(`\nSkipped, not products in the app:\n  ${skipped.join("\n  ")}`);
  const closed = months.filter((m) => m.closedAt).map((m) => m.id).sort();
  if (closed.length) console.log(`\n⚠ Closed: ${closed.join(", ")}. Their figures change.`);

  const bad = ledger.mismatches.filter((s) => [...used].some((n) => s.startsWith(`${n} @`)));
  if (bad.length) {
    console.error(`\n✗ The report's «Итог» columns disagree with its months, so it can't be read safely:\n  ${bad.join("\n  ")}`);
    process.exitCode = 1;
    return;
  }
  if (!commit) {
    console.log("\nDry run: nothing written. Add --commit to replace the counts of these months.");
    return;
  }

  const data = range.flatMap((m) =>
    regular.map((p) => ({ monthId: m, productId: p.id, warehouseId: warehouse.id, qty: counts.get(m)!.get(p.id) ?? 0 }))
  );
  await prisma.$transaction([
    // promo rows and any other warehouse's rows are inside the new figures
    prisma.stockCount.deleteMany({ where: { monthId: { in: range } } }),
    prisma.stockCount.createMany({ data }),
    prisma.auditLog.create({
      data: {
        entity: "stockCount",
        entityId: "bulk",
        action: "IMPORT",
        data: JSON.stringify({ source: "1c-ledger", file, months: range, totals: Object.fromEntries(range.map((m) => [m, total(m)])) }),
        username: "script",
      },
    }),
  ]);
  console.log(`\n✓ Counts replaced for ${range[0]} – ${range[range.length - 1]}. Refresh Товар → Остатки in the app.`);
}

main()
  .catch((e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
