import "dotenv/config";
// Copy ALL data from the production Neon branch into the dev branch, so
// localhost shows the same figures as the live app. Production is opened
// read-only (queries only); the dev branch is wiped and refilled.
//
//   npx tsx prisma/copy-prod-to-dev.ts            # dry run: counts both sides
//   npx tsx prisma/copy-prod-to-dev.ts --commit   # actually copy
//
// Source = the commented DATABASE_URL_PRODUCTION line in .env (aged-glade).
// Target = the active DATABASE_URL (bold-glitter). Hard-coded host checks
// make it impossible to run this the other way round.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newPrismaClient } from "../src/lib/prisma-factory";
import type { PrismaClient } from "../src/generated/prisma/client";

const PROD_HOST = "ep-aged-glade";
const DEV_HOST = "ep-bold-glitter";

function readEnvUrls(): { prod: string; dev: string } {
  const env = readFileSync(join(__dirname, "..", ".env"), "utf8");
  const prod = env.match(/^# DATABASE_URL_PRODUCTION=(.+)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
  const dev = env.match(/^DATABASE_URL="?([^"\r\n]+)"?/m)?.[1]?.trim();
  if (!prod || !prod.includes(PROD_HOST))
    throw new Error(`.env # DATABASE_URL_PRODUCTION line missing or not on ${PROD_HOST}`);
  if (!dev || !dev.includes(DEV_HOST))
    throw new Error(`.env DATABASE_URL missing or not on ${DEV_HOST} — refusing`);
  return { prod, dev };
}

// Parents before children; Product handles its promo→regular self-relation
// by inserting regular SKUs first. Deletion runs in reverse order.
const TABLES = [
  "month",
  "channel",
  "warehouse",
  "opexCategory",
  "marketingCategory",
  "importExpenseCategory",
  "setting",
  "user",
  "contact",
  "product",
  "shipment",
  "shipmentLine",
  "importExpense",
  "sale",
  "opexTiEntry",
  "opexFargoEntry",
  "marketingEntry",
  "tiTaxFiling",
  "capitalContribution",
  "fargoTransfer",
  "stockCount",
  "monthBalance",
  "arEntry",
  "dataRequest",
  "dataRequestItem",
  "auditLog",
] as const;

type Table = (typeof TABLES)[number];
// Loosened accessor: every delegate exposes findMany/createMany/deleteMany/count.
const d = (c: PrismaClient, t: Table) =>
  (c as unknown as Record<Table, {
    findMany: (a?: object) => Promise<Record<string, unknown>[]>;
    createMany: (a: { data: Record<string, unknown>[] }) => Promise<{ count: number }>;
    deleteMany: () => Promise<{ count: number }>;
    count: () => Promise<number>;
  }>)[t];

async function main() {
  const commit = process.argv.includes("--commit");
  const { prod, dev } = readEnvUrls();
  const src = newPrismaClient(prod);
  const dst = newPrismaClient(dev);

  console.log(`source (read-only): ${PROD_HOST}…  →  target (replaced): ${DEV_HOST}…`);
  console.log(commit ? "MODE: COMMIT" : "MODE: dry run (no writes)\n");

  const rows: Partial<Record<Table, Record<string, unknown>[]>> = {};
  for (const t of TABLES) {
    const data = await d(src, t).findMany();
    if (t === "product")
      data.sort((a, b) => Number(a.regularProductId != null) - Number(b.regularProductId != null));
    rows[t] = data;
    const dstCount = await d(dst, t).count();
    console.log(` ${t.padEnd(22)} prod=${String(data.length).padEnd(6)} dev=${dstCount}`);
  }

  if (!commit) {
    console.log("\nDry run only. Re-run with --commit to replace the dev branch data.");
    return;
  }

  console.log("\nDeleting dev-branch data (children first)…");
  for (const t of [...TABLES].reverse()) {
    const r = await d(dst, t).deleteMany();
    if (r.count) console.log(` cleared ${t} (${r.count})`);
  }

  console.log("Inserting production data (parents first)…");
  for (const t of TABLES) {
    const data = rows[t]!;
    if (!data.length) continue;
    // batches keep each INSERT below Neon's parameter limits
    for (let i = 0; i < data.length; i += 500)
      await d(dst, t).createMany({ data: data.slice(i, i + 500) });
    console.log(` ${t}: ${data.length}`);
  }

  console.log("\nVerifying…");
  let ok = true;
  for (const t of TABLES) {
    const want = rows[t]!.length;
    const got = await d(dst, t).count();
    if (want !== got) {
      ok = false;
      console.error(` MISMATCH ${t}: prod=${want} dev=${got}`);
    }
  }
  // one money control total, both sides straight from the databases
  const sum = async (c: PrismaClient) =>
    (await (c as PrismaClient).sale.aggregate({ _sum: { qty: true } }))._sum.qty ?? 0;
  const opexSum = async (c: PrismaClient) =>
    (await (c as PrismaClient).opexTiEntry.aggregate({ _sum: { bankAmount: true, cashAmount: true } }))._sum;
  const [sq, dq, so, doo] = [await sum(src), await sum(dst), await opexSum(src), await opexSum(dst)];
  console.log(` sale qty        prod=${sq} dev=${dq} ${sq === dq ? "✓" : "✗"}`);
  const sTot = (so.bankAmount ?? 0) + (so.cashAmount ?? 0);
  const dTot = (doo.bankAmount ?? 0) + (doo.cashAmount ?? 0);
  console.log(` TI opex total   prod=${sTot} dev=${dTot} ${sTot === dTot ? "✓" : "✗"}`);
  console.log(ok && sq === dq && sTot === dTot ? "\nDONE — dev now mirrors production." : "\nFAILED — see mismatches above.");
  if (!ok) process.exitCode = 1;
}

main();
