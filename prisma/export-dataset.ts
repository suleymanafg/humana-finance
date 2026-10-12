import "dotenv/config";
// Writes everything the app's engine reads, plus the app's own monthly results,
// to one JSON file, so a copy of the books can be built outside the app from
// exactly what the app holds, and checked against what the app shows.
//
//   npx tsx prisma/export-dataset.ts "<file.json>"
//
// Reads the database in .env (DATABASE_URL, the new version's) and changes
// nothing in it. The file holds real figures, so it must be saved outside this
// folder (it would otherwise end up in the public repository).
import { writeFileSync } from "node:fs";
import { relative, resolve, isAbsolute } from "node:path";
import { prisma } from "../src/lib/db";
import { buildDataset } from "../src/lib/dataset";
import { compute } from "../src/lib/engine/compute";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: npx tsx prisma/export-dataset.ts "<file.json>"   (e.g. "$HOME\\Downloads\\humana-app-data.json")');
    process.exitCode = 1;
    return;
  }
  const target = resolve(file);
  const inside = relative(process.cwd(), target);
  if (!inside.startsWith("..") && !isAbsolute(inside)) {
    console.error("✗ Save the file outside this folder, e.g. in Downloads: it holds real figures and this folder is a public repository.");
    process.exitCode = 1;
    return;
  }

  const dataset = await buildDataset(prisma);
  delete dataset.clientMaps; // client names: not needed for the books
  const c = compute(dataset);
  const results = {
    monthIds: c.monthIds,
    ti: c.ti,
    fargo: c.fargo,
    group: c.group,
    settlement: c.settlement,
    balance: c.balance,
    stock: c.stock,
    fifo: c.fifo,
    shipments: c.shipments,
    invoices: c.invoices,
    writeOffs: c.writeOffs,
    fargoWriteOffs: c.fargoWriteOffs,
    priorOwnerVatOpening: c.priorOwnerVatOpening,
  };
  writeFileSync(target, JSON.stringify({ exportedAt: new Date().toISOString(), dataset, results }));

  const units = (m: string) => dataset.sales.filter((s) => s.monthId === m).reduce((a, s) => a + s.qty, 0);
  const counted = [...new Set(dataset.stockCounts.filter((s) => s.qty !== 0).map((s) => s.monthId))].sort();
  const closed = dataset.months.filter((m) => m.closedAt).map((m) => m.id);
  const salesMonths = [...new Set(dataset.sales.map((s) => s.monthId))].sort();
  console.log(`✓ Saved ${target}`);
  console.log(`  months with sales: ${salesMonths[0]} – ${salesMonths.at(-1)}; last three: ${salesMonths.slice(-3).map((m) => `${m} ${units(m).toLocaleString("en-US")}`).join(", ")}`);
  console.log(`  closed months: ${closed.length ? `${closed[0]} – ${closed.at(-1)}` : "none"}; counts: ${counted.join(", ") || "none"}`);
  console.log(`  ${dataset.invoices.length} invoice lines, ${dataset.shipments.length} trucks, ${dataset.fargoWriteOffs.length} Fargo write-off rows`);
  console.log("Upload this file in the chat. Nothing in the database was changed.");
}

main()
  .catch((e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
