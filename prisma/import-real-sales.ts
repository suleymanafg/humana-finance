// Imports the real 1C sales export (Aug 2025 – Jul 2026) as the app's live data.
//
//   npx tsx prisma/import-real-sales.ts            # dry run: report only
//   npx tsx prisma/import-real-sales.ts --commit   # wipe demo data and import
//
// What it does with --commit:
//   1. wipes ALL demo transaction data (sales, shipments, OPEX, marketing,
//      taxes, stock, balances, AR, capital, transfers) — master data is rebuilt
//   2. replaces products with the 18 real SKUs at their real average prices
//   3. replaces channels with the 30 real channels (chains stand alone, the
//      unclassified retail tail goes to «Прочие»)
//   4. imports 13 487 fact rows aggregated to month × product × channel
//   5. records the real control totals as the golden reference
import { newPrismaClient } from "../src/lib/prisma-factory";
import { parseFacts, parseDim, norm } from "./parse-real-sales";

const prisma = newPrismaClient();

const COMMIT = process.argv.includes("--commit");

// ── channels ──────────────────────────────────────────────────
// retroPct / cashPct come from the original workbook spec — verify in Settings.
const CITY = { retroPct: 0.08, cashPct: 0.336 };
const CHAIN = { retroPct: 0, cashPct: 0 };
const CASH = { retroPct: 0, cashPct: 1 };

const CHANNELS: Array<{ name: string; retroPct: number; cashPct: number }> = [
  { name: "г. Ташкент", ...CITY },
  { name: "Ташкентская область", ...CITY },
  { name: "Самарканд", ...CITY },
  { name: "Кашкадарья", ...CITY },
  { name: "Наманган", ...CITY },
  { name: "Андижан", ...CITY },
  { name: "Фергана", ...CITY },
  { name: "Бухара", ...CITY },
  { name: "Джизак", ...CITY },
  { name: "Хорезм", ...CITY },
  { name: "Навои", ...CITY },
  { name: "Сурхандарья", ...CITY },
  // chains — deliberately not tied to any territory
  { name: "Korzinka", retroPct: 0.11, cashPct: 0 },
  { name: "Makro", ...CHAIN },
  { name: "Митвой (Mittivoy)", ...CHAIN },
  { name: "Uzum Market", ...CHAIN },
  { name: "Pepito", ...CHAIN },
  { name: "Vikiton", ...CHAIN },
  { name: "Kidimart", ...CHAIN },
  { name: "Bi1 / New Retail", retroPct: 0.05, cashPct: 0 },
  { name: "Galmart", ...CHAIN },
  { name: "City Farm", ...CHAIN },
  { name: "Bio Plus Farm", ...CHAIN },
  { name: "Bigmag", ...CHAIN },
  { name: "Прочая сеть", ...CHAIN },
  // dealers / wholesale
  { name: "Дилеры Бондюэль", retroPct: 0.04, cashPct: 0 },
  { name: "DARVOZA SAVDO", retroPct: 0.06, cashPct: 0 },
  { name: "ТИИН ОПТОМ", ...CHAIN },
  // internal + the unclassified retail tail
  { name: "Внутреннее", ...CASH },
  { name: "Прочие", ...CASH },
];

const CHAIN_DETAILS = new Set([
  "Korzinka",
  "Uzum Market",
  "Pepito",
  "Vikiton",
  "Kidimart",
  "Bi1 / New Retail",
  "Galmart",
  "City Farm",
  "Bio Plus Farm",
  "Bigmag",
  "Прочая сеть",
]);

// named accounts that 1C left without a territory but the business tracks
const NAMED_UNCLASSIFIED: Array<[RegExp, string]> = [
  [/бондюэль/i, "Дилеры Бондюэль"],
  [/darvoza/i, "DARVOZA SAVDO"],
  [/тиин оптом/i, "ТИИН ОПТОМ"],
  [/митвой|mittivoy/i, "Митвой (Mittivoy)"],
  [/makro|макро/i, "Makro"],
];

