// Loads the missing parts of the handover's starting plan (ADMIN). Idempotent.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { seedPlan } from "@/lib/transition/service";

export async function POST() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    return NextResponse.json(await seedPlan(session.username));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
