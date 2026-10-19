// Loads verified prescriptions from the foil tracking workbook (ADMIN). Without
// apply it reports each month's total next to what the app has; with apply=1
// it writes the closed months (the month in progress is left out — its foils
// are still coming in).
// POST multipart: file, apply=1?
import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { todayInTashkent } from "@/lib/planning/data";
import { foilMonths, type FoilCell } from "@/lib/planning/foil-import";

const MAX_BYTES = 15 * 1024 * 1024;

function cell(v: ExcelJS.CellValue): FoilCell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string" || v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v) return cell(v.result as ExcelJS.CellValue);
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
  const apply = form.get("apply") === "1";
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "file is larger than 15 MB" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "Нужен файл .xlsx / Use the .xlsx file" }, { status: 400 });

  const rows: FoilCell[][] = [];
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Foil Tracking");
    if (!ws) return NextResponse.json({ error: "Нет листа «Foil Tracking» / No «Foil Tracking» sheet" }, { status: 400 });
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as ExcelJS.CellValue[];
      const out: FoilCell[] = [];
      for (let i = 1; i <= 11; i++) out.push(cell(values[i]));
      rows.push(out);
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "could not read the file" }, { status: 400 });
  }

  const { months, skipped } = foilMonths(rows);
  const thisMonth = todayInTashkent().slice(0, 7);
  const current = await prisma.planningRecruitment.findMany();
  const have = Object.fromEntries(current.map((r) => [r.monthKey, r.babies]));
  const lines = Object.entries(months)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, m]) => ({ monthKey, foils: m.foils, paid: Math.round(m.paid), now: have[monthKey] ?? null, closed: monthKey < thisMonth }));

  if (apply) {
    const write = lines.filter((l) => l.closed && l.foils !== l.now);
    for (const l of write) {
      await prisma.planningRecruitment.upsert({ where: { monthKey: l.monthKey }, create: { monthKey: l.monthKey, babies: l.foils }, update: { babies: l.foils } });
    }
    await prisma.auditLog.create({
      data: { entity: "planningRecruitment", entityId: "foil-import", action: "UPSERT", data: JSON.stringify(write.map((l) => ({ m: l.monthKey, babies: l.foils }))), username: session.username },
    });
    return NextResponse.json({ ok: true, written: write.length, lines, skipped });
  }
  return NextResponse.json({ ok: true, lines, skipped });
}
