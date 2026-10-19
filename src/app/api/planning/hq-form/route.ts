// Fills HQ's order form with a pick-up's trucks (ADMIN). The owner uploads
// HQ's latest form; it comes back filled — nothing is stored.
// POST multipart: file (.xlsx), trucks (JSON [{ units: { skuId: qty } }]), name?
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fillHqForm } from "@/lib/planning/hq-form";

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "file is larger than 15 MB" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "Нужна форма HQ в .xlsx / Use HQ's form as .xlsx" }, { status: 400 });
  let trucks: { units: Record<string, number> }[];
  try {
    trucks = JSON.parse(String(form.get("trucks") ?? "[]"));
  } catch {
    return NextResponse.json({ error: "trucks: JSON" }, { status: 400 });
  }
  if (!Array.isArray(trucks) || trucks.length === 0) return NextResponse.json({ error: "trucks required" }, { status: 400 });

  const rows = await prisma.planningSku.findMany({ select: { id: true, article: true, altArticles: true, name: true } });
  const skus = rows.map((s) => ({ id: s.id, article: s.article, altArticles: (s.altArticles ?? "").split(/[,\s]+/).filter(Boolean), name: s.name }));
  try {
    const { file: out } = await fillHqForm(new Uint8Array(await file.arrayBuffer()), skus, trucks.map((t) => t.units ?? {}));
    const name = String(form.get("name") ?? "").replace(/[^\w .()-]/g, "").trim() || "Order Form - Turbo Impex";
    return new NextResponse(Buffer.from(out), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}.xlsx"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "could not fill the form" }, { status: 400 });
  }
}
