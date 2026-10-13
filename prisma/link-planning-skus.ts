import "dotenv/config";
// Links the planning SKUs to their P&L products (PlanningSku.productId), the
// same pairs prisma/import-planning.ts sets. Without the link a SKU shows no
// stock, no sales and no trucks in supply planning. Only empty links are
// filled; a SKU already linked elsewhere is reported, never changed.
// Dry run by default; --commit writes. Runs against whatever DATABASE_URL says.
import { newPrismaClient } from "../src/lib/prisma-factory";

const COMMIT = process.argv.includes("--commit");

// Germany's current article -> P&L product (as in prisma/import-planning.ts)
const PRODUCT_BY_ARTICLE: Record<string, string> = {
  "70987": "p-humana-platin-1-mp-400-4",
  "70988": "p-humana-platin-1-mp-800-4",
  "70989": "p-humana-platin-2-mp-400-4",
  "70990": "p-humana-platin-2-mp-800-4",
  "70991": "p-humana-platin-3-mp-400-4",
  "70992": "p-humana-platin-3-mp-800-4",
  "71292": "p-humana-hn-expert-fs-300-5",
  "70777": "p-humana-sl-expert-bib-500-4",
  "71076": "p-humana-ac-expert-ds-350-12",
  "71077": "p-humana-ar-expert-ds-350-12",
};

async function main() {
  const prisma = newPrismaClient();
  const [skus, products] = await Promise.all([
    prisma.planningSku.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.product.findMany({ select: { id: true, nameRu: true } }),
  ]);
  const productName = new Map(products.map((p) => [p.id, p.nameRu]));
  const linkedTo = new Map(skus.filter((s) => s.productId).map((s) => [s.productId!, s.article]));

  const changes: Array<{ id: string; article: string; productId: string }> = [];
  for (const s of skus) {
    const target = PRODUCT_BY_ARTICLE[s.article];
    if (!target) continue;
    if (s.productId === target) {
      console.log(`  ok       ${s.article} ${s.name} -> ${target}`);
    } else if (s.productId) {
      console.log(`  SKIPPED  ${s.article} ${s.name}: linked to ${s.productId}, expected ${target}`);
    } else if (!productName.has(target)) {
      console.log(`  SKIPPED  ${s.article} ${s.name}: product ${target} does not exist`);
    } else if (linkedTo.has(target)) {
      console.log(`  SKIPPED  ${s.article} ${s.name}: ${target} is already linked to ${linkedTo.get(target)}`);
    } else {
      console.log(`  link     ${s.article} ${s.name}: null -> ${target} (${productName.get(target)})`);
      changes.push({ id: s.id, article: s.article, productId: target });
    }
  }
  console.log(`\n${changes.length} SKU(s) to link.`);
  if (!COMMIT || changes.length === 0) {
    if (!COMMIT) console.log("Dry run — nothing written. Re-run with --commit to write.");
    process.exit(0);
  }
  await prisma.$transaction(
    changes.map((c) => prisma.planningSku.updateMany({ where: { id: c.id, productId: null }, data: { productId: c.productId } }))
  );
  console.log(`Linked ${changes.length} SKU(s).`);
  process.exit(0);
}
main();
