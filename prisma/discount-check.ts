// Decomposes invoiced revenue vs list-price value: where does the gap come from?
import { parseFacts } from "./parse-real-sales";

const facts = parseFacts();

// list price = modal invoiced price of clean positive rows (same rule as the importer)
const prices = new Map<string, Map<number, number>>();
for (const f of facts) {
  if (f.units > 0 && f.amount > 0) {
    const m = prices.get(f.skuName) ?? new Map<number, number>();
    const p = Math.round(f.amount / f.units);
    m.set(p, (m.get(p) ?? 0) + f.units);
    prices.set(f.skuName, m);
  }
}
const listOf = (sku: string) => [...(prices.get(sku) ?? new Map())].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;

const buckets = {
  atList: { rows: 0, units: 0, invoiced: 0, list: 0 },
  below: { rows: 0, units: 0, invoiced: 0, list: 0 }, // discounts
  above: { rows: 0, units: 0, invoiced: 0, list: 0 },
  returns: { rows: 0, units: 0, invoiced: 0, list: 0 },
  corrections: { rows: 0, units: 0, invoiced: 0, list: 0 }, // qty = 0, amount ≠ 0
};

for (const f of facts) {
  const list = listOf(f.skuName);
  const listValue = f.units * list;
  if (f.units === 0) {
    buckets.corrections.rows++;
    buckets.corrections.invoiced += f.amount;
    continue;
  }
  if (f.units < 0) {
    buckets.returns.rows++;
    buckets.returns.units += f.units;
    buckets.returns.invoiced += f.amount;
    buckets.returns.list += listValue;
    continue;
  }
  const unit = Math.round(f.amount / f.units);
  const b = unit === list ? buckets.atList : unit < list ? buckets.below : buckets.above;
  b.rows++;
  b.units += f.units;
  b.invoiced += f.amount;
  b.list += listValue;
}

const totalInvoiced = facts.reduce((a, f) => a + f.amount, 0);
const totalList = facts.reduce((a, f) => a + f.units * listOf(f.skuName), 0);

const pct = (v: number) => `${((v / totalInvoiced) * 100).toFixed(2)}%`;
console.log("bucket        rows    units        invoiced          list-value        delta");
for (const [name, b] of Object.entries(buckets)) {
  console.log(
    `${name.padEnd(12)} ${String(b.rows).padStart(6)} ${String(b.units).padStart(8)} ${String(Math.round(b.invoiced)).padStart(16)} ${String(Math.round(b.list)).padStart(18)} ${String(Math.round(b.invoiced - b.list)).padStart(13)}`
  );
}
console.log("\ntotal invoiced (what the P&L shows):", totalInvoiced);
console.log("total at list price:                ", totalList);
console.log("delta invoiced − list:              ", totalInvoiced - totalList, pct(totalInvoiced - totalList));

console.log("\n=== promo (АКЦИЯ) SKUs: the discount that IS inside the number ===");
const promo = facts.filter((f) => f.skuName.startsWith("(АКЦИЯ)"));
const promoUnits = promo.reduce((a, f) => a + f.units, 0);
const promoInvoiced = promo.reduce((a, f) => a + f.amount, 0);
// what the same units would have invoiced at the regular SKU's list price
const promoAtRegular = promo.reduce((a, f) => a + f.units * listOf(f.skuName.replace(/^\(АКЦИЯ\)\s*/, "")), 0);
console.log("promo units:", promoUnits, "| invoiced:", promoInvoiced);
console.log("same units at regular list price:", promoAtRegular);
console.log("promo discount given:", promoInvoiced - promoAtRegular, pct(promoInvoiced - promoAtRegular));

console.log("\n=== biggest above-list rows (worth a look) ===");
const odd = facts
  .filter((f) => f.units > 0 && f.amount > 0)
  .map((f) => ({ ...f, unit: Math.round(f.amount / f.units), list: listOf(f.skuName) }))
  .filter((f) => f.unit > f.list * 1.05)
  .sort((a, b) => b.amount - b.units * b.list - (a.amount - a.units * a.list))
  .slice(0, 8);
for (const o of odd) {
  console.log(
    `  ${o.monthId} | ${o.units} units @ ${o.unit} (list ${o.list}) = +${Math.round(o.amount - o.units * o.list)} | ${o.client.slice(0, 34)} | ${o.skuName.slice(0, 34)}`
  );
}
