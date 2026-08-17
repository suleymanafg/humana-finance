// Daily scheduler tick (Vercel Cron; vercel.json points here every morning).
// For each active RequestSchedule whose day has come this month, create the
// request for the PREVIOUS month and deliver it. `lastRunMonthId` makes the
// tick idempotent: a schedule fires at most once per calendar month, and a
// missed day is caught up on the next tick instead of being skipped.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`; an admin session
// also works so the button in the UI can trigger a manual run.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { createRequest, deliverRequest } from "@/lib/requests/service";
import { kindOf } from "@/lib/requests/kinds";

const TASHKENT_OFFSET_MS = 5 * 3600 * 1000; // UTC+5, no DST

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const bearerOk = secret !== "" && request.headers.get("authorization") === `Bearer ${secret}`;
  const session = bearerOk ? null : await getSession();
  if (!bearerOk && session?.role !== "ADMIN")
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const now = new Date(Date.now() + TASHKENT_OFFSET_MS);
  const currentMonthKey = now.toISOString().slice(0, 7); // "2026-08"
  const day = now.getUTCDate();
  // the data being requested is always for the month that just closed
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const targetMonthId = prev.toISOString().slice(0, 7);
  const targetExists = await prisma.month.findUnique({ where: { id: targetMonthId } });

  const schedules = await prisma.requestSchedule.findMany({
    where: { active: true },
    include: { contact: true },
  });

  const ran: Array<{ schedule: string; contact: string; requestId?: string; delivered?: boolean; via?: string[]; error?: string }> = [];
  for (const s of schedules) {
    const label = `${kindOf(s.kind)?.labelRu ?? s.kind} · ${targetMonthId}`;
    if (day < s.dayOfMonth || s.lastRunMonthId === currentMonthKey) continue;
    if (!targetExists) {
      ran.push({ schedule: label, contact: s.contact.name, error: `month ${targetMonthId} not in the app` });
      continue;
    }
    try {
      const created = await createRequest({
        kind: s.kind,
        monthId: targetMonthId,
        contactId: s.contactId,
        note: s.note,
        createdBy: "scheduler",
      });
      const sent = await deliverRequest(created.id, false);
      await prisma.dataRequest.update({
        where: { id: created.id },
        data: { status: "SENT", sentAt: new Date() },
      });
      await prisma.requestSchedule.update({
        where: { id: s.id },
        data: { lastRunMonthId: currentMonthKey },
      });
      await prisma.auditLog.create({
        data: {
          entity: "requestSchedule",
          entityId: s.id,
          action: "SCHEDULE_SEND",
          data: JSON.stringify({
            kind: s.kind,
            monthId: targetMonthId,
            contact: s.contact.name,
            requestId: created.id,
            delivered: sent.ok ? sent.delivered : false,
            via: sent.ok ? sent.via : [],
          }),
          username: session?.username ?? "scheduler",
        },
      });
      ran.push({
        schedule: label,
        contact: s.contact.name,
        requestId: created.id,
        delivered: sent.ok ? sent.delivered : false,
        via: sent.ok ? sent.via : [],
        ...(sent.ok && !sent.delivered ? { error: sent.reason } : {}),
      });
    } catch (e) {
      ran.push({ schedule: label, contact: s.contact.name, error: e instanceof Error ? e.message : "error" });
    }
  }

  return NextResponse.json({
    ok: true,
    date: now.toISOString().slice(0, 10),
    targetMonthId,
    checked: schedules.length,
    fired: ran,
  });
}
