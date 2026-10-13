// Loads the ORDERS from DMK's IBP export (ADMIN): "Partner Forecast Input
// Qty." per SKU per ship month, from a ship month on. Without `apply` it only
// reports what would change; with apply=1 it writes PlanningPurchase (0
// removes a line) and stamps planning.ibpSyncedAt. Collected and still-due
// quantities stay the app's own (trucks), never DMK's.
// POST multipart: file, from=YYYY-MM, apply=1?
import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ibpChanges, ibpWrites, parseIbpExport, type Cell } from "@/lib/planning/ibp-export";
import { todayInTashkent } from "@/lib/planning/data";

const MAX_BYTES = 5 * 1024 * 1024;

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string" || v instanceof Date) return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") {
    if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if ("error" in v) return null;
  }
  return String(v);
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const form = await request.formData();
  const file = form.get("file");
  const from = String(form.get("from") ?? "");
  const apply = form.get("apply") === "1";
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "file is larger than 5 MB" }, { status: 400 });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(from)) return NextResponse.json({ error: "from: YYYY-MM" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return NextResponse.json({ error: "Нужен файл .xlsx из IBP / Use the .xlsx export from IBP" }, { status: 400 });
  }

  let rows: Cell[][] = [];
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    ws?.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as ExcelJS.CellValue[]; // 1-based
      const out: Cell[] = [];
      for (let i = 1; i < values.length; i++) out.push(cellValue(values[i]));
      rows.push(out);
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "could not read the file" }, { status: 400 });
  }
  const parsed = parseIbpExport(rows);
  rows = [];
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const [skus, purchases] = await Promise.all([
    prisma.planningSku.findMany({ select: { id: true, article: true, altArticles: true, name: true } }),
    prisma.planningPurchase.findMany({ select: { skuId: true, shipMonth: true, qty: true } }),
  ]);
  const current: Record<string, Record<string, number>> = {};
  for (const p of purchases) (current[p.skuId] ??= {})[p.shipMonth] = p.qty;
  const { changes, unmatched } = ibpChanges(parsed, skus, current, from);

  if (apply) {
    const w = ibpWrites(changes);
    const orderWrites =
      changes.length > 0
        ? [
            prisma.planningPurchase.deleteMany({ where: { OR: w.clear } }),
            prisma.planningPurchase.createMany({ data: w.create }),
          ]
        : [];
    await prisma.$transaction([
      ...orderWrites,
      prisma.setting.upsert({
        where: { key: "planning.ibpSyncedAt" },
        create: { key: "planning.ibpSyncedAt", value: todayInTashkent() },
        update: { value: todayInTashkent() },
      }),
      prisma.auditLog.create({
        data: {
          entity: "planningPurchase",
          entityId: `ibp-import ${from}`,
          action: "UPSERT",
          data: JSON.stringify({ file: file.name, changes: changes.slice(0, 200) }),
          username: session.username,
        },
      }),
    ]);
  }
  return NextResponse.json({ months: parsed.months, changes, unmatched, applied: apply });
}
