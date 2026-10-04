// Every statement the app shows, defined once: the pages render these lines
// and the export writes the same lines to a file.
import { FARGO_GROUPS, GROUP_LABELS, TI_GROUPS } from "./groups";
import type { Computed } from "./engine/types";
import type { Bi } from "./nav";

export type LineKind = "header" | "line" | "subtotal" | "total" | "ratio" | "memo" | "check";

export interface StatementLine {
  key: string;
  label: Bi;
  kind: LineKind;
  /** per month; absent for headers and ratio lines */
  values?: Record<string, number>;
  /** flows add up over a period; positions take the period's last month */
  agg?: "sum" | "last";
  ratio?: { num: string; den: string };
  indent?: boolean;
  /** quantities rather than money */
  units?: boolean;
  /** shown per month only — meaningless over a period */
  noTotal?: boolean;
  /** a result (profit, what is owed): shown in red when negative */
  result?: boolean;
  href?: string;
}

export interface Statement {
  key: string;
  /** "flow" statements total over a period; "position" statements are month-end */
  mode: "flow" | "position";
  lines: StatementLine[];
}

export type Entity = "group" | "ti" | "fargo";

type Rows<T> = T[];
const byMonth = <T extends { monthId: string }>(rows: Rows<T>, pick: (r: T) => number) =>
  Object.fromEntries(rows.map((r) => [r.monthId, pick(r)]));

const header = (key: string, label: Bi): StatementLine => ({ key, label, kind: "header" });
const line = (
  key: string,
  label: Bi,
  values: Record<string, number>,
  opts: Partial<StatementLine> = {}
): StatementLine => ({ key, label, kind: "line", values, agg: "sum", indent: true, ...opts });
const subtotal = (key: string, label: Bi, values: Record<string, number>, opts: Partial<StatementLine> = {}) =>
  line(key, label, values, { kind: "subtotal", indent: false, ...opts });
const total = (key: string, label: Bi, values: Record<string, number>, opts: Partial<StatementLine> = {}) =>
  line(key, label, values, { kind: "total", indent: false, ...opts });
const ratio = (key: string, label: Bi, num: string, den: string): StatementLine => ({
  key,
  label,
  kind: "ratio",
  ratio: { num, den },
});
const memo = (key: string, label: Bi, values: Record<string, number>, opts: Partial<StatementLine> = {}) =>
  line(key, label, values, { kind: "memo", ...opts });
const check = (key: string, label: Bi, values: Record<string, number>, agg: "sum" | "last" = "sum") =>
  line(key, label, values, { kind: "check", agg, indent: false });

const neg = (v: Record<string, number>) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, -x]));

function groupLines(
  prefix: string,
  groups: readonly string[],
  rows: Array<{ monthId: string; opexByGroup: Record<string, number> }>,
  href: string
): StatementLine[] {
  const out = groups.map((g) =>
    line(`${prefix}.${g}`, GROUP_LABELS[g], neg(byMonth(rows, (r) => r.opexByGroup[g] ?? 0)), { href })
  );
  if (rows.some((r) => (r.opexByGroup.UNMAPPED ?? 0) !== 0)) {
    out.push(
      line(`${prefix}.UNMAPPED`, { ru: "Без группы", en: "No group" }, neg(byMonth(rows, (r) => r.opexByGroup.UNMAPPED ?? 0)), {
        href: "/settings",
      })
    );
  }
  return out;
}

// ───────────────────────── Profit and loss ─────────────────────────

