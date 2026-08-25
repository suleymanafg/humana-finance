import "dotenv/config";
// One-way copy of the SUPPLY PLANNING data from dev into production, for the
// first production deploy of the planning module. Touches ONLY:
//   PlanningSku, PlanningForecast, PlanningPurchase, PlanningRecruitment,
//   PlanningContract, PlanningContractLine, and Setting keys "planning.*"
// Everything else (months, sales, shipments, stock, balances, AR, …) is
// live-owned and is NOT read or written. PlanningSku.productId is remapped
// through Product.code1c/article so links survive differing product ids.
// Runs the writes only with --commit; without it, prints what would happen.
import { readFileSync } from "fs";
import { newPrismaClient } from "../src/lib/prisma-factory";

const COMMIT = process.argv.includes("--commit");

function productionUrl(): string {
  const env = readFileSync(".env", "utf8");
  const url = (env.match(/^#\s*DATABASE_URL_PRODUCTION=\s*"?([^"\n]+)/m) ?? [])[1]?.trim();
  if (!url) throw new Error("No `# DATABASE_URL_PRODUCTION=` line in .env.");
  return url;
}
const hostOf = (url: string) => new URL(url).host;

async function main() {
  const devUrl = process.env.DATABASE_URL ?? "";
  const prodUrl = productionUrl();
  if (!devUrl.startsWith("postgres")) throw new Error("DATABASE_URL (dev source) is not Postgres.");
  if (hostOf(devUrl) === hostOf(prodUrl))
    throw new Error("Source host equals the production host — refusing.");

  const dev = newPrismaClient();
  process.env.DATABASE_URL = prodUrl;
  const prod = newPrismaClient();

  // source: everything planning owns in dev
  const [skus, forecasts, purchases, recruitment, contracts, contractLines, settings] =
    await Promise.all([
      dev.planningSku.findMany(),
      dev.planningForecast.findMany(),
      dev.planningPurchase.findMany(),
      dev.planningRecruitment.findMany(),
      dev.planningContract.findMany(),
      dev.planningContractLine.findMany(),
      dev.setting.findMany({ where: { key: { startsWith: "planning." } } }),
    ]);

  // productId remap dev->prod (product ids differ between branches)
  const [devProducts, prodProducts] = await Promise.all([
    dev.product.findMany({ select: { id: true, code1c: true, article: true, nameRu: true } }),
    prod.product.findMany({ select: { id: true, code1c: true, article: true, nameRu: true } }),
  ]);
  const prodIdByKey = new Map<string, string>();
  for (const p of prodProducts) {
    if (p.code1c) prodIdByKey.set(`c:${p.code1c}`, p.id);
    if (p.article) prodIdByKey.set(`a:${p.article}`, p.id);
    prodIdByKey.set(`n:${p.nameRu.trim().toLowerCase()}`, p.id);
  }
  const remap = new Map<string, string | null>();
  for (const p of devProducts) {
    const target =
      (p.code1c ? prodIdByKey.get(`c:${p.code1c}`) : undefined) ??
      (p.article ? prodIdByKey.get(`a:${p.article}`) : undefined) ??
      prodIdByKey.get(`n:${p.nameRu.trim().toLowerCase()}`) ??
      null;
    remap.set(p.id, target);
  }

  let unmatched = 0;
  const skuRows = skus.map((s) => {
    const productId = s.productId ? (remap.get(s.productId) ?? null) : null;
    if (s.productId && !productId) {
      unmatched++;
      console.log(`  note: no prod product match for SKU ${s.name} — copying without link`);
    }
    return { ...s, productId };
  });

  console.log(
    `planning data in dev: ${skus.length} SKUs, ${forecasts.length} forecasts, ${purchases.length} purchases, ` +
      `${recruitment.length} recruitment months, ${contracts.length} contracts, ${settings.length} settings` +
      (unmatched ? ` · ${unmatched} SKUs without product link` : "")
  );

  if (!COMMIT) {
    console.log("\nDry run — pass --commit to write to PRODUCTION.");
    process.exit(0);
  }

  // wipe-and-load, planning tables only (idempotent re-runs)
  await prod.planningContractLine.deleteMany();
  await prod.planningContract.deleteMany();
  await prod.planningForecast.deleteMany();
  await prod.planningPurchase.deleteMany();
  await prod.planningRecruitment.deleteMany();
  await prod.planningSku.deleteMany();

  await prod.planningSku.createMany({ data: skuRows });
  await prod.planningForecast.createMany({ data: forecasts });
  await prod.planningPurchase.createMany({ data: purchases });
  await prod.planningRecruitment.createMany({ data: recruitment });
  await prod.planningContract.createMany({ data: contracts });
  await prod.planningContractLine.createMany({ data: contractLines });
  for (const s of settings) {
    await prod.setting.upsert({
      where: { key: s.key },
      create: { key: s.key, value: s.value },
      update: { value: s.value },
    });
  }

  console.log("\nDone — planning data copied to production. Nothing else was touched.");
  process.exit(0);
}
main();
