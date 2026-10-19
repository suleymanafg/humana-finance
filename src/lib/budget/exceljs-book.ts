// A budget workbook opened with ExcelJS, behind the reader interface the
// budget's workbook parser uses (server only).
import ExcelJS from "exceljs";
import type { BookCell, BudgetBook } from "./workbook";

function toCell(c: ExcelJS.Cell): BookCell | undefined {
  const v = c.value;
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number" || typeof v === "string") return { v, w: c.text };
  if (typeof v === "boolean") return { v: v ? 1 : 0 };
  if (v instanceof Date) return { v: v.getTime() / 86400000 + 25569 };
  if (typeof v === "object") {
    if ("formula" in v || "sharedFormula" in v) {
      const r = (v as ExcelJS.CellFormulaValue).result;
      const f = "formula" in v && v.formula ? v.formula : (v as ExcelJS.CellSharedFormulaValue).sharedFormula;
      return { v: typeof r === "number" || typeof r === "string" ? r : null, f, w: typeof r === "string" ? r : c.text };
    }
    if ("richText" in v) {
      const text = v.richText.map((t) => t.text).join("");
      return { v: text, w: text };
    }
  }
  return undefined;
}

export async function bookFromXlsx(data: ArrayBuffer): Promise<BudgetBook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const names = new Map<string, string>();
  const model = (wb.definedNames as unknown as { model: { name: string; ranges: string[] }[] }).model ?? [];
  for (const d of model) if (d.ranges?.length) names.set(d.name.toUpperCase(), d.ranges[0]);
  return {
    sheetNames: wb.worksheets.map((w) => w.name),
    cell: (sheet, a1) => {
      const ws = wb.getWorksheet(sheet);
      return ws ? toCell(ws.getCell(a1)) : undefined;
    },
    name: (n) => names.get(n.toUpperCase()),
  };
}