export function pnlStatement(entity: Entity, c: Computed): Statement {
  if (entity === "ti") {
    const t = c.ti;
    return {
      key: "pnl-ti",
      mode: "flow",
      lines: [
        header("rev", { ru: "Выручка", en: "Revenue" }),
        line("revenue", { ru: "Продажи Fargo по счетам-фактурам, без НДС", en: "Sales to Fargo by invoice, ex-VAT" }, byMonth(t, (r) => r.revenue), { href: "/goods/invoices" }),
        memo("units", { ru: "Отгружено по счетам, шт", en: "Units invoiced" }, byMonth(t, (r) => r.units), { units: true }),
        line("cogs", { ru: "Себестоимость, FIFO по фурам", en: "Cost of goods, FIFO by truck" }, neg(byMonth(t, (r) => r.cogs)), { href: "/goods/fifo" }),
        line("giveaways", { ru: "Образцы и лаборатория", en: "Samples and laboratory" }, neg(byMonth(t, (r) => r.giveaways)), { href: "/goods/stock" }),
        subtotal("gp", { ru: "Валовая прибыль", en: "Gross profit" }, byMonth(t, (r) => r.grossProfit), { result: true }),
        ratio("gpm", { ru: "Валовая маржа", en: "Gross margin" }, "gp", "revenue"),
        header("opexH", { ru: "Операционные расходы", en: "Operating expenses" }),
        ...groupLines("opex", TI_GROUPS, t, "/expenses/ti"),
        subtotal("opex", { ru: "Итого операционные расходы", en: "Total operating expenses" }, neg(byMonth(t, (r) => r.opex))),
        subtotal("ebitda", { ru: "Операционная прибыль (EBITDA)", en: "Operating profit (EBITDA)" }, byMonth(t, (r) => r.ebitda), { result: true }),
        ratio("ebitdam", { ru: "Рентабельность по EBITDA", en: "EBITDA margin" }, "ebitda", "revenue"),
        header("taxH", { ru: "Налоги", en: "Taxes" }),
        line("profitTax", { ru: "Налог на прибыль, по декларациям", en: "Profit tax, as filed" }, neg(byMonth(t, (r) => r.profitTax)), { href: "/taxes/profit" }),
        line("vatCost", { ru: "НДС за счёт TI", en: "VAT borne by TI" }, neg(byMonth(t, (r) => r.vatCost)), { href: "/taxes/ti-vat" }),
        total("net", { ru: "Чистая прибыль", en: "Net profit" }, byMonth(t, (r) => r.netProfit), { result: true }),
        ratio("netm", { ru: "Чистая маржа", en: "Net margin" }, "net", "revenue"),
      ],
    };
  }
  if (entity === "fargo") {
    const f = c.fargo;
    return {
      key: "pnl-fargo",
      mode: "flow",
      lines: [
        header("rev", { ru: "Выручка без НДС", en: "Revenue, ex-VAT" }),
        line("bank", { ru: "Продажи через банк (цена ÷ 1,12)", en: "Bank sales (price ÷ 1.12)" }, byMonth(f, (r) => r.bankRevenue), { href: "/sales" }),
        line("cash", { ru: "Продажи за наличные (цена − НДС с декларации)", en: "Cash sales (price − VAT on the declared value)" }, byMonth(f, (r) => r.cashRevenue), { href: "/sales" }),
        subtotal("revenue", { ru: "Выручка", en: "Revenue" }, byMonth(f, (r) => r.revenue)),
        memo("atPrice", { ru: "Продажи по ценам клиентов, с НДС", en: "Sales at customer prices, VAT included" }, byMonth(f, (r) => r.salesAtPrice)),
        memo("units", { ru: "Продано, шт", en: "Units sold" }, byMonth(f, (r) => r.units), { units: true }),
        line("cogs", { ru: "Себестоимость, FIFO по счетам TI", en: "Cost of goods, FIFO by TI invoice" }, neg(byMonth(f, (r) => r.cogs)), { href: "/goods/fifo" }),
        line("loss", { ru: "Потери по инвентаризации", en: "Stock loss at the count" }, neg(byMonth(f, (r) => r.stockLoss)), { href: "/goods/stock" }),
        memo("writeOffs", { ru: "в т. ч. списания, учтённые Fargo", en: "of which write-offs recorded by Fargo" }, byMonth(f, (r) => r.writeOffsRecorded), { href: "/expenses/fargo" }),
        subtotal("gp", { ru: "Валовая прибыль", en: "Gross profit" }, byMonth(f, (r) => r.grossProfit), { result: true }),
        ratio("gpm", { ru: "Валовая маржа", en: "Gross margin" }, "gp", "revenue"),
        header("opexH", { ru: "Операционные расходы, включая ретро-бонусы", en: "Operating expenses, including retro bonuses" }),
        ...groupLines("opex", FARGO_GROUPS, f, "/expenses/fargo"),
        subtotal("opex", { ru: "Итого операционные расходы", en: "Total operating expenses" }, neg(byMonth(f, (r) => r.opex))),
        subtotal("ebitda", { ru: "Операционная прибыль (EBITDA)", en: "Operating profit (EBITDA)" }, byMonth(f, (r) => r.ebitda), { result: true }),
        ratio("ebitdam", { ru: "Рентабельность по EBITDA", en: "EBITDA margin" }, "ebitda", "revenue"),
        line("incomeTax", { ru: "Оборотный налог, 1,9% от продаж", en: "Turnover tax, 1.9% of sales" }, neg(byMonth(f, (r) => r.incomeTax)), { indent: false }),
        total("net", { ru: "Чистая прибыль", en: "Net profit" }, byMonth(f, (r) => r.netProfit), { result: true }),
        ratio("netm", { ru: "Чистая маржа", en: "Net margin" }, "net", "revenue"),
      ],
    };
  }
  const g = c.group;
  return {
    key: "pnl-group",
    mode: "flow",
    lines: [
      header("rev", { ru: "Выручка без НДС", en: "Revenue, ex-VAT" }),
      line("bank", { ru: "Продажи через банк", en: "Bank sales" }, byMonth(g, (r) => r.bankRevenue), { href: "/sales" }),
      line("cash", { ru: "Продажи за наличные", en: "Cash sales" }, byMonth(g, (r) => r.cashRevenue), { href: "/sales" }),
      subtotal("revenue", { ru: "Выручка", en: "Revenue" }, byMonth(g, (r) => r.revenue)),
      memo("units", { ru: "Продано, шт", en: "Units sold" }, byMonth(g, (r) => r.units), { units: true }),
      line("cogs", { ru: "Себестоимость, FIFO по стоимости TI", en: "Cost of goods, FIFO at TI landed cost" }, neg(byMonth(g, (r) => r.cogs)), { href: "/goods/fifo" }),
      line("giveaways", { ru: "Образцы и лаборатория", en: "Samples and laboratory" }, neg(byMonth(g, (r) => r.giveaways)), { href: "/goods/stock" }),
      line("loss", { ru: "Потери по инвентаризации", en: "Stock loss at the count" }, neg(byMonth(g, (r) => r.stockLoss)), { href: "/goods/stock" }),
      subtotal("gp", { ru: "Валовая прибыль", en: "Gross profit" }, byMonth(g, (r) => r.grossProfit), { result: true }),
      ratio("gpm", { ru: "Валовая маржа", en: "Gross margin" }, "gp", "revenue"),
      header("opexH", { ru: "Операционные расходы", en: "Operating expenses" }),
      line("opexTi", { ru: "Turbo Impex", en: "Turbo Impex" }, neg(byMonth(g, (r) => r.opexTi)), { href: "/expenses/ti" }),
      line("opexFargo", { ru: "Fargo, включая ретро-бонусы", en: "Fargo, including retro bonuses" }, neg(byMonth(g, (r) => r.opexFargo)), { href: "/expenses/fargo" }),
      subtotal("opex", { ru: "Итого операционные расходы", en: "Total operating expenses" }, neg(byMonth(g, (r) => r.opex))),
      subtotal("ebitda", { ru: "Операционная прибыль (EBITDA)", en: "Operating profit (EBITDA)" }, byMonth(g, (r) => r.ebitda), { result: true }),
      ratio("ebitdam", { ru: "Рентабельность по EBITDA", en: "EBITDA margin" }, "ebitda", "revenue"),
      header("taxH", { ru: "Налоги", en: "Taxes" }),
      line("fargoTax", { ru: "Оборотный налог Fargo", en: "Fargo turnover tax" }, neg(byMonth(g, (r) => r.fargoIncomeTax)), { href: "/taxes/profit" }),
      line("tiTax", { ru: "Налог на прибыль TI", en: "TI profit tax" }, neg(byMonth(g, (r) => r.tiProfitTax)), { href: "/taxes/profit" }),
      line("vatCost", { ru: "НДС за счёт TI", en: "VAT borne by TI" }, neg(byMonth(g, (r) => r.tiVatCost)), { href: "/taxes/ti-vat" }),
      subtotal("taxes", { ru: "Итого налоги", en: "Total taxes" }, neg(byMonth(g, (r) => r.taxes))),
      total("net", { ru: "Чистая прибыль", en: "Net profit" }, byMonth(g, (r) => r.netProfit), { result: true }),
      ratio("netm", { ru: "Чистая маржа", en: "Net margin" }, "net", "revenue"),
      header("reconH", { ru: "Сверка с результатами компаний", en: "Reconciliation with the companies' results" }),
      line("tiNet", { ru: "Чистая прибыль Turbo Impex", en: "Turbo Impex net profit" }, byMonth(g, (r) => r.recon.tiNet)),
      line("fargoNet", { ru: "Чистая прибыль Fargo", en: "Fargo net profit" }, byMonth(g, (r) => r.recon.fargoNet)),
      line("mInv", { ru: "Маржа TI на товаре, выставленном Fargo", en: "TI margin on goods invoiced to Fargo" }, byMonth(g, (r) => r.recon.marginInvoiced)),
      line("mSold", { ru: "Маржа TI на товаре, проданном Fargo", en: "TI margin on goods Fargo sold" }, byMonth(g, (r) => r.recon.marginSold)),
      line("mLoss", { ru: "Маржа TI в потерях по инвентаризации", en: "TI margin inside stock losses" }, byMonth(g, (r) => r.recon.marginInLoss)),
      subtotal("reconTotal", { ru: "Чистая прибыль группы", en: "Group net profit" }, byMonth(g, (r) => r.recon.total), { result: true }),
      check("reconCheck", { ru: "Расхождение", en: "Difference" }, byMonth(g, (r) => r.recon.check)),
    ],
  };
}

