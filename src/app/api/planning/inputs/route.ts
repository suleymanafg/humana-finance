// The owner's say in supply planning (ADMIN): one PlanningInput row per
// (kind, sku, month). value null removes the row (back to the engine's own).
// POST { kind, skuId?, monthKey?, value: number | null, note? }
//   or { batch: [{ kind, skuId?, monthKey?, value }] } — all checked first, then written together
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

const KINDS: Record<string, { sku: boolean; month: boolean; min: number; max: number }> = {
  SHORT: { sku: true, month: true, min: 0, max: 1 },
  OWN_DEMAND: { sku: true, month: false, min: 0, max: 1_000_000 },
  // the owner's own sales for a product in one month (tins)
  OWN_MONTH: { sku: true, month: true, min: 0, max: 1_000_000 },
  OWN_SHARE: { sku: true, month: false, min: 0, max: 1 },
  TARGET: { sku: false, month: true, min: 0, max: 12 },
  // HQ's open quantity less the app's count (the difference is stored, so later trucks still collect from it)
  OPEN_FIX: { sku: true, month: false, min: -10_000_000, max: 10_000_000 },
};

type Item = { kind?: string; skuId?: string; monthKey?: string; value?: number | null; note?: string };

function check(it: Item): { kind: string; skuId: string; monthKey: string; value: number | null; note: string | null } | string {
  const rule = KINDS[it.kind ?? ""];
  if (!rule) return "unknown kind";
  const skuId = rule.sku ? String(it.skuId ?? "") : "";
  const monthKey = rule.month ? String(it.monthKey ?? "") : "";
  if (rule.sku && !skuId) return "skuId required";
  if (rule.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return "monthKey: YYYY-MM";
  if (it.value === null || it.value === undefined) return { kind: it.kind!, skuId, monthKey, value: null, note: null };
  const value = Number(it.value);
  if (!Number.isFinite(value) || value < rule.min || value > rule.max) return `value: ${rule.min}–${rule.max}`;
  return { kind: it.kind!, skuId, monthKey, value, note: it.note ?? null };
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await request.json()) as Item & { batch?: Item[] };
  const items = Array.isArray(body.batch) ? body.batch : [body];
  if (items.length === 0 || items.length > 500) return NextResponse.json({ error: "1–500 items" }, { status: 400 });
  const checked = items.map(check);
  const bad = checked.find((c) => typeof c === "string");
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  const ok = checked as Exclude<ReturnType<typeof check>, string>[];

  await prisma.$transaction([
    ...ok.map((c) =>
      c.value === null
        ? prisma.planningInput.deleteMany({ where: { kind: c.kind, skuId: c.skuId, monthKey: c.monthKey } })
        : prisma.planningInput.upsert({
            where: { kind_skuId_monthKey: { kind: c.kind, skuId: c.skuId, monthKey: c.monthKey } },
            create: { kind: c.kind, skuId: c.skuId, monthKey: c.monthKey, value: c.value, note: c.note, updatedBy: session.username },
            update: { value: c.value, note: c.note, updatedBy: session.username },
          })
    ),
    prisma.auditLog.create({
      data: {
        entity: "planningInput",
        entityId: ok.length === 1 ? `${ok[0].kind}:${ok[0].skuId}:${ok[0].monthKey}` : `${ok.length} inputs`,
        action: ok.every((c) => c.value === null) ? "DELETE" : "UPSERT",
        data: JSON.stringify(ok.map((c) => ({ k: c.kind, s: c.skuId, m: c.monthKey, v: c.value }))),
        username: session.username,
      },
    }),
  ]);
  return NextResponse.json({ ok: true, written: ok.length });
}
