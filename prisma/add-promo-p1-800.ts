// Adds the promo Platin 1 800г SKU (owner decision 2026-07-31: include it;
// previously excluded). Price 195,000; promo variant of regular Platin 1 800г;
// 1C Код 00-00000020; pinetrade КодСКЮ 96689.
//   npx tsx prisma/add-promo-p1-800.ts
import { newPrismaClient } from "../src/lib/prisma-factory";

const prisma = newPrismaClient();

async function main() {
  const template = await prisma.product.findFirst({
    where: { isPromo: true, nameRu: { contains: "Platin 1" } },
  });
  const regular = await prisma.product.findFirst({
    where: { nameRu: "Humana Platin 1 MP 800 гр х 4 шт" },
  });
  const maxSort = await prisma.product.aggregate({ _max: { sortOrder: true } });
  console.log("template promo:", JSON.stringify(template, null, 1));
  console.log("regular 800:", regular?.id, regular?.nameRu);
  if (!regular) throw new Error("regular Platin 1 800 not found");

  const existing = await prisma.product.findFirst({ where: { code1c: "00-00000020" } });
  if (existing) {
    console.log("already exists:", existing.nameRu, "active =", existing.active);
    return;
  }
  const created = await prisma.product.create({
    data: {
      id: "p-promo-humana-platin-1-mp-800-4",
      nameRu: "(АКЦИЯ) Humana Platin 1 MP 800 гр х 4 шт",
      nameEn: template?.nameEn ? "(PROMO) Humana Platin 1 MP 800 g x 4" : null,
      code1c: "00-00000020",
      codeSales1c: "96689",
      productLine: "Platin",
      price: 195000,
      isPromo: true,
      regularProductId: regular.id,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      active: true,
    },
  });
  await prisma.auditLog.create({
    data: {
      entity: "product",
      entityId: created.id,
      action: "CREATE",
      data: JSON.stringify({ nameRu: created.nameRu, price: created.price, reason: "owner included promo P1 800 (2026-07-31)" }),
      username: "admin",
    },
  });
  console.log("created:", created.id, created.nameRu, created.price);
}

main().finally(() => prisma.$disconnect());