// ───────────────────────── Balance sheets ─────────────────────────

export function balanceStatement(entity: Entity, c: Computed): Statement {
  const b = c.balance;
  const pos = (key: string, label: Bi, pick: (r: Computed["balance"][number]) => number, opts: Partial<StatementLine> = {}) =>
    line(key, label, byMonth(b, pick), { agg: "last", ...opts });
  const sub = (key: string, label: Bi, pick: (r: Computed["balance"][number]) => number) =>
    subtotal(key, label, byMonth(b, pick), { agg: "last" });
  const tot = (key: string, label: Bi, pick: (r: Computed["balance"][number]) => number) =>
    total(key, label, byMonth(b, pick), { agg: "last" });
  const flow = (key: string, label: Bi, pick: (r: Computed["balance"][number]) => number) =>
    line(key, label, byMonth(b, pick), { agg: "sum" });

  const tiLiabilities: StatementLine[] = [
    pos("vatDebt", { ru: "Долг по НДС (лицевой счёт)", en: "VAT owed (tax account)" }, (r) => r.ti.vatDebt, { href: "/taxes/ti-vat" }),
    pos("priorVat", { ru: "Прежнему владельцу: переплата НДС", en: "Previous owner: VAT overpayment" }, (r) => r.ti.priorOwnerVat, { href: "/funding/previous-owner" }),
    pos("priorCash", { ru: "Прежнему владельцу: его деньги", en: "Previous owner: their money" }, (r) => r.ti.priorOwnerCash, { href: "/funding/previous-owner" }),
    pos("loans", { ru: "Займы и финансовая помощь", en: "Loans and financial assistance" }, (r) => r.ti.loans, { href: "/funding/loans" }),
    pos("other", { ru: "Деньги других покупателей", en: "Other customers' money" }, (r) => r.ti.otherReceipts, { href: "/funding/other" }),
    pos("importUnpaid", { ru: "Импортные услуги к оплате", en: "Import services unpaid" }, (r) => r.ti.importUnpaid, { href: "/goods/shipments" }),
    pos("taxPayable", { ru: "Налог на прибыль к оплате", en: "Profit tax payable" }, (r) => r.ti.profitTaxPayable, { href: "/taxes/profit" }),
  ];

  if (entity === "ti") {
    return {
      key: "bs-ti",
      mode: "position",
      lines: [
        header("assets", { ru: "Активы", en: "Assets" }),
        pos("bank", { ru: "Деньги на счёте", en: "Cash at bank" }, (r) => r.ti.bank, { href: "/funding/balances" }),
        pos("cash", { ru: "Деньги в кассе", en: "Cash on hand" }, (r) => r.ti.cash, { href: "/funding/balances" }),
        pos("receivable", { ru: "Fargo: счета с НДС минус платежи", en: "Fargo: invoices incl. VAT less payments" }, (r) => r.ti.receivableFromFargo, { href: "/settlement" }),
        pos("stock", { ru: "Товар на складе TI", en: "Stock held by TI" }, (r) => r.ti.stock, { href: "/goods/stock" }),
        pos("transit", { ru: "Товар в пути (предоплата)", en: "Goods in transit (prepaid)" }, (r) => r.ti.goodsInTransit, { href: "/funding/balances" }),
        pos("vatOver", { ru: "Переплата НДС (лицевой счёт)", en: "VAT overpaid (tax account)" }, (r) => r.ti.vatOverpaid, { href: "/taxes/ti-vat" }),
        sub("assetsTotal", { ru: "Итого активы", en: "Total assets" }, (r) => r.ti.assets),
        header("liab", { ru: "Обязательства", en: "Liabilities" }),
        ...tiLiabilities,
        sub("liabTotal", { ru: "Итого обязательства", en: "Total liabilities" }, (r) => r.ti.liabilities),
        header("equity", { ru: "Капитал", en: "Equity" }),
        pos("capTi", { ru: "Капитал Turbo Impex", en: "Capital, Turbo Impex" }, (r) => r.ti.tiCapital, { href: "/funding/capital" }),
        pos("capFargo", { ru: "Капитал Fargo", en: "Capital, Fargo" }, (r) => r.ti.fargoCapital, { href: "/funding/capital" }),
        pos("retained", { ru: "Нераспределённая прибыль", en: "Retained earnings" }, (r) => r.ti.retained),
        sub("equityTotal", { ru: "Итого капитал", en: "Total equity" }, (r) => r.ti.equity),
        tot("unreconciled", { ru: "Несверенная сумма", en: "Unreconciled" }, (r) => r.ti.unreconciled),
        pos("unrecCash", { ru: "из неё: деньги и предоплаты против их источников", en: "of which cash and prepayments against their sources" }, (r) => r.ti.unreconciledCash, { kind: "memo" }),
        pos("unrecVat", { ru: "из неё: НДС", en: "of which VAT" }, (r) => r.ti.unreconciledVat, { kind: "memo" }),
        header("roll", { ru: "Движение товара TI", en: "Turbo Impex stock movement" }),
        pos("rollOpen", { ru: "На начало месяца", en: "Opening" }, (r) => r.ti.stockOpening),
        flow("rollIn", { ru: "Поступило (фуры, по себестоимости)", en: "Trucks arrived, landed cost" }, (r) => r.ti.stockArrived),
        flow("rollOut", { ru: "Отгружено Fargo, по себестоимости", en: "Invoiced to Fargo, at cost" }, (r) => -r.ti.stockInvoiced),
        flow("rollWo", { ru: "Образцы и лаборатория", en: "Samples and laboratory" }, (r) => -r.ti.stockWrittenOff),
        sub("rollClose", { ru: "На конец месяца", en: "Closing" }, (r) => r.ti.stock),
      ],
    };
  }
  if (entity === "fargo") {
    return {
      key: "bs-fargo",
      mode: "position",
      lines: [
        header("assets", { ru: "Активы", en: "Assets" }),
        pos("stock", { ru: "Товар у Fargo, по ценам счетов TI", en: "Stock at Fargo, at TI invoice prices" }, (r) => r.fargo.stock, { href: "/goods/stock" }),
        pos("vat", { ru: "НДС к зачёту, перенесённый", en: "VAT credit carried forward" }, (r) => r.fargo.vatCredit, { href: "/taxes/fargo-vat" }),
        pos("ar", { ru: "Долги покупателей", en: "Customer receivables" }, (r) => r.fargo.receivables, { href: "/settlement/receivables" }),
        pos("cashHeld", { ru: "Деньги Humana у Fargo, расчётно", en: "Humana money held by Fargo, derived" }, (r) => r.fargo.cashHeld, { href: "/settlement" }),
        sub("assetsTotal", { ru: "Итого активы", en: "Total assets" }, (r) => r.fargo.assets),
        header("liab", { ru: "Обязательства", en: "Liabilities" }),
        pos("payable", { ru: "Turbo Impex: счета с НДС минус платежи", en: "Turbo Impex: invoices incl. VAT less payments" }, (r) => r.fargo.payableToTi, { href: "/settlement" }),
        sub("liabTotal", { ru: "Итого обязательства", en: "Total liabilities" }, (r) => r.fargo.liabilities),
        header("equity", { ru: "Капитал", en: "Equity" }),
        pos("retained", { ru: "Нераспределённая прибыль Humana", en: "Retained Humana profit" }, (r) => r.fargo.retained),
        sub("equityTotal", { ru: "Итого капитал", en: "Total equity" }, (r) => r.fargo.equity),
        check("check", { ru: "Расхождение", en: "Difference" }, byMonth(b, (r) => r.fargo.check), "last"),
        header("roll", { ru: "Движение товара Fargo", en: "Fargo stock movement" }),
        pos("rollOpen", { ru: "На начало месяца", en: "Opening" }, (r) => r.fargo.stockOpening),
        flow("rollIn", { ru: "Куплено у TI, без НДС", en: "Bought from TI, ex-VAT" }, (r) => r.fargo.stockBought),
        flow("rollSold", { ru: "Себестоимость продаж", en: "Cost of goods sold" }, (r) => -r.fargo.stockSold),
        flow("rollLost", { ru: "Потери по инвентаризации", en: "Stock loss at the count" }, (r) => -r.fargo.stockLost),
        sub("rollClose", { ru: "На конец месяца", en: "Closing" }, (r) => r.fargo.stock),
        header("memoH", { ru: "Справочно", en: "Memo" }),
        pos("owes", { ru: "Fargo должен TI", en: "Fargo owes TI" }, (r) => r.fargo.settlement, { href: "/settlement", kind: "memo" }),
        pos("capital", { ru: "Капитал Fargo, внесённый в совместный бизнес", en: "Fargo capital paid into the joint business" }, (r) => r.fargo.capital, { kind: "memo" }),
      ],
    };
  }
  return {
    key: "bs-group",
    mode: "position",
    lines: [
      header("assets", { ru: "Активы", en: "Assets" }),
      pos("stock", { ru: "Товар по стоимости TI", en: "Stock at TI landed cost" }, (r) => r.group.stock, { href: "/goods/stock" }),
      pos("stockTi", { ru: "в т. ч. у TI", en: "of which held by TI" }, (r) => r.group.stockAtTi, { kind: "memo" }),
      pos("stockFargo", { ru: "в т. ч. у Fargo", en: "of which at Fargo" }, (r) => r.group.stockAtFargo, { kind: "memo" }),
      pos("transit", { ru: "Товар в пути (предоплата)", en: "Goods in transit (prepaid)" }, (r) => r.group.goodsInTransit, { href: "/funding/balances" }),
      pos("vat", { ru: "НДС: переплата TI и зачёт Fargo", en: "VAT: TI overpayment and Fargo credit" }, (r) => r.group.vat, { href: "/taxes/ti-vat" }),
      pos("ar", { ru: "Долги покупателей", en: "Customer receivables" }, (r) => r.group.receivables, { href: "/settlement/receivables" }),
      pos("tiCash", { ru: "Деньги TI, банк и касса", en: "Turbo Impex cash, bank and on hand" }, (r) => r.group.tiCash, { href: "/funding/balances" }),
      pos("fargoCash", { ru: "Деньги Humana у Fargo", en: "Humana money held by Fargo" }, (r) => r.group.cashHeldByFargo, { href: "/settlement" }),
      sub("assetsTotal", { ru: "Итого активы", en: "Total assets" }, (r) => r.group.assets),
      header("liab", { ru: "Обязательства", en: "Liabilities" }),
      ...tiLiabilities,
      sub("liabTotal", { ru: "Итого обязательства", en: "Total liabilities" }, (r) => r.group.liabilities),
      header("equity", { ru: "Капитал", en: "Equity" }),
      pos("capTi", { ru: "Капитал Turbo Impex", en: "Capital, Turbo Impex" }, (r) => r.group.tiCapital, { href: "/funding/capital" }),
      pos("capFargo", { ru: "Капитал Fargo", en: "Capital, Fargo" }, (r) => r.group.fargoCapital, { href: "/funding/capital" }),
      pos("retained", { ru: "Нераспределённая прибыль", en: "Retained earnings" }, (r) => r.group.retained),
      sub("equityTotal", { ru: "Итого капитал", en: "Total equity" }, (r) => r.group.equity),
      tot("unreconciled", { ru: "Несверенная сумма", en: "Unreconciled" }, (r) => r.group.unreconciled),
      header("memoH", { ru: "Справочно", en: "Memo" }),
      pos("margin", { ru: "Маржа TI в товаре Fargo", en: "TI margin inside Fargo's stock" }, (r) => r.group.tiMarginInStock, { kind: "memo" }),
      pos("counted", { ru: "Пересчитано на складе, шт", en: "Counted at the warehouse, units" }, (r) => r.group.countedUnits, { kind: "memo", units: true }),
      pos("lossCum", { ru: "Потери по инвентаризации, с начала", en: "Stock loss at the count, to date" }, (r) => r.group.cumStockLoss, { kind: "memo" }),
    ],
  };
}

