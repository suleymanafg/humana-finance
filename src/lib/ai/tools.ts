// Read-only tool surface for the AI analyst. Every tool answers from the same
// engine the pages render, so the assistant can never disagree with the app.
// No tool writes anything — that is the entire safety model of this feature.
import type Anthropic from "@anthropic-ai/sdk";
import { getComputed } from "@/lib/data";

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
