// Reads an uploaded .xlsx or .csv into plain rows so the owner can map its
// columns in the browser (ADMIN). Nothing is stored.
import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { requireAdmin } from "@/lib/auth";

type Cell = string | number | null;
const MAX_ROWS = 5000;
const MAX_BYTES = 10 * 1024 * 1024;

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") return v.trim();
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((t) => t.text).join("").trim();
    if ("text" in v) return String(v.text).trim();
    if ("error" in v) return null;
  }
  return String(v);
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "file is larger than 10 MB" }, { status: 400 });
  const name = file.name.toLowerCase();

  try {
    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      const parsed = Papa.parse<string[]>(await file.text(), { skipEmptyLines: true });
      const rows = parsed.data.slice(0, MAX_ROWS).map((r) => r.map((c) => (c?.trim() ? c.trim() : null)));
      return NextResponse.json({ sheets: [{ name: file.name, rows }] });
    }
    if (!name.endsWith(".xlsx") && !name.endsWith(".xlsm")) {
      return NextResponse.json(
        { error: "Нужен файл .xlsx или .csv (старый .xls пересохраните как .xlsx) / Use .xlsx or .csv (save an old .xls as .xlsx)" },
        { status: 400 }
      );
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer);
    const sheets = wb.worksheets.map((ws) => {
      const rows: Cell[][] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        if (rows.length >= MAX_ROWS) return;
        const values = row.values as ExcelJS.CellValue[]; // 1-based
        const out: Cell[] = [];
        for (let i = 1; i < values.length; i++) out.push(cellValue(values[i]));
        rows.push(out);
      });
      return { name: ws.name, rows };
    });
    return NextResponse.json({ sheets: sheets.filter((s) => s.rows.length > 0) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "could not read the file" }, { status: 400 });
  }
}
