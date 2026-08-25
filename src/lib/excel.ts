// Shared .xlsx writer so every download looks like one report pack:
// a title line, an indigo header band, real numbers (never text) with thousands
// separators, sized columns, frozen headers and ruled total rows.
import ExcelJS from "exceljs";

export const ACCENT = "FF1F108E"; // the app's indigo
const HEADER_BG = "FFEEF0FD";
const HEADER_FG = "FF3A3A6E";
const RULE = "FFC8C4D5";

export const MONEY = "#,##0";
export const MONEY2 = "#,##0.00";
export const PCT = "0.0%";

export interface Column {
  header: string;
  width?: number;
  /** numFmt for numeric columns; omit for text */
  numFmt?: string;
}

/** A live Excel formula with its cached result (shown until recalculation). */
export interface FormulaCell {
  formula: string;
  result?: number;
}
export const isFormula = (v: unknown): v is FormulaCell =>
  typeof v === "object" && v !== null && "formula" in v;

export type CellValue = string | number | null | FormulaCell;

/** 1-based worksheet row of data row 0 (after title, optional subtitle, header). */
export const firstDataRow = (hasSubtitle: boolean) => (hasSubtitle ? 4 : 3);

export interface SheetSpec {
  name: string;
  title: string;
  subtitle?: string;
  columns: Column[];
  rows: Array<Array<CellValue>>;
  /** 0-based indexes of rows that are totals/subtotals (bold + top rule) */
  boldRows?: number[];
  /** 0-based indexes of rows that are section headings (indigo, no numbers) */
  sectionRows?: number[];
  /** freeze after this many leading columns (default 1) */
  freezeCols?: number;
}

export function buildWorkbook(sheets: SheetSpec[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Humana Finance";
  wb.created = new Date();

  for (const spec of sheets) {
    const ws = wb.addWorksheet(spec.name.slice(0, 31), {
      views: [{ state: "frozen", xSplit: spec.freezeCols ?? 1, ySplit: spec.subtitle ? 3 : 2 }],
    });
    const lastCol = Math.max(1, spec.columns.length);

    // title
    ws.mergeCells(1, 1, 1, lastCol);
    const title = ws.getCell(1, 1);
    title.value = spec.title;
    title.font = { name: "Calibri", size: 14, bold: true, color: { argb: ACCENT } };
    title.alignment = { vertical: "middle" };
    ws.getRow(1).height = 22;

    let headerRowIdx = 2;
    if (spec.subtitle) {
      ws.mergeCells(2, 1, 2, lastCol);
      const sub = ws.getCell(2, 1);
      sub.value = spec.subtitle;
      sub.font = { name: "Calibri", size: 10, color: { argb: "FF64748B" } };
      headerRowIdx = 3;
    }

    // header band
    const header = ws.getRow(headerRowIdx);
    spec.columns.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.value = c.header;
      cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: HEADER_FG } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
      cell.alignment = { vertical: "middle", horizontal: c.numFmt ? "right" : "left", wrapText: true };
      cell.border = { bottom: { style: "thin", color: { argb: RULE } } };
    });
    header.height = 20;

    // data
    spec.rows.forEach((row, r) => {
      const excelRow = ws.getRow(headerRowIdx + 1 + r);
      const isBold = spec.boldRows?.includes(r) ?? false;
      const isSection = spec.sectionRows?.includes(r) ?? false;
      row.forEach((value, i) => {
        const col = spec.columns[i];
        const cell = excelRow.getCell(i + 1);
        const numeric = typeof value === "number" || isFormula(value);
        if (isFormula(value)) {
          cell.value = { formula: value.formula, result: value.result } as ExcelJS.CellFormulaValue;
        } else {
          cell.value = value === "" ? null : value;
        }
        cell.font = {
          name: "Calibri",
          size: 10,
          bold: isBold || isSection,
          color: { argb: isSection ? ACCENT : "FF0B1C30" },
        };
        if (numeric && col?.numFmt) cell.numFmt = col.numFmt;
        cell.alignment = { horizontal: numeric ? "right" : "left" };
        if (isBold) cell.border = { top: { style: "thin", color: { argb: RULE } } };
        if (isSection) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F7FB" } };
        }
      });
    });

    spec.columns.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.width ?? (c.numFmt ? 16 : 28);
    });
    ws.autoFilter = undefined;
  }
  return wb;
}

export async function workbookResponse(wb: ExcelJS.Workbook, filename: string): Promise<Response> {
  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String((buffer as ArrayBuffer).byteLength),
    },
  });
}
