import "dotenv/config";
// Quick look at the client registry + drill-down tables after a sync run.
import { newPrismaClient } from "../src/lib/prisma-factory";

const prisma = newPrismaClient();

async function main() {
  const maps = await prisma.clientChannelMap.findMany({
    where: { deletedAt: null },
    include: { channel: { select: { name: true } } },
    orderBy: { totalQty: "desc" },
  });
  const unassigned = maps.filter((m) => !m.channelId);
  console.log(`registry rows: ${maps.length} | unassigned: ${unassigned.length}`);
  const byRule = new Map<string, number>();
  for (const m of maps) byRule.set(m.matchedRule ?? "?", (byRule.get(m.matchedRule ?? "?") ?? 0) + 1);
  console.log("by rule:", [...byRule.entries()].map(([r, n]) => `${r}=${n}`).join(" "));

  console.log("\ntop 12 by qty:");
  for (const m of maps.slice(0, 12))
    console.log(
      ` ${m.displayName.slice(0, 44).padEnd(44)} → ${(m.channel?.name ?? "—").padEnd(22)} ${String(m.matchedRule).padEnd(9)} qty=${m.totalQty}`
    );

  console.log("\nunassigned (top 12 by qty):");
  for (const m of unassigned.slice(0, 12))
    console.log(` ${m.displayName.slice(0, 52).padEnd(52)} qty=${m.totalQty}`);

  const cs = await prisma.clientSale.groupBy({ by: ["monthId"], _count: true, _sum: { qty: true } });
  console.log(
    "\nclientSale months:",
    cs.length ? cs.map((r) => `${r.monthId}(rows=${r._count},qty=${r._sum.qty})`).join(" ") : "(empty — populated on commit)"
  );
}

main().finally(() => prisma.$disconnect());
