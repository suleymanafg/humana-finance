// Server-side lifecycle for data requests: create → send → fill → review →
// integrate. The token in the fill-page URL is the responder's only credential,
// so it is long, random, revocable and scoped to a single request.
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { kindOf, type AcceptedItem } from "./kinds";

export type RequestStatus =
  | "DRAFT"
  | "SENT"
  | "OPENED"
  | "PARTIAL"
  | "SUBMITTED"
  | "INTEGRATED"
  | "REVOKED";

export const newToken = () => randomBytes(24).toString("base64url");

/** Public URL a responder opens. APP_URL must be set once deployed. */
export function fillUrl(token: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3005").replace(/\/$/, "");
  return `${base}/f/${token}`;
}

export async function priorMonthIdOf(monthId: string): Promise<string | null> {
  const months = await prisma.month.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true } });
  const i = months.findIndex((m) => m.id === monthId);
  return i > 0 ? months[i - 1].id : null;
}

export async function createRequest(opts: {
  kind: string;
  monthId: string;
  contactId: string;
  note?: string | null;
  dueDate?: string | null;
  createdBy: string;
}) {
  const spec = kindOf(opts.kind);
  if (!spec) throw new Error("unknown request kind");

  const prior = await priorMonthIdOf(opts.monthId);
  const items = await spec.buildItems(opts.monthId, prior);

  return prisma.dataRequest.create({
    data: {
      kind: opts.kind,
      monthId: opts.monthId,
      contactId: opts.contactId,
      token: newToken(),
      note: opts.note ?? null,
      dueDate: opts.dueDate ? new Date(opts.dueDate) : null,
      createdBy: opts.createdBy,
      status: "DRAFT",
      items: {
        create: items.map((it) => ({
          sortOrder: it.sortOrder,
          label: it.label,
          refId: it.refId ?? null,
          refId2: it.refId2 ?? null,
          field: it.field,
          freeLabel: it.freeLabel ?? null,
          priorValue: it.priorValue ?? null,
          value: it.value ?? null,
        })),
      },
    },
    include: { items: true, contact: true },
  });
}

/**
 * A request is only fillable while it is live: revoked and already-integrated
 * links stop working, which is what makes the token safe to send over chat.
 */
export function isFillable(status: string): boolean {
  return status === "SENT" || status === "OPENED" || status === "PARTIAL" || status === "SUBMITTED";
}

export async function loadByToken(token: string) {
  const request = await prisma.dataRequest.findUnique({
    where: { token },
    include: { items: { orderBy: { sortOrder: "asc" } }, month: true, contact: true },
  });
  if (!request || !isFillable(request.status)) return null;
  return request;
}

/** First open flips SENT → OPENED so the list shows it has been seen. */
export async function markOpened(id: string, status: string) {
  if (status !== "SENT") return;
  await prisma.dataRequest.update({
    where: { id },
    data: { status: "OPENED", openedAt: new Date() },
  });
}

/**
 * Save what the responder typed. `submit` marks it finished; otherwise it stays
 * PARTIAL so they can come back, and so the list can show progress.
 */
export async function saveSubmission(
  token: string,
  rows: Array<{ id?: string; freeLabel?: string | null; value: number | null; note?: string | null }>,
  submit: boolean
) {
  const request = await loadByToken(token);
  if (!request) return null;
  const spec = kindOf(request.kind);
  const byId = new Map(request.items.map((i) => [i.id, i]));

  await prisma.$transaction(async (tx) => {
    let nextOrder = request.items.length;
    for (const row of rows) {
      const existing = row.id ? byId.get(row.id) : undefined;
      if (existing) {
        await tx.dataRequestItem.update({
          where: { id: existing.id },
          data: {
            value: row.value,
            note: row.note ?? null,
            // a responder revising a line resets a decision made earlier
            decision: "PENDING",
            ...(spec?.allowAddRows ? { freeLabel: row.freeLabel ?? existing.freeLabel } : {}),
          },
        });
      } else if (spec?.allowAddRows && (row.freeLabel ?? "").trim() !== "") {
        await tx.dataRequestItem.create({
          data: {
            requestId: request.id,
            sortOrder: nextOrder++,
            label: (row.freeLabel ?? "").trim(),
            freeLabel: (row.freeLabel ?? "").trim(),
            field: "amount",
            value: row.value,
            note: row.note ?? null,
          },
        });
      }
    }
    await tx.dataRequest.update({
      where: { id: request.id },
      data: submit
        ? { status: "SUBMITTED", submittedAt: new Date() }
        : { status: "PARTIAL", openedAt: request.openedAt ?? new Date() },
    });
  });
  return true;
}

/**
 * Write the accepted lines through the kind's integrator. Every write is
 * mirrored into AuditLog under the reviewer's name, so an integrated figure is
 * traceable to both the person who sent it and the person who approved it.
 */
export async function integrateRequest(id: string, username: string) {
  const request = await prisma.dataRequest.findUnique({
    where: { id },
    include: { items: true, contact: true },
  });
  if (!request) throw new Error("request not found");
  if (request.status === "INTEGRATED") throw new Error("already integrated");
  const spec = kindOf(request.kind);
  if (!spec) throw new Error("unknown request kind");

  const accepted = request.items.filter((i) => i.decision === "ACCEPTED" && i.value !== null);

  for (const item of accepted) {
    const payload: AcceptedItem = {
      refId: item.refId,
      refId2: item.refId2,
      field: item.field,
      freeLabel: item.freeLabel,
      value: item.value as number,
    };
    await spec.integrate(request.monthId, payload);
    await prisma.auditLog.create({
      data: {
        entity: `request:${request.kind}`,
        entityId: item.id,
        action: "INTEGRATE",
        data: JSON.stringify({
          monthId: request.monthId,
          label: item.label,
          field: item.field,
          value: item.value,
          from: request.contact.name,
        }),
        username,
      },
    });
  }

  await prisma.dataRequest.update({
    where: { id },
    data: { status: "INTEGRATED", integratedAt: new Date() },
  });
  return accepted.length;
}
