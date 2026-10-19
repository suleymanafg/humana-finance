// Reads the foil tracking workbook (verified prescriptions) into monthly
// totals. Sheet "Foil Tracking": one row per foil batch — date in column A,
// region in C, product code in H, foils in I, amount paid in J, the month as a
// Russian month name in K (the year comes from the date). Only totals leave
// this file; no doctor or rep names. Pure — the route reads the workbook.

export type FoilCell = string | number | Date | null;

export interface FoilMonth {
  foils: number;
  paid: number;
  rows: number;
}

const RU = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const num = (x: FoilCell) => (typeof x === "number" ? x : typeof x === "string" ? Number(x.replace(/[\s,]/g, "")) || 0 : 0);

export function foilMonths(rows: FoilCell[][]): { months: Record<string, FoilMonth>; skipped: number } {
  const months: Record<string, FoilMonth> = {};
  let skipped = 0;
  for (const r of rows.slice(1)) {
    if (!r || r.every((c) => c === null || c === "")) continue;
    const q = num(r[8] ?? null);
    if (!q) continue;
    let y = 0, m = 0;
    const a = r[0];
    if (a instanceof Date) { y = a.getUTCFullYear(); m = a.getUTCMonth() + 1; }
    else if (typeof a === "number") { const d = new Date(Math.round((a - 25569) * 86_400_000)); y = d.getUTCFullYear(); m = d.getUTCMonth() + 1; }
    else if (typeof a === "string") { const p = a.split(/[.,/\s]+/).map(Number); if (p.length >= 3) { m = p[1]; y = p[2] < 100 ? 2000 + p[2] : p[2]; } }
    const k = String(r[10] ?? "").trim().toLowerCase();
    const km = RU.findIndex((x) => k.startsWith(x.slice(0, 3))) + 1;
    if (km) {
      if (!y) y = km >= 11 ? 2025 : 2026;
      else if (km === 12 && m === 1) y -= 1; // a December batch dated in January
      m = km;
    }
    if (!y || !m) { skipped++; continue; }
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const e = (months[key] ??= { foils: 0, paid: 0, rows: 0 });
    e.foils += q;
    e.paid += num(r[9] ?? null);
    e.rows++;
  }
  return { months, skipped };
}
