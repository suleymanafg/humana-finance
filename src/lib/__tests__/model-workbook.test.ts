import { describe, expect, it } from "vitest";
import type ExcelJS from "exceljs";
import { compute } from "../engine/compute";
import { fixture } from "../engine/__tests__/fixture";
import { modelWorkbook } from "../model-workbook";

/** the row whose first cell matches, and its formula cells' stored results by month header */
function line(wb: ExcelJS.Workbook, sheet: string, label: RegExp): Record<number, unknown> {
  const ws = wb.getWorksheet(sheet)!;
  const head = ws.getRow(3);
  let found: ExcelJS.Row | null = null;
  ws.eachRow((row) => {
    if (!found && label.test(String(row.getCell(1).value ?? ""))) found = row;
  });
  if (!found) throw new Error(`no line ${label} on ${sheet}`);
  const out: Record<number, unknown> = {};
  (found as ExcelJS.Row).eachCell((cell, col) => {
    const month = head.getCell(col).value;
    const v = cell.value as { formula?: string; result?: unknown } | null;
    if (typeof month === "number" && v && typeof v === "object" && v.formula) out[month] = v.result;
  });
  return out;
}

describe("model workbook", () => {
  const ds = fixture();
  const c = compute(ds);

  it("has the statement and data tabs in both languages", () => {
    expect(modelWorkbook(ds, c, "2025-10", "ru").worksheets.map((w) => w.name)).toContain("ОПиУ Fargo");
    const en = modelWorkbook(ds, c, "2025-10", "en").worksheets.map((w) => w.name);
    expect(en).toEqual(expect.arrayContaining(["P&L TI", "P&L Fargo", "P&L Consolidated", "BS TI", "Settlement", "COGS", "Stock", "Sales", "TI invoices", "App check"]));
  });

  it("stores the app's figures with the statement formulas", () => {
    const wb = modelWorkbook(ds, c, "2025-10", "en");
    const net = line(wb, "P&L Fargo", /^NET PROFIT/);
    c.fargo.forEach((f) => expect(net[Number(f.monthId.replace("-", ""))]).toBeCloseTo(f.netProfit, 6));
    const tiNet = line(wb, "P&L TI", /^NET PROFIT/);
    expect(tiNet[202509]).toBeCloseTo(c.ti[1].netProfit, 6);
  });

  it("works out each company's VAT on its own tab, as the engine does", () => {
    const wb = modelWorkbook(ds, c, "2025-10", "en");
    expect(wb.worksheets[0].name).toBe("Contents");
    const credit = line(wb, "VAT Fargo", /^VAT CREDIT AT MONTH-END/);
    const paid = line(wb, "VAT Fargo", /^VAT paid to the state/);
    // ExcelJS keeps no stored result for a zero, so a missing one reads as 0
    const at = (rec: Record<number, unknown>, m: string) => Number(rec[Number(m.replace("-", ""))] ?? 0);
    c.fargo.forEach((f) => {
      expect(at(credit, f.monthId)).toBeCloseTo(f.vat.creditOut, 6);
      expect(at(paid, f.monthId)).toBeCloseTo(f.vat.paid, 6);
    });
    const ours = line(wb, "VAT TI", /^OURS \(the joint work\)/);
    c.ti.forEach((x) => expect(at(ours, x.monthId)).toBeCloseTo(x.vat.jvPosition, 6));
  });

  it("stops at the report month", () => {
    const wb = modelWorkbook(ds, c, "2025-09", "en");
    expect(Object.keys(line(wb, "P&L Fargo", /^Revenue$/))).toEqual(["202508", "202509"]);
  });
});
