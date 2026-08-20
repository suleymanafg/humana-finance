// Generic audited CRUD endpoint. Soft delete where configured.
// ADMIN writes anything; STAFF writes figures but not structural entities
// (categories, products, channels, settings) — see src/lib/permissions.ts.
// POST /api/crud/<entity>  { action: "create"|"update"|"delete"|"upsert", id?, data?, where? }
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireDataEditor } from "@/lib/auth";
import { canWriteEntity, canEditClosedMonth } from "@/lib/permissions";
import { isMonthClosed } from "@/lib/month-close";

interface EntityConfig {
  delegate: () => unknown; // prisma model delegate
  fields: string[]; // whitelisted writable fields
  dateFields?: string[]; // coerced to Date
  softDelete?: boolean;
  upsertWhere?: (data: Record<string, unknown>) => Record<string, unknown>;
}

const registry: Record<string, EntityConfig> = {
  shipment: {
    delegate: () => prisma.shipment,
    fields: ["code", "monthId", "notes"],
    softDelete: true,
  },
  shipmentLine: {
    delegate: () => prisma.shipmentLine,
    fields: ["shipmentId", "productId", "qty", "priceEur", "rate", "fargoUnitCost"],
    softDelete: true,
  },
  importExpense: {
    delegate: () => prisma.importExpense,
    fields: ["monthId", "shipmentId", "categoryId", "amount", "notes"],
    softDelete: true,
  },
  opexTi: {
    delegate: () => prisma.opexTiEntry,
    fields: ["monthId", "categoryId", "bankAmount", "cashAmount", "notes"],
    softDelete: true,
  },
  opexFargo: {
    delegate: () => prisma.opexFargoEntry,
    fields: ["monthId", "categoryId", "amount", "notes"],
    softDelete: true,
  },
  marketing: {
    delegate: () => prisma.marketingEntry,
    fields: ["monthId", "categoryId", "amount", "paidBy", "notes"],
    softDelete: true,
  },
  taxFiling: {
    delegate: () => prisma.tiTaxFiling,
    fields: ["quarterLabel", "taxAmount", "bookedMonthId", "declaredExpenses"],
    softDelete: true,
  },
  contribution: {
    delegate: () => prisma.capitalContribution,
    fields: ["date", "tiAmount", "fargoAmount", "notes"],
    dateFields: ["date"],
    softDelete: true,
  },
  transfer: {
    delegate: () => prisma.fargoTransfer,
    fields: ["date", "cashAmount", "bankAmount", "notes"],
    dateFields: ["date"],
    softDelete: true,
  },
  arEntry: {
    delegate: () => prisma.arEntry,
    fields: ["monthId", "customerName", "amount"],
    softDelete: true,
  },
  stockCount: {
    delegate: () => prisma.stockCount,
    fields: ["monthId", "productId", "warehouseId", "qty"],
    upsertWhere: (d) => ({
      monthId_productId_warehouseId: {
        monthId: d.monthId,
        productId: d.productId,
        warehouseId: d.warehouseId,
      },
    }),
  },
  warehouse: {
    delegate: () => prisma.warehouse,
    fields: ["name", "code1c", "sortOrder", "active"],
  },
  monthBalance: {
    delegate: () => prisma.monthBalance,
    fields: ["monthId", "tiBank", "tiCash", "goodsInTransit", "vatPrepayment", "priorVatBalance", "nutribenLoan"],
    upsertWhere: (d) => ({ monthId: d.monthId }),
  },
  product: {
    delegate: () => prisma.product,
    fields: [
      "nameRu",
      "nameEn",
      "code1c",
      "productLine",
      "price",
      "isPromo",
      "regularProductId",
      "sortOrder",
      "active",
    ],
  },
  channel: {
    delegate: () => prisma.channel,
    fields: ["name", "code1c", "retroPct", "cashPct", "sortOrder", "active"],
  },
  opexCategory: {
    delegate: () => prisma.opexCategory,
    fields: ["company", "name", "plGroup", "sortOrder", "active"],
  },
  marketingCategory: {
    delegate: () => prisma.marketingCategory,
    fields: ["name", "active"],
  },
  importExpenseCategory: {
    delegate: () => prisma.importExpenseCategory,
    fields: ["name", "active"],
  },
  month: {
    delegate: () => prisma.month,
    fields: ["id", "nameRu", "nameEn", "sortOrder"],
    upsertWhere: (d) => ({ id: d.id }),
  },
  contact: {
    delegate: () => prisma.contact,
    // telegramChatId is captured by the webhook, never typed in
    fields: ["name", "role", "email", "active"],
  },
  clientChannelMap: {
    delegate: () => prisma.clientChannelMap,
    // only the assignment is editable — name/qty/lastSeen belong to the sync
    fields: ["channelId", "source", "matchedRule"],
    softDelete: true,
  },
  setting: {
    delegate: () => prisma.setting,
    fields: ["key", "value"],
    upsertWhere: (d) => ({ key: d.key }),
  },
};

