// Tool surface for the AI analyst. Read tools answer from the same engine and
// statement definitions the pages render, so the assistant can never disagree
// with the app. Write tools (further down) are ADMIN-only, reuse the
// data-request integrators, and are mirrored into AuditLog.
import type Anthropic from "@anthropic-ai/sdk";
import { getComputed } from "@/lib/data";
import { prisma } from "@/lib/db";
import { REQUEST_KINDS } from "@/lib/requests/kinds";
import { costProductIdOf } from "@/lib/engine/compute";
import {
  balanceStatement,
  fargoVatStatement,
  pnlStatement,
  settlementStatement,
  settlementSummary,
  tiVatStatement,
  valueOver,
  type Entity,
  type Statement,
} from "@/lib/statements";

export type AiContext = Awaited<ReturnType<typeof getComputed>>;

const r = (n: number) => Math.round(n);
const pct = (n: number) => Math.round(n * 1000) / 10; // 0.436 -> 43.6

/** Label shown in the chat UI while a tool runs. */
export const TOOL_LABELS: Record<string, { ru: string; en: string }> = {
  pnl: { ru: "Смотрю отчёт о прибылях и убытках", en: "Reading the profit and loss" },
  month_detail: { ru: "Разбираю месяц", en: "Breaking down the month" },
  product_economics: { ru: "Считаю экономику продуктов", en: "Checking product economics" },
  opex_entries: { ru: "Читаю статьи расходов", en: "Reading expense entries" },
  shipments_and_costs: { ru: "Смотрю поставки и себестоимость", en: "Reading shipments and costs" },
  balance_sheet: { ru: "Открываю баланс", en: "Opening the balance sheet" },
  settlement: { ru: "Проверяю расчёты с Fargo", en: "Checking the settlement with Fargo" },
  taxes: { ru: "Смотрю налоги", en: "Reading taxes" },
  health_checks: { ru: "Запускаю проверки данных", en: "Running data checks" },
  sales_query: { ru: "Ищу в продажах", en: "Querying sales" },
  set_opex: { ru: "Записываю расходы", en: "Writing expenses" },
  set_stock: { ru: "Записываю остатки", en: "Writing stock" },
  set_ar: { ru: "Записываю дебиторку", en: "Writing receivables" },
  set_month_balance: { ru: "Записываю денежные остатки", en: "Writing cash balances" },
  add_contribution: { ru: "Добавляю вклад капитала", en: "Adding a capital contribution" },
  add_transfer: { ru: "Добавляю платёж Fargo", en: "Adding a payment from Fargo" },
};

const MONTH = { type: "string", description: "Месяц YYYY-MM; без него — последний месяц" } as const;
const ENTITY = {
  type: "string",
  enum: ["group", "ti", "fargo"],
  description: "group — консолидировано (по умолчанию), ti — Turbo Impex, fargo — Fargo (только бизнес Humana)",
} as const;

