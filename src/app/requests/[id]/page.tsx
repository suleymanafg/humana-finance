import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { REQUEST_KINDS } from "@/lib/requests/kinds";
import { fillUrl } from "@/lib/requests/service";
import RequestReviewView from "@/components/RequestReviewView";

export const dynamic = "force-dynamic";

export default async function RequestReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const request = await prisma.dataRequest.findUnique({
    where: { id },
    include: {
      contact: true,
      month: true,
      items: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!request) notFound();

  const spec = REQUEST_KINDS[request.kind];

  return (
    <RequestReviewView
      readOnly={session?.role !== "ADMIN"}
      id={request.id}
      kindLabel={spec?.labelRu ?? request.kind}
      unit={spec?.unit ?? "money"}
      monthNameRu={request.month.nameRu}
      monthNameEn={request.month.nameEn}
      contactName={request.contact.name}
      status={request.status}
      url={fillUrl(request.token)}
      submittedAt={request.submittedAt?.toISOString() ?? null}
      items={request.items.map((i) => ({
        id: i.id,
        label: i.label,
        priorValue: i.priorValue,
        currentValue: null, // filled below
        value: i.value,
        note: i.note,
        decision: i.decision,
      }))}
      currentValues={await currentValues(request.kind, request.monthId, request.items)}
    />
  );
}

/**
 * What the app holds right now for each line, so the reviewer sees
 * «сейчас → предложено» rather than a bare submitted number.
 */
async function currentValues(
  kind: string,
  monthId: string,
  items: Array<{ id: string; refId: string | null; refId2: string | null; field: string; freeLabel: string | null }>
): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};

  if (kind === "OPEX_TI" || kind === "OPEX_FARGO") {
    const rows =
      kind === "OPEX_TI"
        ? await prisma.opexTiEntry.findMany({ where: { monthId, deletedAt: null } })
        : await prisma.opexFargoEntry.findMany({ where: { monthId, deletedAt: null } });
    for (const it of items) {
      const mine = rows.filter((r) => r.categoryId === it.refId);
      out[it.id] = mine.length
        ? mine.reduce((s, r) => s + ((r as unknown as Record<string, number>)[it.field] ?? 0), 0)
        : null;
    }
  } else if (kind === "STOCK") {
    const rows = await prisma.stockCount.findMany({ where: { monthId } });
    for (const it of items) {
      out[it.id] =
        rows.find((r) => r.productId === it.refId && r.warehouseId === it.refId2)?.qty ?? null;
    }
  } else if (kind === "AR") {
    const rows = await prisma.arEntry.findMany({ where: { monthId, deletedAt: null } });
    for (const it of items) {
      out[it.id] = rows.find((r) => r.customerName === (it.freeLabel ?? "").trim())?.amount ?? null;
    }
  }
  return out;
}
