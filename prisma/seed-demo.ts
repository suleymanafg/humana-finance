import "dotenv/config";
// DEMO data — synthetic numbers to explore the app before importing real data.
// Run:   npx tsx prisma/seed-demo.ts
// Reset: npx tsx prisma/reset.ts  (wipes transactions, keeps master data)
import { newPrismaClient } from "../src/lib/prisma-factory";

const prisma = newPrismaClient();

// deterministic pseudo-random so reseeding gives identical data
let seedState = 42;
function rnd() {
  seedState = (seedState * 1103515245 + 12345) % 2 ** 31;
  return seedState / 2 ** 31;
}

const DEMO_MONTHS = ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"];

async function main() {
  const products = await prisma.product.findMany({ orderBy: { sortOrder: "asc" } });
  const channels = await prisma.channel.findMany({ orderBy: { sortOrder: "asc" } });
  const tiCats = await prisma.opexCategory.findMany({ where: { company: "TI" } });
  const fgCats = await prisma.opexCategory.findMany({ where: { company: "FARGO" } });
  const mktCats = await prisma.marketingCategory.findMany();
  const impCats = await prisma.importExpenseCategory.findMany();
  const regulars = products.filter((p) => !p.isPromo);

  // ── shipments ──
  const shipmentSpecs = [
    { code: "Авиа №1 (демо)", monthId: "2025-08", rate: 13850 },
    { code: "Фура №1 (демо)", monthId: "2025-10", rate: 14100 },
    { code: "Фура №2 (демо)", monthId: "2025-12", rate: 14350 },
  ];
  for (const spec of shipmentSpecs) {
    const existing = await prisma.shipment.findUnique({ where: { code: spec.code } });
    if (existing) continue;
    const shipment = await prisma.shipment.create({
      data: { code: spec.code, monthId: spec.monthId },
    });
    let purchase = 0;
    for (const p of regulars) {
      const qty = Math.round(2000 + rnd() * 4000);
      const priceEur = +(4.2 + rnd() * 2.2).toFixed(2);
      const priceUzs = priceEur * spec.rate;
      purchase += priceUzs * qty;
      await prisma.shipmentLine.create({
        data: {
          shipmentId: shipment.id,
          productId: p.id,
          qty,
          priceEur,
          rate: spec.rate,
          fargoUnitCost: Math.round(priceUzs * 1.25),
        },
      });
    }
    // import expenses ≈ 12% of purchase across categories
    for (const cat of impCats) {
      await prisma.importExpense.create({
        data: {
          monthId: spec.monthId,
          shipmentId: shipment.id,
          categoryId: cat.id,
          amount: Math.round((purchase * 0.12) / impCats.length),
          notes: "демо",
        },
      });
    }
  }

  // ── sales ──
  for (const [mi, monthId] of DEMO_MONTHS.entries()) {
    const growth = 1 + mi * 0.08;
    for (const p of products) {
      for (const ch of channels) {
        const base = ch.name === "Город" ? 260 : ch.cashPct === 1 ? 25 : 90;
        const qty = Math.round(base * growth * (0.4 + rnd()) * (p.isPromo ? 0.35 : 1));
        if (qty <= 0) continue;
        await prisma.sale.upsert({
          where: { monthId_productId_channelId: { monthId, productId: p.id, channelId: ch.id } },
          create: { monthId, productId: p.id, channelId: ch.id, qty, source: "MANUAL" },
          update: { qty },
        });
      }
    }
  }

  // ── OPEX ──
  for (const monthId of DEMO_MONTHS) {
    for (const cat of tiCats) {
      const existing = await prisma.opexTiEntry.findFirst({ where: { monthId, categoryId: cat.id } });
      if (existing) continue;
      await prisma.opexTiEntry.create({
        data: {
          monthId,
          categoryId: cat.id,
          bankAmount: Math.round((8 + rnd() * 25) * 1e6),
          cashAmount: Math.round(rnd() * 6 * 1e6),
          notes: "демо",
        },
      });
    }
    for (const cat of fgCats) {
      const existing = await prisma.opexFargoEntry.findFirst({ where: { monthId, categoryId: cat.id } });
      if (existing) continue;
      await prisma.opexFargoEntry.create({
        data: { monthId, categoryId: cat.id, amount: Math.round((12 + rnd() * 30) * 1e6), notes: "демо" },
      });
    }
    for (const cat of mktCats.slice(0, 3)) {
      const existing = await prisma.marketingEntry.findFirst({ where: { monthId, categoryId: cat.id } });
      if (existing) continue;
      await prisma.marketingEntry.create({
        data: {
          monthId,
          categoryId: cat.id,
          amount: Math.round((5 + rnd() * 15) * 1e6),
          paidBy: rnd() > 0.3 ? "FARGO" : "TI",
          notes: "демо",
        },
      });
    }
  }

  // ── TI quarterly filings ──
  for (const f of [
    { quarterLabel: "Q3 2025", taxAmount: 185_000_000, bookedMonthId: "2025-10", declaredExpenses: 240_000_000 },
    { quarterLabel: "Q4 2025", taxAmount: 232_000_000, bookedMonthId: "2026-01", declaredExpenses: 265_000_000 },
  ]) {
    const existing = await prisma.tiTaxFiling.findFirst({ where: { quarterLabel: f.quarterLabel } });
    if (!existing) await prisma.tiTaxFiling.create({ data: f });
  }

  // ── capital, transfers, month-end ──
  if ((await prisma.capitalContribution.count()) === 0) {
    await prisma.capitalContribution.createMany({
      data: [
        { date: new Date("2025-08-05"), tiAmount: 4_500_000_000, fargoAmount: 0, notes: "демо" },
        { date: new Date("2025-09-15"), tiAmount: 0, fargoAmount: 1_200_000_000, notes: "демо" },
      ],
    });
  }
  if ((await prisma.fargoTransfer.count()) === 0) {
    await prisma.fargoTransfer.createMany({
      data: [
        { date: new Date("2025-10-10"), cashAmount: 400_000_000, bankAmount: 900_000_000, notes: "демо" },
        { date: new Date("2025-12-20"), cashAmount: 350_000_000, bankAmount: 1_100_000_000, notes: "демо" },
      ],
    });
  }

  // demo warehouses
  for (const [i, name] of ["Основной склад", "Склад Fargo (демо)"].entries()) {
    await prisma.warehouse.upsert({
      where: { name },
      create: { name, sortOrder: i },
      update: {},
    });
  }
  const warehouses = await prisma.warehouse.findMany({ orderBy: { sortOrder: "asc" } });

  const lastMonth = DEMO_MONTHS.at(-1)!;
  await prisma.monthBalance.upsert({
    where: { monthId: lastMonth },
    create: {
      monthId: lastMonth,
      tiBank: 620_000_000,
      goodsInTransit: 1_400_000_000,
      vatPrepayment: 85_000_000,
      priorVatBalance: 120_000_000,
      nutribenLoan: 500_000_000,
    },
    update: {},
  });
  for (const p of regulars) {
    for (const wh of warehouses) {
      await prisma.stockCount.upsert({
        where: {
          monthId_productId_warehouseId: { monthId: lastMonth, productId: p.id, warehouseId: wh.id },
        },
        create: {
          monthId: lastMonth,
          productId: p.id,
          warehouseId: wh.id,
          qty: Math.round(300 + rnd() * 1500),
        },
        update: {},
      });
    }
  }
  for (const name of ["Эльвира Плюс", "Дарвоза", "Uzum Market", "Корзинка (Angelsey)", "ТИИН ОПТОМ"]) {
    const existing = await prisma.arEntry.findFirst({ where: { monthId: lastMonth, customerName: name } });
    if (!existing) {
      await prisma.arEntry.create({
        data: { monthId: lastMonth, customerName: name, amount: Math.round((50 + rnd() * 250) * 1e6) },
      });
    }
  }

  console.log("Demo data seeded.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
