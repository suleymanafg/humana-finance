// Parses the raw 1C export (month × client × SKU) and validates it against the
// control totals in the companion README. Shared by the import script.
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

export const SKU_XLSX = "C:/Users/suley/Downloads/humana_12m_sku.xlsx";
export const DIM_CSV =
  "C:/Users/suley/AppData/Local/Temp/claude/C--Users-suley-Downloads-Claude/72f3ca3a-4b98-4fd0-88ce-0273cc87ae41/scratchpad/humana-csv/csv/dim_trade_point.csv";

export interface FactRow {
  monthId: string; // "2025-08"
  district: string; // "Район (Общие)" prefix, may be empty
  client: string;
  skuName: string;
  units: number;
  amount: number;
}

/** "8/1/2025" -> "2025-08" */
function monthIdOf(label: string): string {
  const [m, , y] = label.split("/");
  return `${y}-${String(Number(m)).padStart(2, "0")}`;
}

export function parseFacts(): FactRow[] {
  const wb = XLSX.readFile(SKU_XLSX);
  const g = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Sheet_1"], {
    header: 1,
    defval: null,
    raw: true,
  });

  // row 5 carries month labels, row 6 the "Количество заказа" / "Сумма …" pair
  const monthRow = g[5] as (string | null)[];
  const kindRow = g[6] as (string | null)[];
  const cols: Array<{ monthId: string; unitsCol: number; amountCol: number }> = [];
  let currentMonth: string | null = null;
  for (let i = 0; i < kindRow.length; i++) {
    const label = monthRow[i];
    if (label && /^\d+\/\d+\/\d{4}$/.test(String(label))) currentMonth = monthIdOf(String(label));
    else if (label === "Total") currentMonth = null; // ignore the total columns
    const kind = kindRow[i];
    if (!currentMonth || !kind) continue;
    if (String(kind).startsWith("Количество")) {
      cols.push({ monthId: currentMonth, unitsCol: i, amountCol: -1 });
    } else if (String(kind).startsWith("Сумма")) {
      const last = cols[cols.length - 1];
      if (last && last.monthId === currentMonth && last.amountCol === -1) last.amountCol = i;
    }
  }
  const monthCols = cols.filter((c) => c.amountCol !== -1);
  if (monthCols.length !== 12) {
    throw new Error(`expected 12 month column pairs, got ${monthCols.length}`);
  }

  const facts: FactRow[] = [];
  for (const row of g.slice(7)) {
    const key = row[0] as string | null;
    const skuName = row[3] as string | null;
    if (!key || !skuName) continue; // subtotal / blank rows carry no SKU
    const comma = String(key).indexOf(",");
    const district = comma >= 0 ? String(key).slice(0, comma).trim() : "";
    const client = (comma >= 0 ? String(key).slice(comma + 1) : String(key)).trim();
    for (const c of monthCols) {
      const units = row[c.unitsCol];
      const amount = row[c.amountCol];
      if ((units == null || units === 0) && (amount == null || amount === 0)) continue;
      facts.push({
        monthId: c.monthId,
        district,
        client,
        skuName: String(skuName).trim(),
        units: typeof units === "number" ? units : 0,
        amount: typeof amount === "number" ? amount : 0,
      });
    }
  }
  return facts;
}

export interface DimPoint {
  id: string;
  name: string;
  territory: string;
  detail: string;
  needsReview: boolean;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseDim(): DimPoint[] {
  const lines = readFileSync(DIM_CSV, "utf8").trim().split(/\r?\n/);
  return lines.slice(1).map((l) => {
    const c = splitCsvLine(l);
    return {
      id: c[0],
      name: c[1].trim(),
      territory: c[3],
      detail: c[4],
      needsReview: c[5] === "ДА",
    };
  });
}

export const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/ё/g, "е");

if (process.argv[1]?.endsWith("parse-real-sales.ts")) {
  const facts = parseFacts();
  const units = facts.reduce((a, f) => a + f.units, 0);
  const amount = facts.reduce((a, f) => a + f.amount, 0);
  console.log("fact rows:", facts.length);
  console.log("units:", units, "(expected 176996)", units === 176996 ? "OK" : "MISMATCH");
  console.log(
    "amount:",
    amount,
    "(expected 30667764096)",
    amount === 30667764096 ? "OK" : `MISMATCH diff=${amount - 30667764096}`
  );
  console.log("months:", [...new Set(facts.map((f) => f.monthId))].sort().join(", "));
  console.log("distinct clients:", new Set(facts.map((f) => f.client)).size);
  console.log("distinct SKUs:", new Set(facts.map((f) => f.skuName)).size);

  // golden check: Aug'25–Apr'26 revenue should be 26 269 537 700
  const ytd = facts
    .filter((f) => f.monthId <= "2026-04")
    .reduce((a, f) => a + f.amount, 0);
  console.log("Aug'25–Apr'26 amount:", ytd, "(workbook golden 26269537700) diff =", ytd - 26_269_537_700);

  // clients in facts that are missing from the dim file
  const dim = parseDim();
  const dimByName = new Map(dim.map((d) => [norm(d.name), d]));
  const missing = [...new Set(facts.map((f) => f.client))].filter((c) => !dimByName.has(norm(c)));
  console.log("clients not found in dim_trade_point.csv:", missing.length);
  for (const m of missing.slice(0, 20)) console.log("  ?", m);
}
