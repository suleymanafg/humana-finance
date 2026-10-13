// Reading cells from uploaded lists: numbers and dates as people and 1C write
// them. Pure functions, no database.
export type RawRow = Record<string, string | number | boolean | null | undefined>;

export const text = (v: RawRow[string]) => (v === null || v === undefined ? "" : String(v).trim());

/** "1 234,5" / "1,234.5" / 1234.5 → number */
export function numberOf(v: RawRow[string]): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = text(v).replace(/\s| /g, "");
  if (!s) return null;
  const normalised = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

/** Excel serial, "31.12.2026", "2026-12-31", "12/2026" → YYYY-MM-DD */
export function dateOfCell(v: RawRow[string]): string | null {
  if (typeof v === "number" && v > 20000 && v < 80000) {
    return new Date(Math.round((v - 25569) * 86400_000)).toISOString().slice(0, 10);
  }
  const s = text(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})[./](\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}-01`;
  return null;
}

