// Tool surface for the AI analyst. Read tools answer from the same engine the
// pages render, so the assistant can never disagree with the app. Write tools
// (further down) are ADMIN-only, reuse the data-request integrators, and are
// mirrored into AuditLog.
import type Anthropic from "@anthropic-ai/sdk";
import { getComputed } from "@/lib/data";
import { prisma } from "@/lib/db";
import { REQUEST_KINDS } from "@/lib/requests/kinds";

export type AiContext = Awaited<ReturnType<typeof getComputed>>;

const r = (n: number) => Math.round(n);
const pct = (n: number) => Math.round(n * 1000) / 10; // 0.436 -> 43.6

/** Label shown in the chat UI while a tool runs. */
export const TOOL_LABELS: Record<string, { ru: string; en: string }> = {
  pnl_overview: { ru: "Смотрю P&L по месяцам", en: "Reading the monthly P&L" },
  month_detail: { ru: "Разбираю месяц", en: "Breaking down the month" },
  product_economics: { ru: "Считаю экономику продуктов", en: "Checking product economics" },
  opex_entries: { ru: "Читаю статьи расходов", en: "Reading OPEX entries" },
  shipments_and_costs: { ru: "Смотрю поставки и себестоимость", en: "Reading shipments and costs" },
  balance_sheet: { ru: "Открываю баланс", en: "Opening the balance sheet" },
  settlement_and_capital: { ru: "Проверяю расчёты Fargo↔TI", en: "Checking the settlement" },
  health_checks: { ru: "Запускаю проверки данных", en: "Running data checks" },
  sales_query: { ru: "Ищу в продажах", en: "Querying sales" },
  quarter_tax_audit: { ru: "Сверяю налоги TI по кварталам", en: "Auditing TI quarterly taxes" },
  set_opex: { ru: "✏ Записываю OPEX", en: "✏ Writing OPEX" },
  set_stock: { ru: "✏ Записываю остатки", en: "✏ Writing stock" },
  set_ar: { ru: "✏ Записываю дебиторку", en: "✏ Writing AR" },
  set_month_balance: { ru: "✏ Записываю балансовый ввод", en: "✏ Writing balance input" },
  add_contribution: { ru: "✏ Добавляю вклад капитала", en: "✏ Adding contribution" },
  add_transfer: { ru: "✏ Добавляю платёж Fargo→TI", en: "✏ Adding transfer" },
};

