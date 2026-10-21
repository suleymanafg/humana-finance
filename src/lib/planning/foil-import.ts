// Reads the foil tracking workbook (verified prescriptions). Sheet "Foil
// Tracking": one row per foil batch — date in A, region in C, district in D,
// clinic in E, doctor in F, rate per foil in G, product code in H, foils in I,
// amount paid in J, the month as a Russian month name in K (the year comes from
// the date), the medical rep in L, the proof (photo, stub…) in M.
// `foilMonths` gives monthly totals (supply planning's prescriptions);
// `foilLines` keeps every line with its region, rep and doctor (the medical
// team's view). Pure — the route reads the workbook.
import { UZ_REGIONS } from "../uz-map";

export type FoilCell = string | number | Date | null;

export interface FoilMonth {
  foils: number;
  paid: number;
  rows: number;
}

export interface FoilLine {
  monthKey: string;
  date: string | null; // ISO day
  regionIso: string | null;
  regionName: string;
  district: string;
  clinic: string;
  doctor: string;
  rep: string;
  foils: number;
  rate: number | null;
  amount: number | null;
  proof: string;
}

const RU = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const num = (x: FoilCell) => (typeof x === "number" ? x : typeof x === "string" ? Number(x.replace(/[\s,]/g, "")) || 0 : 0);
const text = (x: FoilCell) => (x == null ? "" : x instanceof Date ? x.toISOString().slice(0, 10) : String(x).replace(/\s+/g, " ").trim());

/** The file's region names as the map's regions (Kokand is in Fergana region). */
const REGION_ALIASES: Record<string, string> = {
  "ташкент": "UZ-TK",
  "г. ташкент": "UZ-TK",
  "ташкент область": "UZ-TO",
  "ташкентская область": "UZ-TO",
  "андижон": "UZ-AN",
  "андижан": "UZ-AN",
  "наманган": "UZ-NG",
  "фергана": "UZ-FA",
  "фаргона": "UZ-FA",
  "коканд": "UZ-FA",
  "самарканд": "UZ-SA",
  "бухоро": "UZ-BU",
  "бухара": "UZ-BU",
  "кашкадарьё": "UZ-QA",
  "кашкадарья": "UZ-QA",
  "сурхандарья": "UZ-SU",
  "сурхондарё": "UZ-SU",
  "джиззах": "UZ-JI",
  "джизак": "UZ-JI",
  "сырдарья": "UZ-SI",
  "сирдарё": "UZ-SI",
  "навои": "UZ-NW",
  "хоразм": "UZ-XO",
  "хорезм": "UZ-XO",
  "каракалпакстан": "UZ-QR",
};

export function regionIsoOf(name: string): string | null {
  const k = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!k) return null;
  return REGION_ALIASES[k] ?? UZ_REGIONS.find((r) => r.nameRu.toLowerCase() === k)?.iso ?? null;
}

/** The month a foil row belongs to: its month name (K), the year from its date (A). */
function monthOf(r: FoilCell[]): string | null {
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
  return y && m ? `${y}-${String(m).padStart(2, "0")}` : null;
}

function dateOf(a: FoilCell): string | null {
  if (a instanceof Date) return a.toISOString().slice(0, 10);
  if (typeof a === "number") return new Date(Math.round((a - 25569) * 86_400_000)).toISOString().slice(0, 10);
  return null;
}

const rowsWithFoils = (rows: FoilCell[][]) => rows.slice(1).filter((r) => r && !r.every((c) => c === null || c === "") && num(r[8] ?? null) !== 0);

export function foilMonths(rows: FoilCell[][]): { months: Record<string, FoilMonth>; skipped: number } {
  const months: Record<string, FoilMonth> = {};
  let skipped = 0;
  for (const r of rowsWithFoils(rows)) {
    const key = monthOf(r);
    if (!key) { skipped++; continue; }
    const e = (months[key] ??= { foils: 0, paid: 0, rows: 0 });
    e.foils += num(r[8] ?? null);
    e.paid += num(r[9] ?? null);
    e.rows++;
  }
  return { months, skipped };
}

/** Every foil line with its region (as the map's), district, clinic, doctor and rep. */
export function foilLines(rows: FoilCell[][]): { lines: FoilLine[]; skipped: number } {
  const lines: FoilLine[] = [];
  let skipped = 0;
  for (const r of rowsWithFoils(rows)) {
    const monthKey = monthOf(r);
    if (!monthKey) { skipped++; continue; }
    const regionName = text(r[2] ?? null);
    const rate = num(r[6] ?? null);
    const amount = num(r[9] ?? null);
    lines.push({
      monthKey,
      date: dateOf(r[0] ?? null),
      regionIso: regionIsoOf(regionName),
      regionName,
      district: text(r[3] ?? null),
      clinic: text(r[4] ?? null),
      doctor: text(r[5] ?? null),
      rep: text(r[11] ?? null),
      foils: num(r[8] ?? null),
      rate: rate || null,
      amount: amount || null,
      proof: text(r[12] ?? null),
    });
  }
  return { lines, skipped };
}
