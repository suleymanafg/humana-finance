import "dotenv/config";
// Loads 1C product codes ("Код", e.g. 00-00000008) from "Humana товар.xls"
// into Product.code1c, matching by the exact 1C name. Import matching then
// prefers these codes over names (see src/lib/import-sales.ts).
//   npx tsx prisma/import-product-codes.ts
import * as XLSX from "xlsx";
import { newPrismaClient } from "../src/lib/prisma-factory";

const prisma = newPrismaClient();

async function main() {
  const wb = XLSX.readFile("C:/Users/suley/Downloads/Humana товар.xls");
  const g = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: null,
    raw: true,
  });
  // header: Наименование | Артикул | Код
  const rows = g
    .slice(1)
    .map((r) => ({
      name: String(r[0] ?? "").trim(),
      article: r[1] == null ? null : String(r[1]).trim(),
      code: String(r[2] ?? "").trim(),
    }))
    .filter((r) => r.name && r.code);

  const products = await prisma.product.findMany();
  let updated = 0;
  const unmatchedFile: string[] = [];

  for (const row of rows) {
    const product = products.find((p) => p.nameRu === row.name);
    if (!product) {
      unmatchedFile.push(`${row.name} (${row.code})`);
      continue;
    }
    await prisma.product.update({ where: { id: product.id }, data: { code1c: row.code } });
    console.log(`  ${row.code}  ${row.article ? `арт. ${row.article}` : "        "}  ${row.name}`);
    updated++;
  }

  const withoutCode = (await prisma.product.findMany({ where: { code1c: null } })).map((p) => p.nameRu);

  console.log(`\nupdated: ${updated} of ${products.length} products`);
  if (unmatchedFile.length > 0) {
    console.log(`file rows not in the app (expected — outside the approved range):`);
    for (const u of unmatchedFile) console.log(`  · ${u}`);
  }
  if (withoutCode.length > 0) {
    console.log(`⚠ app products still without a code:`);
    for (const p of withoutCode) console.log(`  · ${p}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
