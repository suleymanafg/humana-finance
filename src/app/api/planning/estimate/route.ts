// Keeps the supply plan's estimate as it stands now for the current month (ADMIN),
// replacing one already kept — closing the month before does it on its own.
// POST {}
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { savePlanEstimate } from "@/lib/planning/estimates";

export async function POST() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const r = await savePlanEstimate(session.username, { overwrite: true });
  return NextResponse.json({ ok: r.saved, monthId: r.monthId });
}
