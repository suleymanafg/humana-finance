import "dotenv/config";
// Add a Fargo write-off document (expired or damaged goods) by quantity in one
// go — the same rows as Товар → Списания in the app.
//
//   npx tsx prisma/fargo-writeoffs.ts 2026-08-29 "Platin 2 400=120" "HN Expert 300=5" --note "Fargo write-off 29.08.2026"
//
// Each "<product>=<qty>" names a product as the app shows it: Platin 1 400,
// Platin 2 800, HN Expert 300, SL Expert 500, AC Expert 350, AR Expert 350.
// --reason EXPIRED (default, «Просрочка») | DAMAGED | OTHER. It shows the rows,
// then saves them after "yes". A row already there (same date, product and
// quantity) is skipped, so running the same command twice adds nothing.
//
// Targets the database in .env (DATABASE_URL — the new version's).
import { createInterface } from "node:readline";
import { prisma } from "../src/lib/db";
import { productKey } from "../src/lib/didox-invoice";

const REASONS = ["EXPIRED", "DAMAGED", "OTHER"];

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const note = option("--note");
const reason = (option("--reason") ?? "EXPIRED").toUpperCase();
const optionValues = new Set([note, option("--reason")]);
const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const pairs = args.filter((a) => a.includes("=") && !a.startsWith("--") && !optionValues.has(a));

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();
async function ask(question: string): Promise<string> {
  process.stdout.write(question);
  const { value, done } = await lines.next();
  return done ? "" : String(value).trim();
}

/** «Platin 2 400» → the key the app's product names share; a bare weight reads as grams. */
const keyOf = (name: string) => productKey(name.replace(/(\d{3,4})\s*$/, "$1g"));

async function main() {
  if (!date || pairs.length === 0 || !REASONS.includes(reason)) {
    console.error('usage: npx tsx prisma/fargo-writeoffs.ts <YYYY-MM-DD> "<product>=<qty>" ... [--note "<text>"] [--reason EXPIRED|DAMAGED|OTHER]');
    process.exitCode = 1;
    return;
  }
  const month = await prisma.month.findUnique({ where: { id: date.slice(0, 7) } });
  if (!month) {
    console.error(`There is no month ${date.slice(0, 7)} in the database.`);
    process.exitCode = 1;
    return;
  }
  const products = (await prisma.product.findMany({ where: { isPromo: false } })).map((p) => ({
    id: p.id,
    name: p.nameRu,
    key: productKey(p.nameRu),
  }));

  const rows: Array<{ productId: string; name: string; qty: number }> = [];
  const problems: string[] = [];
  for (const pair of pairs) {
    const [rawName, rawQty] = pair.split("=");
    const qty = Number(String(rawQty).replace(/[\s,]/g, ""));
    const key = keyOf(rawName.trim());
    const found = key ? products.filter((p) => p.key === key) : [];
    if (!(qty > 0)) problems.push(`"${pair}": the quantity must be a number above zero`);
    else if (found.length !== 1) problems.push(`"${pair}": no single product matches "${rawName.trim()}"`);
    else rows.push({ productId: found[0].id, name: found[0].name, qty });
  }
  if (problems.length) {
    console.error("✗ Nothing saved:\n  " + problems.join("\n  "));
    console.error("Products: " + products.map((p) => p.name.replace(/^Humana /, "").replace(/\s+(MP|FS|DS|BIB)(?=\s)/, "").replace(/\s*гр.*$/, "")).join(", "));
    process.exitCode = 1;
    return;
  }

  const day = new Date(date);
  const existing = await prisma.fargoWriteOff.findMany({ where: { date: day, deletedAt: null } });
  const isThere = (r: { productId: string; qty: number }) =>
    existing.some((e) => e.productId === r.productId && Math.abs(e.qty - r.qty) < 1e-9);
  const fresh = rows.filter((r) => !isThere(r));

  console.log(`\nFargo write-off of ${date} · reason ${reason}${note ? ` · note "${note}"` : ""}`);
  for (const r of rows)
    console.log(`  ${r.name.padEnd(42)} ${r.qty.toLocaleString("en-US").padStart(8)}${isThere(r) ? "   (already entered, skipped)" : ""}`);
  console.log(`  ${"Total".padEnd(42)} ${rows.reduce((s, r) => s + r.qty, 0).toLocaleString("en-US").padStart(8)}`);
  if (month.closedAt) console.log(`\n⚠ ${month.id} is closed.`);
  if (fresh.length === 0) {
    console.log("\nEvery row is already there. Nothing to add.");
    return;
  }

  const ok = await ask(`\nType "yes" to add ${fresh.length} write-off row${fresh.length === 1 ? "" : "s"}: `);
  if (ok.toLowerCase() !== "yes") {
    console.log("Nothing changed.");
    return;
  }
  await prisma.$transaction(async (tx) => {
    for (const r of fresh) {
      const data = { date: day, productId: r.productId, qty: r.qty, reason, notes: note ?? null };
      const created = await tx.fargoWriteOff.create({ data });
      await tx.auditLog.create({
        data: { entity: "fargoWriteOff", entityId: created.id, action: "CREATE", data: JSON.stringify(data), username: "script" },
      });
    }
  });
  console.log(`✓ ${fresh.length} row${fresh.length === 1 ? "" : "s"} added. Refresh Товар → Списания in the app.`);
}

main()
  .catch((e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
    return prisma.$disconnect();
  });