// ── products ──────────────────────────────────────────────────
// The approved range (confirmed by the owner 2026-07-28). Prices are the
// official list prices and match the modal invoiced price in 1C exactly.
// Names are the 1C "Номенклатура" spelling — the 1C view appends ", шт." for
// the unit of measure, which is deliberately not stored so import name
// matching keeps working.
// Anything NOT listed here is excluded from every calculation: AC/AR Expert
// FS 300, both MC cereals, and the promo Platin 1 800 г.
const PRODUCTS: Array<{ name: string; price: number; line: "Platin" | "Expert" }> = [
  { name: "Humana Platin 1 MP 400 гр х 4 шт", price: 135_800, line: "Platin" },
  { name: "Humana Platin 1 MP 800 гр х 4 шт", price: 259_800, line: "Platin" },
  { name: "Humana Platin 2 MP 400 гр х 4 шт", price: 135_800, line: "Platin" },
  { name: "Humana Platin 2 MP 800 гр х 4 шт", price: 259_800, line: "Platin" },
  { name: "Humana Platin 3 MP 400 гр х 4 шт", price: 135_800, line: "Platin" },
  { name: "Humana Platin 3 MP 800 гр х 4 шт", price: 259_800, line: "Platin" },
  { name: "Humana HN Expert FS 300 гр х 5 шт", price: 120_000, line: "Expert" },
  { name: "Humana SL Expert BIB 500 гр х 4 шт", price: 152_000, line: "Expert" },
  { name: "Humana AC Expert DS 350 гр х 12 шт", price: 176_000, line: "Expert" },
  { name: "Humana AR Expert DS 350 гр х 12 шт", price: 176_000, line: "Expert" },
  { name: "(АКЦИЯ) Humana Platin 1 MP 400 гр х 4 шт", price: 101_850, line: "Platin" },
  { name: "(АКЦИЯ) Humana Platin 2 MP 400 гр х 4 шт", price: 101_850, line: "Platin" },
  { name: "(АКЦИЯ) Humana Platin 3 MP 400 гр х 4 шт", price: 101_850, line: "Platin" },
];
const SKU_ORDER = PRODUCTS.map((p) => p.name);
const INCLUDED = new Set(SKU_ORDER);

const nameEnOf = (ru: string) =>
  ru
    .replace(/^\(АКЦИЯ\)\s*/, "")
    .replace(/\s*гр\s*/g, "g ")
    .replace(/х\s*(\d+)\s*шт/, "× $1 pcs")
    .trim() + (ru.startsWith("(АКЦИЯ)") ? " (PROMO)" : "");

const slugOf = (ru: string) =>
  "p-" +
  ru
    .toLowerCase()
    .replace(/\(акция\)/, "promo")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

