// Adds Fargo's recent 1C clients to the outlet register (ADMIN). Existing
// outlets are left untouched.
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { outletsFromSales } from "@/lib/transition/service";

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { months?: number };
  const months = Math.min(Math.max(Math.round(body.months ?? 6), 1), 24);
  try {
    return NextResponse.json(await outletsFromSales(session.username, months));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