// ───────────────────────── Settlement with Fargo ─────────────────────────

export function settlementStatement(c: Computed): Statement {
  const s = c.settlement;
  const flow = (key: string, label: Bi, pick: (r: Computed["settlement"][number]) => number, opts: Partial<StatementLine> = {}) =>
    line(key, label, byMonth(s, pick), opts);
  const pos = (key: string, label: Bi, pick: (r: Computed["settlement"][number]) => number, opts: Partial<StatementLine> = {}) =>
    line(key, label, byMonth(s, pick), { agg: "last", ...opts });
  return {
    key: "settlement",
    mode: "flow",
    lines: [
      header("cashH", { ru: "Расчёт по собранным деньгам", en: "From the money collected" }),
      flow("sales", { ru: "Продажи по ценам клиентов, с НДС", en: "Sales at customer prices, VAT included" }, (r) => r.salesAtPrice, { href: "/sales" }),
      flow("opex", { ru: "Расходы Fargo, включая ретро-бонусы", en: "Fargo expenses, including retro bonuses" }, (r) => -r.fargoOpex, { href: "/expenses/fargo" }),
      flow("wo", { ru: "Списания, вычитаемые Fargo", en: "Write-offs deducted by Fargo" }, (r) => -r.writeOffsDeducted),
      flow("vat", { ru: "НДС, уплаченный Fargo", en: "VAT paid by Fargo" }, (r) => -r.vatPaid, { href: "/taxes/fargo-vat" }),
      flow("tax", { ru: "Оборотный налог Fargo", en: "Fargo turnover tax" }, (r) => -r.incomeTax),
      subtotal("accrued", { ru: "Причитается TI за месяц", en: "Due to TI for the month" }, byMonth(s, (r) => r.accrued)),
      pos("dueCum", { ru: "Причитается TI с начала", en: "Due to TI to date" }, (r) => r.dueCum),
      pos("cashCum", { ru: "Получено наличными, с начала", en: "Received in cash, to date" }, (r) => -r.cashCum, { href: "/settlement/payments" }),
      pos("bankCum", { ru: "Получено через банк, с начала", en: "Received by bank, to date" }, (r) => -r.bankCum, { href: "/settlement/payments" }),
      pos("ar", { ru: "Долги покупателей на конец месяца", en: "Customer receivables at month-end" }, (r) => -r.receivables, { href: "/settlement/receivables" }),
      total("owes", { ru: "Fargo должен TI", en: "Fargo owes TI" }, byMonth(s, (r) => r.owes), { agg: "last" }),
      header("actH", { ru: "Расчёт от акта сверки", en: "From the reconciliation act" }),
      pos("invoices", { ru: "Счета-фактуры TI с НДС, с начала", en: "TI invoices incl. VAT, to date" }, (r) => r.invoicesInclVatCum, { href: "/goods/invoices" }),
      pos("allBank", { ru: "Все банковские платежи со счёта Fargo", en: "All bank payments from Fargo's account" }, (r) => -r.allBankCum),
      subtotal("act", { ru: "Остаток по акту сверки", en: "Balance of the reconciliation act" }, byMonth(s, (r) => r.actBalance), { agg: "last" }),
      pos("capFargo", { ru: "Капитал Fargo, отправленный как оплата", en: "Fargo capital sent as a payment" }, (r) => r.fargoCapitalViaFargo, { href: "/funding/capital" }),
      pos("capTi", { ru: "Капитал партнёров TI со счёта Fargo", en: "TI partners' capital from Fargo's account" }, (r) => r.tiCapitalViaFargo, { href: "/funding/capital" }),
      pos("prior", { ru: "Деньги прежнего владельца через Fargo", en: "Previous owner's money via Fargo" }, (r) => r.priorOwnerViaFargo, { href: "/funding/previous-owner" }),
      pos("fargoNet", { ru: "Чистая прибыль Fargo, с начала", en: "Fargo net profit, to date" }, (r) => r.fargoNetCum, { href: "/statements/pnl?entity=fargo" }),
      pos("stock", { ru: "Товар на складе Fargo", en: "Goods in Fargo's warehouse" }, (r) => -r.fargoStock, { href: "/goods/stock" }),
      pos("ar2", { ru: "Долги покупателей", en: "Customer receivables" }, (r) => -r.receivables),
      pos("woCum", { ru: "Списания, вычтенные Fargo", en: "Write-offs deducted by Fargo" }, (r) => -r.writeOffsDeductedCum),
      pos("credit", { ru: "НДС к зачёту у Fargo", en: "Fargo VAT credit" }, (r) => -r.vatCredit, { href: "/taxes/fargo-vat" }),
      pos("cash2", { ru: "Наличные, уже переданные TI", en: "Cash already paid to TI" }, (r) => -r.cashCum),
      total("owesAct", { ru: "Fargo должен TI", en: "Fargo owes TI" }, byMonth(s, (r) => r.owesByAct), { agg: "last" }),
      check("check", { ru: "Расхождение двух расчётов", en: "Difference between the two" }, byMonth(s, (r) => r.check), "last"),
      header("payH", { ru: "Как погашается", en: "How it is paid" }),
      pos("byBank", { ru: "Через банк, по счетам (до остатка по акту)", en: "By bank against invoices (up to the act balance)" }, (r) => r.byBank),
      pos("inCash", { ru: "Наличными", en: "In cash" }, (r) => r.inCash),
    ],
  };
}

