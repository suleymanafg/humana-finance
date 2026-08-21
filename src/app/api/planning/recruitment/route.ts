// Verified prescriptions per month (foil tracking totals). ADMIN only.
// POST { monthKey, babies }
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { monthKey, babies } = (await request.json()) as { monthKey?: string; babies?: number };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey ?? "") || !Number.isFinite(babies) || (babies ?? 0) < 0) {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }
  await prisma.planningRecruitment.upsert({
    where: { monthKey: monthKey! },
    create: { monthKey: monthKey!, babies: babies! },
    update: { babies: babies! },
  });
  await prisma.auditLog.create({
    data: {
      entity: "planningRecruitment",
      entityId: monthKey!,
      action: "UPSERT",
      data: JSON.stringify({ babies }),
      username: session.username,
    },
  });
  return NextResponse.json({ ok: true });
}
