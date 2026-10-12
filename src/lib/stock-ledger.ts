// Fargo's 1C «Ведомость по товарам на складах»: month-end balances (Конечный
// остаток) with one column per warehouse and month. Pure parsing, no database.
//
// 1C prints a month for a warehouse only when that warehouse had movements, so
// a warehouse's balance carries forward from its last printed month; a blank
// cell in a printed month is zero. Each warehouse also has an «Итог» column
// (its balance at the end of the report period), used to check the carry-forward.

const MONTHS_RU = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

export interface StockLedgerItem {
  /** name as 1C prints it, without the unit («, шт.») */
  name: string;
  /** month id ("2026-08") → units across all warehouses */
  byMonth: Record<string, number>;
}

export interface StockLedger {
  /** last day the report covers ("2026-10-01"), from «Период: … - DD.MM.YYYY» */
  periodEnd: string | null;
  /** every month from the first to the last one printed, ascending */
  months: string[];
  warehouses: string[];
  items: StockLedgerItem[];
  /** item/warehouse pairs whose carried balance differs from the warehouse's «Итог» */
  mismatches: string[];
}

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v)).replace(/\s+/g, " ").trim();

/** «Март 2025 г.» → "2025-03" */
export function ledgerMonth(label: string): string | null {
  const m = text(label).toLowerCase().match(/^([а-яё]+)\s+(\d{4})/);
  const i = m ? MONTHS_RU.indexOf(m[1]) : -1;
  return m && i >= 0 ? `${m[2]}-${String(i + 1).padStart(2, "0")}` : null;
}

export function nextMonth(id: string): string {
  const [y, m] = id.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Last calendar day of a month id, as "YYYY-MM-DD". */
export function monthEnd(id: string): string {
  const [y, m] = id.split("-").map(Number);
  return `${id}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export function parseStockLedger(rows: unknown[][]): StockLedger {
  let periodEnd: string | null = null;
  for (const r of rows.slice(0, 12)) {
    const m = r.map(text).join(" ").match(/Период:.*?-\s*(\d{2})\.(\d{2})\.(\d{4})/);
    if (m) {
      periodEnd = `${m[3]}-${m[2]}-${m[1]}`;
      break;
    }
  }

  const head = rows.findIndex((r) => r.some((c) => text(c).startsWith("Номенклатура")));
  if (head < 0) throw new Error("No «Номенклатура» header row: is this the 1C report «Ведомость по товарам на складах»?");
  const nameCol = rows[head].findIndex((c) => text(c).startsWith("Номенклатура"));
  const whRow = rows[head];
  const monthRow = rows[head + 1] ?? [];

  // columns: (warehouse, month) balances and each warehouse's «Итог»
  const monthCols = new Map<string, Array<{ col: number; month: string }>>();
  const totalCol = new Map<string, number>();
  for (let col = nameCol + 1; col < whRow.length; col++) {
    const wh = text(whRow[col]);
    const label = text(monthRow[col]);
    if (!wh || wh === "Итог") continue;
    if (label === "Итог") {
      totalCol.set(wh, col);
      continue;
    }
    const month = ledgerMonth(label);
    if (!month) continue;
    if (!monthCols.has(wh)) monthCols.set(wh, []);
    monthCols.get(wh)!.push({ col, month });
  }
  const printed = [...monthCols.values()].flat().map((c) => c.month).sort();
  if (printed.length === 0) throw new Error("No month columns («Январь 2026 г.» …) under the warehouse header.");
  const months: string[] = [];
  for (let m = printed[0]; m <= printed[printed.length - 1]; m = nextMonth(m)) months.push(m);
  for (const cols of monthCols.values()) cols.sort((a, b) => (a.month < b.month ? -1 : 1));

  const items: StockLedgerItem[] = [];
  const mismatches: string[] = [];
  for (const r of rows.slice(head + 2)) {
    const raw = text(r[nameCol]);
    if (!raw || raw === "Итог") continue;
    // «Name , шт.» — a hierarchy group line has an empty unit («HUMANA, »)
    const split = raw.match(/^(.*?)\s*,\s*([^,]*)$/);
    const name = split ? split[1].trim() : raw;
    const unit = split ? split[2].trim() : "";
    if (!name || !unit) continue;

    const byMonth: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]));
    for (const [wh, cols] of monthCols) {
      let i = -1;
      let balance = 0;
      for (const m of months) {
        while (i + 1 < cols.length && cols[i + 1].month <= m) {
          i++;
          balance = num(r[cols[i].col]);
        }
        byMonth[m] += balance;
      }
      const tc = totalCol.get(wh);
      if (tc !== undefined && Math.abs(num(r[tc]) - balance) > 1e-6)
        mismatches.push(`${name} @ ${wh}: carried ${balance}, «Итог» ${num(r[tc])}`);
    }
    items.push({ name, byMonth });
  }
  return { periodEnd, months, warehouses: [...monthCols.keys()], items, mismatches };
}