// Which field ties each figure entity to a month, for the closed-month guard.
// shipmentLine resolves through its shipment; entities absent here are either
// month-less (contributions, transfers) or structural (ADMIN-only anyway).
const MONTH_FIELD: Record<string, string> = {
  shipment: "monthId",
  importExpense: "monthId",
  opexTi: "monthId",
  opexFargo: "monthId",
  marketing: "monthId",
  arEntry: "monthId",
  stockCount: "monthId",
  monthBalance: "monthId",
  taxFiling: "bookedMonthId",
};

/** Every month a write touches: the incoming payload's month and, for
 *  update/delete, the month the existing row already belongs to. */
async function affectedMonths(
  entity: string,
  config: EntityConfig,
  data: Record<string, unknown>,
  id: string | undefined
): Promise<string[]> {
  const out = new Set<string>();
  if (entity === "shipmentLine") {
    const shipmentId = (data.shipmentId as string | undefined) ?? undefined;
    if (shipmentId) {
      const s = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { monthId: true } });
      if (s) out.add(s.monthId);
    }
    if (id) {
      const line = await prisma.shipmentLine.findUnique({
        where: { id },
        select: { shipment: { select: { monthId: true } } },
      });
      if (line) out.add(line.shipment.monthId);
    }
    return [...out];
  }
  const field = MONTH_FIELD[entity];
  if (!field) return [];
  if (typeof data[field] === "string") out.add(data[field] as string);
  if (id) {
    const delegate = config.delegate() as Delegate;
    const row = (await delegate.findUnique({ where: { id } })) as Record<string, unknown> | null;
    if (row && typeof row[field] === "string") out.add(row[field] as string);
  }
  return [...out];
}

type Delegate = {
  create: (args: unknown) => Promise<{ id?: string }>;
  update: (args: unknown) => Promise<{ id?: string }>;
  delete: (args: unknown) => Promise<{ id?: string }>;
  upsert: (args: unknown) => Promise<{ id?: string }>;
  findUnique: (args: unknown) => Promise<unknown>;
};

export async function POST(request: NextRequest, ctx: { params: Promise<{ entity: string }> }) {
  const session = await requireDataEditor();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { entity } = await ctx.params;
  const config = registry[entity];
  if (!config) return NextResponse.json({ error: "unknown entity" }, { status: 404 });

  // structural entities (categories, products, settings) stay ADMIN-only
  if (!canWriteEntity(session.role, entity)) {
    return NextResponse.json({ error: "structure changes require an administrator" }, { status: 403 });
  }

  const body = (await request.json()) as {
    action: "create" | "update" | "delete" | "upsert";
    id?: string;
    data?: Record<string, unknown>;
  };
  const delegate = config.delegate() as Delegate;

  const data: Record<string, unknown> = {};
  for (const f of config.fields) {
    if (body.data && f in body.data) {
      let v = body.data[f];
      if (v !== null && config.dateFields?.includes(f)) v = new Date(v as string);
      data[f] = v;
    }
  }

  try {
    // a closed month is frozen for everyone but ADMIN
    if (!canEditClosedMonth(session.role)) {
      const monthIds = await affectedMonths(entity, config, data, body.id);
      for (const monthId of monthIds) {
        if (await isMonthClosed(monthId)) {
          return NextResponse.json({ error: "month is closed" }, { status: 403 });
        }
      }
    }

    let result: { id?: string } | undefined;
    if (body.action === "create") {
      result = await delegate.create({ data });
    } else if (body.action === "update") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      result = await delegate.update({ where: { id: body.id }, data });
    } else if (body.action === "upsert" && config.upsertWhere) {
      result = await delegate.upsert({
        where: config.upsertWhere(data),
        create: data,
        update: data,
      });
    } else if (body.action === "delete") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const before = await delegate.findUnique({ where: { id: body.id } });
      if (config.softDelete) {
        result = await delegate.update({ where: { id: body.id }, data: { deletedAt: new Date() } });
      } else {
        result = await delegate.delete({ where: { id: body.id } });
      }
      await prisma.auditLog.create({
        data: {
          entity,
          entityId: body.id,
          action: "DELETE",
          data: JSON.stringify(before ?? {}),
          username: session.username,
        },
      });
      return NextResponse.json({ ok: true });
    } else {
      return NextResponse.json({ error: "bad action" }, { status: 400 });
    }

    await prisma.auditLog.create({
      data: {
        entity,
        entityId: String(result?.id ?? body.id ?? ""),
        action: body.action.toUpperCase(),
        data: JSON.stringify(data),
        username: session.username,
      },
    });
    return NextResponse.json({ ok: true, id: result?.id });
  } catch (e) {
    const message = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
