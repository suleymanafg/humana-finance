// Parses the OPEX and marketing tabs of the working P&L workbook.
// The workbook already carries a "P&L Group" column in English that matches the
// app's group labels, so the category → group mapping comes from the source
// rather than being guessed here.
import * as XLSX from "xlsx";
import { PNL_FILE, monthIdOfRu } from "./parse-cogs";
import { FARGO_GROUPS, GROUP_LABELS, TI_GROUPS } from "../src/lib/groups";

const str = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/\s/g, "")) || 0);

function grid(sheet: string): unknown[][] {
  const wb = XLSX.readFile(PNL_FILE);
  const s = wb.Sheets[sheet];
  if (!s) throw new Error(`sheet "${sheet}" not found`);
  return XLSX.utils.sheet_to_json<unknown[]>(s, { header: 1, defval: null, raw: true });
}

/** Anchors on a section title, then the header row beneath it. */
function sectionRows(g: unknown[][], sectionTitle: string, headerCell: string, firstCol: number): unknown[][] {
  const sectionIdx = g.findIndex((r) =>
    r.some((c) => str(c).toUpperCase().includes(sectionTitle.toUpperCase()))
  );
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

/** English P&L-group label from the workbook → the app's group key. */
function groupKeyOf(label: string, company: "TI" | "FARGO"): string | null {
  const keys = company === "TI" ? TI_GROUPS : FARGO_GROUPS;
  const hit = keys.find((k) => GROUP_LABELS[k].en.toLowerCase() === label.trim().toLowerCase());
  return hit ?? null;
}

export interface OpexTiRow {
  monthId: string;
  category: string;
  groupKey: string | null;
  groupLabel: string;
  bank: number;
  cash: number;
  notes: string;
}

export interface OpexFargoRow {
  monthId: string;
  category: string;
  groupKey: string | null;
  groupLabel: string;
  amount: number;
  notes: string;
}

export interface MarketingRow {
  monthId: string;
  category: string;
  amount: number;
  paidBy: "TI" | "FARGO";
  notes: string;
  validated: boolean;
}

export function parseOpexTi(): { rows: OpexTiRow[]; skipped: string[] } {
  const g = grid("OPEX — Turbo Impex");
  // header: Month | Category | Bank Transfer | Cash | TOTAL | Notes | P&L Group
  const raw = sectionRows(g, "EXPENSE DETAIL", "Category", 0);
  const rows: OpexTiRow[] = [];
  const skipped: string[] = [];
  for (const r of raw) {
    const monthId = monthIdOfRu(str(r[0]));
    if (!monthId) {
      skipped.push(`month "${str(r[0])}"`);
      continue;
    }
    const groupLabel = str(r[6]);
    rows.push({
      monthId,
      category: str(r[1]),
      groupKey: groupKeyOf(groupLabel, "TI"),
      groupLabel,
      bank: num(r[2]),
      cash: num(r[3]),
      notes: str(r[5]),
    });
  }
  return { rows, skipped };
}

export function parseOpexFargo(): { rows: OpexFargoRow[]; skipped: string[] } {
  const g = grid("OPEX — Fargo");
  // header: Month | Category | Amount (UZS) | Notes | P&L Group
  const raw = sectionRows(g, "EXPENSE DETAIL", "Category", 0);
  const rows: OpexFargoRow[] = [];
  const skipped: string[] = [];
  for (const r of raw) {
    const monthId = monthIdOfRu(str(r[0]));
    if (!monthId) {
      skipped.push(`month "${str(r[0])}"`);
      continue;
    }
    const groupLabel = str(r[4]);
    rows.push({
      monthId,
      category: str(r[1]),
      groupKey: groupKeyOf(groupLabel, "FARGO"),
      groupLabel,
      amount: num(r[2]),
      notes: str(r[3]),
    });
  }
  return { rows, skipped };
}

export function parseMarketing(): { rows: MarketingRow[]; skipped: string[] } {
  const g = grid("Marketing & Promo");
  // header: Month | Category | Amount (UZS) | Оплатил / Paid By | Notes | Validated?
  const raw = sectionRows(g, "EXPENSE DETAIL", "Category", 0);
  const rows: MarketingRow[] = [];
  const skipped: string[] = [];
  for (const r of raw) {
    const monthId = monthIdOfRu(str(r[0]));
    if (!monthId) {
      skipped.push(`month "${str(r[0])}"`);
      continue;
    }
    const payer = str(r[3]).toLowerCase();
    rows.push({
      monthId,
      category: str(r[1]),
      amount: num(r[2]),
      paidBy: payer.includes("fargo") ? "FARGO" : "TI",
      notes: str(r[4]),
      validated: str(r[5]).includes("✅"),
    });
  }
  return { rows, skipped };
}

if (process.argv[1]?.endsWith("parse-opex.ts")) {
  const ti = parseOpexTi();
  const fg = parseOpexFargo();
  const mk = parseMarketing();

  const report = (
    name: string,
    rows: Array<{ monthId: string; category: string }>,
    skipped: string[],
    total: number,
    expected: number
  ) => {
    console.log(`\n── ${name} ──`);
    console.log(`rows: ${rows.length} (nonzero-carrying entries counted below)`);
    if (skipped.length) console.log(`⚠ skipped: ${[...new Set(skipped)].join(", ")}`);
    console.log(
      `total: ${total} | workbook: ${expected} | ${Math.abs(total - expected) < 0.01 ? "OK" : `MISMATCH ${total - expected}`}`
    );
    const months = [...new Set(rows.map((r) => r.monthId))].sort();
    console.log(`months: ${months[0]} → ${months.at(-1)} (${months.length})`);
  };

  report(
    "OPEX Turbo Impex",
    ti.rows,
    ti.skipped,
    ti.rows.reduce((a, r) => a + r.bank + r.cash, 0),
    4_680_793_998
  );
  console.log(
    `bank ${ti.rows.reduce((a, r) => a + r.bank, 0)} (wb 357711798) | cash ${ti.rows.reduce((a, r) => a + r.cash, 0)} (wb 4323082200)`
  );
  console.log("category → group:");
  for (const [cat, info] of new Map(
    ti.rows.map((r) => [r.category, { g: r.groupKey, l: r.groupLabel }])
  )) {
    console.log(`  ${info.g ?? "⚠ UNMAPPED"}  ←  ${cat}  (workbook: "${info.l}")`);
  }

  report(
    "OPEX Fargo",
    fg.rows,
    fg.skipped,
    fg.rows.reduce((a, r) => a + r.amount, 0),
    2_376_145_000
  );
  console.log("category → group:");
  for (const [cat, info] of new Map(
    fg.rows.map((r) => [r.category, { g: r.groupKey, l: r.groupLabel }])
  )) {
    console.log(`  ${info.g ?? "⚠ UNMAPPED"}  ←  ${cat}  (workbook: "${info.l}")`);
  }

  report(
    "Marketing & Promo",
    mk.rows,
    mk.skipped,
    mk.rows.reduce((a, r) => a + r.amount, 0),
    346_326_578.64
  );
  console.log(
    `Fargo ${mk.rows.filter((r) => r.paidBy === "FARGO").reduce((a, r) => a + r.amount, 0)} (wb 190217582) | ` +
      `TI ${mk.rows.filter((r) => r.paidBy === "TI").reduce((a, r) => a + r.amount, 0)} (wb 156108996.64)`
  );
  console.log("categories:", [...new Set(mk.rows.map((r) => r.category))].join(" | "));
  const unvalidated = mk.rows.filter((r) => !r.validated && r.amount !== 0);
  console.log(`not validated: ${unvalidated.length}`);
  for (const u of unvalidated.slice(0, 10)) console.log(`  ${u.monthId} ${u.category} ${u.amount}`);
}
