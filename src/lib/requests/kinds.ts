// Registry of the things we ask other people for.
//
// Adding a new request type later is one entry here — `buildItems` decides what
// lines the responder sees, `integrate` decides where an accepted line lands.
// Nothing else in the feature (compose, fill page, review, Telegram) knows the
// difference between one kind and another.
import { prisma } from "@/lib/db";

/** A line as it is created for the responder to fill in. */
export interface DraftItem {
  sortOrder: number;
  label: string;
  refId?: string | null; // categoryId | productId
  refId2?: string | null; // warehouseId
  field: string; // the column an accepted value writes to
  freeLabel?: string | null; // responder-typed name (AR customer)
  priorValue?: number | null; // prior-month figure, shown as a grey hint
  value?: number | null; // prefilled current value, if the month is part-filled
}

/** The shape `integrate` receives for an accepted line. */
export interface AcceptedItem {
  refId: string | null;
  refId2: string | null;
  field: string;
  freeLabel: string | null;
  value: number;
}

export interface RequestKind {
  labelRu: string;
  labelEn: string;
  /** Sentence shown to the responder under the heading. */
  hintRu: string;
  hintEn: string;
  /** Responder may add their own rows (AR customers) rather than only filling fixed ones. */
  allowAddRows: boolean;
  /** Unit for display — money is comma-grouped, quantities are plain counts. */
  unit: "money" | "qty";
  buildItems: (monthId: string, priorMonthId: string | null) => Promise<DraftItem[]>;
  /** Writes one accepted line. Runs inside the integrate transaction. */
  integrate: (monthId: string, item: AcceptedItem) => Promise<void>;
}

const sum = (rows: Array<{ [k: string]: unknown }>, field: string) =>
  rows.reduce((s, r) => s + (typeof r[field] === "number" ? (r[field] as number) : 0), 0);

// ── OPEX ────────────────────────────────────────────────────────────
// One line per active category. TI splits bank/cash, so it gets two lines per
// category; Fargo is a single amount.

