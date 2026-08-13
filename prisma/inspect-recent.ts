import "dotenv/config";
// Temporary read-only inspection: what data exists, per month, and what
// changed recently (audit log). Run:
//   DATABASE_URL="<url>" npx tsx prisma/inspect-recent.ts
import { newPrismaClient } from "../src/lib/prisma-factory";

const prisma = newPrismaClient();

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^./]+)/)?.[1] ?? "?";
  console.log("DB host prefix:", host);

  console.log("\n== AuditLog: last 25 entries ==");
  const audit = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 25 });
  for (const a of audit)
    console.log(
      ` ${a.createdAt.toISOString().slice(0, 16)} ${a.action.padEnd(12)} ${a.entity.padEnd(16)} by ${a.username}`
    );

  console.log("\n== Row counts ==");
  const counts: Record<string, number> = {
    sales: await prisma.sale.count(),
    shipments: await prisma.shipment.count({ where: { deletedAt: null } }),
    shipmentLines: await prisma.shipmentLine.count({ where: { deletedAt: null } }),
    importExpenses: await prisma.importExpense.count({ where: { deletedAt: null } }),
    opexTi: await prisma.opexTiEntry.count({ where: { deletedAt: null } }),
    opexFargo: await prisma.opexFargoEntry.count({ where: { deletedAt: null } }),
    stockCounts: await prisma.stockCount.count(),
    arEntries: await prisma.arEntry.count(),
    monthBalances: await prisma.monthBalance.count(),
    contributions: await prisma.capitalContribution.count(),
    fargoTransfers: await prisma.fargoTransfer.count(),
    tiTaxFilings: await prisma.tiTaxFiling.count(),
    dataRequests: await prisma.dataRequest.count(),
    contacts: await prisma.contact.count(),
    users: await prisma.user.count(),
    auditRows: await prisma.auditLog.count(),
  };
  for (const [k, v] of Object.entries(counts)) console.log(` ${k.padEnd(16)} ${v}`);

  console.log("\n== Sales by month/source ==");
  const bySrc = await prisma.sale.groupBy({ by: ["monthId", "source"], _count: true, _sum: { qty: true } });
  for (const r of [...bySrc].sort((a, b) => a.monthId.localeCompare(b.monthId)))
    console.log(` ${r.monthId} ${String(r.source).padEnd(6)} rows=${String(r._count).padEnd(5)} qty=${r._sum.qty}`);

  console.log("\n== OPEX by month ==");
  const ti = await prisma.opexTiEntry.groupBy({
    by: ["monthId"], where: { deletedAt: null }, _sum: { bankAmount: true, cashAmount: true },
  });
  const fg = await prisma.opexFargoEntry.groupBy({
    by: ["monthId"], where: { deletedAt: null }, _sum: { amount: true },
  });
  const fgMap = new Map(fg.map((r) => [r.monthId, r._sum.amount ?? 0]));
  const monthsSet = new Set([...ti.map((r) => r.monthId), ...fg.map((r) => r.monthId)]);
  for (const m of [...monthsSet].sort()) {
    const t = ti.find((r) => r.monthId === m);
    console.log(
      ` ${m} TI=${((t?._sum.bankAmount ?? 0) + (t?._sum.cashAmount ?? 0)).toLocaleString("en-US")} Fargo=${(fgMap.get(m) ?? 0).toLocaleString("en-US")}`
    );
  }

  console.log("\n== Stock / AR / MonthBalance coverage ==");
  const stock = await prisma.stockCount.groupBy({ by: ["monthId"], _sum: { qty: true }, _count: true });
  for (const r of [...stock].sort((a, b) => a.monthId.localeCompare(b.monthId)))
    console.log(` stock ${r.monthId} rows=${r._count} qty=${r._sum.qty}`);
  const ar = await prisma.arEntry.groupBy({ by: ["monthId"], _sum: { amount: true }, _count: true });
  for (const r of [...ar].sort((a, b) => a.monthId.localeCompare(b.monthId)))
    console.log(` AR    ${r.monthId} rows=${r._count} sum=${(r._sum.amount ?? 0).toLocaleString("en-US")}`);
  const mb = await prisma.monthBalance.findMany({ orderBy: { monthId: "asc" } });
  for (const b of mb)
    console.log(
      ` MB    ${b.monthId} tiBank=${b.tiBank.toLocaleString("en-US")} transit=${b.goodsInTransit.toLocaleString("en-US")} vatPre=${b.vatPrepayment.toLocaleString("en-US")} priorVat=${b.priorVatBalance.toLocaleString("en-US")} loan=${b.nutribenLoan.toLocaleString("en-US")}`
    );

  console.log("\n== Contributions / transfers (last 10 each) ==");
  const contr = await prisma.capitalContribution.findMany({ orderBy: { date: "desc" }, take: 10 });
  for (const c of contr)
    console.log(` contrib ${c.date.toISOString().slice(0, 10)} TI=${c.tiAmount.toLocaleString("en-US")} Fargo=${c.fargoAmount.toLocaleString("en-US")}`);
  const tr = await prisma.fargoTransfer.findMany({ orderBy: { date: "desc" }, take: 10 });
  for (const t of tr)
    console.log(` transfer ${t.date.toISOString().slice(0, 10)} cash=${t.cashAmount.toLocaleString("en-US")} bank=${t.bankAmount.toLocaleString("en-US")}`);

  console.log("\n== TiTaxFilings ==");
  const filings = await prisma.tiTaxFiling.findMany({ orderBy: { quarterLabel: "asc" } });
  for (const f of filings)
    console.log(` ${f.quarterLabel} tax=${f.taxAmount.toLocaleString("en-US")} booked=${f.bookedMonthId} declaredExp=${f.declaredExpenses.toLocaleString("en-US")}`);
  if (!filings.length) console.log(" (none)");

  console.log("\n== Data requests ==");
  const reqs = await prisma.dataRequest.findMany({
    orderBy: { createdAt: "desc" }, take: 10, include: { contact: true },
  });
  for (const r of reqs)
    console.log(` ${r.createdAt.toISOString().slice(0, 10)} ${r.kind} ${r.monthId} → ${r.contact.name} [${r.status}]`);
  if (!reqs.length) console.log(" (none)");

  console.log("\n== Users (name/role only) ==");
  const users = await prisma.user.findMany();
  for (const u of users) console.log(` ${u.username} ${u.role}${u.mustChangePassword ? " (change pending)" : ""}`);
}

main().finally(() => prisma.$disconnect());