export const AI_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "pnl",
    description:
      "Отчёт о прибылях и убытках по месяцам — те же строки, что на странице «Отчётность → Прибыли и убытки»: выручка без НДС, себестоимость FIFO, валовая прибыль, расходы по группам, EBITDA, налоги, чистая прибыль; для консолидации — сверка с суммой прибылей TI и Fargo. Начинай с этого инструмента почти любой вопрос о цифрах.",
    input_schema: {
      type: "object",
      properties: { entity: ENTITY, from: { type: "string", description: "YYYY-MM, начало периода" }, to: MONTH },
      additionalProperties: false,
    },
  },
  {
    name: "month_detail",
    description:
      "Детализация одного месяца: продажи Fargo по каналам и продуктам (по ценам продажи с НДС и без НДС), количество, себестоимость группы по продуктам, расходы TI и Fargo по группам, НДС Fargo (банк / наличные / зачёт), позиция расчётов с Fargo на конец месяца.",
    input_schema: {
      type: "object",
      properties: { month: { type: "string", description: "YYYY-MM" } },
      required: ["month"],
      additionalProperties: false,
    },
  },
  {
    name: "product_economics",
    description:
      "Экономика каждого продукта с начала учёта: продано штук, продажи с НДС, выручка без НДС, себестоимость группы (TI, FIFO) и Fargo (цены счетов TI, FIFO) на единицу, валовая маржа группы.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "opex_entries",
    description:
      "Статьи операционных расходов по категориям: компания TI (банк / наличные раздельно) или FARGO. Опционально фильтр по месяцу. Показывает и заметки к записям.",
    input_schema: {
      type: "object",
      properties: {
        company: { type: "string", enum: ["TI", "FARGO"] },
        month: { type: "string", description: "YYYY-MM; без него — все месяцы" },
      },
      required: ["company"],
      additionalProperties: false,
    },
  },
  {
    name: "shipments_and_costs",
    description:
      "Все поставки: закупка (EUR → сум), расходы импорта (без НДС при импорте — он к зачёту), коэффициент нагрузки, себестоимость с расходами, статус (в пути / прибыла).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "balance_sheet",
    description:
      "Баланс на конец месяца — те же строки, что на странице «Отчётность → Баланс»: активы, обязательства, капитал и строка «Несверенная сумма» (ошибка сверки). Плюс остатки товара по продуктам и дебиторка по клиентам.",
    input_schema: {
      type: "object",
      properties: { entity: ENTITY, month: MONTH },
      additionalProperties: false,
    },
  },
  {
    name: "settlement",
    description:
      "Расчёты Fargo с TI: итог на конец месяца (прибыль Fargo от Humana, что Fargo должен передать, что получено, сколько должен — через банк по счетам и наличными, сверка с актом), помесячная таблица и итоги по вкладам капитала и платежам.",
    input_schema: { type: "object", properties: { month: MONTH }, additionalProperties: false },
  },
  {
    name: "taxes",
    description:
      "Налоги по месяцам: НДС Fargo (банковские продажи — НДС в цене 12/112; наличные — декларируются по себестоимости Fargo × 1,03 с НДС 12%; зачёт по счетам TI; перенос зачёта), НДС Turbo Impex (расчёт против лицевого счёта, доля прежнего владельца), декларации TI по налогу на прибыль.",
    input_schema: { type: "object", properties: { to: MONTH }, additionalProperties: false },
  },
  {
    name: "health_checks",
    description:
      "Автоматические проверки целостности данных. Первый инструмент для вопросов вида «что не так с данными» или «почему не сходится».",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "sales_query",
    description:
      "Гранулярные продажи: месяц × продукт × канал, количество и продажи по ценам с НДС. Фильтры по месяцу, названию продукта, названию канала (подстрока, без учёта регистра). Отрицательное количество — возвраты.",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "string", description: "YYYY-MM" },
        product: { type: "string", description: "подстрока названия продукта" },
        channel: { type: "string", description: "подстрока названия канала" },
      },
      additionalProperties: false,
    },
  },
];

/** A statement as plain rows: one value per month, plus the period total for flows. */
function statementRows(st: Statement, months: string[]) {
  return st.lines
    .filter((l) => l.kind !== "header")
    .map((l) => {
      const values = Object.fromEntries(
        months.map((m) => {
          const v = valueOver(l, [m], st.lines);
          return [m, v == null ? null : l.kind === "ratio" ? pct(v) : r(v)];
        })
      );
      const total = st.mode === "flow" && months.length > 1 ? valueOver(l, months, st.lines) : undefined;
      return {
        line: l.label.ru,
        ...(l.kind === "ratio" ? { unit: "%" } : {}),
        values,
        ...(total !== undefined ? { total: total == null ? null : l.kind === "ratio" ? pct(total) : r(total) } : {}),
      };
    });
}

