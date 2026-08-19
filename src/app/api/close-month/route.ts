// Close or reopen a month. ADMIN only: closing freezes the month's figures
// for STAFF and the 1C feeds, and puts the month onto the P&L; reopening
// reverses that. Both actions are audit-logged.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { monthId, action } = (await request.json()) as {
    monthId?: string;
    action?: "close" | "reopen";
  };
  if (!monthId || (action !== "close" && action !== "reopen")) {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  const month = await prisma.month.findUnique({ where: { id: monthId } });
  if (!month) return NextResponse.json({ error: "unknown month" }, { status: 404 });

  if (action === "close" && month.closedAt) {
    return NextResponse.json({ error: "already closed" }, { status: 400 });
  }
  if (action === "reopen" && !month.closedAt) {
    return NextResponse.json({ error: "not closed" }, { status: 400 });
  }

  await prisma.month.update({
    where: { id: monthId },
    data:
      action === "close"
        ? { closedAt: new Date(), closedBy: session.username }
        : { closedAt: null, closedBy: null },
  });

  await prisma.auditLog.create({
    data: {
      entity: "month",
      entityId: monthId,
      action: action === "close" ? "CLOSE" : "REOPEN",
      data: JSON.stringify({}),
      username: session.username,
    },
  });

  return NextResponse.json({ ok: true });
}