// ───────────────────────── VAT ─────────────────────────

export function fargoVatStatement(c: Computed): Statement {
  const f = c.fargo;
  return {
    key: "vat-fargo",
    mode: "flow",
    lines: [
      header("decl", { ru: "Декларируемые продажи", en: "Declared sales" }),
      line("bankEx", { ru: "Продажи через банк, без НДС", en: "Bank sales, ex-VAT" }, byMonth(f, (r) => r.bankRevenue)),
      line("cashDecl", { ru: "Продажи за наличные, себестоимость × 1,03", en: "Cash sales, cost × 1.03" }, byMonth(f, (r) => r.cashDeclared)),
      subtotal("declTotal", { ru: "Итого декларируется", en: "Total declared" }, byMonth(f, (r) => r.declaredTotal)),
      header("vatH", { ru: "НДС", en: "VAT" }),
      line("outBank", { ru: "Начислено с банковских продаж (12/112 цены)", en: "Charged on bank sales (12/112 of the price)" }, byMonth(f, (r) => r.vat.outputBank)),
      line("outCash", { ru: "Начислено с наличных продаж (12% декларации)", en: "Charged on cash sales (12% of the declared value)" }, byMonth(f, (r) => r.vat.outputCash)),
      line("input", { ru: "Зачёт по счетам-фактурам TI", en: "Offset from TI invoices" }, neg(byMonth(f, (r) => r.vat.input)), { href: "/goods/invoices" }),
      subtotal("net", { ru: "НДС за месяц", en: "VAT for the month" }, byMonth(f, (r) => r.vat.net)),
      line("creditIn", { ru: "Зачёт, перенесённый с прошлого месяца", en: "Credit brought forward" }, byMonth(f, (r) => r.vat.creditIn), { indent: false, kind: "memo", noTotal: true }),
      total("paid", { ru: "К уплате в бюджет", en: "Payable to the budget" }, byMonth(f, (r) => r.vat.paid)),
      line("creditOut", { ru: "Зачёт на следующий месяц", en: "Credit carried forward" }, byMonth(f, (r) => r.vat.creditOut), { agg: "last", indent: false, kind: "memo" }),
    ],
  };
}

