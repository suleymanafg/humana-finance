// One-off: inspect the 1C sales API response structure.
import { readFileSync } from "node:fs";

const FILE =
  "C:/Users/suley/AppData/Local/Temp/claude/C--Users-suley-Downloads-Claude/72f3ca3a-4b98-4fd0-88ce-0273cc87ae41/scratchpad/api-sample.json";

const raw = readFileSync(FILE, "utf8");
console.log("first 400 chars:", JSON.stringify(raw.slice(0, 400)));

const data = JSON.parse(raw);
console.log("\ntop-level type:", Array.isArray(data) ? `array[${data.length}]` : typeof data);
if (!Array.isArray(data)) {
  console.log("top-level keys:", Object.keys(data));
}

const rows: Record<string, unknown>[] = Array.isArray(data)
  ? data
  : (Object.values(data).find((v) => Array.isArray(v)) as Record<string, unknown>[]) ?? [];
console.log("rows:", rows.length);
if (rows.length > 0) {
  console.log("\nrow keys:", Object.keys(rows[0]));
  console.log("\nfirst 3 rows:");
  for (const r of rows.slice(0, 3)) console.log(JSON.stringify(r));

  // field statistics: distinct values for small-cardinality fields
  const keys = Object.keys(rows[0]);
  console.log("\nfield cardinality:");
  for (const k of keys) {
    const vals = new Set(rows.map((r) => JSON.stringify(r[k])));
    const sample = [...vals].slice(0, 4).join(", ");
    console.log(`  ${k}: ${vals.size} distinct ${vals.size <= 25 ? `→ ${sample.slice(0, 160)}` : `(e.g. ${sample.slice(0, 100)})`}`);
  }

  // numeric aggregates to tie against known May totals (11 948 units / 1 966 141 984 UZS)
  console.log("\nnumeric sums:");
  for (const k of keys) {
    const nums = rows.map((r) => r[k]).filter((v): v is number => typeof v === "number");
    if (nums.length > rows.length / 2) {
      console.log(`  ${k}: sum ${nums.reduce((a, v) => a + v, 0)}`);
    }
  }
}
