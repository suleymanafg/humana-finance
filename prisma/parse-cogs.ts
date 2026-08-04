// Parses the COGS and Import Expenses tabs of the working P&L workbook.
// Shared by the COGS importer.
import * as XLSX from "xlsx";

export const PNL_FILE = "C:/Users/suley/Downloads/Humana P&L - 2026 - Working Copy.xlsx";

export interface ShipmentLineIn {
  monthRu: string; // "Август 2025"
  shipment: string; // "Avia №1"
  productRu: string; // 1C name WITH the ", шт." suffix as written in the workbook
  qty: number;
  priceEur: number;
  rate: number;
  priceUzs: number; // workbook's own computed value (for cross-check)
  purchase: number; // workbook's own computed value (for cross-check)
  costTi: number; // workbook's landed cost (for cross-check)
  costFargo: number; // manual transfer price -> we import this
}

export interface ImportExpenseIn {
  monthRu: string;
  shipment: string;
  category: string;
  amount: number;
}

export interface ProductCostIn {
  productRu: string;
  totalQty: number;
  purchaseValue: number;
  avgCostTi: number;
  avgCostFargo: number;
}

function grid(sheet: string): unknown[][] {
  const wb = XLSX.readFile(PNL_FILE);
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, defval: null, raw: true });
}

const str = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/\s/g, "")) || 0);

/**
 * Section-aware row scan. Several sections in this workbook reuse the same
 * column headers (e.g. "Category" appears in both the summary and the detail),
 * so the section title is the anchor and the header row is located after it.
 */
function sectionRows(
  g: unknown[][],
  sectionTitle: string,
  headerCell: string,
  firstCol: number
): unknown[][] {
  const sectionIdx = g.findIndex((r) => r.some((c) => str(c).toUpperCase().includes(sectionTitle.toUpperCase())));
  if (sectionIdx < 0) throw new Error(`section "${sectionTitle}" not found`);
  const headerOffset = g.slice(sectionIdx).findIndex((r) => r.some((c) => str(c) === headerCell));
  if (headerOffset < 0) throw new Error(`header "${headerCell}" not found under "${sectionTitle}"`);
  const out: unknown[][] = [];
  for (const row of g.slice(sectionIdx + headerOffset + 1)) {
    const key = str(row[firstCol]);
    if (!key) break;
    if (key.toUpperCase().startsWith("TOTAL") || key.toUpperCase().startsWith("ИТОГО")) break;
    out.push(row);
  }
  return out;
}

export function parseProductCosts(): ProductCostIn[] {
  const g = grid("COGS");
  // header row: [null,"#","Product","Total Qty","Purchase Value (UZS)","Avg Unit Cost (TI)","Avg Unit Cost (Fargo)"]
  return sectionRows(g, "PRODUCT COST SUMMARY", "Product", 2).map((r) => ({
    productRu: str(r[2]),
    totalQty: num(r[3]),
    purchaseValue: num(r[4]),
    avgCostTi: num(r[5]),
    avgCostFargo: num(r[6]),
  }));
}

export function parseShipmentLines(): ShipmentLineIn[] {
  const g = grid("COGS");
  // header row: [null,"Месяц","Поставка","Продукт","Кол-во","Цена EUR","Курс EUR","Цена UZS","Сумма закупки","Себест TI","Себест Fargo"]
  return sectionRows(g, "SHIPMENT DETAIL", "Поставка", 1).map((r) => ({
    monthRu: str(r[1]),
    shipment: str(r[2]),
    productRu: str(r[3]),
    qty: num(r[4]),
    priceEur: num(r[5]),
    rate: num(r[6]),
    priceUzs: num(r[7]),
    purchase: num(r[8]),
    costTi: num(r[9]),
    costFargo: num(r[10]),
  }));
}

export function parseImportExpenses(): ImportExpenseIn[] {
  const g = grid("Import Expenses");
  // header row: [null,"Month","Shipment","Category","Amount (UZS)"]
  return sectionRows(g, "EXPENSE DETAIL", "Category", 1)
    .filter((r) => str(r[1]) && str(r[3]))
    .map((r) => ({
      monthRu: str(r[1]),
      shipment: str(r[2]),
      category: str(r[3]),
      amount: num(r[4]),
    }));
}

/** "Август 2025" -> "2025-08" */
const MONTHS_RU = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];
export function monthIdOfRu(label: string): string | null {
  const m = label.trim().toLowerCase().match(/^([а-яё]+)\s+(\d{4})$/);
  if (!m) return null;
  const idx = MONTHS_RU.indexOf(m[1]);
  if (idx < 0) return null;
  return `${m[2]}-${String(idx + 1).padStart(2, "0")}`;
}

/** workbook product names carry a ", шт." unit suffix that 1C names don't */
export function stripUom(name: string): string {
  return name.replace(/,\s*шт\.?\s*$/i, "").trim();
}

if (process.argv[1]?.endsWith("parse-cogs.ts")) {
  const costs = parseProductCosts();
  const lines = parseShipmentLines();
  const expenses = parseImportExpenses();

  console.log("── product cost summary ──", costs.length, "products");
  for (const c of costs) {
    console.log(
      `  ${String(c.totalQty).padStart(6)} | ${String(Math.round(c.purchaseValue)).padStart(12)} | TI ${Math.round(c.avgCostTi).toString().padStart(7)} | Fargo ${Math.round(c.avgCostFargo).toString().padStart(7)} | ${c.productRu}`
    );
  }

  console.log("\n── shipment lines ──", lines.length, "rows");
  const shipments = [...new Set(lines.map((l) => `${l.monthRu} | ${l.shipment}`))];
  console.log("shipments:", shipments.length);
  for (const s of shipments) console.log("  ", s);
  const badMonths = [...new Set(lines.map((l) => l.monthRu))].filter((m) => !monthIdOfRu(m));
  if (badMonths.length) console.log("⚠ unparsed months:", badMonths);
  console.log("qty total:", lines.reduce((a, l) => a + l.qty, 0));
  console.log("purchase total:", lines.reduce((a, l) => a + l.purchase, 0));
  console.log("lines missing Fargo cost:", lines.filter((l) => !l.costFargo).length);

  console.log("\n── import expenses ──", expenses.length, "rows");
  console.log("amount total:", expenses.reduce((a, e) => a + e.amount, 0), "(workbook TOTAL 4399131356.74)");
  const byCat = new Map<string, number>();
  for (const e of expenses) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
  for (const [c, v] of [...byCat].sort((a, b) => b[1] - a[1])) console.log(`  ${c}: ${Math.round(v)}`);
  const expShipments = new Set(expenses.map((e) => e.shipment));
  const lineShipments = new Set(lines.map((l) => l.shipment));
  console.log(
    "expense shipments not in lines:",
    [...expShipments].filter((s) => !lineShipments.has(s))
  );
  console.log(
    "line shipments with no expenses:",
    [...lineShipments].filter((s) => !expShipments.has(s))
  );

  console.log("\n── product names vs app (after stripping ', шт.') ──");
  for (const n of new Set(lines.map((l) => stripUom(l.productRu)))) console.log("  ", n);
}
