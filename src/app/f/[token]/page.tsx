// Public fill page. Rendered without the app shell (no session), and enriched
// server-side with the structure the form needs to look like a proper
// accounting document: P&L-group sections for OPEX, warehouse sections for
// stock, and bank/cash pairing for Turbo Impex (two value columns, one row
// per category).
import { prisma } from "@/lib/db";
import { loadByToken, markOpened } from "@/lib/requests/service";
import { kindOf } from "@/lib/requests/kinds";
import { GROUP_LABELS, TI_GROUPS, FARGO_GROUPS } from "@/lib/groups";
import FillForm, { type FillItem } from "@/components/FillForm";

export const dynamic = "force-dynamic";

export default async function FillPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const request = await loadByToken(token);

  if (!request) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10 text-center">
        <h1 className="font-display text-[20px] font-semibold">Ссылка недействительна</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          Форма уже отправлена и принята, либо срок ссылки истёк. Свяжитесь с отправителем, чтобы
          получить новую.
        </p>
      </main>
    );
  }

  await markOpened(request.id, request.status);
  const spec = kindOf(request.kind);

  let items: FillItem[] = request.items.map((i) => ({
    id: i.id,
    label: i.label,
    rowLabel: i.label,
    freeLabel: i.freeLabel,
    field: i.field,
    pairKey: i.refId,
    group: null,
    priorValue: i.priorValue,
    value: i.value,
    note: i.note,
  }));

  // OPEX: sections by P&L group in the canonical order; TI rows lose the
  // «· банк / · нал» suffix because bank and cash become columns
  if (request.kind === "OPEX_TI" || request.kind === "OPEX_FARGO") {
    const refIds = [...new Set(request.items.map((i) => i.refId).filter((x): x is string => !!x))];
    const cats = await prisma.opexCategory.findMany({ where: { id: { in: refIds } } });
    const catById = new Map(cats.map((c) => [c.id, c]));
    const order = request.kind === "OPEX_TI" ? TI_GROUPS : FARGO_GROUPS;
    const orderOf = (g: string) => {
      const i = (order as readonly string[]).indexOf(g);
      return i === -1 ? 999 : i;
    };
    items = items
      .map((it, idx) => {
        const cat = it.pairKey ? catById.get(it.pairKey) : undefined;
        const groupKey = cat?.plGroup ?? "UNMAPPED";
        return {
          ...it,
          rowLabel: it.label.replace(/ · (банк|нал)$/, ""),
          group: GROUP_LABELS[groupKey]?.ru ?? groupKey,
          _sort: orderOf(groupKey) * 10_000 + idx,
        };
      })
      .sort((a, b) => (a as { _sort: number })._sort - (b as { _sort: number })._sort)
      .map((it) => {
        const rest = { ...it } as FillItem & { _sort?: number };
        delete rest._sort;
        return rest;
      });
  }

  // stock across several warehouses: one section per warehouse
  if (request.kind === "STOCK") {
    const whIds = [...new Set(request.items.map((i) => i.refId2).filter((x): x is string => !!x))];
    if (whIds.length > 1) {
      const warehouses = await prisma.warehouse.findMany({ where: { id: { in: whIds } } });
      const whById = new Map(warehouses.map((w) => [w.id, w]));
      items = request.items
        .map((i, idx) => {
          const wh = i.refId2 ? whById.get(i.refId2) : undefined;
          return {
            id: i.id,
            label: i.label,
            rowLabel: wh ? i.label.replace(` · ${wh.name}`, "") : i.label,
            freeLabel: i.freeLabel,
            field: i.field,
            pairKey: i.refId,
            group: wh?.name ?? null,
            priorValue: i.priorValue,
            value: i.value,
            note: i.note,
            _sort: (wh?.sortOrder ?? 999) * 10_000 + idx,
          };
        })
        .sort((a, b) => a._sort - b._sort)
        .map((it) => {
          const rest = { ...it } as FillItem & { _sort?: number };
          delete rest._sort;
          return rest;
        });
    }
  }

  return (
    <FillForm
      token={token}
      kindLabel={spec?.labelRu ?? request.kind}
      hint={spec?.hintRu ?? ""}
      allowAddRows={spec?.allowAddRows ?? false}
      split={request.kind === "OPEX_TI"}
      unit={spec?.unit ?? "money"}
      monthName={request.month.nameRu}
      note={request.note}
      dueDate={request.dueDate ? request.dueDate.toISOString() : null}
      alreadySubmitted={request.status === "SUBMITTED"}
      items={items}
    />
  );
}
