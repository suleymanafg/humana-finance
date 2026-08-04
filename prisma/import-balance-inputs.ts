import "dotenv/config";
// Loads the three manual-input tabs from the owner's workbook:
//   Investments      → CapitalContribution (TI/Fargo) + FargoTransfer (cash/bank)
//   Month-End Stock  → StockCount (all into «Основной склад» — the workbook
//                      keeps no warehouse split)
//   Monthly AR       → ArEntry (per customer per month)
// Every block is tied to the control totals printed in the workbook itself.
//   npx tsx prisma/import-balance-inputs.ts [--commit]
import * as XLSX from "xlsx";
import { newPrismaClient } from "../src/lib/prisma-factory";

const FILE =
  "H:/My Drive/Files/Nutriben Company Docs/Humana/1. Humana Reports/Humana P&L - 2026 - Begzod Uchun.xlsx";
const WAREHOUSE_ID = "wh-main";
const COMMIT = process.argv.includes("--commit");

const prisma = newPrismaClient();

interface MonthBalanceDraft {
  tiBank: number;
  goodsInTransit: number;
  vatPrepayment: number;
  priorVatBalance: number;
  nutribenLoan: number;
}

const wb = XLSX.readFile(FILE);
const grid = (name: string) =>
  XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null, raw: true });

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** Excel serial → ISO date (UTC midnight) */
const excelDate = (serial: unknown): string | null => {
  const s = num(serial);
  if (s <= 0) return null;
  return new Date(Math.round((s - 25569) * 86400 * 1000)).toISOString();
};
const money = (v: number) => Math.round(v).toLocaleString("en-US");
const tie = (label: string, actual: number, expected: number) => {
  const ok = Math.abs(actual - expected) < 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${money(actual)}${ok ? "" : ` vs workbook ${money(expected)}`}`);
  return ok;
};

async function main() {
  console.log(COMMIT ? "=== COMMIT ===" : "=== DRY RUN (add --commit to write) ===");
  let allTied = true;

  // ── Investments: capital contributions + Fargo→TI payments ──
  const inv = grid("Investments");
  const contributions: Array<{ date: string; tiAmount: number; fargoAmount: number }> = [];
  const transfers: Array<{ date: string; cashAmount: number; bankAmount: number }> = [];
  for (const row of inv.slice(3)) {
    const cDate = excelDate(row[1]);
    if (cDate && (num(row[2]) !== 0 || num(row[3]) !== 0)) {
      contributions.push({ date: cDate, tiAmount: num(row[2]), fargoAmount: num(row[3]) });
    }
    const tDate = excelDate(row[6]);
    if (tDate && (num(row[7]) !== 0 || num(row[8]) !== 0)) {
      transfers.push({ date: tDate, cashAmount: num(row[7]), bankAmount: num(row[8]) });
    }
  }
  // control totals live in the summary block (col K label / col L value)
  const summary = new Map<string, number>();
  for (const row of inv) {
    const label = typeof row[10] === "string" ? row[10].trim() : "";
    if (label && typeof row[11] === "number") summary.set(label, row[11]);
  }
  console.log(`\nInvestments — ${contributions.length} вкладов, ${transfers.length} платежей`);
  allTied =
    tie(
      "Инвестиции TI",
      contributions.reduce((s, c) => s + c.tiAmount, 0),
      summary.get("Инвестиции TI / TI Capital Invested") ?? 0
    ) && allTied;
  allTied =
    tie(
      "Инвестиции Fargo",
      contributions.reduce((s, c) => s + c.fargoAmount, 0),
      summary.get("Инвестиции Fargo / Fargo Capital Invested") ?? 0
    ) && allTied;
  allTied =
    tie(
      "Платежи наличными",
      transfers.reduce((s, t) => s + t.cashAmount, 0),
      summary.get("Наличные / Cash Payments") ?? 0
    ) && allTied;
  allTied =
    tie(
      "Платежи банком",
      transfers.reduce((s, t) => s + t.bankAmount, 0),
      summary.get("Банк / Bank Payments") ?? 0
    ) && allTied;

  // ── Month-End Stock ──
  const stockGrid = grid("Month-End Stock");
  const monthHeader = stockGrid[1] ?? [];
  const RU_MONTHS = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
  ];
  const monthCols: Array<{ monthId: string; col: number; label: string }> = [];
  monthHeader.forEach((cell, col) => {
    if (typeof cell !== "string") return;
    const [name, year] = cell.trim().split(/\s+/);
    const idx = RU_MONTHS.indexOf(name);
    if (idx >= 0 && year) monthCols.push({ monthId: `${year}-${String(idx + 1).padStart(2, "0")}`, col, label: cell.trim() });
  });

  const products = await prisma.product.findMany({ where: { isPromo: false } });
  const stock: Array<{ monthId: string; productId: string; qty: number }> = [];
  const unmatched: string[] = [];
  const totalsRow = stockGrid.find((r) => typeof r[1] === "string" && r[1].includes("ИТОГО"));
  for (const row of stockGrid.slice(3)) {
    const label = typeof row[1] === "string" ? row[1].trim() : "";
    if (!label || label.includes("ИТОГО")) continue;
    const name = label.replace(/,\s*шт\.?$/i, "").trim();
    const product = products.find((p) => p.nameRu === name);
    if (!product) {
      unmatched.push(label);
      continue;
    }
    for (const m of monthCols) {
      const qty = num(row[m.col]);
      if (qty !== 0) stock.push({ monthId: m.monthId, productId: product.id, qty });
    }
  }
  const stockMonths = [...new Set(stock.map((s) => s.monthId))].sort();
  console.log(`\nMonth-End Stock — ${stock.length} строк, месяцы: ${stockMonths.join(", ") || "—"}`);
  for (const m of monthCols) {
    const mine = stock.filter((s) => s.monthId === m.monthId).reduce((a, s) => a + s.qty, 0);
    const expected = num(totalsRow?.[m.col]);
    if (mine === 0 && expected === 0) continue;
    allTied = tie(`${m.label} (шт.)`, mine, expected) && allTied;
  }
  if (unmatched.length) console.log("  ⚠ товары без соответствия:", unmatched.join(" | "));

  // ── Monthly AR ──
  const arGrid = grid("Monthly AR");
  const arHeaderIdx = arGrid.findIndex((r) => typeof r[0] === "string" && r[0].includes("Клиент"));
  const arHeader = arGrid[arHeaderIdx] ?? [];
  const arCols: Array<{ monthId: string; col: number; label: string }> = [];
  arHeader.forEach((cell, col) => {
    if (col === 0 || typeof cell !== "string") return;
    const [name, year] = cell.trim().split(/\s+/);
    const idx = RU_MONTHS.indexOf(name);
    if (idx >= 0 && year) arCols.push({ monthId: `${year}-${String(idx + 1).padStart(2, "0")}`, col, label: cell.trim() });
  });
  const ar: Array<{ monthId: string; customerName: string; amount: number }> = [];
  let arTotalsRow: unknown[] | undefined;
  for (const row of arGrid.slice(arHeaderIdx + 1)) {
    const name = typeof row[0] === "string" ? row[0].trim() : "";
    if (!name) continue;
    if (name.includes("ИТОГО")) {
      arTotalsRow = row;
      break;
    }
    for (const m of arCols) {
      const amount = num(row[m.col]);
      if (amount !== 0) ar.push({ monthId: m.monthId, customerName: name, amount });
    }
  }
  const arMonths = [...new Set(ar.map((a) => a.monthId))].sort();
  console.log(`\nMonthly AR — ${ar.length} строк, месяцы: ${arMonths.join(", ") || "—"}`);
  for (const m of arCols) {
    const mine = ar.filter((a) => a.monthId === m.monthId).reduce((a, x) => a + x.amount, 0);
    const expected = num(arTotalsRow?.[m.col]);
    if (mine === 0 && expected === 0) continue;
    allTied = tie(m.label, mine, expected) && allTied;
  }

  // ── «ПРОЧИЕ ВВОДЫ» (same tab, below the AR block) → MonthBalance ──
  const MB_FIELDS: Array<{ match: string; field: keyof MonthBalanceDraft }> = [
    { match: "Р/С TI", field: "tiBank" },
    { match: "Товар в пути", field: "goodsInTransit" },
    { match: "Предоплата НДС", field: "vatPrepayment" },
    { match: "Остаток НДС", field: "priorVatBalance" },
    { match: "Займ Nutriben", field: "nutribenLoan" },
  ];
  const otherIdx = arGrid.findIndex(
    (r) => typeof r[0] === "string" && r[0].includes("ПРОЧИЕ ВВОДЫ")
  );
  const balances = new Map<string, MonthBalanceDraft>();
  if (otherIdx >= 0) {
    // the section repeats the same month columns as the AR block
    for (const row of arGrid.slice(otherIdx + 2)) {
      const label = typeof row[0] === "string" ? row[0].trim() : "";
      if (!label) continue;
      const spec = MB_FIELDS.find((f) => label.startsWith(f.match));
      if (!spec) continue;
      for (const m of arCols) {
        const v = num(row[m.col]);
        if (v === 0) continue;
        const b =
          balances.get(m.monthId) ??
          ({ tiBank: 0, goodsInTransit: 0, vatPrepayment: 0, priorVatBalance: 0, nutribenLoan: 0 } as MonthBalanceDraft);
        b[spec.field] = v;
        balances.set(m.monthId, b);
      }
    }
  }
  console.log(`\nПрочие вводы БС — ${balances.size} мес.: ${[...balances.keys()].sort().join(", ") || "—"}`);
  for (const [mid, b] of [...balances.entries()].sort()) {
    console.log(
      `  ${mid}: банк ${money(b.tiBank)} · в пути ${money(b.goodsInTransit)} · НДС предопл. ${money(
        b.vatPrepayment
      )} · НДС остаток ${money(b.priorVatBalance)} · займ ${money(b.nutribenLoan)}`
    );
  }

  // months referenced must exist
  const known = new Set((await prisma.month.findMany()).map((m) => m.id));
  const missingMonths = [...new Set([...stock, ...ar].map((x) => x.monthId))].filter((m) => !known.has(m));
  if (missingMonths.length) console.log("\n⚠ месяцы отсутствуют в справочнике:", missingMonths.join(", "));

  if (!COMMIT) {
    console.log(`\n${allTied ? "всё сходится" : "⚠ ЕСТЬ РАСХОЖДЕНИЯ — не импортировать"} — dry run, ничего не записано`);
    return;
  }
  if (!allTied) throw new Error("control totals do not tie — refusing to write");

  await prisma.$transaction(async (tx) => {
    await tx.capitalContribution.deleteMany({});
    for (const c of contributions) await tx.capitalContribution.create({ data: { ...c, date: new Date(c.date) } });
    await tx.fargoTransfer.deleteMany({});
    for (const t of transfers) await tx.fargoTransfer.create({ data: { ...t, date: new Date(t.date) } });
    // the workbook is authoritative for the months it covers, so clear them
    // first — an upsert-only pass would leave stale rows for products the
    // workbook now reports as zero
    const coveredStockMonths = [...new Set(stock.map((s) => s.monthId))].filter((m) => known.has(m));
    await tx.stockCount.deleteMany({ where: { monthId: { in: coveredStockMonths } } });
    for (const s of stock) {
      if (!known.has(s.monthId)) continue;
      await tx.stockCount.upsert({
        where: {
          monthId_productId_warehouseId: {
            monthId: s.monthId,
            productId: s.productId,
            warehouseId: WAREHOUSE_ID,
          },
        },
        create: { ...s, warehouseId: WAREHOUSE_ID },
        update: { qty: s.qty },
      });
    }
    await tx.arEntry.deleteMany({});
    for (const a of ar) {
      if (!known.has(a.monthId)) continue;
      await tx.arEntry.create({ data: a });
    }
    for (const [monthId, b] of balances) {
      if (!known.has(monthId)) continue;
      await tx.monthBalance.upsert({
        where: { monthId },
        create: { monthId, ...b },
        update: b,
      });
    }
  });
  console.log("\n✓ записано");
}

main().finally(() => prisma.$disconnect());