export function tiVatStatement(c: Computed): Statement {
  const t = c.ti;
  return {
    key: "vat-ti",
    mode: "flow",
    lines: [
      header("model", { ru: "По данным приложения", en: "Per the app's data" }),
      line("output", { ru: "Начислено по счетам-фактурам Fargo", en: "Charged on invoices to Fargo" }, byMonth(t, (r) => r.vat.outputInvoices), { href: "/goods/invoices" }),
      line("other", { ru: "Начислено по прочим продажам", en: "Charged on other sales" }, byMonth(t, (r) => r.vat.outputOther)),
      line("import", { ru: "Зачёт импортного НДС на таможне", en: "Import VAT paid at customs, offset" }, neg(byMonth(t, (r) => r.vat.importVat)), { href: "/goods/shipments" }),
      subtotal("netModel", { ru: "НДС за месяц", en: "VAT for the month" }, byMonth(t, (r) => r.vat.netModel)),
      header("account", { ru: "По лицевому счёту", en: "Per the tax account" }),
      line("perAccount", { ru: "Начислено минус уменьшено", en: "Charged less reduced" }, byMonth(t, (r) => r.vat.perAccount)),
      check("diff", { ru: "Разница с данными приложения", en: "Difference from the app's data" }, byMonth(t, (r) => r.vat.difference)),
      header("balance", { ru: "Сальдо на конец месяца", en: "Balance at month-end" }),
      line("bal", { ru: "Переплата (+) / долг (−)", en: "Overpaid (+) / owed (−)" }, byMonth(t, (r) => r.vat.accountBalance), { agg: "last" }),
      line("prior", { ru: "в т. ч. прежнего владельца", en: "of which the previous owner's" }, byMonth(t, (r) => r.vat.priorOwnerPart), { agg: "last", kind: "memo" }),
      total("jv", { ru: "Позиция совместного бизнеса", en: "Joint business position" }, byMonth(t, (r) => r.vat.jvPosition), { agg: "last" }),
    ],
  };
}

