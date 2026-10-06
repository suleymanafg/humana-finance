import "dotenv/config";
// Pull a month's sales from Fargo's 1C on THIS computer and save them in the
// app's database. For when the app's own server cannot reach 1C: db.mobi-c.uz
// answers only connections from Uzbekistan, and the app runs abroad (Vercel).
// Same rules as «Синхронизация 1С» in the app: it shows what would change,
// then replaces the month's sales after you type "yes".
//
//   npx tsx prisma/sync-1c.ts 2026-09
//   npx tsx prisma/sync-1c.ts 2026-09 --file "C:\Users\...\sales.json"   # a page saved from the browser
//
// Targets the database in .env (DATABASE_URL — the new version's). The 1C
// login and password are asked for when it runs; the password is not shown,
// stored or logged.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { prisma } from "../src/lib/db";
import {
  buildSync,
  commitSync,
  fetch1cSales,
  itemsFromFile,
  monthRange,
  parse1cFile,
  SyncError,
} from "../src/lib/sync-1c";

const args = process.argv.slice(2);
const monthId = args.find((a) => /^\d{4}-\d{2}$/.test(a));
const fileIdx = args.indexOf("--file");
const filePath = fileIdx >= 0 ? args[fileIdx + 1] : undefined;

// one reader for every question; lines typed (or piped) ahead of a question wait for it
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();
const echo = rl as unknown as { _writeToOutput: (s: string) => void };
const write = echo._writeToOutput.bind(rl);
let muted = false;
echo._writeToOutput = (s: string) => {
  if (!muted) write(s);
};

/** A typed password (hidden) is not echoed. */
async function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  muted = hidden;
  const { value, done } = await lines.next();
  muted = false;
  if (hidden) process.stdout.write("\n");
  return done ? "" : String(value).trim();
}

const n = (v: number) => Math.round(v).toLocaleString("en-US");

async function main() {
  if (!monthId || (fileIdx >= 0 && !filePath)) {
    console.error('usage: npx tsx prisma/sync-1c.ts <YYYY-MM> [--file "<saved page>"]   e.g. 2026-09');
    process.exitCode = 1;
    return;
  }
  const month = await prisma.month.findUnique({ where: { id: monthId } });
  if (!month) {
    console.error(`There is no month ${monthId} in the database.`);
    process.exitCode = 1;
    return;
  }
  const { dateFrom, dateTo } = monthRange(monthId);

  let items;
  if (filePath) {
    items = itemsFromFile(parse1cFile(readFileSync(filePath, "utf8")));
    if (!items) {
      console.error("✗ The file does not look like a 1C response (no list of sales in it).");
      process.exitCode = 1;
      return;
    }
  } else {
    const login = await ask("1C login: ");
    const password = await ask("1C password (typing is hidden): ", true);
    console.log(`\nAsking 1C for ${dateFrom} … ${dateTo} …`);
    items = (await fetch1cSales(dateFrom, dateTo, login, password)).items;
  }

  const { report, matched, learned, clientDetail } = await buildSync(monthId, items, true);
  const totalCur = report.products.reduce((s, p) => s + p.qtyCur, 0);
  const totalNew = report.products.reduce((s, p) => s + p.qtyNew, 0);

  console.log(
    `\n1C documents: ${n(report.fetched.sales)} sales · ${n(report.fetched.returns)} returns` +
      (report.fetched.outsidePeriod ? ` · ${n(report.fetched.outsidePeriod)} rows outside ${monthId} skipped` : "")
  );
  console.log(`Units in ${monthId}: now ${n(totalCur)} → from 1C ${n(totalNew)}\n`);
  console.log(`  ${"Product".padEnd(42)} ${"now".padStart(8)} ${"1C".padStart(8)}`);
  for (const p of report.products)
    console.log(`  ${p.name.padEnd(42)} ${n(p.qtyCur).padStart(8)} ${n(p.qtyNew).padStart(8)}`);
  console.log(`\n  ${"Channel".padEnd(42)} ${"1C".padStart(8)}`);
  for (const c of report.channels) console.log(`  ${c.name.padEnd(42)} ${n(c.qty).padStart(8)}`);
  if (report.unknownSkus.length) {
    console.log("\n⚠ Products 1C sent that the app does not know (left out):");
    for (const u of report.unknownSkus) console.log(`  ${u.code} ${u.name}: ${n(u.qty)}`);
  }
  if (report.fallbackClients.length)
    console.log(`\n${report.fallbackClients.length} clients went to «Прочие»; reassign them in the app if needed.`);
  if (report.current.withAmount > 0)
    console.log(
      `\n⚠ ${monthId} now holds ${report.current.withAmount} rows from Excel with exact amounts; 1C figures are valued at the Settings prices instead.`
    );
  if (month.closedAt) console.log(`\n⚠ ${monthId} is closed.`);

  const ok = await ask(`\nType "yes" to replace the sales of ${monthId} with these 1C figures: `);
  if (ok.toLowerCase() !== "yes") {
    console.log("Nothing changed.");
    return;
  }
  const committed = await commitSync(
    monthId,
    matched,
    learned,
    {
      dateFrom,
      dateTo,
      fetched: report.fetched,
      totalQty: totalNew,
      replacedRows: report.current.rows,
      replacedWithAmount: report.current.withAmount,
      unknownSkus: report.unknownSkus,
      fallbackClients: report.fallbackClients.length,
      learnedCodes: report.learnedCodes,
      via: filePath ? "prisma/sync-1c.ts --file" : "prisma/sync-1c.ts",
    },
    "1C script",
    clientDetail
  );
  console.log(`✓ ${monthId}: ${n(committed.inserted)} sales rows saved (${n(committed.deleted)} replaced). Refresh the app.`);
}

main()
  .catch((e) => {
    console.error("✗", e instanceof SyncError || e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
    return prisma.$disconnect();
  });
