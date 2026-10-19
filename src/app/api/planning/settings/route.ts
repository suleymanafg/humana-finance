// Supply-planning engine settings (ADMIN): tins per baby, lead time, truck
// places and fill, pick-up horizon, danger line, default stock target.
// POST partial PlanSettings — merged into Setting "planning.engine".
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PLAN_SETTINGS_KEY, parsePlanSettings, type PlanSettings } from "@/lib/planning/plan-data";

const RANGES: Record<string, [number, number]> = {
  leadDays: [10, 120],
  dispatchDay: [1, 28],
  truckPlaces: [20, 40],
  minFill: [0.5, 1],
  maxFill: [0.5, 1],
  pickupMonths: [0, 4],
  dangerLine: [0, 6],
  defaultTarget: [0.5, 6],
};

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await request.json()) as Partial<PlanSettings>;
  const row = await prisma.setting.findUnique({ where: { key: PLAN_SETTINGS_KEY } });
  const next: PlanSettings = parsePlanSettings(row?.value);
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    const v = (body as Record<string, unknown>)[k];
    if (v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) return NextResponse.json({ error: `${k}: ${lo}–${hi}` }, { status: 400 });
    (next as unknown as Record<string, number>)[k] = n;
  }
  if (body.tinsPerBaby) {
    for (const st of ["P1", "P2", "P3"] as const) {
      const v = body.tinsPerBaby[st];
      if (v === undefined) continue;
      if (!Number.isFinite(v) || v < 0 || v > 3) return NextResponse.json({ error: `tinsPerBaby.${st}: 0–3` }, { status: 400 });
      next.tinsPerBaby[st] = v;
    }
  }
  if ("rxAhead" in body) {
    const v = body.rxAhead;
    if (v !== null && (!Number.isFinite(v) || (v as number) < 0)) return NextResponse.json({ error: "rxAhead" }, { status: 400 });
    next.rxAhead = v ?? null;
  }
  if (next.minFill > next.maxFill) return NextResponse.json({ error: "minFill must not exceed maxFill" }, { status: 400 });
  await prisma.setting.upsert({ where: { key: PLAN_SETTINGS_KEY }, update: { value: JSON.stringify(next) }, create: { key: PLAN_SETTINGS_KEY, value: JSON.stringify(next) } });
  await prisma.auditLog.create({ data: { entity: "setting", entityId: PLAN_SETTINGS_KEY, action: "UPSERT", data: JSON.stringify(next), username: session.username } });
  return NextResponse.json({ ok: true, settings: next });
}
