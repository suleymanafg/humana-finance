import "dotenv/config";
// Imports COGS from "Humana P&L - 2026 - Working Copy.xlsx" — the COGS tab
// (shipment detail) and the Import Expenses tab (expense detail).
//
//   npx tsx prisma/import-cogs.ts            # dry run: report + validation only
//   npx tsx prisma/import-cogs.ts --commit   # replace shipments/expenses
//
// Scope is deliberately COGS only: sales, OPEX, marketing, taxes and balance
// inputs are untouched.
//
// The app does not store landed costs — it derives them, exactly as the
// workbook does: loadFactor = 1 + Σexpenses ÷ Σpurchase per shipment, then
// TI unit cost = price UZS × loadFactor, then a qty-weighted average per
// product. This script verifies the derivation reproduces the workbook's own
// "Avg Unit Cost (TI)" column before and after writing.
import { newPrismaClient } from "../src/lib/prisma-factory";
import {
  monthIdOfRu,
  parseImportExpenses,
  parseProductCosts,
  parseShipmentLines,
  stripUom,
} from "./parse-cogs";

const prisma = newPrismaClient();

const COMMIT = process.argv.includes("--commit");

// workbook category name -> seeded category name, where they differ
const CATEGORY_ALIASES: Record<string, string> = { "НДС": "НДС (импорт)" };

