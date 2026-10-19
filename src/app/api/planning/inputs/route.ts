// The owner's say in supply planning (ADMIN): one PlanningInput row per
// (kind, sku, month). value null removes the row (back to the engine's own).
// POST { kind, skuId?, monthKey?, value: number | null, note? }
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

const KINDS: Record<string, { sku: boolean; month: boolean; min: number; max: number }> = {
  SHORT: { sku: true, month: true, min: 0, max: 1 },
  OWN_DEMAND: { sku: true, month: false, min: 0, max: 1_000_000 },
  OWN_SHARE: { sku: true, month: false, min: 0, max: 1 },
  TARGET: { sku: false, month: true, min: 0, max: 12 },
  // HQ's open quantity less the app's count (the difference is stored, so later trucks still collect from it)
  OPEN_FIX: { sku: true, month: false, min: -10_000_000, max: 10_000_000 },
};

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await request.json()) as { kind?: string; skuId?: string; monthKey?: string; value?: number | null; note?: string };
  const rule = KINDS[body.kind ?? ""];
  if (!rule) return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  const skuId = rule.sku ? String(body.skuId ?? "") : "";
  const monthKey = rule.month ? String(body.monthKey ?? "") : "";
  if (rule.sku && !skuId) return NextResponse.json({ error: "skuId required" }, { status: 400 });
  if (rule.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return NextResponse.json({ error: "monthKey: YYYY-MM" }, { status: 400 });
  const where = { kind_skuId_monthKey: { kind: body.kind!, skuId, monthKey } };

  if (body.value === null || body.value === undefined) {
    await prisma.planningInput.deleteMany({ where: { kind: body.kind!, skuId, monthKey } });
  } else {
    const value = Number(body.value);
    if (!Number.isFinite(value) || value < rule.min || value > rule.max) return NextResponse.json({ error: `value: ${rule.min}–${rule.max}` }, { status: 400 });
    await prisma.planningInput.upsert({
      where,
      create: { kind: body.kind!, skuId, monthKey, value, note: body.note ?? null, updatedBy: session.username },
      update: { value, note: body.note ?? null, updatedBy: session.username },
    });
  }
  await prisma.auditLog.create({
    data: { entity: "planningInput", entityId: `${body.kind}:${skuId}:${monthKey}`, action: body.value == null ? "DELETE" : "UPSERT", data: JSON.stringify({ value: body.value ?? null }), username: session.username },
  });
  return NextResponse.json({ ok: true });
}
