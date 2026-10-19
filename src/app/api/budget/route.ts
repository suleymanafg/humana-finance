// The budget's writes (ADMIN): save the working forecast's assumptions,
// approve the forecast as the new budget (the old one is kept one step back),
// or reset the forecast to the approved budget.
// POST JSON { action: "save", inputs, name? } | { action: "approve" } | { action: "reset" }
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { checkInputs, parseStored, SETTING_APPROVED, SETTING_FORECAST, SETTING_PREVIOUS, type StoredBudget } from "@/lib/budget/store";

const upsert = (key: string, value: string) => prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { action?: string; inputs?: unknown; name?: string } | null;
  const rows = await prisma.setting.findMany({ where: { key: { in: [SETTING_APPROVED, SETTING_FORECAST] } } });
  const approved = parseStored(rows.find((r) => r.key === SETTING_APPROVED)?.value);
  const forecast = parseStored(rows.find((r) => r.key === SETTING_FORECAST)?.value);
  const stamp = { savedAt: new Date().toISOString(), savedBy: session.username };
  const audit = (action: string, data: unknown) =>
    prisma.auditLog.create({ data: { entity: "budget", entityId: action, action: "UPDATE", data: JSON.stringify(data), username: session.username } });

  if (body?.action === "save") {
    const ok = checkInputs(body.inputs);
    if ("error" in ok) return NextResponse.json({ error: ok.error }, { status: 400 });
    const next: StoredBudget = { name: body.name?.trim() || forecast?.name || approved?.name || "Forecast", ...stamp, source: "edited in the app", inputs: ok.inputs };
    await prisma.$transaction([upsert(SETTING_FORECAST, JSON.stringify(next)), audit("save forecast", { before: forecast?.inputs ?? null })]);
    return NextResponse.json({ ok: true });
  }
  if (body?.action === "approve") {
    const source = forecast ?? approved;
    if (!source) return NextResponse.json({ error: "no forecast to approve" }, { status: 400 });
    const next: StoredBudget = { ...source, ...stamp };
    await prisma.$transaction([
      ...(approved ? [upsert(SETTING_PREVIOUS, JSON.stringify(approved))] : []),
      upsert(SETTING_APPROVED, JSON.stringify(next)),
      audit("approve", { previous: approved?.name ?? null }),
    ]);
    return NextResponse.json({ ok: true });
  }
  if (body?.action === "reset") {
    if (!approved) return NextResponse.json({ error: "no approved budget" }, { status: 400 });
    await prisma.$transaction([upsert(SETTING_FORECAST, JSON.stringify({ ...approved, ...stamp })), audit("reset forecast", { before: forecast?.inputs ?? null })]);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "action: save | approve | reset" }, { status: 400 });
}
