import "dotenv/config";
// Imports OPEX (both companies) and marketing from
// "Humana P&L - 2026 - Working Copy.xlsx" (tabs OPEX — Turbo Impex,
// OPEX — Fargo, Marketing & Promo).
//
//   npx tsx prisma/import-opex.ts            # dry run: report + validation
//   npx tsx prisma/import-opex.ts --commit   # replace OPEX and marketing
//
// Scope is OPEX and marketing only — sales, shipments, taxes and balance inputs
// are untouched. Category → P&L group comes from the workbook's own "P&L Group"
// column, so the app's grouping matches the workbook by construction.
import { newPrismaClient } from "../src/lib/prisma-factory";
import { parseMarketing, parseOpexFargo, parseOpexTi } from "./parse-opex";

const prisma = newPrismaClient();

const COMMIT = process.argv.includes("--commit");

const WB_TOTALS = {
  tiBank: 357_711_798,
  tiCash: 4_323_082_200,
  fargo: 2_376_145_000,
  mktFargo: 190_217_582,
  mktTi: 156_108_996.64,
};

async function main() {
  const ti = parseOpexTi();
  const fg = parseOpexFargo();
  const mk = parseMarketing();

  // blank spacer rows carry no category and no amount
  const tiRows = ti.rows.filter((r) => r.category !== "");
  const fgRows = fg.rows.filter((r) => r.category !== "");
  const mkRows = mk.rows.filter((r) => r.category !== "");

  const problems: string[] = [];
  for (const r of [...tiRows, ...fgRows]) {
    if (!r.groupKey) problems.push(`"${r.category}" → workbook group "${r.groupLabel}" is not a known P&L group`);
  }
  if (problems.length > 0) throw new Error(`unmapped groups:\n  ${[...new Set(problems)].join("\n  ")}`);

  const months = await prisma.month.findMany();
  const monthIds = new Set(months.map((m) => m.id));
  const badMonths = [...new Set([...tiRows, ...fgRows, ...mkRows].map((r) => r.monthId))].filter(
    (m) => !monthIds.has(m)
  );
  if (badMonths.length > 0) throw new Error(`months not in the app: ${badMonths.join(", ")}`);

  const tiBank = tiRows.reduce((a, r) => a + r.bank, 0);
  const tiCash = tiRows.reduce((a, r) => a + r.cash, 0);
  const fgTotal = fgRows.reduce((a, r) => a + r.amount, 0);
  const mktFargo = mkRows.filter((r) => r.paidBy === "FARGO").reduce((a, r) => a + r.amount, 0);
  const mktTi = mkRows.filter((r) => r.paidBy === "TI").reduce((a, r) => a + r.amount, 0);

  const check = (label: string, actual: number, expected: number) => {
    const ok = Math.abs(actual - expected) < 0.01;
    console.log(`  ${label.padEnd(24)} ${String(actual).padStart(16)} | wb ${String(expected).padStart(16)} | ${ok ? "OK" : `MISMATCH ${actual - expected}`}`);
    return ok;
  };

  console.log("── validation against workbook totals ──");
  const allOk = [
    check("OPEX TI bank", tiBank, WB_TOTALS.tiBank),
    check("OPEX TI cash", tiCash, WB_TOTALS.tiCash),
    check("OPEX Fargo", fgTotal, WB_TOTALS.fargo),
    check("Marketing (Fargo)", mktFargo, WB_TOTALS.mktFargo),
    check("Marketing (TI)", mktTi, WB_TOTALS.mktTi),
  ].every(Boolean);
  if (!allOk) throw new Error("totals do not tie to the workbook — not importing");

  // entries worth storing (zero rows are structural placeholders in the sheet)
  const tiEntries = tiRows.filter((r) => r.bank !== 0 || r.cash !== 0);
  const fgEntries = fgRows.filter((r) => r.amount !== 0);
  const mkEntries = mkRows.filter((r) => r.amount !== 0);

  const tiCats = [...new Map(tiRows.map((r) => [r.category, r.groupKey!])).entries()];
  const fgCats = [...new Map(fgRows.map((r) => [r.category, r.groupKey!])).entries()];
  const mkCats = [...new Set(mkRows.map((r) => r.category))];

  console.log("\n── to import ──");
  console.log(`OPEX TI:    ${tiEntries.length} entries (${tiRows.length - tiEntries.length} zero rows skipped), ${tiCats.length} categories`);
  console.log(`OPEX Fargo: ${fgEntries.length} entries (${fgRows.length - fgEntries.length} zero rows skipped), ${fgCats.length} categories`);
  console.log(`Marketing:  ${mkEntries.length} entries, ${mkCats.length} categories`);
  const allMonths = [...new Set([...tiEntries, ...fgEntries, ...mkEntries].map((r) => r.monthId))].sort();
  console.log(`months: ${allMonths[0]} → ${allMonths.at(-1)}`);

  if (!COMMIT) {
    console.log("\nDRY RUN — re-run with --commit to write to the database.");
    return;
  }

  console.log("\n── replacing OPEX and marketing ──");
  await prisma.opexTiEntry.deleteMany();
  await prisma.opexFargoEntry.deleteMany();
  await prisma.marketingEntry.deleteMany();
  // categories are rebuilt from the workbook so the grouping matches it exactly
  await prisma.opexCategory.deleteMany();
  await prisma.marketingCategory.deleteMany();

  const tiCatId = new Map<string, string>();
  for (const [i, [name, group]] of tiCats.entries()) {
    const c = await prisma.opexCategory.create({
      data: { company: "TI", name, plGroup: group, sortOrder: i },
    });
    tiCatId.set(name, c.id);
  }
  const fgCatId = new Map<string, string>();
  for (const [i, [name, group]] of fgCats.entries()) {
    const c = await prisma.opexCategory.create({
      data: { company: "FARGO", name, plGroup: group, sortOrder: i },
    });
    fgCatId.set(name, c.id);
  }
  const mkCatId = new Map<string, string>();
  for (const name of mkCats) {
    const c = await prisma.marketingCategory.create({ data: { name } });
    mkCatId.set(name, c.id);
  }

  for (const r of tiEntries) {
    await prisma.opexTiEntry.create({
      data: {
        monthId: r.monthId,
        categoryId: tiCatId.get(r.category)!,
        bankAmount: r.bank,
        cashAmount: r.cash,
        notes: r.notes || null,
      },
    });
  }
  for (const r of fgEntries) {
    await prisma.opexFargoEntry.create({
      data: {
        monthId: r.monthId,
        categoryId: fgCatId.get(r.category)!,
        amount: r.amount,
        notes: r.notes || null,
      },
    });
  }
  for (const r of mkEntries) {
    await prisma.marketingEntry.create({
      data: {
        monthId: r.monthId,
        categoryId: mkCatId.get(r.category)!,
        amount: r.amount,
        paidBy: r.paidBy,
        notes: r.notes || null,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      entity: "opex",
      entityId: "bulk",
      action: "IMPORT",
      data: JSON.stringify({
        source: "Humana P&L - 2026 - Working Copy.xlsx",
        opexTi: tiEntries.length,
        opexFargo: fgEntries.length,
        marketing: mkEntries.length,
      }),
      username: "import-script",
    },
  });

  // ── verify what landed ──
  const [dbTi, dbFg, dbMk] = await Promise.all([
    prisma.opexTiEntry.findMany({ where: { deletedAt: null } }),
    prisma.opexFargoEntry.findMany({ where: { deletedAt: null } }),
    prisma.marketingEntry.findMany({ where: { deletedAt: null } }),
  ]);
  console.log("\n── verification ──");
  check("db OPEX TI bank", dbTi.reduce((a, r) => a + r.bankAmount, 0), WB_TOTALS.tiBank);
  check("db OPEX TI cash", dbTi.reduce((a, r) => a + r.cashAmount, 0), WB_TOTALS.tiCash);
  check("db OPEX Fargo", dbFg.reduce((a, r) => a + r.amount, 0), WB_TOTALS.fargo);
  check(
    "db Marketing (Fargo)",
    dbMk.filter((r) => r.paidBy === "FARGO").reduce((a, r) => a + r.amount, 0),
    WB_TOTALS.mktFargo
  );
  check(
    "db Marketing (TI)",
    dbMk.filter((r) => r.paidBy === "TI").reduce((a, r) => a + r.amount, 0),
    WB_TOTALS.mktTi
  );
  console.log(`rows: TI ${dbTi.length} | Fargo ${dbFg.length} | Marketing ${dbMk.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