async function main() {
  const facts = parseFacts();
  const dim = parseDim();
  const dimByName = new Map(dim.map((d) => [norm(d.name), d]));

  function channelOf(client: string): string {
    const d = dimByName.get(norm(client));
    for (const [re, name] of NAMED_UNCLASSIFIED) if (re.test(client)) return name;
    if (!d) return "Прочие";
    if (d.territory === "Сети / Chains") return CHAIN_DETAILS.has(d.detail) ? d.detail : "Прочая сеть";
    if (d.territory === "г. Ташкент") return "г. Ташкент";
    if (d.territory === "Ташкентская область") return "Ташкентская область";
    if (d.territory === "Регионы / Regions") return d.detail || "Прочие";
    if (d.territory === "Внутреннее / Internal") return "Внутреннее";
    return "Прочие";
  }

  // split the source into the approved range and everything excluded
  const included = facts.filter((f) => INCLUDED.has(f.skuName));
  const excluded = facts.filter((f) => !INCLUDED.has(f.skuName));

  const sumBy = <T,>(rows: T[], get: (r: T) => number) => rows.reduce((a, r) => a + get(r), 0);
  const skuTotals = new Map<string, { units: number; amount: number; modal: number }>();
  for (const f of facts) {
    const e = skuTotals.get(f.skuName) ?? { units: 0, amount: 0, modal: 0 };
    e.units += f.units;
    e.amount += f.amount;
    skuTotals.set(f.skuName, e);
  }
  // cross-check the confirmed list prices against what 1C actually invoiced
  const modalPrices = new Map<string, Map<number, number>>();
  for (const f of included) {
    if (f.units > 0 && f.amount > 0) {
      const m = modalPrices.get(f.skuName) ?? new Map<number, number>();
      const p = Math.round(f.amount / f.units);
      m.set(p, (m.get(p) ?? 0) + f.units);
      modalPrices.set(f.skuName, m);
    }
  }

  // aggregate the approved range to the app grain: month × product × channel
  const agg = new Map<string, { monthId: string; skuName: string; channel: string; qty: number; amount: number }>();
  const unknownChannels = new Set<string>();
  for (const f of included) {
    const channel = channelOf(f.client);
    if (!CHANNELS.some((c) => c.name === channel)) unknownChannels.add(channel);
    const key = `${f.monthId}|${f.skuName}|${channel}`;
    const e = agg.get(key) ?? { monthId: f.monthId, skuName: f.skuName, channel, qty: 0, amount: 0 };
    e.qty += f.units;
    e.amount += f.amount;
    agg.set(key, e);
  }
  if (unknownChannels.size > 0) throw new Error(`unmapped channels: ${[...unknownChannels].join(", ")}`);

  const totalUnits = sumBy(included, (f) => f.units);
  const totalAmount = sumBy(included, (f) => f.amount);
  const srcUnits = sumBy(facts, (f) => f.units);
  const srcAmount = sumBy(facts, (f) => f.amount);

  console.log("── source ──");
  console.log(`export: ${facts.length} fact rows | ${srcUnits} units | ${srcAmount} UZS`);
  console.log(`approved range: ${included.length} rows | ${totalUnits} units | ${totalAmount} UZS`);
  console.log(`→ app rows after aggregation: ${agg.size} | channels: ${CHANNELS.length}`);

  console.log("\n── EXCLUDED from all calculations ──");
  const exBySku = new Map<string, { units: number; amount: number }>();
  for (const f of excluded) {
    const e = exBySku.get(f.skuName) ?? { units: 0, amount: 0 };
    e.units += f.units;
    e.amount += f.amount;
    exBySku.set(f.skuName, e);
  }
  for (const [name, v] of [...exBySku].sort((a, b) => b[1].amount - a[1].amount)) {
    console.log(`  ${String(v.units).padStart(6)} units | ${String(v.amount).padStart(12)} UZS | ${name}`);
  }
  console.log(
    `  total excluded: ${sumBy(excluded, (f) => f.units)} units | ${sumBy(excluded, (f) => f.amount)} UZS ` +
      `(${((sumBy(excluded, (f) => f.amount) / srcAmount) * 100).toFixed(2)}% of export revenue)`
  );

  console.log("\n── confirmed list prices vs 1C invoiced ──");
  for (const p of PRODUCTS) {
    const m = modalPrices.get(p.name);
    if (!m) {
      console.log(`  ${String(p.price).padStart(9)} | ${p.line.padEnd(6)} | NO SALES | ${p.name}`);
      continue;
    }
    const [modal, modalUnits] = [...m].sort((a, b) => b[1] - a[1])[0];
    const clean = [...m.values()].reduce((a, u) => a + u, 0);
    const flag = modal === p.price ? "match" : `1C modal ${modal} ⚠`;
    console.log(
      `  ${String(p.price).padStart(9)} | ${p.line.padEnd(6)} | ${((modalUnits / clean) * 100).toFixed(1).padStart(5)}% at list | ${flag.padEnd(18)} | ${p.name}`
    );
  }
  const months = [...new Set(included.map((f) => f.monthId))].sort();
  console.log("\nmonths:", months[0], "→", months.at(-1));

  if (!COMMIT) {
    console.log("\nDRY RUN — re-run with --commit to write to the database.");
    return;
  }

  // 1. wipe demo transaction data
  console.log("\n── wiping demo transaction data ──");
  await prisma.sale.deleteMany();
  await prisma.importExpense.deleteMany();
  await prisma.shipmentLine.deleteMany();
  await prisma.shipment.deleteMany();
  await prisma.opexTiEntry.deleteMany();
  await prisma.opexFargoEntry.deleteMany();
  await prisma.marketingEntry.deleteMany();
  await prisma.tiTaxFiling.deleteMany();
  await prisma.capitalContribution.deleteMany();
  await prisma.fargoTransfer.deleteMany();
  await prisma.stockCount.deleteMany();
  await prisma.monthBalance.deleteMany();
  await prisma.arEntry.deleteMany();
  await prisma.auditLog.deleteMany();

  // 2. products — only the approved range
  console.log("── products ──");
  await prisma.product.updateMany({ data: { regularProductId: null } });
  await prisma.product.deleteMany();
  for (const [i, p] of PRODUCTS.entries()) {
    await prisma.product.create({
      data: {
        id: slugOf(p.name),
        nameRu: p.name,
        nameEn: nameEnOf(p.name),
        productLine: p.line,
        price: p.price,
        isPromo: p.name.startsWith("(АКЦИЯ)"),
        sortOrder: i,
      },
    });
  }
  // link promo SKUs to their regular counterpart (shared unit costs)
  for (const name of SKU_ORDER.filter((n) => n.startsWith("(АКЦИЯ)"))) {
    const regular = name.replace(/^\(АКЦИЯ\)\s*/, "");
    const promoId = slugOf(name);
    const regularId = slugOf(regular);
    const [p, r] = await Promise.all([
      prisma.product.findUnique({ where: { id: promoId } }),
      prisma.product.findUnique({ where: { id: regularId } }),
    ]);
    if (p && r) await prisma.product.update({ where: { id: promoId }, data: { regularProductId: r.id } });
  }

  // 3. channels
  console.log("── channels ──");
  await prisma.channel.deleteMany();
  for (const [i, c] of CHANNELS.entries()) {
    await prisma.channel.create({ data: { ...c, sortOrder: i } });
  }

  // 4. sales
  console.log("── sales ──");
  const products = await prisma.product.findMany();
  const channels = await prisma.channel.findMany();
  const productByName = new Map(products.map((p) => [p.nameRu, p.id]));
  const channelByName = new Map(channels.map((c) => [c.name, c.id]));

  let written = 0;
  const rows = [...agg.values()];
  for (const r of rows) {
    const productId = productByName.get(r.skuName);
    const channelId = channelByName.get(r.channel);
    if (!productId || !channelId) throw new Error(`unresolved ${r.skuName} / ${r.channel}`);
    await prisma.sale.upsert({
      where: { monthId_productId_channelId: { monthId: r.monthId, productId, channelId } },
      create: { monthId: r.monthId, productId, channelId, qty: r.qty, amount: r.amount, source: "CSV" },
      update: { qty: r.qty, amount: r.amount, source: "CSV" },
    });
    if (++written % 1000 === 0) console.log(`  ${written}/${rows.length}`);
  }
  console.log(`  wrote ${written} sale rows`);

  // 5. golden reference = the 1C control total for the approved range
  const goldenValue = JSON.stringify({
    toMonthId: months.at(-1),
    revenue: totalAmount,
    cogs: null, // no real landed-cost data yet
    netProfit: null,
    note:
      `1C export Aug'25–Jul'26, approved range only: ${totalUnits} units / ${totalAmount} UZS (VAT incl.). ` +
      `Excluded from the export: ${sumBy(excluded, (f) => f.units)} units / ${sumBy(excluded, (f) => f.amount)} UZS ` +
      `(AC/AR Expert FS 300, MC cereals, promo Platin 1 800 г).`,
  });
  await prisma.setting.upsert({
    where: { key: "golden" },
    create: { key: "golden", value: goldenValue },
    update: { value: goldenValue },
  });

  // 6. verify what landed in the database
  const dbSales = await prisma.sale.findMany({ include: { product: true } });
  const dbUnits = dbSales.reduce((a, s) => a + s.qty, 0);
  const dbRevenue = dbSales.reduce((a, s) => a + (s.amount ?? s.qty * s.product.price), 0);
  const atListPrice = dbSales.reduce((a, s) => a + s.qty * s.product.price, 0);
  console.log("\n── verification ──");
  console.log("db sale rows:", dbSales.length);
  console.log("db units:", dbUnits, dbUnits === totalUnits ? "OK" : `MISMATCH vs ${totalUnits}`);
  console.log(
    "db revenue (invoiced):",
    dbRevenue,
    dbRevenue === totalAmount ? "OK — ties to 1C" : `diff ${dbRevenue - totalAmount}`
  );
  console.log(
    "for reference, qty × list price:",
    atListPrice,
    `(${(((atListPrice - totalAmount) / totalAmount) * 100).toFixed(2)}% vs invoiced)`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
