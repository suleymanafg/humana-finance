// The workbook was the trusted reference until 2026-08-03, when the owner made
// pinetrade 1C the source of truth for sales. The golden values are therefore
// re-baselined to the engine's current output so the check keeps doing its real
// job — catching future accidental drift — instead of reporting a permanent
// 258M gap against a superseded reference.
//   npx tsx prisma/rebaseline-golden.ts [--commit]
import { newPrismaClient } from "../src/lib/prisma-factory";
import { getComputed } from "../src/lib/data";

const prisma = newPrismaClient();
const COMMIT = process.argv.includes("--commit");

async function main() {
  const { dataset, computed } = await getComputed();
  const prev = dataset.golden;
  const toMonthId = prev?.toMonthId ?? dataset.months.at(-1)!.id;
  const set = new Set(dataset.months.filter((m) => m.id <= toMonthId).map((m) => m.id));
  let revenue = 0, cogs = 0, netProfit = 0;
  for (const m of computed.monthly) {
    if (!set.has(m.monthId)) continue;
    revenue += m.revenue;
    cogs += m.cogs;
    netProfit += m.netProfit;
  }
  const next = {
    toMonthId,
    revenue: Math.round(revenue),
    cogs: Math.round(cogs),
    netProfit: Math.round(netProfit),
    gpMarginPct: revenue !== 0 ? (revenue - cogs) / revenue : null,
    note: "Re-baselined 2026-08-03 to the 1C-based figures (1C is the source of truth; the Excel workbook reference is superseded).",
  };
  console.log("before:", JSON.stringify(prev, null, 1));
  console.log("after: ", JSON.stringify(next, null, 1));
  if (!COMMIT) return console.log("\n(dry run — add --commit)");
  await prisma.setting.upsert({
    where: { key: "golden" },
    create: { key: "golden", value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  console.log("\ncommitted");
}
main().finally(() => prisma.$disconnect());
