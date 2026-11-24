import "dotenv/config";
// Fargo's e-invoices (ЭСФ, Didox) → the Setting «fargo.esf»: tins per month and regular SKU. A month loaded here
// splits Fargo's sales into bank and cash by them: what was invoiced was paid through the bank, the rest in cash
// (owner, 24 Nov 2026). Reads either Didox's registry (sheet «Реестр», outgoing documents only) or the finance
// team's extract (sheet «2-source (filtred)»). Counts signed and pending documents; a return (negative price with a
// positive quantity, Didox «Дополнительный») is subtracted. Only whole months: by default up to the last month the
// file covers to its end (a file ending on 19 Nov stops at October).
//   npx tsx prisma/import-fargo-esf.ts <file.xlsx> [--from YYYY-MM] [--to YYYY-MM] [--commit]
import { createRequire } from "module";
import { basename } from "path";
import { FARGO_ESF_KEY, parseFargoEsf, type FargoEsfStore } from "../src/lib/fargo-esf";

const req = createRequire(import.meta.url);
const COUNTED = new Set(["Подписан", "Ожидает"]);
// Didox spelling (spaces collapsed, lower case) → the app's regular SKU
const SKU: Record<string, string> = {
  "humana platin 1 400g mp": "Humana Platin 1 MP 400 гр х 4 шт",
  "humana platin 1 800g mp": "Humana Platin 1 MP 800 гр х 4 шт",
  "humana platin 2 400g mp": "Humana Platin 2 MP 400 гр х 4 шт",
  "humana platin 2 800g mp": "Humana Platin 2 MP 800 гр х 4 шт",
  "humana platin 3 400g mp": "Humana Platin 3 MP 400 гр х 4 шт",
  "humana platin 3 800g mp": "Humana Platin 3 MP 800 гр х 4 шт",
  "humana hn expert 300g fs": "Humana HN Expert FS 300 гр х 5 шт",
  "humana sl expert 500g bib": "Humana SL Expert BIB 500 гр х 4 шт",
  "humana ac expert 350g ds": "Humana AC Expert DS 350 гр х 12 шт",
  "humana ar expert 350g ds": "Humana AR Expert DS 350 гр х 12 шт",
};
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

interface Line { date: string; status: string; product: string; qty: number; price: number; net: number; gross: number }

