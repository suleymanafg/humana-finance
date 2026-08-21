import "dotenv/config";
// Imports the supply-planning source files:
//   1. IBP GAP file        (FC & shipments Jan-Jul-26)  -> forecast Jan-Jul + prices
//   2. IBP estimation file (FC Aug-Dec-26)              -> forecast Aug-Dec + prices
//   3. Order Form          (Logistical data, Ordersheet)-> carton/pallet/weight data + contracts
//
//   npx tsx prisma/import-planning.ts <gap.xlsx> <estimation.xlsx> <orderform.xlsx> [--commit]
//
// Re-runnable: SKUs and forecasts upsert; contracts are matched by contract
// number and their lines replaced. Dry run prints everything it would write.
import * as XLSX from "xlsx";
import { newPrismaClient } from "../src/lib/prisma-factory";

const COMMIT = process.argv.includes("--commit");
const [GAP_FILE, EST_FILE, ORDER_FILE] = process.argv.slice(2).filter((a) => a !== "--commit");
if (!GAP_FILE || !EST_FILE || !ORDER_FILE) {
  console.error("usage: npx tsx prisma/import-planning.ts <gap.xlsx> <estimation.xlsx> <orderform.xlsx> [--commit]");
  process.exit(1);
}

const prisma = newPrismaClient();

// Germany renumbered several articles; both ids are the same physical product.
// alt (old) -> canonical (current, as used in the estimation file)
const ALT_ARTICLE: Record<string, string> = {
  "70836": "70987", // Platin 1 400g
  "70838": "70989", // Platin 2 400g
  "70841": "70992", // Platin 3 800g
  "70929": "71292", // HN Expert 300g
};
const canonical = (article: string) => ALT_ARTICLE[article] ?? article;

// canonical article -> app product id (P&L link). benelife etc. stay unlinked.
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

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};
/** "Aug-26" -> "2026-08" */
function monthKeyOfHeader(h: unknown): string | null {
  const m = String(h ?? "").trim().match(/^([A-Z][a-z]{2})-(\d{2})$/);
  if (!m || !MONTHS[m[1]]) return null;
  return `20${m[2]}-${MONTHS[m[1]]}`;
}
const num = (v: unknown): number => {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

interface SkuAgg {
  article: string; // canonical
  altSeen: Set<string>;
  name: string;
  priceEur: number;
  forecast: Map<string, number>; // monthKey -> qty
  order: number; // first appearance, for sortOrder
}
const skus = new Map<string, SkuAgg>();
let appearance = 0;

function skuOf(articleRaw: string, name: string): SkuAgg {
  const article = canonical(articleRaw);
  let s = skus.get(article);
  if (!s) {
    s = { article, altSeen: new Set(), name, priceEur: 0, forecast: new Map(), order: appearance++ };
    skus.set(article, s);
  }
  if (articleRaw !== article) s.altSeen.add(articleRaw);
  if (name && name.length > (s.name?.length ?? 0)) s.name = name;
  return s;
}

/** Reads one IBP sheet: "Partner Forecast Input" rows -> forecast per month;
 *  price from the paired second key-figure row. */
function readIbpSheet(path: string, sheetName: string) {
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`sheet "${sheetName}" not found in ${path}`);
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  const header = rows[0] as unknown[];
  const monthCols: Array<{ col: number; key: string }> = [];
  header.forEach((h, i) => {
    const key = monthKeyOfHeader(h);
    if (key) monthCols.push({ col: i, key });
  });
  // price columns: the LAST header containing "price" wins (the "from Feb" one)
  const priceCols = header
    .map((h, i) => (String(h).toLowerCase().includes("price") ? i : -1))
    .filter((i) => i >= 0);
  const priceCol = priceCols.at(-1) ?? -1;

  for (const row of rows.slice(1)) {
    const article = String(row[2] ?? "").trim();
    const name = String(row[3] ?? "").trim();
    const keyFigure = String(row[4] ?? "").trim();
    if (!/^\d{5}$/.test(article)) continue;
    const sku = skuOf(article, name);
    if (/Partner Forecast Input/i.test(keyFigure)) {
      for (const { col, key } of monthCols) {
        const qty = num(row[col]);
        if (qty > 0) sku.forecast.set(key, (sku.forecast.get(key) ?? 0) + qty);
      }
    } else if (priceCol >= 0) {
      const p = num(row[priceCol]);
      if (p > 0) sku.priceEur = p;
    }
  }
  console.log(`  ${sheetName}: months ${monthCols.map((c) => c.key).join(", ")}`);
}

