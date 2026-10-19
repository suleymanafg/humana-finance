// Creates the trucks of a pick-up as PLANNED (ADMIN): agreed loads that are
// not yet ordered. They count for supply planning (and as collected from the
// open IBP quantities in their dispatch month) but never for stock or COGS
// until marked arrived. The truck belongs to its dispatch month until then.
// POST { dispatchDate: "YYYY-MM-DD", trucks: [{ units: { skuId: qty } }] }
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { loadPlanning } from "@/lib/planning/data";
import { PLAN_SETTINGS_KEY, parsePlanSettings } from "@/lib/planning/plan-data";

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await request.json()) as { dispatchDate?: string; trucks?: { units: Record<string, number> }[] };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.dispatchDate ?? "") || !Array.isArray(body.trucks) || body.trucks.length === 0 || body.trucks.length > 6) {
    return NextResponse.json({ error: "dispatchDate and 1–6 trucks required" }, { status: 400 });
  }
  const [skus, months, codes, settingRow, planning] = await Promise.all([
    prisma.planningSku.findMany({ where: { productId: { not: null } }, select: { id: true, productId: true, priceEur: true } }),
    prisma.month.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
    prisma.shipment.findMany({ select: { code: true } }),
    prisma.setting.findUnique({ where: { key: PLAN_SETTINGS_KEY } }),
    loadPlanning(),
  ]);
  const settings = parsePlanSettings(settingRow?.value);
  const dispatch = body.dispatchDate!;
  const eta = new Date(Date.parse(`${dispatch}T00:00:00Z`) + settings.leadDays * 86_400_000);
  const dispatchMonth = dispatch.slice(0, 7);
  const monthId = [...months].reverse().find((m) => m.id <= dispatchMonth)?.id;
  if (!monthId) return NextResponse.json({ error: `no month ${dispatchMonth}` }, { status: 400 });
  let next = Math.max(0, ...codes.map((c) => Number(c.code.match(/(\d+)\s*$/)?.[1] ?? 0))) + 1;

  const created: string[] = [];
  for (const t of body.trucks!) {
    const lines = Object.entries(t.units ?? {})
      .filter(([, q]) => Number.isFinite(q) && q > 0)
      .map(([skuId, qty]) => {
        const s = skus.find((x) => x.id === skuId);
        return s ? { productId: s.productId!, qty: Math.round(qty), priceEur: s.priceEur, rate: planning.eurRate } : null;
      });
    if (lines.some((l) => l === null) || lines.length === 0) return NextResponse.json({ error: "unknown product in a truck" }, { status: 400 });
    const code = `Truck ${next++}`;
    await prisma.shipment.create({
      data: {
        code,
        monthId,
        status: "PLANNED",
        dispatchDate: new Date(`${dispatch}T00:00:00Z`),
        etaDate: eta,
        notes: `Planned from the supply plan (${dispatchMonth})`,
        lines: { create: lines.map((l) => l!) },
      },
    });
    created.push(code);
  }
  await prisma.auditLog.create({
    data: { entity: "shipment", entityId: created.join(","), action: "CREATE", data: JSON.stringify({ status: "PLANNED", dispatch, trucks: body.trucks }), username: session.username },
  });
  return NextResponse.json({ ok: true, created });
}
