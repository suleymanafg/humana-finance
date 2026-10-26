// The supply plan's trucks (ADMIN).
// POST — creates the trucks of a pick-up as PLANNED: agreed loads that are not
// yet ordered. They count for supply planning (and as collected from the open
// IBP quantities in their dispatch month) but never for stock or COGS until
// marked arrived. The truck belongs to its dispatch month until then.
//   { dispatchDate: "YYYY-MM-DD", trucks: [{ units: { skuId: qty } }] }
// PATCH — the owner's own composition for planned or ordered trucks: the lines
// are replaced (old ones soft-deleted), each product at its existing price and
// rate on the truck, else the SKU's price and the truck's rate.
//   { trucks: [{ id, units: { skuId: qty } }] }
// DELETE — removes planned trucks (soft delete); their ship month is planned again.
//   { ids: [id, …] }
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
        // the load of this ship month, even if the truck later leaves DMK in another month
        shipMonth: dispatchMonth,
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

const EDITABLE = ["PLANNED", "ORDERED"];

export async function PATCH(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await request.json()) as { trucks?: { id: string; units: Record<string, number> }[] };
  if (!Array.isArray(body.trucks) || body.trucks.length === 0) return NextResponse.json({ error: "trucks required" }, { status: 400 });
  const [skus, planning] = await Promise.all([
    prisma.planningSku.findMany({ where: { productId: { not: null } }, select: { id: true, productId: true, priceEur: true } }),
    loadPlanning(),
  ]);
  const ids = body.trucks.map((t) => t.id);
  const found = await prisma.shipment.findMany({ where: { id: { in: ids }, deletedAt: null }, include: { lines: { where: { deletedAt: null } } } });
  for (const t of body.trucks) {
    const sh = found.find((s) => s.id === t.id);
    if (!sh) return NextResponse.json({ error: `truck not found` }, { status: 404 });
    if (!EDITABLE.includes(sh.status)) return NextResponse.json({ error: `${sh.code}: only planned or ordered trucks can be changed here` }, { status: 400 });
    const entries = Object.entries(t.units ?? {}).filter(([, q]) => Number.isFinite(q) && q > 0);
    if (entries.length === 0) return NextResponse.json({ error: `${sh.code}: a truck needs at least one product (remove it instead)` }, { status: 400 });
    if (entries.some(([id]) => !skus.some((s) => s.id === id))) return NextResponse.json({ error: "unknown product in a truck" }, { status: 400 });
  }
  const changed: string[] = [];
  for (const t of body.trucks) {
    const sh = found.find((s) => s.id === t.id)!;
    const rate = sh.lines[0]?.rate ?? planning.eurRate;
    const lines = Object.entries(t.units)
      .filter(([, q]) => Number.isFinite(q) && q > 0)
      .map(([skuId, qty]) => {
        const s = skus.find((x) => x.id === skuId)!;
        const old = sh.lines.find((l) => l.productId === s.productId);
        return { shipmentId: sh.id, productId: s.productId!, qty: Math.round(qty), priceEur: old?.priceEur ?? s.priceEur, rate: old?.rate ?? rate };
      });
    await prisma.$transaction([
      prisma.shipmentLine.updateMany({ where: { shipmentId: sh.id, deletedAt: null }, data: { deletedAt: new Date() } }),
      prisma.shipmentLine.createMany({ data: lines }),
    ]);
    changed.push(sh.code);
  }
  await prisma.auditLog.create({
    data: { entity: "shipment", entityId: changed.join(","), action: "UPDATE", data: JSON.stringify({ lines: body.trucks }), username: session.username },
  });
  return NextResponse.json({ ok: true, changed });
}

export async function DELETE(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await request.json()) as { ids?: string[] };
  if (!Array.isArray(body.ids) || body.ids.length === 0) return NextResponse.json({ error: "ids required" }, { status: 400 });
  const found = await prisma.shipment.findMany({ where: { id: { in: body.ids }, deletedAt: null }, select: { id: true, code: true, status: true } });
  if (found.length !== body.ids.length) return NextResponse.json({ error: "truck not found" }, { status: 404 });
  const notPlanned = found.filter((s) => s.status !== "PLANNED");
  if (notPlanned.length) return NextResponse.json({ error: `${notPlanned.map((s) => s.code).join(", ")}: only planned trucks can be removed here` }, { status: 400 });
  await prisma.shipment.updateMany({ where: { id: { in: body.ids } }, data: { deletedAt: new Date() } });
  await prisma.auditLog.create({
    data: { entity: "shipment", entityId: found.map((s) => s.code).join(","), action: "DELETE", data: JSON.stringify({ status: "PLANNED" }), username: session.username },
  });
  return NextResponse.json({ ok: true, removed: found.map((s) => s.code) });
}