export async function runAiTool(
  ctx: AiContext,
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const { dataset, computed } = ctx;
  const productName = (id: string) => dataset.products.find((p) => p.id === id)?.nameRu ?? id;
  const channelName = (id: string) => dataset.channels.find((c) => c.id === id)?.name ?? id;
  const named = (m: Record<string, number>, nameOf: (id: string) => string) =>
    Object.fromEntries(
      Object.entries(m)
        .filter(([, v]) => v !== 0)
        .map(([id, v]) => [nameOf(id), r(v)])
    );
  const ids = computed.monthIds;
  const lastId = ids.at(-1) ?? "";
  const monthArg = (v: unknown) => (typeof v === "string" && ids.includes(v) ? v : lastId);
  const entityArg = (v: unknown): Entity => (v === "ti" || v === "fargo" ? v : "group");
  const until = (to: string) => ids.filter((m) => m <= to);
  const preliminary = (months: string[]) =>
    months.filter((m) => !dataset.months.find((x) => x.id === m)?.closedAt);

  switch (name) {
    case "pnl": {
      const to = monthArg(input.to);
      const from = typeof input.from === "string" ? input.from : "";
      const months = until(to).filter((m) => m >= from);
      return {
        entity: entityArg(input.entity),
        months,
        preliminaryMonths: preliminary(months),
        lines: statementRows(pnlStatement(entityArg(input.entity), computed), months),
      };
    }

    case "month_detail": {
      const i = ids.indexOf(String(input.month));
      if (i < 0) return { error: `нет месяца ${input.month}` };
      const f = computed.fargo[i];
      const g = computed.group[i];
      const t = computed.ti[i];
      const s = computed.settlement[i];
      return {
        month: f.monthId,
        preliminary: preliminary([f.monthId]).length > 0,
        units: r(f.units),
        salesInclVat: { total: r(f.salesAtPrice), cash: r(f.cashSales), bank: r(f.bankSales) },
        revenueExVat: r(f.revenue),
        salesByChannel: named(f.salesByChannel, channelName),
        salesByProduct: named(f.salesByProduct, productName),
        revenueExVatByProduct: named(f.revenueByProduct, productName),
        qtyByProduct: named(f.qtyByProduct, productName),
        groupCogsByProduct: named(g.cogsByProduct, productName),
        group: {
          revenue: r(g.revenue),
          cogs: r(g.cogs),
          giveaways: r(g.giveaways),
          stockLoss: r(g.stockLoss),
          grossProfit: r(g.grossProfit),
          opex: r(g.opex),
          taxes: r(g.taxes),
          netProfit: r(g.netProfit),
        },
        opexTiByGroup: Object.fromEntries(Object.entries(t.opexByGroup).map(([k, v]) => [k, r(v)])),
        opexFargoByGroup: Object.fromEntries(Object.entries(f.opexByGroup).map(([k, v]) => [k, r(v)])),
        tiInvoicesToFargo: { revenueExVat: r(t.revenue), units: r(t.units), cogsAtTiCost: r(t.cogs) },
        fargoVat: Object.fromEntries(Object.entries(f.vat).map(([k, v]) => [k, r(v)])),
        settlement: { fargoOwesTi: r(s.owes), byBank: r(s.byBank), inCash: r(s.inCash), receivedInMonth: r(s.transfersCash + s.transfersBank) },
      };
    }

    case "product_economics": {
      return dataset.products
        .filter((p) => !p.isPromo || computed.fargo.some((f) => f.qtyByProduct[p.id]))
        .map((p) => {
          const sum = (pick: (f: (typeof computed.fargo)[number]) => number) =>
            computed.fargo.reduce((a, f) => a + pick(f), 0);
          const qty = sum((f) => f.qtyByProduct[p.id] ?? 0);
          const sales = sum((f) => f.salesByProduct[p.id] ?? 0);
          const revenue = sum((f) => f.revenueByProduct[p.id] ?? 0);
          const groupCogs = computed.group.reduce((a, g) => a + (g.cogsByProduct[p.id] ?? 0), 0);
          const fifo = computed.fifo[costProductIdOf(p.id, dataset)];
          const fargoCogs = fifo ? Object.values(fifo.months).reduce((a, m) => a + m.fargoCogs, 0) : 0;
          const fifoUnits = fifo ? Object.values(fifo.months).reduce((a, m) => a + m.unitsSold, 0) : 0;
          return {
            product: p.nameRu,
            isPromo: p.isPromo,
            listPrice: r(p.price),
            soldQty: r(qty),
            salesInclVat: r(sales),
            revenueExVat: r(revenue),
            groupUnitCost: qty ? r(groupCogs / qty) : null,
            fargoUnitCost: fifoUnits ? r(fargoCogs / fifoUnits) : null,
            groupGrossMargin: r(revenue - groupCogs),
            groupGrossMarginPct: revenue ? pct((revenue - groupCogs) / revenue) : null,
          };
        });
    }

    case "opex_entries": {
      const rows = (input.company === "TI" ? dataset.opexTi : dataset.opexFargo).filter(
        (e) => !input.month || e.monthId === input.month
      );
      return rows.map((e) => ({
        month: e.monthId,
        category: e.categoryName,
        group: e.plGroup ?? "UNMAPPED",
        ...("bankAmount" in e
          ? { bank: r(e.bankAmount), cash: r(e.cashAmount) }
          : { amount: r(e.amount) }),
        notes: e.notes ?? undefined,
      }));
    }

    case "shipments_and_costs": {
      return computed.shipments.map((s) => ({
        code: s.code,
        month: s.monthId,
        status: s.status,
        units: r(s.units),
        purchaseEur: r(s.purchaseEur),
        purchaseUzs: r(s.purchaseTotal),
        importExpenses: r(s.expenseTotal),
        importVatRecoverable: r(s.importVat),
        loadFactor: Math.round(s.loadFactor * 10000) / 10000,
        landedCost: r(s.landedTotal),
      }));
    }

    case "balance_sheet": {
      const month = monthArg(input.month);
      const entity = entityArg(input.entity);
      const b = computed.balance.find((x) => x.monthId === month);
      const stock = dataset.stockCounts.filter((s) => s.monthId === month && s.qty !== 0);
      const ar = dataset.arEntries.filter((a) => a.monthId === month);
      return {
        month,
        entity,
        cashBalancesEntered: b?.hasInputs ?? false,
        preliminary: preliminary([month]).length > 0,
        lines: statementRows(balanceStatement(entity, computed), [month]).map((l) => ({ line: l.line, value: l.values[month] })),
        stockCountByProduct: stock.map((s) => ({ product: productName(s.productId), qty: r(s.qty) })),
        receivablesByCustomer: ar.map((a) => ({ customer: a.customerName, amount: r(a.amount) })),
      };
    }

    case "settlement": {
      const month = monthArg(input.month);
      const summary = settlementSummary(computed, month);
      return {
        month,
        preliminary: preliminary([month]).length > 0,
        summary: summary?.sections.map((s) => ({
          section: s.title.ru,
          lines: s.lines.map((l) => ({ line: l.label.ru, value: l.value == null ? null : r(l.value) })),
        })),
        methodsDifference: summary ? r(summary.check) : null,
        byMonth: statementRows(settlementStatement(computed), until(month)),
        capital: {
          tiTotal: r(dataset.contributions.reduce((a, c) => a + c.tiAmount, 0)),
          fargoTotal: r(dataset.contributions.reduce((a, c) => a + c.fargoAmount, 0)),
        },
        paymentsFromFargo: {
          count: dataset.transfers.length,
          cashTotal: r(dataset.transfers.reduce((a, t) => a + t.cashAmount, 0)),
          bankTotal: r(dataset.transfers.reduce((a, t) => a + t.bankAmount, 0)),
        },
      };
    }

    case "taxes": {
      const months = until(monthArg(input.to));
      return {
        months,
        fargoVat: statementRows(fargoVatStatement(computed), months),
        tiVat: statementRows(tiVatStatement(computed), months),
        tiProfitTaxFilings: dataset.taxFilings.map((f) => ({
          quarter: f.quarterLabel,
          tax: r(f.taxAmount),
          bookedIn: f.bookedMonthId,
          paidIn: f.paidMonthId ?? null,
          declaredExpenses: r(f.declaredExpenses),
        })),
      };
    }

    case "health_checks": {
      return computed.healthChecks.map((h) => ({
        key: h.key,
        status: h.status,
        severity: h.severity,
        count: h.count,
        details: h.details.slice(0, 10),
        truncated: h.details.length > 10 ? h.details.length - 10 : undefined,
      }));
    }

    case "sales_query": {
      const prod = typeof input.product === "string" ? input.product.toLowerCase() : null;
      const chan = typeof input.channel === "string" ? input.channel.toLowerCase() : null;
      const rows = dataset.sales
        .filter(
          (s) =>
            (!input.month || s.monthId === input.month) &&
            (!prod || productName(s.productId).toLowerCase().includes(prod)) &&
            (!chan || channelName(s.channelId).toLowerCase().includes(chan))
        )
        .map((s) => {
          const price = dataset.products.find((p) => p.id === s.productId)?.price ?? 0;
          return {
            month: s.monthId,
            product: productName(s.productId),
            channel: channelName(s.channelId),
            qty: r(s.qty),
            salesInclVat: r(s.amount ?? s.qty * price),
          };
        });
      return {
        rows: rows.slice(0, 200),
        totalRows: rows.length,
        truncated: rows.length > 200,
        totals: {
          qty: r(rows.reduce((a, x) => a + x.qty, 0)),
          salesInclVat: r(rows.reduce((a, x) => a + x.salesInclVat, 0)),
        },
      };
    }

    default:
      return { error: `неизвестный инструмент ${name}` };
  }
}

