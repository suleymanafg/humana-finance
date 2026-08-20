import "dotenv/config";
// One-way refresh: copies EVERY table from the production Neon branch into
// the dev branch (the one in DATABASE_URL). Production is opened read-only
// by convention — this script only ever calls findMany on it.
//
//   npx tsx prisma/refresh-dev-from-prod.ts            # dry run (counts only)
//   npx tsx prisma/refresh-dev-from-prod.ts --commit   # wipe dev + copy
import { readFileSync } from "node:fs";
import { newPrismaClient } from "../src/lib/prisma-factory";

const COMMIT = process.argv.includes("--commit");

function productionUrl(): string {
  const env = readFileSync(".env", "utf8");
  const url = (env.match(/^#\s*DATABASE_URL_PRODUCTION=\s*"?([^"\n]+)/m) ?? [])[1]?.trim();
  if (!url) throw new Error("No `# DATABASE_URL_PRODUCTION=` line in .env.");
  return url;
}

const hostOf = (url: string) => new URL(url).host;

const SOURCE = productionUrl();
const TARGET = process.env.DATABASE_URL ?? "";
if (!TARGET.startsWith("postgres")) throw new Error("DATABASE_URL (target/dev) is not Postgres.");
if (hostOf(TARGET) === hostOf(SOURCE)) {
  throw new Error("Target host equals the production host — refusing: this would wipe production.");
}

// parents first — FK order matters; deletes run in reverse
const MODELS = [
  "product",
  "channel",
  "month",
  "opexCategory",
  "marketingCategory",
  "importExpenseCategory",
  "setting",
  "warehouse",
  "user",
  "contact",
  "clientChannelMap",
  "sale",
  "clientSale",
  "shipment",
  "shipmentLine",
  "importExpense",
  "opexTiEntry",
  "opexFargoEntry",
  "marketingEntry",
  "tiTaxFiling",
  "capitalContribution",
  "fargoTransfer",
  "stockCount",
  "monthBalance",
  "arEntry",
  "auditLog",
  "dataRequest",
  "dataRequestItem",
] as const;

type Delegate = {
  findMany: () => Promise<Record<string, unknown>[]>;
  deleteMany: () => Promise<unknown>;
  createMany: (a: { data: Record<string, unknown>[] }) => Promise<unknown>;
  count: () => Promise<number>;
};
const delegateOf = (client: unknown, model: string): Delegate =>
  (client as Record<string, Delegate>)[model];

async function main() {
  console.log(COMMIT ? "=== COMMIT ===" : "=== DRY RUN (add --commit to write) ===");
  console.log(`source (read-only): ${hostOf(SOURCE)}`);
  console.log(`target (wiped):     ${hostOf(TARGET)}\n`);

  const src = newPrismaClient(SOURCE);
  const dst = newPrismaClient(TARGET);

  // read everything from production first
  const data: Record<string, Record<string, unknown>[]> = {};
  let total = 0;
  for (const m of MODELS) {
    data[m] = await delegateOf(src, m).findMany();
    total += data[m].length;
    console.log(`  ${m.padEnd(24)} ${String(data[m].length).padStart(6)} rows`);
  }
  console.log(`  ${"TOTAL".padEnd(24)} ${String(total).padStart(6)} rows`);
  await src.$disconnect();

  if (!COMMIT) {
    console.log("\nDry run — nothing written.");
    await dst.$disconnect();
    return;
  }

  console.log("\nWiping dev (children first)…");
  for (const m of [...MODELS].reverse()) await delegateOf(dst, m).deleteMany();

  console.log("Writing (parents first)…");
  for (const m of MODELS) {
    const rows = data[m];
    for (let i = 0; i < rows.length; i += 500) {
      await delegateOf(dst, m).createMany({ data: rows.slice(i, i + 500) });
    }
  }

  console.log("\nVerifying row counts…");
  let bad = 0;
  for (const m of MODELS) {
    const count = await delegateOf(dst, m).count();
    const ok = count === data[m].length;
    if (!ok) bad++;
    console.log(`  ${ok ? "✓" : "✗"} ${m.padEnd(24)} ${count}/${data[m].length}`);
  }
  await dst.$disconnect();
  if (bad > 0) throw new Error(`${bad} table(s) mismatched`);
  console.log("\nDone — dev now mirrors production.");
}

main();