async function readLines(file: string): Promise<Line[]> {
  const ExcelJS = req("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const V = (v: unknown): unknown =>
    v && typeof v === "object" && !(v instanceof Date)
      ? ((v as { result?: unknown; text?: unknown }).result ?? (v as { text?: unknown }).text ?? ((v as { richText?: Array<{ text: string }> }).richText?.map((x) => x.text).join("") ?? null))
      : v;
  const iso = (v: unknown) => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const m = String(v ?? "").match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : new Date(String(v)).toISOString().slice(0, 10);
  };
  const out: Line[] = [];
  const registry = wb.getWorksheet("Реестр");
  const extract = wb.getWorksheet("2-source (filtred)");
  if (registry) {
    registry.eachRow((row: { values: unknown[] }, r: number) => {
      if (r < 4) return;
      const v = row.values.map(V);
      if (String(v[2] ?? "") !== "Исх") return; // outgoing only: incoming are Fargo's purchases (TI's invoices)
      out.push({ date: iso(v[10]), status: String(v[3] ?? ""), product: String(v[15] ?? ""), qty: Number(v[25]) || 0, price: Number(v[28]) || 0, net: Number(v[29]) || 0, gross: Number(v[32]) || 0 });
    });
  } else if (extract) {
    extract.eachRow((row: { values: unknown[] }, r: number) => {
      if (r === 1) return;
      const v = row.values.slice(1).map(V);
      if (!v[2]) return;
      out.push({ date: iso(v[0]), status: String(v[7] ?? ""), product: String(v[2]), qty: Number(v[3]) || 0, price: Number(v[4]) || 0, net: Number(v[5]) || 0, gross: Number(v[6]) || 0 });
    });
  } else throw new Error("neither a «Реестр» nor a «2-source (filtred)» sheet in " + file);
  return out.filter((l) => /humana/i.test(l.product));
}

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) throw new Error("usage: import-fargo-esf.ts <file.xlsx> [--from YYYY-MM] [--to YYYY-MM] [--commit]");
  const commit = process.argv.includes("--commit");
  const lines = await readLines(file);
  const unknown = [...new Set(lines.filter((l) => !SKU[norm(l.product)]).map((l) => l.product))];
  if (unknown.length) throw new Error("Humana names without a SKU: " + unknown.join(" ; "));
  const dates = lines.map((l) => l.date).sort();
  const first = dates[0].slice(0, 7), lastDate = dates[dates.length - 1];
  const [y, m] = lastDate.slice(0, 7).split("-").map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const prevMonth = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const from = arg("--from") ?? first;
  const to = arg("--to") ?? (lastDate === monthEnd ? lastDate.slice(0, 7) : prevMonth);
  console.log(`${basename(file)}: ${lines.length} Humana lines, ${dates[0]} … ${lastDate}; loading whole months ${from} … ${to}`);

  const { prisma } = await import("../src/lib/db");
  const products = await prisma.product.findMany({ where: { isPromo: false } });
  const idOf = (name: string) => {
    const p = products.filter((x) => x.nameRu.trim() === name);
    if (p.length !== 1) throw new Error(`product "${name}": ${p.length} matches`);
    return p[0].id;
  };
  const months: FargoEsfStore["months"] = {};
  const skipped: Record<string, number> = {};
  for (const l of lines) {
    const month = l.date.slice(0, 7);
    if (month < from || month > to) continue;
    if (!COUNTED.has(l.status)) {
      skipped[l.status] = (skipped[l.status] ?? 0) + 1;
      continue;
    }
    const sign = l.net < 0 || l.price < 0 ? -1 : 1;
    const row = ((months[month] ??= {})[idOf(SKU[norm(l.product)])] ??= { qty: 0, amount: 0, lines: 0 });
    row.qty += sign * Math.abs(l.qty);
    row.amount += l.gross;
    row.lines += 1;
  }
  console.log("not counted (status):", JSON.stringify(skipped));

  // what the split gives next to the app's 1C sales
  const sales = await prisma.sale.findMany({ where: { monthId: { gte: from, lte: to } }, include: { product: true } });
  const sold: Record<string, number> = {};
  for (const s of sales) sold[s.monthId] = (sold[s.monthId] ?? 0) + s.qty;
  console.log("month | e-invoiced tins | amount incl. VAT | sold (1C) | cash tins");
  for (const [month, byProduct] of Object.entries(months).sort()) {
    const q = Object.values(byProduct).reduce((a, x) => a + x.qty, 0), a = Object.values(byProduct).reduce((s, x) => s + x.amount, 0);
    console.log(`  ${month} | ${fmt(q)} | ${fmt(a)} | ${fmt(sold[month] ?? 0)} | ${fmt((sold[month] ?? 0) - q)}`);
  }

  const row = await prisma.setting.findUnique({ where: { key: FARGO_ESF_KEY } });
  const store = parseFargoEsf(row?.value);
  const replaced = Object.keys(months).filter((mo) => store.months[mo]);
  for (const [mo, x] of Object.entries(months)) store.months[mo] = x;
  store.sources.push({ file: basename(file), months: Object.keys(months).sort(), importedAt: new Date().toISOString() });
  console.log(`months ${Object.keys(months).length} (replacing ${replaced.length}); the store then holds ${Object.keys(store.months).length} months`);
  if (!commit) {
    console.log("Dry run — nothing written.");
    await prisma.$disconnect();
    return;
  }
  const value = JSON.stringify(store);
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: FARGO_ESF_KEY }, update: { value }, create: { key: FARGO_ESF_KEY, value } }),
    prisma.auditLog.create({ data: { entity: "setting", entityId: FARGO_ESF_KEY, action: row ? "UPDATE" : "CREATE", data: JSON.stringify({ file: basename(file), months: Object.keys(months).sort(), replaced }), username: "import-fargo-esf" } }),
  ]);
  console.log("Written.");
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