/** Logistical data sheet -> carton/pallet/weight per article. */
interface Logistics {
  pcsPerCarton: number; pcsPerLayer: number; pcsPerPallet: number;
  layersPerPallet: number; grossKgPerUnit: number; netKgPerUnit: number;
}
function readLogistics(path: string): Map<string, Logistics> {
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets["Logistical data"];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  const out = new Map<string, Logistics>();
  for (const row of rows.slice(1)) {
    const article = String(row[0] ?? "").trim();
    if (!/^\d{5}$/.test(article)) continue;
    const pcsPerCarton = num(row[2]);
    const gross = num(row[7]) || (pcsPerCarton > 0 ? num(row[8]) / pcsPerCarton : 0);
    out.set(article, {
      pcsPerCarton,
      pcsPerLayer: num(row[3]),
      pcsPerPallet: num(row[4]),
      layersPerPallet: num(row[5]),
      grossKgPerUnit: gross,
      netKgPerUnit: num(row[9]),
    });
  }
  console.log(`  Logistical data: ${out.size} articles`);
  return out;
}

/** Ordersheet -> contracts with per-SKU contracted / open quantities. */
interface ContractAgg {
  code: string;
  label: string;
  shipMonth: string;
  lines: Map<string, { qty: number; openQty: number }>; // by canonical article
}
function readContracts(path: string): ContractAgg[] {
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets["Ordersheet_with weights"];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  const byCode = new Map<string, ContractAgg>();
  for (const row of rows.slice(2)) {
    const code = String(row[1] ?? "").trim();
    const label = String(row[2] ?? "").trim();
    const article = String(row[3] ?? "").trim();
    if (!/^\d+$/.test(code) || !/^\d{5}$/.test(article)) continue;
    const m = label.match(/sales\s+(\d{2})-(\d{4})/i);
    if (!m) continue;
    const shipMonth = `${m[2]}-${m[1]}`;
    let c = byCode.get(code);
    if (!c) {
      c = { code, label: label.replace(/\s+UZ\s*$/i, ""), shipMonth, lines: new Map() };
      byCode.set(code, c);
    }
    const art = canonical(article);
    const qty = num(row[5]);
    const picked = num(row[6]);
    const prev = c.lines.get(art) ?? { qty: 0, openQty: 0 };
    prev.qty += qty;
    prev.openQty += Math.max(0, qty - picked);
    c.lines.set(art, prev);
  }
  return [...byCode.values()];
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

async function main() {
  console.log(COMMIT ? "=== COMMIT ===" : "=== DRY RUN (add --commit to write) ===");
  console.log("\nReading IBP files…");
  readIbpSheet(GAP_FILE, "FC & shipments Jan-Jul-26");
  readIbpSheet(EST_FILE, "FC Aug-Dec-26");
  const logistics = readLogistics(ORDER_FILE);
  const contracts = readContracts(ORDER_FILE);

  console.log(`\nSKUs found: ${skus.size}`);
  for (const s of [...skus.values()].sort((a, b) => a.order - b.order)) {
    const log = logistics.get(s.article) ?? [...s.altSeen].map((a) => logistics.get(a)).find(Boolean);
    const productId = PRODUCT_BY_ARTICLE[s.article] ?? null;
    const fc = [...s.forecast.entries()].sort();
    console.log(
      `  ${s.article}${s.altSeen.size ? `(+${[...s.altSeen]})` : ""} | ${s.name.slice(0, 34).padEnd(34)} | ` +
      `${productId ? "P&L" : "план-only"} | €${s.priceEur} | ` +
      `carton ${log?.pcsPerCarton ?? "?"} pallet ${log?.pcsPerPallet ?? "?"} | ` +
      `FC ${fc.length} мес = ${fmt(fc.reduce((x, [, q]) => x + q, 0))} шт`
    );
    if (!log) console.log(`    ⚠ no logistics row for ${s.article}`);
  }

  console.log(`\nContracts: ${contracts.length}`);
  for (const c of contracts) {
    const open = [...c.lines.values()].reduce((s, l) => s + l.openQty, 0);
    const total = [...c.lines.values()].reduce((s, l) => s + l.qty, 0);
    console.log(`  ${c.code} ${c.label} ship=${c.shipMonth} | ${fmt(total)} шт contracted, ${fmt(open)} open`);
    for (const [art, l] of c.lines) {
      if (l.openQty > 0) console.log(`    ${art} ${skus.get(art)?.name.slice(0, 30) ?? ""}: open ${fmt(l.openQty)} / ${fmt(l.qty)}`);
    }
  }

  if (!COMMIT) {
    console.log("\nDry run — nothing written.");
    process.exit(0);
  }

  console.log("\nWriting…");
  const skuIdByArticle = new Map<string, string>();
  let order = 0;
  for (const s of [...skus.values()].sort((a, b) => a.order - b.order)) {
    const log =
      logistics.get(s.article) ??
      [...s.altSeen].map((a) => logistics.get(a)).find(Boolean) ??
      { pcsPerCarton: 0, pcsPerLayer: 0, pcsPerPallet: 0, layersPerPallet: 0, grossKgPerUnit: 0, netKgPerUnit: 0 };
    const data = {
      altArticles: s.altSeen.size ? [...s.altSeen].join(",") : null,
      name: s.name,
      productId: PRODUCT_BY_ARTICLE[s.article] ?? null,
      priceEur: s.priceEur,
      sortOrder: order++,
      ...log,
    };
    const row = await prisma.planningSku.upsert({
      where: { article: s.article },
      create: { article: s.article, ...data },
      update: data,
    });
    skuIdByArticle.set(s.article, row.id);
    for (const [monthKey, qty] of s.forecast) {
      await prisma.planningForecast.upsert({
        where: { skuId_monthKey: { skuId: row.id, monthKey } },
        create: { skuId: row.id, monthKey, qty },
        update: { qty },
      });
    }
  }

  for (const c of contracts) {
    const arrivalMonth = ((k: string) => {
      const [y, m] = k.split("-").map(Number);
      return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    })(c.shipMonth);
    const totalOpen = [...c.lines.values()].reduce((s, l) => s + l.openQty, 0);
    const existing = await prisma.planningContract.findFirst({ where: { code: c.code } });
    const contract = existing
      ? await prisma.planningContract.update({
          where: { id: existing.id },
          data: { label: c.label, shipMonth: c.shipMonth, arrivalMonth, status: totalOpen > 0 ? "PLACED" : "CLOSED" },
        })
      : await prisma.planningContract.create({
          data: { code: c.code, label: c.label, shipMonth: c.shipMonth, arrivalMonth, status: totalOpen > 0 ? "PLACED" : "CLOSED" },
        });
    await prisma.planningContractLine.deleteMany({ where: { contractId: contract.id } });
    for (const [art, l] of c.lines) {
      const skuId = skuIdByArticle.get(art);
      if (!skuId || l.qty <= 0) continue;
      await prisma.planningContractLine.create({
        data: { contractId: contract.id, skuId, qty: l.qty, openQty: l.openQty },
      });
    }
  }
  console.log("Done.");
  process.exit(0);
}
main();