export const AI_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "pnl_overview",
    description:
      "Ключевые строки P&L по каждому месяцу с данными плюс итог YTD: выручка, COGS, валовая прибыль, OPEX (TI/Fargo/ретро), EBITDA, налоги (НДС Fargo, налог с оборота Fargo 1.9%, налог на прибыль TI из квартальных деклараций), чистая прибыль. Начинай с этого инструмента почти любой вопрос о цифрах.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "month_detail",
    description:
      "Полная детализация одного месяца: выручка по каналам и по продуктам, количество по продуктам, строки COGS (продукт × количество × себестоимость), OPEX по группам P&L, детали НДС (банк/нал), строка расчётов Fargo↔TI.",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "string", description: "Месяц в формате YYYY-MM, например 2026-05" },
      },
      required: ["month"],
      additionalProperties: false,
    },
  },
  {
    name: "product_economics",
    description:
      "Экономика каждого продукта: цена продажи, средняя себестоимость TI, себестоимость Fargo (трансфертная), маржа на единицу, продано штук и выручка за всё время.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "opex_entries",
    description:
      "Статьи операционных расходов по категориям: компания TI (банк/наличные раздельно) или FARGO. Опционально фильтр по месяцу. Показывает и заметки к записям.",
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
      "Все поставки: закупка (EUR→UZS), импортные расходы, коэффициент нагрузки (load factor), стоимость по ценам Fargo, флаг отсутствующих трансфертных цен.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "balance_sheet",
    description:
      "Баланс месяца: активы (склад, товары в пути, дебиторка, банк TI, предоплата НДС, задолженность Fargo), обязательства, капитал, нераспределённая прибыль и НЕСВЕДЁННЫЙ ОСТАТОК (plug). Плюс остатки по продуктам и дебиторка по клиентам.",
    input_schema: {
      type: "object",
      properties: { month: { type: "string", description: "YYYY-MM" } },
      required: ["month"],
      additionalProperties: false,
    },
  },
  {
    name: "settlement_and_capital",
    description:
      "Помесячные расчёты Fargo↔TI (сколько Fargo должен TI и сколько перечислено), вклады капитала и платежи Fargo→TI.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "health_checks",
    description:
      "Автоматические проверки целостности данных, включая сверку с контрольными значениями (golden values). Первый инструмент для вопросов вида «что не так с данными» или «почему не сходится».",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "sales_query",
    description:
      "Гранулярные продажи: месяц × продукт × канал, количество и выручка. Фильтры по месяцу, названию продукта, названию канала (подстрока, без учёта регистра). Отрицательное количество — возвраты.",
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
  {
    name: "quarter_tax_audit",
    description:
      "Квартальный аудит налогов TI: официальная маржа 3% на трансферах, расчётный НДС 12% и налог на прибыль 15%, задекларированные расходы и поданные декларации. ВАЖНО: фактически уплаченные налоги TI сейчас лежат в OPEX-категориях «Налог на прибыль» и «Налог на НДС (3%)» — сверяй с opex_entries.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

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

  const monthRow = (m: (typeof computed.monthly)[0]) => ({
    month: m.monthId,
    revenue: r(m.revenue),
    cogs: r(m.cogs),
    grossProfit: r(m.grossProfit),
    gpMarginPct: pct(m.gpMarginPct),
    opexTi: r(m.opexTiTotal),
    opexFargo: r(m.opexFargoTotal),
    retroBonus: r(m.retroBonus),
    totalOpex: r(m.totalOpex),
    ebitda: r(m.ebitda),
    fargoVat: r(m.fargoVat),
    fargoIncomeTax: r(m.fargoIncomeTax),
    tiIncomeTaxFromFilings: r(m.tiIncomeTax),
    taxesTotal: r(m.taxesTotal),
    netProfit: r(m.netProfit),
    netMarginPct: pct(m.netMarginPct),
  });

  switch (name) {
    case "pnl_overview": {
      const withData = computed.monthly.filter((m) => m.revenue !== 0 || m.totalOpex !== 0);
      return { months: withData.map(monthRow), ytd: monthRow(computed.ytd) };
    }

    case "month_detail": {
      const m = computed.monthly.find((x) => x.monthId === input.month);
      if (!m) return { error: `нет месяца ${input.month}` };
      const st = computed.settlement.find((s) => s.monthId === m.monthId);
      return {
        ...monthRow(m),
        revenueByChannel: named(m.revenueByChannel, channelName),
        revenueByProduct: named(m.revenueByProduct, productName),
        qtyByProduct: named(m.qtyByProduct, productName),
        cogsRows: m.cogsRows.map((c) => ({
          product: productName(c.productId),
          qty: r(c.qty),
          unitCost: r(c.unitCost),
          amount: r(c.amount),
        })),
        opexTiByGroup: Object.fromEntries(
          Object.entries(m.opexTiByGroup).map(([g, v]) => [g, r(v)])
        ),
        opexFargoByGroup: Object.fromEntries(
          Object.entries(m.opexFargoByGroup).map(([g, v]) => [g, r(v)])
        ),
        vat: { bankVat: r(m.bankVat), cashVat: r(m.cashVat) },
        settlement: st
          ? { dueToTi: r(st.dueToTi), transferred: r(st.cumTransfersCash + st.cumTransfersBank), remaining: r(st.remaining) }
          : null,
      };
    }

    case "product_economics": {
      return dataset.products
        .filter((p) => !p.isPromo || computed.ytd.qtyByProduct[p.id])
        .map((p) => {
          const cost = computed.productCosts[p.regularProductId ?? p.id];
          const tiCost = cost?.avgTiCost ?? 0;
          return {
            product: p.nameRu,
            isPromo: p.isPromo,
            sellPrice: r(p.price),
            avgTiCost: r(tiCost),
            avgFargoCost: r(cost?.avgFargoCost ?? 0),
            unitMargin: r(p.price - tiCost),
            marginPct: p.price ? pct((p.price - tiCost) / p.price) : null,
            soldQty: r(computed.ytd.qtyByProduct[p.id] ?? 0),
            revenue: r(computed.ytd.revenueByProduct[p.id] ?? 0),
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
      return computed.shipmentCosts.map((s) => ({
        code: s.code,
        month: s.monthId,
        purchaseTotal: r(s.purchaseTotal),
        importExpenses: r(s.expenseTotal),
        loadFactor: Math.round(s.loadFactor * 10000) / 10000,
        fargoValue: r(s.fargoValue),
        missingFargoCosts: s.hasMissingFargoCost,
        units: r(s.lines.reduce((a, l) => a + l.qty, 0)),
      }));
    }

    case "balance_sheet": {
      const b = computed.balanceSheets.find((x) => x.monthId === input.month);
      if (!b) return { error: `нет месяца ${input.month}` };
      const stock = dataset.stockCounts.filter((s) => s.monthId === input.month && s.qty !== 0);
      const ar = dataset.arEntries.filter((a) => a.monthId === input.month);
      return {
        month: b.monthId,
        hasManualInputs: b.hasInputs,
        assets: {
          inventory: r(b.inventory),
          goodsInTransit: r(b.goodsInTransit),
          accountsReceivable: r(b.arTotal),
          tiBank: r(b.tiBank),
          vatPrepayment: r(b.vatPrepayment),
          settlementReceivable: r(b.settlementReceivable),
          total: r(b.assetsTotal),
        },
        liabilities: {
          taxPayable: r(b.taxPayable),
          priorVatBalance: r(b.priorVatBalance),
          nutribenLoan: r(b.nutribenLoan),
          total: r(b.liabilitiesTotal),
        },
        equity: {
          tiCapital: r(b.tiCapital),
          fargoCapital: r(b.fargoCapital),
          retainedEarnings: r(b.retainedEarnings),
          unreconciledPlug: r(b.plug),
          total: r(b.equityTotal),
        },
        stockByProduct: stock.map((s) => ({ product: productName(s.productId), qty: r(s.qty) })),
        arByCustomer: ar.map((a) => ({ customer: a.customerName, amount: r(a.amount) })),
      };
    }

    case "settlement_and_capital": {
      return {
        settlement: computed.settlement
          .filter((s) => s.cumRevenue !== 0)
          .map((s) => ({
            month: s.monthId,
            dueToTi: r(s.dueToTi),
            transferredCash: r(s.cumTransfersCash),
            transferredBank: r(s.cumTransfersBank),
            outstandingAr: r(s.outstandingAr),
            remaining: r(s.remaining),
          })),
        capitalContributions: {
          count: dataset.contributions.length,
          tiTotal: r(dataset.contributions.reduce((a, c) => a + c.tiAmount, 0)),
          fargoTotal: r(dataset.contributions.reduce((a, c) => a + c.fargoAmount, 0)),
        },
        fargoToTiTransfers: {
          count: dataset.transfers.length,
          cashTotal: r(dataset.transfers.reduce((a, t) => a + t.cashAmount, 0)),
          bankTotal: r(dataset.transfers.reduce((a, t) => a + t.bankAmount, 0)),
        },
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
            revenue: r(s.amount ?? s.qty * price),
          };
        });
      return {
        rows: rows.slice(0, 200),
        totalRows: rows.length,
        truncated: rows.length > 200,
        totals: { qty: r(rows.reduce((a, x) => a + x.qty, 0)), revenue: r(rows.reduce((a, x) => a + x.revenue, 0)) },
      };
    }

    case "quarter_tax_audit": {
      return computed.quarterAudits.map((q) => ({
        quarter: q.quarterLabel,
        shipments: q.shipmentCodes,
        fargoValue: r(q.fargoValue),
        officialGrossProfit: r(q.grossProfit),
        declaredExpenses: r(q.declaredExpenses),
        taxableProfit: r(q.taxableProfit),
        computedIncomeTax15: r(q.computedTax),
        filedTax: r(q.filedTax),
        variance: r(q.taxVariance),
        computedVat12: r(q.computedVat),
      }));
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
      "Устанавливает один из ручных балансовых вводов месяца: tiBank (счёт TI в банке), goodsInTransit (товары в пути), vatPrepayment (предоплата НДС), priorVatBalance (сальдо НДС, обязательство), nutribenLoan (займ Nutriben).",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "string", description: "YYYY-MM" },
        field: {
          type: "string",
          enum: ["tiBank", "goodsInTransit", "vatPrepayment", "priorVatBalance", "nutribenLoan"],
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
      const FIELDS = [
        "tiBank",
        "goodsInTransit",
        "vatPrepayment",
        "priorVatBalance",
        "nutribenLoan",
      ] as const;
      const field = FIELDS.find((f) => f === input.field);
      if (!field) return { error: `field должен быть одним из: ${FIELDS.join(", ")}` };
      const month = input.month as string;
      const prev = await prisma.monthBalance.findUnique({ where: { monthId: month } });
      await prisma.monthBalance.upsert({
        where: { monthId: month },
        create: {
          monthId: month,
          tiBank: 0,
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