// ─── Write tools (ADMIN only) ───────────────────────────────────────
// Included in the model's tool list only for ADMIN sessions, and the route
// re-checks the role before executing — a viewer can never reach these.
// OPEX / stock / AR writes reuse the data-request integrators, so chat writes
// behave byte-for-byte like an accepted «Запрос данных». Every write is
// mirrored into AuditLog.

export const WRITE_TOOL_NAMES = new Set([
  "set_opex",
  "set_stock",
  "set_ar",
  "set_month_balance",
  "add_contribution",
  "add_transfer",
]);

export const AI_WRITE_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "set_opex",
    description:
      "ЗАМЕНЯЕТ сумму OPEX-категории за месяц (не добавляет к существующей). Для TI можно задать банк и/или наличные — незаданная часть сохраняется. Возвращает прежнее значение, чтобы сообщить пользователю, что именно заменено.",
    input_schema: {
      type: "object",
      properties: {
        company: { type: "string", enum: ["TI", "FARGO"] },
        month: { type: "string", description: "YYYY-MM" },
        category: { type: "string", description: "название категории, как в приложении" },
        bank: { type: "number", description: "TI: сумма по банку" },
        cash: { type: "number", description: "TI: сумма наличными" },
        amount: { type: "number", description: "FARGO: сумма" },
      },
      required: ["company", "month", "category"],
      additionalProperties: false,
    },
  },
  {
    name: "set_stock",
    description: "Устанавливает остаток товара на конец месяца (штук) на складе.",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "string", description: "YYYY-MM" },
        product: { type: "string", description: "название товара (можно часть)" },
        qty: { type: "number" },
        warehouse: { type: "string", description: "название склада; по умолчанию основной" },
      },
      required: ["month", "product", "qty"],
      additionalProperties: false,
    },
  },
  {
    name: "set_ar",
    description:
      "Устанавливает дебиторку клиента на конец месяца (заменяет прежнюю сумму этого клиента за этот месяц).",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "string", description: "YYYY-MM" },
        customer: { type: "string", description: "имя клиента" },
        amount: { type: "number" },
      },
      required: ["month", "customer", "amount"],
      additionalProperties: false,
    },
  },
  {
    name: "set_month_balance",
    description:
      "Устанавливает денежный остаток TI на конец месяца: tiBank (счёт TI в банке), tiCash (касса TI), goodsInTransit (оплаченный товар в пути).",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "string", description: "YYYY-MM" },
        field: {
          type: "string",
          enum: ["tiBank", "tiCash", "goodsInTransit"],
        },
        value: { type: "number" },
      },
      required: ["month", "field", "value"],
      additionalProperties: false,
    },
  },
  {
    name: "add_contribution",
    description:
      "Добавляет вклад капитала (дата + сумма TI и/или Fargo). Это добавление новой записи, не замена.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        tiAmount: { type: "number" },
        fargoAmount: { type: "number" },
        note: { type: "string" },
      },
      required: ["date"],
      additionalProperties: false,
    },
  },
  {
    name: "add_transfer",
    description:
      "Добавляет платёж Fargo → TI (дата + наличные и/или банк). Это добавление новой записи, не замена.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        cashAmount: { type: "number" },
        bankAmount: { type: "number" },
        note: { type: "string" },
      },
      required: ["date"],
      additionalProperties: false,
    },
  },
];

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function resolveOne<T extends { id: string }>(
  kind: string,
  query: string,
  rows: T[],
  nameOf: (row: T) => string
): { row?: T; error?: string } {
  const q = query.trim().toLowerCase();
  const exact = rows.filter((r) => nameOf(r).toLowerCase() === q);
  if (exact.length === 1) return { row: exact[0] };
  const partial = rows.filter((r) => nameOf(r).toLowerCase().includes(q));
  if (partial.length === 1) return { row: partial[0] };
  if (partial.length === 0) {
    return { error: `${kind} «${query}» не найдено. Есть: ${rows.map(nameOf).join(", ")}` };
  }
  return {
    error: `${kind} «${query}» неоднозначно: ${partial.map(nameOf).join(" | ")}. Уточните.`,
  };
}

