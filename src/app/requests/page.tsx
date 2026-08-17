import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { REQUEST_KINDS } from "@/lib/requests/kinds";
import { fillUrl } from "@/lib/requests/service";
import { telegramConfigured } from "@/lib/telegram";
import { emailConfigured } from "@/lib/email";
import RequestsView from "@/components/RequestsView";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const session = await getSession();
  const [requests, contacts, months] = await Promise.all([
    prisma.dataRequest.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        contact: true,
        month: true,
        items: { select: { value: true, decision: true } },
      },
    }),
    prisma.contact.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    prisma.month.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  return (
    <RequestsView
      readOnly={session?.role !== "ADMIN"}
      telegramReady={telegramConfigured()}
      emailReady={emailConfigured()}
      kinds={Object.entries(REQUEST_KINDS).map(([id, k]) => ({
        id,
        labelRu: k.labelRu,
        labelEn: k.labelEn,
      }))}
      months={months.map((m) => ({ id: m.id, nameRu: m.nameRu, nameEn: m.nameEn }))}
      contacts={contacts.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        telegramUser: c.telegramUser,
        hasChat: !!c.telegramChatId,
        email: c.email,
        active: c.active,
      }))}
      requests={requests.map((r) => ({
        id: r.id,
        kind: r.kind,
        kindLabel: REQUEST_KINDS[r.kind]?.labelRu ?? r.kind,
        monthId: r.monthId,
        monthNameRu: r.month.nameRu,
        monthNameEn: r.month.nameEn,
        contactName: r.contact.name,
        contactHasChat: !!r.contact.telegramChatId,
        status: r.status,
        url: fillUrl(r.token),
        dueDate: r.dueDate?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        total: r.items.length,
        filled: r.items.filter((i) => i.value !== null).length,
        accepted: r.items.filter((i) => i.decision === "ACCEPTED").length,
      }))}
    />
  );
}
