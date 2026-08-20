import "dotenv/config";
// One-off: copies MonthBalance.tiCash values from the dev branch (DATABASE_URL)
// into production (the # DATABASE_URL_PRODUCTION line). Touches ONLY tiCash on
// months that already exist in production; everything else is left alone.
//
//   npx tsx prisma/push-ticash-to-prod.ts            # dry run
//   npx tsx prisma/push-ticash-to-prod.ts --commit   # write
import { readFileSync } from "node:fs";
import { newPrismaClient, databaseUrl } from "../src/lib/prisma-factory";

const COMMIT = process.argv.includes("--commit");

function productionUrl(): string {
  const env = readFileSync(".env", "utf8");
  const url = (env.match(/^#\s*DATABASE_URL_PRODUCTION=\s*"?([^"\n]+)/m) ?? [])[1]?.trim();
  if (!url) throw new Error("No `# DATABASE_URL_PRODUCTION=` line in .env.");
  return url;
}
const hostOf = (url: string) => new URL(url).host;

async function main() {
  const SOURCE = databaseUrl(); // dev
  const TARGET = productionUrl();
  if (hostOf(SOURCE) === hostOf(TARGET)) throw new Error("source and target are the same host");
  console.log(COMMIT ? "=== COMMIT ===" : "=== DRY RUN (add --commit to write) ===");
  console.log(`source (dev, read-only): ${hostOf(SOURCE)}`);
  console.log(`target (production):     ${hostOf(TARGET)}\n`);

  const dev = newPrismaClient(SOURCE);
  const prod = newPrismaClient(TARGET);

  const rows = await dev.monthBalance.findMany({ orderBy: { monthId: "asc" } });
  for (const r of rows) {
    const existing = await prod.monthBalance.findUnique({ where: { monthId: r.monthId } });
    if (!existing) {
      console.log(`  ${r.monthId}  SKIP — no MonthBalance row in production`);
      continue;
    }
    console.log(
      `  ${r.monthId}  tiCash ${existing.tiCash.toLocaleString()} -> ${r.tiCash.toLocaleString()}`
    );
    if (COMMIT && existing.tiCash !== r.tiCash) {
      await prod.monthBalance.update({ where: { monthId: r.monthId }, data: { tiCash: r.tiCash } });
      await prod.auditLog.create({
        data: {
          entity: "monthBalance",
          entityId: r.monthId,
          action: "UPDATE",
          data: JSON.stringify({ tiCash: r.tiCash, via: "push-ticash-to-prod" }),
          username: "admin",
        },
      });
    }
  }
  await dev.$disconnect();
  await prod.$disconnect();
  console.log(COMMIT ? "\nDone." : "\nDry run — nothing written.");
}
main();