async function assertMonth(month: unknown): Promise<string | null> {
  if (typeof month !== "string") return "не указан месяц";
  const exists = await prisma.month.findUnique({ where: { id: month } });
  return exists ? null : `месяца ${month} нет в справочнике`;
}

export async function runAiWriteTool(
  name: string,
  input: Record<string, unknown>,
  username: string
): Promise<unknown> {
  const audit = (data: unknown) =>
    prisma.auditLog.create({
      data: {
        entity: `chat:${name}`,
        entityId: "",
        action: "AI_WRITE",
        data: JSON.stringify(data),
        username,
      },
    });

  switch (name) {
    case "set_opex": {
      const monthError = await assertMonth(input.month);
      if (monthError) return { error: monthError };
      const company = input.company === "FARGO" ? "FARGO" : "TI";
      const cats = await prisma.opexCategory.findMany({ where: { company, active: true } });
      const found = resolveOne("категория", String(input.category ?? ""), cats, (c) => c.name);
      if (!found.row) return { error: found.error };
      const month = input.month as string;

      if (company === "TI") {
        const bank = num(input.bank);
        const cash = num(input.cash);
        if (bank === null && cash === null) return { error: "укажите bank и/или cash" };
        const before = await prisma.opexTiEntry.findMany({
          where: { monthId: month, categoryId: found.row.id, deletedAt: null },
        });
        const prev = {
          bank: before.reduce((s, e) => s + e.bankAmount, 0),
          cash: before.reduce((s, e) => s + e.cashAmount, 0),
        };
        for (const [field, value] of [
          ["bankAmount", bank],
          ["cashAmount", cash],
        ] as const) {
          if (value === null) continue;
          await REQUEST_KINDS.OPEX_TI.integrate(month, {
            refId: found.row.id,
            refId2: null,
            field,
            freeLabel: null,
            value,
          });
        }
        const written = {
          month,
          category: found.row.name,
          bank: bank ?? prev.bank,
          cash: cash ?? prev.cash,
        };
        await audit({ ...written, previous: prev });
        return { ok: true, written, previous: prev };
      }

      const amount = num(input.amount);
      if (amount === null) return { error: "укажите amount" };
      const before = await prisma.opexFargoEntry.findMany({
        where: { monthId: month, categoryId: found.row.id, deletedAt: null },
      });
      const prev = before.reduce((s, e) => s + e.amount, 0);
      await REQUEST_KINDS.OPEX_FARGO.integrate(month, {
        refId: found.row.id,
        refId2: null,
        field: "amount",
        freeLabel: null,
        value: amount,
      });
      const written = { month, category: found.row.name, amount };
      await audit({ ...written, previous: prev });
      return { ok: true, written, previous: prev };
    }

    case "set_stock": {
      const monthError = await assertMonth(input.month);
      if (monthError) return { error: monthError };
      const qty = num(input.qty);
      if (qty === null) return { error: "укажите qty" };
      const products = await prisma.product.findMany({ where: { active: true, isPromo: false } });
      const product = resolveOne("товар", String(input.product ?? ""), products, (p) => p.nameRu);
      if (!product.row) return { error: product.error };
      const warehouses = await prisma.warehouse.findMany({
        where: { active: true },
        orderBy: { sortOrder: "asc" },
      });
      let warehouse = warehouses[0];
      if (typeof input.warehouse === "string" && input.warehouse.trim()) {
        const w = resolveOne("склад", input.warehouse, warehouses, (x) => x.name);
        if (!w.row) return { error: w.error };
        warehouse = w.row;
      }
      const prev = await prisma.stockCount.findUnique({
        where: {
          monthId_productId_warehouseId: {
            monthId: input.month as string,
            productId: product.row.id,
            warehouseId: warehouse.id,
          },
        },
      });
      await REQUEST_KINDS.STOCK.integrate(input.month as string, {
        refId: product.row.id,
        refId2: warehouse.id,
        field: "qty",
        freeLabel: null,
        value: qty,
      });
      const written = {
        month: input.month,
        product: product.row.nameRu,
        warehouse: warehouse.name,
        qty,
      };
      await audit({ ...written, previous: prev?.qty ?? 0 });
      return { ok: true, written, previous: prev?.qty ?? 0 };
    }

    case "set_ar": {
      const monthError = await assertMonth(input.month);
      if (monthError) return { error: monthError };
      const amount = num(input.amount);
      if (amount === null) return { error: "укажите amount" };
      const customer = String(input.customer ?? "").trim();
      if (!customer) return { error: "укажите customer" };
      const prev = await prisma.arEntry.findFirst({
        where: { monthId: input.month as string, customerName: customer, deletedAt: null },
      });
      await REQUEST_KINDS.AR.integrate(input.month as string, {
        refId: null,
        refId2: null,
        field: "amount",
        freeLabel: customer,
        value: amount,
      });
      const written = { month: input.month, customer, amount };
      await audit({ ...written, previous: prev?.amount ?? null });
      return { ok: true, written, previous: prev?.amount ?? null };
    }

    case "set_month_balance": {
      const monthError = await assertMonth(input.month);
      if (monthError) return { error: monthError };
      const value = num(input.value);
      if (value === null) return { error: "укажите value" };
      const FIELDS = ["tiBank", "tiCash", "goodsInTransit"] as const;
      const field = FIELDS.find((f) => f === input.field);
      if (!field) return { error: `field должен быть одним из: ${FIELDS.join(", ")}` };
      const month = input.month as string;
      const prev = await prisma.monthBalance.findUnique({ where: { monthId: month } });
      await prisma.monthBalance.upsert({
        where: { monthId: month },
        create: {
          monthId: month,
          tiBank: 0,
          tiCash: 0,
          goodsInTransit: 0,
          vatPrepayment: 0,
          priorVatBalance: 0,
          nutribenLoan: 0,
          [field]: value,
        },
        update: { [field]: value },
      });
      const written = { month, field, value };
      await audit({ ...written, previous: prev?.[field] ?? 0 });
      return { ok: true, written, previous: prev?.[field] ?? 0 };
    }

    case "add_contribution":
    case "add_transfer": {
      const date = new Date(String(input.date ?? ""));
      if (Number.isNaN(date.getTime())) return { error: "укажите дату YYYY-MM-DD" };
      const note = typeof input.note === "string" ? input.note : null;
      if (name === "add_contribution") {
        const ti = num(input.tiAmount) ?? 0;
        const fargo = num(input.fargoAmount) ?? 0;
        if (ti === 0 && fargo === 0) return { error: "укажите tiAmount и/или fargoAmount" };
        await prisma.capitalContribution.create({
          data: { date, tiAmount: ti, fargoAmount: fargo, notes: note },
        });
        const written = { date: date.toISOString().slice(0, 10), tiAmount: ti, fargoAmount: fargo };
        await audit(written);
        return { ok: true, written };
      }
      const cash = num(input.cashAmount) ?? 0;
      const bank = num(input.bankAmount) ?? 0;
      if (cash === 0 && bank === 0) return { error: "укажите cashAmount и/или bankAmount" };
      await prisma.fargoTransfer.create({
        data: { date, cashAmount: cash, bankAmount: bank, notes: note },
      });
      const written = { date: date.toISOString().slice(0, 10), cashAmount: cash, bankAmount: bank };
      await audit(written);
      return { ok: true, written };
    }

    default:
      return { error: `неизвестный инструмент записи ${name}` };
  }
}
