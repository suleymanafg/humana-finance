// Seeds Product.article (Артикул производителя) and Product.codeSales1c
// (КодСКЮ of the pinetrade sales API — its own code space, not Код 00-xxx).
// Mapping verified against the May-2026 API pull (qty tied exactly to the
// Excel-imported figure). The three promo SKUs and their codes 96619/96620/96621
// are matched by full name in the API's СКЮ column, so they are learned
// automatically on the first sync (see src/lib/sync-1c.ts) — not seeded here.
//   npx tsx prisma/seed-sales-codes.ts
import { newPrismaClient } from "../src/lib/prisma-factory";

const prisma = newPrismaClient();

// keyed by Product.code1c (Код номенклатуры, stable across renames)
const MAP: Record<string, { article: string | null; codeSales1c: string }> = {
  "00-00000008": { article: "70836", codeSales1c: "96599" }, // Platin 1 MP 400
  "00-00000009": { article: "70988", codeSales1c: "96608" }, // Platin 1 MP 800
  "00-00000010": { article: "70838", codeSales1c: "96606" }, // Platin 2 MP 400
  "00-00000011": { article: "70990", codeSales1c: "96600" }, // Platin 2 MP 800
  "00-00000012": { article: "70991", codeSales1c: "96607" }, // Platin 3 MP 400
  "00-00000013": { article: "70841", codeSales1c: "96601" }, // Platin 3 MP 800
  "00-00000005": { article: "70929", codeSales1c: "96597" }, // HN Expert FS 300
  "00-00000014": { article: "70777", codeSales1c: "96611" }, // SL Expert BIB 500
  "00-00000015": { article: null, codeSales1c: "96615" }, // AC Expert DS 350 (no артикул)
  "00-00000003": { article: "71077", codeSales1c: "96616" }, // AR Expert DS 350
};

async function main() {
  const products = await prisma.product.findMany();
  let updated = 0;
  for (const [code1c, data] of Object.entries(MAP)) {
    const p = products.find((x) => x.code1c === code1c);
    if (!p) {
      console.log(`⚠ no product with code1c=${code1c}`);
      continue;
    }
    await prisma.product.update({ where: { id: p.id }, data });
    console.log(`✓ ${p.nameRu} → артикул=${data.article ?? "—"} КодСКЮ=${data.codeSales1c}`);
    updated++;
  }
  console.log(`${updated}/${Object.keys(MAP).length} updated`);
}

main().finally(() => prisma.$disconnect());