async function main() {
  const lines = parseShipmentLines();
  const expenses = parseImportExpenses();
  const wbCosts = parseProductCosts();

  // ── resolve months, products, categories ──
  const products = await prisma.product.findMany();
  const productByName = new Map(products.map((p) => [p.nameRu, p]));
  const months = await prisma.month.findMany();
  const monthIds = new Set(months.map((m) => m.id));

  const problems: string[] = [];
  for (const l of lines) {
    const monthId = monthIdOfRu(l.monthRu);
    if (!monthId || !monthIds.has(monthId)) problems.push(`line month "${l.monthRu}"`);
    if (!productByName.has(stripUom(l.productRu))) problems.push(`line product "${l.productRu}"`);
  }
  for (const e of expenses) {
    const monthId = monthIdOfRu(e.monthRu);
    if (!monthId || !monthIds.has(monthId)) problems.push(`expense month "${e.monthRu}"`);
  }
  if (problems.length > 0) {
    throw new Error(`unresolved references:\n  ${[...new Set(problems)].join("\n  ")}`);
  }

  // ── per-shipment aggregation + load factor (the workbook's own method) ──
  const shipmentCodes = [...new Set(lines.map((l) => l.shipment))];
  const purchaseByShipment = new Map<string, number>();
  const expenseByShipment = new Map<string, number>();
  for (const l of lines) {
    purchaseByShipment.set(l.shipment, (purchaseByShipment.get(l.shipment) ?? 0) + l.priceEur * l.rate * l.qty);
  }
  for (const e of expenses) {
    expenseByShipment.set(e.shipment, (expenseByShipment.get(e.shipment) ?? 0) + e.amount);
  }

  console.log("── shipments ──");
  for (const code of shipmentCodes) {
    const purchase = purchaseByShipment.get(code) ?? 0;
    const expense = expenseByShipment.get(code) ?? 0;
    const lf = purchase > 0 ? 1 + expense / purchase : 1;
    const monthRu = lines.find((l) => l.shipment === code)!.monthRu;
    console.log(
      `  ${code.padEnd(9)} | ${monthIdOfRu(monthRu)} | purchase ${String(Math.round(purchase)).padStart(13)} | expenses ${String(Math.round(expense)).padStart(12)} | ×${lf.toFixed(5)}`
    );
  }

  // ── verify derived unit costs against the workbook's summary column ──
  // promo SKUs share their regular product's cost, so compare on the regular
  const derived = new Map<string, { qty: number; tiSum: number; fargoQty: number; fargoSum: number }>();
  for (const l of lines) {
    const name = stripUom(l.productRu);
    const purchase = purchaseByShipment.get(l.shipment) ?? 0;
    const expense = expenseByShipment.get(l.shipment) ?? 0;
    const lf = purchase > 0 ? 1 + expense / purchase : 1;
    const tiUnit = l.priceEur * l.rate * lf;
    const e = derived.get(name) ?? { qty: 0, tiSum: 0, fargoQty: 0, fargoSum: 0 };
    e.qty += l.qty;
    e.tiSum += l.qty * tiUnit;
    if (l.costFargo) {
      e.fargoQty += l.qty;
      e.fargoSum += l.qty * l.costFargo;
    }
    derived.set(name, e);
  }

  console.log("\n── derived TI unit cost vs workbook ──");
  let worstDelta = 0;
  for (const wc of wbCosts) {
    const name = stripUom(wc.productRu);
    const d = derived.get(name);
    if (!d) continue; // promo rows repeat their regular product's figures
    const mine = d.tiSum / d.qty;
    const delta = mine - wc.avgCostTi;
    worstDelta = Math.max(worstDelta, Math.abs(delta));
    const flag = Math.abs(delta) < 1 ? "ok" : `Δ ${delta.toFixed(2)} ⚠`;
    console.log(
      `  ${Math.round(mine).toString().padStart(7)} vs ${Math.round(wc.avgCostTi).toString().padStart(7)} | ${flag.padEnd(16)} | ${name}`
    );
  }
  console.log(`worst deviation: ${worstDelta.toFixed(4)} UZS`);

  const missingFargo = lines.filter((l) => !l.costFargo);
  console.log(`\n── lines missing Fargo cost: ${missingFargo.length} of ${lines.length} ──`);
  for (const l of missingFargo) {
    console.log(`  ${l.monthRu} | ${l.shipment} | ${l.qty} × ${stripUom(l.productRu)}`);
  }

  console.log("\n── totals ──");
  console.log("shipments:", shipmentCodes.length, "| lines:", lines.length, "| expenses:", expenses.length);
  console.log("purchase value:", Math.round([...purchaseByShipment.values()].reduce((a, v) => a + v, 0)));
  console.log("import expenses:", [...expenseByShipment.values()].reduce((a, v) => a + v, 0));
  console.log("purchased qty:", lines.reduce((a, l) => a + l.qty, 0));

  if (!COMMIT) {
    console.log("\nDRY RUN — re-run with --commit to write to the database.");
    return;
  }

  // ── write ──
  console.log("\n── replacing shipments and import expenses ──");
  await prisma.importExpense.deleteMany();
  await prisma.shipmentLine.deleteMany();
  await prisma.shipment.deleteMany();

  // categories: match by name, then alias, then create
  const existingCats = await prisma.importExpenseCategory.findMany();
  const catByName = new Map(existingCats.map((c) => [c.name, c]));
  const catFor = async (workbookName: string) => {
    const target = CATEGORY_ALIASES[workbookName] ?? workbookName;
    const hit = catByName.get(target) ?? catByName.get(workbookName);
    if (hit) return hit;
    const created = await prisma.importExpenseCategory.create({ data: { name: workbookName } });
    catByName.set(workbookName, created);
    console.log(`  created expense category "${workbookName}"`);
    return created;
  };

  const shipmentIdByCode = new Map<string, string>();
  for (const code of shipmentCodes) {
    const monthRu = lines.find((l) => l.shipment === code)!.monthRu;
    const created = await prisma.shipment.create({
      data: { code, monthId: monthIdOfRu(monthRu)!, notes: "Импорт из рабочего P&L" },
    });
    shipmentIdByCode.set(code, created.id);
  }

  for (const l of lines) {
    await prisma.shipmentLine.create({
      data: {
        shipmentId: shipmentIdByCode.get(l.shipment)!,
        productId: productByName.get(stripUom(l.productRu))!.id,
        qty: l.qty,
        priceEur: l.priceEur,
        rate: l.rate,
        fargoUnitCost: l.costFargo || null,
      },
    });
  }

  for (const e of expenses) {
    const cat = await catFor(e.category);
    await prisma.importExpense.create({
      data: {
        monthId: monthIdOfRu(e.monthRu)!,
        shipmentId: shipmentIdByCode.get(e.shipment)!,
        categoryId: cat.id,
        amount: e.amount,
        notes: "Импорт из рабочего P&L",
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      entity: "shipment",
      entityId: "bulk",
      action: "IMPORT",
      data: JSON.stringify({
        source: "Humana P&L - 2026 - Working Copy.xlsx",
        shipments: shipmentCodes.length,
        lines: lines.length,
        expenses: expenses.length,
      }),
      username: "import-script",
    },
  });

  const counts = {
    shipments: await prisma.shipment.count(),
    lines: await prisma.shipmentLine.count(),
    expenses: await prisma.importExpense.count(),
  };
  console.log("\n── written ──", JSON.stringify(counts));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
