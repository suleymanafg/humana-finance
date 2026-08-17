// Admin actions on data requests. Everything a responder submits stays in
// staging until `integrate`, which writes through the kind's integrator and
// mirrors each line into AuditLog.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { createRequest, deliverRequest, integrateRequest } from "@/lib/requests/service";

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json()) as {
    action: "create" | "send" | "remind" | "revoke" | "decide" | "decideAll" | "integrate" | "delete";
    id?: string;
    kind?: string;
    monthId?: string;
    contactId?: string;
    note?: string | null;
    dueDate?: string | null;
    itemId?: string;
    decision?: "PENDING" | "ACCEPTED" | "REJECTED";
    value?: number | null;
  };

  try {
    switch (body.action) {
      case "create": {
        if (!body.kind || !body.monthId || !body.contactId) {
          return NextResponse.json({ error: "kind, monthId and contactId required" }, { status: 400 });
        }
        const created = await createRequest({
          kind: body.kind,
          monthId: body.monthId,
          contactId: body.contactId,
          note: body.note ?? null,
          dueDate: body.dueDate ?? null,
          createdBy: session.username,
        });
        return NextResponse.json({ ok: true, id: created.id, items: created.items.length });
      }

      case "send":
      case "remind": {
        if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const result = await deliverRequest(body.id, body.action === "remind");
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
        await prisma.dataRequest.update({
          where: { id: body.id },
          data:
            body.action === "remind"
              ? { remindedAt: new Date() }
              : { status: "SENT", sentAt: new Date() },
        });
        return NextResponse.json(result);
      }

      case "revoke": {
        if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
        await prisma.dataRequest.update({
          where: { id: body.id },
          data: { status: "REVOKED", revokedAt: new Date() },
        });
        return NextResponse.json({ ok: true });
      }

      case "decide": {
        if (!body.itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });
        await prisma.dataRequestItem.update({
          where: { id: body.itemId },
          data: {
            decision: body.decision ?? "PENDING",
            ...(body.value !== undefined ? { value: body.value } : {}),
          },
        });
        return NextResponse.json({ ok: true });
      }

      case "decideAll": {
        if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
        // only lines that actually carry a figure can be accepted wholesale
        await prisma.dataRequestItem.updateMany({
          where: { requestId: body.id, ...(body.decision === "ACCEPTED" ? { NOT: { value: null } } : {}) },
          data: { decision: body.decision ?? "PENDING" },
        });
        return NextResponse.json({ ok: true });
      }

      case "integrate": {
        if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const count = await integrateRequest(body.id, session.username);
        return NextResponse.json({ ok: true, integrated: count });
      }

      case "delete": {
        if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
        await prisma.dataRequest.delete({ where: { id: body.id } });
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: "bad action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}
