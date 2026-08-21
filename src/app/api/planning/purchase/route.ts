// Committed purchases (закуп) — the de facto IBP order per SKU per ship
// month. ADMIN only. Accepts one or many lines; qty 0 removes the line.
// POST { shipMonth, lines: [{skuId, qty}] }
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { shipMonth, lines } = (await request.json()) as {
    shipMonth?: string;
    lines?: Array<{ skuId: string; qty: number }>;
  };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(shipMonth ?? "") || !Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json({ error: "shipMonth and lines required" }, { status: 400 });
  }

  for (const l of lines) {
    if (!l.skuId || !Number.isFinite(l.qty) || l.qty < 0) continue;
    if (l.qty === 0) {
      await prisma.planningPurchase.deleteMany({ where: { skuId: l.skuId, shipMonth: shipMonth! } });
    } else {
      await prisma.planningPurchase.upsert({
        where: { skuId_shipMonth: { skuId: l.skuId, shipMonth: shipMonth! } },
        create: { skuId: l.skuId, shipMonth: shipMonth!, qty: l.qty },
        update: { qty: l.qty },
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      entity: "planningPurchase",
      entityId: shipMonth!,
      action: "UPSERT",
      data: JSON.stringify({ lines: lines.slice(0, 40) }),
      username: session.username,
    },
  });
  return NextResponse.json({ ok: true });
}
