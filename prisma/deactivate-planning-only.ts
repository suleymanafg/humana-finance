import "dotenv/config";
// Deactivates planning-only SKUs (benelife, milk minis — no linked P&L
// product): the owner excluded them from planning until they are actually
// ordered. Runs against whatever DATABASE_URL says.
import { newPrismaClient } from "../src/lib/prisma-factory";

async function main() {
  const prisma = newPrismaClient();
  const r = await prisma.planningSku.updateMany({ where: { productId: null }, data: { active: false } });
  const left = await prisma.planningSku.findMany({ where: { active: true }, select: { name: true } });
  console.log(`deactivated ${r.count} planning-only SKUs; active: ${left.map((x) => x.name).join(", ")}`);
  process.exit(0);
}
main();
