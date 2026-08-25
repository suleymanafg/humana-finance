import "dotenv/config";
// Imports a 1C «Стоимостная оценка склада» xlsx (остатки) as a stock snapshot.
// Reads the Итог column per SKU (per-warehouse detail is aggregated — the app
// keeps one physical count in «Основной склад»), matches by 1C code / name via
// the same logic as the /api/import/1c-stock endpoint, and snapshots into the
// month taken from the report's «Период: на конец дня DD.MM.YYYY» line.
//
// Usage: npx tsx prisma/import-stock-xlsx.ts "<file.xlsx>" [--month 2026-08] [--commit]
// Dry-run by default: prints matched/rejected rows and totals, writes nothing.
import * as XLSX from "xlsx";
import { matchStockRows, commitStockRows, type StockRow } from "../src/lib/import-stock";

const WAREHOUSE = "Основной склад";

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const monthFlag = args.includes("--month") ? args[args.indexOf("--month") + 1] : null;
  const file = args.find((a) => !a.startsWith("--") && a !== monthFlag);
  if (!file) fail('Usage: npx tsx prisma/import-stock-xlsx.ts "<file.xlsx>" [--month 2026-08] [--commit]');

  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // month: --month flag wins, else the «Период: на конец дня DD.MM.YYYY» line
  let month = monthFlag;
  let asOf: string | null = null;
  for (const r of rows.slice(0, 8)) {
    const m = String(r[0] ?? "").match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (m) {
      asOf = `${m[3]}-${m[2]}-${m[1]}`;
      month ??= `${m[3]}-${m[2]}`;
      break;
    }
  }
  if (!month || !/^\d{4}-\d{2}$/.test(month)) fail("Could not determine the month — pass --month YYYY-MM");

  // header row: starts with «Код, Артикул»; data until the trailing «Итог» row
  const headerIdx = rows.findIndex((r) => String(r[0] ?? "").trim().startsWith("Код"));
  if (headerIdx < 0) fail('Header row ("Код, Артикул") not found — is this the usual 1C stock report?');
  const totalCol = rows[headerIdx].length - 1; // «Итог»

  const stockRows: StockRow[] = [];
  const skipped: string[] = [];
  for (const r of rows.slice(headerIdx + 3)) {
    const codeCell = String(r[0] ?? "").trim();
    const name = String(r[1] ?? "").trim();
    if (codeCell === "Итог" || codeCell === "") continue;
    const code = codeCell.split(",")[0].trim();
    const qty = Number(r[totalCol] ?? 0);
    if (!name || name === "HUMANA") {
      // hierarchy group line — its Итог double-counts the SKUs beneath it
      continue;
    }
    if (!Number.isFinite(qty)) {
      skipped.push(`${code} ${name}: bad qty "${r[totalCol]}"`);
      continue;
    }
    stockRows.push({ warehouse: WAREHOUSE, productName: name, productCode: code, qty, month });
  }

  const { matched, rejected } = await matchStockRows(stockRows);
  console.log(`Snapshot ${asOf ?? "?"} -> month ${month}, warehouse «${WAREHOUSE}»`);
  console.log(`\nMatched ${matched.length}:`);
  for (const m of matched.sort((a, b) => b.qty - a.qty))
    console.log(`  ${String(m.qty).padStart(7)}  ${m.productName}`);
  console.log(`  ${String(matched.reduce((s, m) => s + m.qty, 0)).padStart(7)}  TOTAL`);
  if (rejected.length > 0) {
    console.log(`\nRejected ${rejected.length} (NOT imported):`);
    for (const r of rejected) console.log(`  ${r.row.productCode} ${r.row.productName} (${r.row.qty}): ${r.reason}`);
  }
  for (const s of skipped) console.log(`  skipped: ${s}`);

  if (!commit) {
    console.log("\nDry run — pass --commit to write (full snapshot: absent SKUs are zeroed for this month).");
  } else {
    await commitStockRows(matched, "xlsx-import", true);
    console.log(`\nCommitted ${matched.length} rows to month ${month}.`);
  }
  process.exit(0);
}
main();
