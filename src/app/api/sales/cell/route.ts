// Inline sales-grid editing: upsert one (month, product, channel) cell.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { monthId, productId, channelId, qty } = (await request.json()) as {
    monthId: string;
    productId: string;
    channelId: string;
    qty: number;
  };
  if (!monthId || !productId || !channelId || typeof qty !== "number" || Number.isNaN(qty)) {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  const where = { monthId_productId_channelId: { monthId, productId, channelId } };
  if (qty === 0) {
    await prisma.sale.deleteMany({ where: { monthId, productId, channelId } });
  } else {
    await prisma.sale.upsert({
      where,
      create: { monthId, productId, channelId, qty, source: "MANUAL" },
      update: { qty, source: "MANUAL" },
    });
  }
  await prisma.auditLog.create({
    data: {
      entity: "sale",
      entityId: `${monthId}/${productId}/${channelId}`,
      action: qty === 0 ? "DELETE" : "UPSERT",
      data: JSON.stringify({ qty }),
      username: session.username,
    },
  });
  return NextResponse.json({ ok: true });
}