// ───────────────────────── column logic, shared with the export ─────────────────────────

export interface Column {
  key: string;
  label: Bi;
  months: string[]; // months the column covers
  kind: "month" | "range" | "change";
  focus?: boolean;
}

/** Value of a line over a set of months (sum for flows, last month for positions). */
export function valueOver(lineDef: StatementLine, months: string[], all: StatementLine[]): number | null {
  if (lineDef.kind === "header") return null;
  if (lineDef.kind === "ratio" && lineDef.ratio) {
    const num = all.find((x) => x.key === lineDef.ratio!.num);
    const den = all.find((x) => x.key === lineDef.ratio!.den);
    if (!num || !den) return null;
    const d = valueOver(den, months, all) ?? 0;
    return d !== 0 ? (valueOver(num, months, all) ?? 0) / d : null;
  }
  if (!lineDef.values || months.length === 0) return null;
  if (lineDef.noTotal && months.length > 1) return null;
  if (lineDef.agg === "last") return lineDef.values[months[months.length - 1]] ?? 0;
  return months.reduce((s, m) => s + (lineDef.values![m] ?? 0), 0);
}

// ───────────────────────── Settlement summary (one month-end) ─────────────────────────

export interface DocLine {
  label: Bi;
  value: number | null;
  kind?: "line" | "subtotal" | "total" | "memo";
  href?: string;
}
export interface DocSection {
  title: Bi;
  lines: DocLine[];
}

