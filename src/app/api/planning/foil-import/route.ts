// Loads verified prescriptions from the foil tracking workbook (ADMIN). Without
// apply it reports each month's total next to what the app has, and the detail
// (regions, reps, doctors); with apply=1 it writes the closed months' totals
// (the month in progress is left out — its foils are still coming in) and
// replaces every detailed line (MedFoil) with the file's, the month in progress
// included, for the medical team's view.
// POST multipart: file, apply=1?
import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { todayInTashkent } from "@/lib/planning/data";
import { foilLines, foilMonths, type FoilCell } from "@/lib/planning/foil-import";

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
      for (let i = 1; i <= 13; i++) out.push(cell(values[i]));
      rows.push(out);
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "could not read the file" }, { status: 400 });
  }

  const { months, skipped } = foilMonths(rows);
  const { lines: detail } = foilLines(rows);
  const unmatched = [...new Set(detail.filter((d) => !d.regionIso).map((d) => d.regionName || "—"))];
  const summary = {
    lines: detail.length,
    foils: detail.reduce((t, d) => t + d.foils, 0),
    regions: new Set(detail.map((d) => d.regionIso).filter(Boolean)).size,
    reps: new Set(detail.map((d) => d.rep).filter(Boolean)).size,
    doctors: new Set(detail.map((d) => d.doctor).filter(Boolean)).size,
    unmatchedRegions: unmatched,
  };
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
    // the detail: the file is cumulative, so its lines replace all of them
    const source = file.name.slice(0, 120);
    const data = detail.map((d) => ({ ...d, date: d.date ? new Date(`${d.date}T00:00:00Z`) : null, source }));
    await prisma.$transaction([
      prisma.medFoil.deleteMany({}),
      ...Array.from({ length: Math.ceil(data.length / 400) }, (_, i) => prisma.medFoil.createMany({ data: data.slice(i * 400, i * 400 + 400) })),
    ]);
    await prisma.auditLog.create({
      data: { entity: "planningRecruitment", entityId: "foil-import", action: "UPSERT", data: JSON.stringify({ totals: write.map((l) => ({ m: l.monthKey, babies: l.foils })), detail: { ...summary, source } }), username: session.username },
    });
    return NextResponse.json({ ok: true, written: write.length, lines, skipped, detail: summary });
  }
  return NextResponse.json({ ok: true, lines, skipped, detail: summary });
}
