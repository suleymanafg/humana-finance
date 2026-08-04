import "dotenv/config";
// One-off DB inspection for building the 1C sync classifier.
//   npx tsx prisma/inspect-db.ts
import { newPrismaClient } from "../src/lib/prisma-factory";

const prisma = newPrismaClient();

async function main() {
  const ch = await prisma.channel.findMany({ orderBy: { sortOrder: "asc" } });
  console.log("CHANNELS:");
  for (const c of ch)
    console.log(
      ` ${c.name}${c.code1c ? " [" + c.code1c + "]" : ""}${c.active ? "" : " (inactive)"} cash=${c.cashPct}`
    );
  const p = await prisma.product.findMany({ orderBy: { sortOrder: "asc" } });
  console.log("PRODUCTS:");
  for (const x of p)
    console.log(` ${x.nameRu} | code1c=${x.code1c} | promo=${x.isPromo} | active=${x.active} | price=${x.price}`);
  const months = await prisma.month.findMany({ orderBy: { sortOrder: "asc" } });
  console.log("MONTHS:", months.map((m) => m.id).join(","));
  const bySrc = await prisma.sale.groupBy({
    by: ["monthId", "source"],
    _count: true,
    _sum: { qty: true },
  });
  console.log("SALES by month/source:");
  for (const r of [...bySrc].sort((a, b) => a.monthId.localeCompare(b.monthId)))
    console.log(` ${r.monthId} ${r.source} rows=${r._count} qty=${r._sum.qty}`);
  const withAmount = await prisma.sale.count({ where: { amount: { not: null } } });
  console.log("sales rows with amount:", withAmount);
}

main().finally(() => prisma.$disconnect());
