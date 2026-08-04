import "dotenv/config";
// Wipes ALL transaction data (sales, shipments, OPEX, marketing, taxes,
// balances, audit log). Master data (products, channels, months, categories,
// settings, users) is kept. Run: npx tsx prisma/reset.ts
import { newPrismaClient } from "../src/lib/prisma-factory";

const prisma = newPrismaClient();

async function main() {
  await prisma.sale.deleteMany();
  await prisma.importExpense.deleteMany();
  await prisma.shipmentLine.deleteMany();
  await prisma.shipment.deleteMany();
  await prisma.opexTiEntry.deleteMany();
  await prisma.opexFargoEntry.deleteMany();
  await prisma.marketingEntry.deleteMany();
  await prisma.tiTaxFiling.deleteMany();
  await prisma.capitalContribution.deleteMany();
  await prisma.fargoTransfer.deleteMany();
  await prisma.stockCount.deleteMany();
  await prisma.monthBalance.deleteMany();
  await prisma.arEntry.deleteMany();
  await prisma.auditLog.deleteMany();
  console.log("All transaction data wiped (master data kept).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