export function settlementSummary(c: Computed, monthId: string): { sections: DocSection[]; check: number } | null {
  const i = c.monthIds.indexOf(monthId);
  if (i < 0) return null;
  const s = c.settlement[i];
  const f = c.fargo.slice(0, i + 1);
  const sum = (pick: (r: Computed["fargo"][number]) => number) => f.reduce((t, r) => t + pick(r), 0);
  const revenue = sum((r) => r.revenue);
  const cogs = sum((r) => r.cogs);
  const opex = sum((r) => r.opex);
  const loss = sum((r) => r.stockLoss);
  const tax = sum((r) => r.incomeTax);
  const beforeTax = revenue - cogs - opex - loss;
  const net = beforeTax - tax;
  const ifSold = s.invoicesInclVatCum + s.fargoNetCum;
  const due = ifSold - s.fargoStock - s.receivables - s.vatCredit - s.writeOffsDeductedCum;
  const sections: DocSection[] = [
    {
      title: { ru: "Прибыль Fargo от Humana", en: "Fargo's profit from Humana" },
      lines: [
        { label: { ru: "Выручка без НДС", en: "Revenue, ex-VAT" }, value: revenue },
        { label: { ru: "Себестоимость по ценам счетов TI, FIFO", en: "Cost of goods at TI invoice prices, FIFO" }, value: -cogs },
        { label: { ru: "Валовая прибыль", en: "Gross profit" }, value: revenue - cogs, kind: "subtotal" },
        { label: { ru: "Операционные расходы, включая ретро-бонусы", en: "Operating expenses, including retro bonuses" }, value: -opex, href: "/expenses/fargo" },
        { label: { ru: "Потери по инвентаризации", en: "Stock loss at the count" }, value: -loss, href: "/goods/stock" },
        { label: { ru: "Прибыль до налога", en: "Profit before tax" }, value: beforeTax, kind: "subtotal" },
        { label: { ru: "Оборотный налог, 1,9%", en: "Turnover tax, 1.9%" }, value: -tax },
        { label: { ru: "Чистая прибыль", en: "Net profit" }, value: net, kind: "total" },
      ],
    },
    {
      title: { ru: "Что Fargo должен передать TI", en: "What Fargo has to pay TI" },
      lines: [
        { label: { ru: "Счета-фактуры TI с НДС — через банк", en: "TI invoices incl. VAT — by bank" }, value: s.invoicesInclVatCum, href: "/goods/invoices" },
        { label: { ru: "Чистая прибыль Fargo — наличными", en: "Fargo's net profit — in cash" }, value: s.fargoNetCum },
        { label: { ru: "Итого, когда товар продан и деньги собраны", en: "Total once all goods are sold and paid for" }, value: ifSold, kind: "subtotal" },
        { label: { ru: "Товар на складе Fargo", en: "Goods still in Fargo's warehouse" }, value: -s.fargoStock, href: "/goods/stock" },
        { label: { ru: "Долги покупателей", en: "Customers still owe Fargo" }, value: -s.receivables, href: "/settlement/receivables" },
        { label: { ru: "НДС к зачёту у Fargo", en: "Fargo VAT credit not yet recovered" }, value: -s.vatCredit, href: "/taxes/fargo-vat" },
        ...(s.writeOffsDeductedCum !== 0
          ? [{ label: { ru: "Списания, вычитаемые Fargo", en: "Write-offs deducted by Fargo" }, value: -s.writeOffsDeductedCum }]
          : []),
        { label: { ru: "Причитается TI на конец месяца", en: "Due to TI at month-end" }, value: due, kind: "total" },
      ],
    },
    {
      title: { ru: "Получено от Fargo", en: "Received from Fargo" },
      lines: [
        { label: { ru: "Наличными", en: "In cash" }, value: s.cashCum, href: "/settlement/payments" },
        { label: { ru: "Через банк, оплата товара", en: "By bank, payments for goods" }, value: s.bankCum, href: "/settlement/payments" },
        { label: { ru: "Итого получено", en: "Total received" }, value: s.cashCum + s.bankCum, kind: "total" },
      ],
    },
    {
      title: { ru: "Итог", en: "Result" },
      lines: [
        { label: { ru: "Fargo должен TI", en: "Fargo still owes TI" }, value: s.owes, kind: "total" },
        { label: { ru: "через банк, по счетам (остаток по акту сверки)", en: "by bank against invoices (the act balance)" }, value: s.byBank, kind: "memo" },
        { label: { ru: "наличными", en: "in cash" }, value: s.inCash, kind: "memo" },
      ],
    },
    {
      title: { ru: "Банковские платежи со счёта Fargo", en: "Bank payments from Fargo's account" },
      lines: [
        { label: { ru: "Все платежи (как в акте сверки)", en: "All payments (as in the reconciliation act)" }, value: s.allBankCum },
        { label: { ru: "Капитал Fargo", en: "Fargo's capital" }, value: -s.fargoCapitalViaFargo, href: "/funding/capital" },
        { label: { ru: "Капитал партнёров TI", en: "TI partners' capital" }, value: -s.tiCapitalViaFargo, href: "/funding/capital" },
        { label: { ru: "Деньги прежнего владельца", en: "The previous owner's money" }, value: -s.priorOwnerViaFargo, href: "/funding/previous-owner" },
        { label: { ru: "Оплата товара", en: "Payments for goods" }, value: s.bankCum, kind: "subtotal" },
        { label: { ru: "Счета-фактуры TI с НДС", en: "TI invoices incl. VAT" }, value: s.invoicesInclVatCum },
        { label: { ru: "Все банковские платежи", en: "All bank payments" }, value: -s.allBankCum },
        { label: { ru: "Остаток по акту сверки", en: "Balance of the reconciliation act" }, value: s.actBalance, kind: "total" },
      ],
    },
  ];
  return { sections, check: s.check };
}
