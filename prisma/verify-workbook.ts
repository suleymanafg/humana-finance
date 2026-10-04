// Recomputes the owner's finance workbook with the app's engine and compares
// every figure the workbook calculates itself, month by month.
//   npx tsx prisma/verify-workbook.ts "<path to the .xlsx>"
import { compute } from "../src/lib/engine/compute";
import { readWorkbook } from "./workbook";
import { compareWithWorkbook } from "./workbook-compare";

const path = process.argv[2];
if (!path) {
  console.error('Usage: npx tsx prisma/verify-workbook.ts "<path to the .xlsx>"');
  process.exit(1);
}
const wb = readWorkbook(path);
const result = compareWithWorkbook(compute(wb.dataset), wb.expected, wb.reportTo);
for (const line of result.lines) console.log(line);
process.exit(result.ok ? 0 : 1);
