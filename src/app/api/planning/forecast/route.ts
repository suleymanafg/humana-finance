// Inline forecast edits from the planning table. ADMIN only — the forecast
// is the owner's own Partner Forecast Input.
// POST { skuId, monthKey, qty }
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { skuId, monthKey, qty } = (await request.json()) as {
    skuId?: string;
    monthKey?: string;
    qty?: number;
  };
  if (!skuId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey ?? "") || !Number.isFinite(qty) || (qty ?? 0) < 0) {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }
  const sku = await prisma.planningSku.findUnique({ where: { id: skuId } });
  if (!sku) return NextResponse.json({ error: "unknown sku" }, { status: 404 });

  await prisma.planningForecast.upsert({
    where: { skuId_monthKey: { skuId, monthKey: monthKey! } },
    create: { skuId, monthKey: monthKey!, qty: qty! },
    update: { qty: qty! },
  });
  await prisma.auditLog.create({
    data: {
      entity: "planningForecast",
      entityId: `${sku.article}/${monthKey}`,
      action: "UPSERT",
      data: JSON.stringify({ qty }),
      username: session.username,
    },
  });
  return NextResponse.json({ ok: true });
}