async function opexItems(company: "TI" | "FARGO", monthId: string, priorMonthId: string | null) {
  const categories = await prisma.opexCategory.findMany({
    where: { company, active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const fields = company === "TI" ? ["bankAmount", "cashAmount"] : ["amount"];
  const fieldLabel: Record<string, string> = { bankAmount: "банк", cashAmount: "нал", amount: "" };

  const entriesFor = async (mid: string | null) => {
    if (!mid) return [];
    return company === "TI"
      ? await prisma.opexTiEntry.findMany({ where: { monthId: mid, deletedAt: null } })
      : await prisma.opexFargoEntry.findMany({ where: { monthId: mid, deletedAt: null } });
  };
  const current = await entriesFor(monthId);
  const prior = await entriesFor(priorMonthId);

  const items: DraftItem[] = [];
  let i = 0;
  for (const c of categories) {
    for (const field of fields) {
      items.push({
        sortOrder: i++,
        label: fieldLabel[field] ? `${c.name} · ${fieldLabel[field]}` : c.name,
        refId: c.id,
        field,
        priorValue: sum(prior.filter((e) => e.categoryId === c.id), field) || null,
        value: sum(current.filter((e) => e.categoryId === c.id), field) || null,
      });
    }
  }
  return items;
}

/**
 * Replace the month's entries for one category. OPEX allows several rows per
 * category, so an accepted figure collapses them into a single entry rather
 * than adding to whatever is already there.
 */
async function integrateOpexTi(monthId: string, item: AcceptedItem) {
  if (!item.refId) return;
  const existing = await prisma.opexTiEntry.findMany({
    where: { monthId, categoryId: item.refId, deletedAt: null },
  });
  const other = item.field === "bankAmount" ? "cashAmount" : "bankAmount";
  const keepOther = sum(existing, other);
  for (const e of existing.slice(1)) {
    await prisma.opexTiEntry.update({ where: { id: e.id }, data: { deletedAt: new Date() } });
  }
  const data = { [item.field]: item.value, [other]: keepOther } as {
    bankAmount: number;
    cashAmount: number;
  };
  if (existing[0]) {
    await prisma.opexTiEntry.update({ where: { id: existing[0].id }, data });
  } else {
    await prisma.opexTiEntry.create({ data: { monthId, categoryId: item.refId, ...data } });
  }
}

async function integrateOpexFargo(monthId: string, item: AcceptedItem) {
  if (!item.refId) return;
  const existing = await prisma.opexFargoEntry.findMany({
    where: { monthId, categoryId: item.refId, deletedAt: null },
  });
  for (const e of existing.slice(1)) {
    await prisma.opexFargoEntry.update({ where: { id: e.id }, data: { deletedAt: new Date() } });
  }
  if (existing[0]) {
    await prisma.opexFargoEntry.update({ where: { id: existing[0].id }, data: { amount: item.value } });
  } else {
    await prisma.opexFargoEntry.create({
      data: { monthId, categoryId: item.refId, amount: item.value },
    });
  }
}

// ── Month-end stock ─────────────────────────────────────────────────

async function stockItems(monthId: string, priorMonthId: string | null): Promise<DraftItem[]> {
  const products = await prisma.product.findMany({
    where: { active: true, isPromo: false },
    orderBy: [{ sortOrder: "asc" }, { nameRu: "asc" }],
  });
  const warehouses = await prisma.warehouse.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });
  const counts = await prisma.stockCount.findMany({
    where: { monthId: { in: [monthId, ...(priorMonthId ? [priorMonthId] : [])] } },
  });
  const at = (mid: string, productId: string, warehouseId: string) =>
    counts.find((c) => c.monthId === mid && c.productId === productId && c.warehouseId === warehouseId)
      ?.qty ?? null;

  const items: DraftItem[] = [];
  let i = 0;
  for (const p of products) {
    for (const w of warehouses) {
      items.push({
        sortOrder: i++,
        label: warehouses.length > 1 ? `${p.nameRu} · ${w.name}` : p.nameRu,
        refId: p.id,
        refId2: w.id,
        field: "qty",
        priorValue: priorMonthId ? at(priorMonthId, p.id, w.id) : null,
        value: at(monthId, p.id, w.id),
      });
    }
  }
  return items;
}

async function integrateStock(monthId: string, item: AcceptedItem) {
  if (!item.refId || !item.refId2) return;
  await prisma.stockCount.upsert({
    where: {
      monthId_productId_warehouseId: {
        monthId,
        productId: item.refId,
        warehouseId: item.refId2,
      },
    },
    create: { monthId, productId: item.refId, warehouseId: item.refId2, qty: item.value },
    update: { qty: item.value },
  });
}

// ── AR per customer ─────────────────────────────────────────────────
// The customer list is not fixed, so prior-month customers are offered as a
// starting point and the responder can add rows.

async function arItems(monthId: string, priorMonthId: string | null): Promise<DraftItem[]> {
  const current = await prisma.arEntry.findMany({ where: { monthId, deletedAt: null } });
  const prior = priorMonthId
    ? await prisma.arEntry.findMany({ where: { monthId: priorMonthId, deletedAt: null } })
    : [];
  const names = [...new Set([...current, ...prior].map((a) => a.customerName))].sort();
  // no prior customers to offer (first month, or a gap): still hand over one
  // blank row, so the form opens with something to fill rather than empty
  if (names.length === 0) {
    return [{ sortOrder: 0, label: "", field: "amount", freeLabel: "", priorValue: null, value: null }];
  }
  return names.map((name, i) => ({
    sortOrder: i,
    label: name,
    field: "amount",
    freeLabel: name,
    priorValue: prior.find((a) => a.customerName === name)?.amount ?? null,
    value: current.find((a) => a.customerName === name)?.amount ?? null,
  }));
}

async function integrateAr(monthId: string, item: AcceptedItem) {
  const name = (item.freeLabel ?? "").trim();
  if (!name) return;
  const existing = await prisma.arEntry.findFirst({
    where: { monthId, customerName: name, deletedAt: null },
  });
  if (existing) {
    await prisma.arEntry.update({ where: { id: existing.id }, data: { amount: item.value } });
  } else {
    await prisma.arEntry.create({ data: { monthId, customerName: name, amount: item.value } });
  }
}

// ── the registry ────────────────────────────────────────────────────

export const REQUEST_KINDS: Record<string, RequestKind> = {
  OPEX_TI: {
    labelRu: "OPEX Turbo Impex",
    labelEn: "OPEX Turbo Impex",
    hintRu: "Расходы Turbo Impex за месяц, отдельно банк и наличные.",
    hintEn: "Turbo Impex operating costs for the month, bank and cash separately.",
    allowAddRows: false,
    unit: "money",
    buildItems: (monthId, prior) => opexItems("TI", monthId, prior),
    integrate: integrateOpexTi,
  },
  OPEX_FARGO: {
    labelRu: "OPEX Fargo",
    labelEn: "OPEX Fargo",
    hintRu: "Расходы Fargo за месяц.",
    hintEn: "Fargo operating costs for the month.",
    allowAddRows: false,
    unit: "money",
    buildItems: (monthId, prior) => opexItems("FARGO", monthId, prior),
    integrate: integrateOpexFargo,
  },
  STOCK: {
    labelRu: "Остатки на конец месяца",
    labelEn: "Month-end stock",
    hintRu: "Количество каждого товара на складе на последний день месяца, в штуках.",
    hintEn: "Units of each product in the warehouse on the last day of the month.",
    allowAddRows: false,
    unit: "qty",
    buildItems: stockItems,
    integrate: integrateStock,
  },
  AR: {
    labelRu: "Дебиторка по клиентам",
    labelEn: "AR per customer",
    hintRu: "Задолженность каждого клиента на конец месяца. Клиентов можно добавлять.",
    hintEn: "What each customer still owes at month end. You can add customers.",
    allowAddRows: true,
    unit: "money",
    buildItems: arItems,
    integrate: integrateAr,
  },
};

export const kindOf = (kind: string): RequestKind | null => REQUEST_KINDS[kind] ?? null;
