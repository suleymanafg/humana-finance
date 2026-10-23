// The whole financial model as one Excel workbook, laid out like the owner's
// finance workbook («Humana Finance - 2026.xlsx»): the statements (P&L and
// balance sheet for TI, Fargo and the group, the settlement with Fargo, both
// VAT checks) built from the same definitions as the pages, then every record
// they are calculated from — sales, TI invoices, write-offs, trucks with their
// lines and import expenses, stock, expenses, taxes, funding, receivables,
// counts and month-end balances. Up to the chosen month. Budget, supply
// planning, the medical section and the distribution handover are not part of it.
import { MONEY, MONEY2, PCT, type CellValue, type SheetSpec } from "./excel";
import type { Computed, Dataset } from "./engine/types";
import { balanceStatement, fargoVatStatement, pnlStatement, settlementStatement, tiVatStatement, type Entity } from "./statements";
import { statementSheet } from "./statement-export";
import { shortMonth } from "./statement-ui";

type Locale = "ru" | "en";

const ENTITIES: Array<{ key: Entity; ru: string; en: string }> = [
  { key: "ti", ru: "TI", en: "TI" },
  { key: "fargo", ru: "Fargo", en: "Fargo" },
  { key: "group", ru: "Консолид.", en: "Consolidated" },
];

const day = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : null);

/** A record sheet: a header row, the rows, an optional total row in bold. */
function table(name: string, title: string, subtitle: string, columns: SheetSpec["columns"], rows: CellValue[][], total?: CellValue[]): SheetSpec {
  return {
    name,
    title,
    subtitle,
    columns,
    rows: total ? [...rows, total] : rows,
    boldRows: total ? [rows.length] : [],
  };
}

export function fullWorkbookSheets(ds: Dataset, c: Computed, monthId: string, locale: Locale): SheetSpec[] {
  const ru = locale === "ru";
  const t = (r: string, e: string) => (ru ? r : e);
  const idx = c.monthIds.indexOf(monthId);
  const upto = c.monthIds.slice(0, idx + 1);
  const inRange = (m: string | null | undefined) => !!m && m <= monthId;
  const monthName = (id: string | null | undefined) => {
    if (!id) return null;
    const m = ds.months.find((x) => x.id === id);
    return m ? (ru ? m.nameRu : m.nameEn) : id;
  };
  const product = (id: string) => {
    const p = ds.products.find((x) => x.id === id);
    return p ? (ru ? p.nameRu : p.nameEn || p.nameRu) : id;
  };
  const channel = (id: string) => ds.channels.find((x) => x.id === id)?.name ?? id;
  const warehouse = (id: string) => ds.warehouses.find((x) => x.id === id)?.name ?? id;
  const sum = <T,>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + pick(r), 0);

  const open = upto.filter((m) => !ds.months.find((x) => x.id === m)?.closedAt);
  const generated = [
    `${t("Выгружено", "Generated")} ${new Date().toLocaleDateString(ru ? "ru-RU" : "en-GB", { timeZone: "Asia/Tashkent" })}`,
    `${shortMonth(upto[0], locale)} – ${shortMonth(monthId, locale)}`,
    open.length === 0 ? null : `${t("предварительно, не закрыты", "preliminary, not closed")}: ${open.map((m) => shortMonth(m, locale)).join(", ")}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const withInputs = new Set(c.balance.filter((b) => b.hasInputs).map((b) => b.monthId));
  const sheets: SheetSpec[] = [];

  // ── statements ──
  for (const e of ENTITIES)
    sheets.push(statementSheet({ name: `${t("ОПиУ", "P&L")} ${ru ? e.ru : e.en}`, title: `${t("Прибыли и убытки", "Profit and loss")} — ${ru ? e.ru : e.en}`, subtitle: generated, statement: pnlStatement(e.key, c), months: upto, locale }));
  for (const e of ENTITIES)
    sheets.push(
      statementSheet({
        name: `${t("Баланс", "BS")} ${ru ? e.ru : e.en}`,
        title: `${t("Баланс", "Balance sheet")} — ${ru ? e.ru : e.en}`,
        subtitle: e.key === "fargo" ? generated : `${generated} · ${t("месяцы с введёнными остатками денег", "months with month-end cash entered")}`,
        statement: balanceStatement(e.key, c),
        months: e.key === "fargo" ? upto : upto.filter((m) => withInputs.has(m)),
        locale,
      })
    );
  sheets.push(statementSheet({ name: t("Расчёты с Fargo", "Settlement"), title: t("Расчёты с Fargo по месяцам", "Settlement with Fargo by month"), subtitle: generated, statement: settlementStatement(c), months: upto, locale }));
  sheets.push(statementSheet({ name: t("НДС Fargo", "Fargo VAT"), title: t("НДС Fargo — проверка", "Fargo VAT check"), subtitle: generated, statement: fargoVatStatement(c), months: upto, locale }));
  sheets.push(statementSheet({ name: t("НДС TI", "TI VAT"), title: t("НДС Turbo Impex — проверка", "Turbo Impex VAT check"), subtitle: generated, statement: tiVatStatement(c), months: upto, locale }));

  // ── sales ──
  const sales = ds.sales.filter((s) => inRange(s.monthId)).sort((a, b) => a.monthId.localeCompare(b.monthId));
  const priceOf = (id: string) => ds.products.find((p) => p.id === id)?.price ?? 0;
  const cashOf = (id: string) => ds.channels.find((x) => x.id === id)?.cashPct ?? 0;
  const saleRows = sales.map((s) => {
    const revenue = s.amount ?? s.qty * priceOf(s.productId);
    return [monthName(s.monthId), product(s.productId), channel(s.channelId), s.qty, priceOf(s.productId), revenue, cashOf(s.channelId), revenue * cashOf(s.channelId), revenue * (1 - cashOf(s.channelId))];
  });
  sheets.push(
    table(
      t("Продажи", "Sales"),
      t("Продажи (1С), по месяцам, товарам и каналам", "Sales (1C) by month, product and channel"),
      `${t("Выручка = кол-во × цена из справочника, с НДС", "Revenue = qty × list price, VAT included")} · ${generated}`,
      [
        { header: t("Месяц", "Month"), width: 14 },
        { header: t("Товар", "Product"), width: 38 },
        { header: t("Канал", "Channel"), width: 26 },
        { header: t("Кол-во", "Qty"), numFmt: MONEY, width: 10 },
        { header: t("Цена", "Price"), numFmt: MONEY, width: 12 },
        { header: t("Выручка", "Revenue"), numFmt: MONEY, width: 16 },
        { header: t("Доля наличных", "Cash share"), numFmt: PCT, width: 11 },
        { header: t("Наличные", "Cash"), numFmt: MONEY, width: 16 },
        { header: t("Перечисление", "Bank"), numFmt: MONEY, width: 16 },
      ],
      saleRows,
      [t("Итого", "Total"), null, null, sum(saleRows, (r) => r[3] as number), null, sum(saleRows, (r) => r[5] as number), null, sum(saleRows, (r) => r[7] as number), sum(saleRows, (r) => r[8] as number)]
    )
  );

  // ── TI invoices ──
  const inv = c.invoices.filter((l) => inRange(l.monthId)).sort((a, b) => (a.date === b.date ? a.sortOrder - b.sortOrder : a.date.localeCompare(b.date)));
  const invRows = inv.map((l) => [day(l.date), monthName(l.monthId), l.number, product(l.productId), l.qty, l.price, l.amount, l.amount ? l.vat / l.amount : null, l.vat, l.amount + l.vat, l.tiUnitCost, l.tiCost, l.amount - l.tiCost]);
  sheets.push(
    table(
      t("Счета-фактуры TI", "TI invoices"),
      t("Счета-фактуры TI → Fargo, все строки", "TI → Fargo invoices, every line"),
      `${t("Себестоимость TI — по FIFO", "TI cost — FIFO")} · ${generated}`,
      [
        { header: t("Дата", "Date"), width: 11 },
        { header: t("Месяц", "Month"), width: 14 },
        { header: "№", width: 8 },
        { header: t("Товар", "Product"), width: 38 },
        { header: t("Кол-во", "Qty"), numFmt: MONEY, width: 10 },
        { header: t("Цена без НДС", "Price ex-VAT"), numFmt: MONEY2, width: 13 },
        { header: t("Стоимость без НДС", "Value ex-VAT"), numFmt: MONEY, width: 16 },
        { header: t("Ставка НДС", "VAT rate"), numFmt: PCT, width: 9 },
        { header: t("НДС", "VAT"), numFmt: MONEY, width: 14 },
        { header: t("С НДС", "Incl. VAT"), numFmt: MONEY, width: 16 },
        { header: t("Себест. TI, шт", "TI unit cost"), numFmt: MONEY, width: 12 },
        { header: t("Себестоимость TI", "TI cost"), numFmt: MONEY, width: 16 },
        { header: t("Маржа TI", "TI margin"), numFmt: MONEY, width: 15 },
      ],
      invRows,
      [t("Итого", "Total"), null, null, null, sum(inv, (l) => l.qty), null, sum(inv, (l) => l.amount), null, sum(inv, (l) => l.vat), sum(inv, (l) => l.amount + l.vat), null, sum(inv, (l) => l.tiCost), sum(inv, (l) => l.amount - l.tiCost)]
    )
  );

  // ── write-offs ──
  const wo = c.writeOffs.filter((w) => inRange(w.monthId));
  sheets.push(
    table(
      t("Списания TI", "TI write-offs"),
      t("Товар TI, отданный бесплатно (образцы, лаборатория)", "TI goods given away (samples, laboratory)"),
      generated,
      [
        { header: t("Дата", "Date"), width: 11 },
        { header: t("Месяц", "Month"), width: 14 },
        { header: t("Товар", "Product"), width: 38 },
        { header: t("Кол-во", "Qty"), numFmt: MONEY, width: 10 },
        { header: t("Себест., шт (FIFO)", "Unit cost (FIFO)"), numFmt: MONEY, width: 14 },
        { header: t("Сумма", "Value"), numFmt: MONEY, width: 15 },
        { header: t("Причина", "Reason"), width: 30 },
      ],
      wo.map((w) => [day(w.date), monthName(w.monthId), product(w.productId), w.qty, w.unitCost, w.value, w.reason ?? null]),
      [t("Итого", "Total"), null, null, sum(wo, (w) => w.qty), null, sum(wo, (w) => w.value), null]
    )
  );
  const fwo = c.fargoWriteOffs.filter((w) => inRange(w.monthId));
  sheets.push(
    table(
      t("Списания Fargo", "Fargo write-offs"),
      t("Списания со склада Fargo (просрочка, брак, прочее)", "Written off at Fargo (expired, damaged, other)"),
      generated,
      [
        { header: t("Дата", "Date"), width: 11 },
        { header: t("Месяц", "Month"), width: 14 },
        { header: t("Товар", "Product"), width: 38 },
        { header: t("Кол-во", "Qty"), numFmt: MONEY, width: 10 },
        { header: t("Причина", "Reason"), width: 12 },
        { header: t("По цене TI→Fargo", "At Fargo cost"), numFmt: MONEY, width: 16 },
        { header: t("По себестоимости TI", "At TI cost"), numFmt: MONEY, width: 16 },
        { header: t("Примечание", "Note"), width: 30 },
      ],
      fwo.map((w) => [day(w.date), monthName(w.monthId), product(w.productId), w.qty, w.reason, w.value, w.groupValue, w.notes ?? null]),
      [t("Итого", "Total"), null, null, sum(fwo, (w) => w.qty), null, sum(fwo, (w) => w.value), sum(fwo, (w) => w.groupValue), null]
    )
  );

  // ── trucks ──
  const trucks = c.shipments.filter((s) => s.status === "ARRIVED" && inRange(s.monthId)).sort((a, b) => a.monthId.localeCompare(b.monthId) || a.code.localeCompare(b.code));
  sheets.push(
    table(
      t("Поставки", "Shipments"),
      t("Поставки — себестоимость с расходами на импорт", "Trucks — landed cost"),
      `${t("Себестоимость = закупка + расходы на импорт без НДС; только прибывшие", "Landed = purchase + import expenses ex import VAT; arrived trucks only")} · ${generated}`,
      [
        { header: t("Поставка", "Truck"), width: 14 },
        { header: t("Месяц прибытия", "Arrival month"), width: 15 },
        { header: t("Штук", "Units"), numFmt: MONEY, width: 10 },
        { header: t("Закупка, EUR", "Purchase, EUR"), numFmt: MONEY2, width: 14 },
        { header: t("Закупка, сум", "Purchase, UZS"), numFmt: MONEY, width: 16 },
        { header: t("Расходы на импорт", "Import expenses"), numFmt: MONEY, width: 16 },
        { header: t("НДС на таможне", "Import VAT"), numFmt: MONEY, width: 15 },
        { header: t("Коэффициент", "Load factor"), numFmt: "0.0000", width: 11 },
        { header: t("Себестоимость", "Landed cost"), numFmt: MONEY, width: 16 },
      ],
      trucks.map((s) => [s.code, monthName(s.monthId), s.units, s.purchaseEur, s.purchaseTotal, s.expenseTotal, s.importVat, s.loadFactor, s.landedTotal]),
      [t("Итого", "Total"), null, sum(trucks, (s) => s.units), sum(trucks, (s) => s.purchaseEur), sum(trucks, (s) => s.purchaseTotal), sum(trucks, (s) => s.expenseTotal), sum(trucks, (s) => s.importVat), null, sum(trucks, (s) => s.landedTotal)]
    )
  );
  const truckLines = trucks.flatMap((s) => s.lines.map((l) => ({ s, l })));
  sheets.push(
    table(
      t("Строки поставок", "Shipment lines"),
      t("Строки поставок — себестоимость за штуку", "Truck lines — unit cost"),
      `${t("Себест. за шт = цена EUR × курс × коэффициент", "Unit cost = EUR price × rate × load factor")} · ${generated}`,
      [
        { header: t("Поставка", "Truck"), width: 14 },
        { header: t("Месяц", "Month"), width: 14 },
        { header: t("Товар", "Product"), width: 38 },
        { header: t("Кол-во", "Qty"), numFmt: MONEY, width: 10 },
        { header: t("Цена, EUR", "Price, EUR"), numFmt: MONEY2, width: 10 },
        { header: t("Курс", "Rate"), numFmt: MONEY2, width: 11 },
        { header: t("Цена, сум", "Price, UZS"), numFmt: MONEY2, width: 12 },
        { header: t("Закупка, сум", "Purchase, UZS"), numFmt: MONEY, width: 16 },
        { header: t("Себест., шт", "Unit cost"), numFmt: MONEY2, width: 12 },
        { header: t("Себестоимость", "Landed value"), numFmt: MONEY, width: 16 },
      ],
      truckLines.map(({ s, l }) => [s.code, monthName(s.monthId), product(l.productId), l.qty, l.priceEur, l.rate, l.priceUzs, l.purchaseAmount, l.unitCost, l.landedValue]),
      [t("Итого", "Total"), null, null, sum(truckLines, (x) => x.l.qty), null, null, null, sum(truckLines, (x) => x.l.purchaseAmount), null, sum(truckLines, (x) => x.l.landedValue)]
    )
  );
  const truckIds = new Set(trucks.map((s) => s.shipmentId));
  const exp = ds.importExpenses.filter((e) => truckIds.has(e.shipmentId)).sort((a, b) => a.monthId.localeCompare(b.monthId));
  const codeOf = (id: string) => c.shipments.find((s) => s.shipmentId === id)?.code ?? id;
  sheets.push(
    table(
      t("Расходы на импорт", "Import expenses"),
      t("Расходы на импорт по поставкам", "Import expenses per truck"),
      generated,
      [
        { header: t("Поставка", "Truck"), width: 14 },
        { header: t("Месяц", "Month"), width: 14 },
        { header: t("Статья", "Category"), width: 24 },
        { header: t("Сумма", "Amount"), numFmt: MONEY, width: 15 },
        { header: t("Оплачено в месяце", "Paid in month"), width: 15 },
        { header: t("Примечание", "Note"), width: 30 },
      ],
      exp.map((e) => [codeOf(e.shipmentId), monthName(e.monthId), e.categoryName, e.amount, monthName(e.paidMonthId), e.notes ?? null]),
      [t("Итого", "Total"), null, null, sum(exp, (e) => e.amount), null, null]
    )
  );

  // ── stock ──
  const stockRows: CellValue[][] = [];
  for (const m of upto) {
    const sm = c.stock.find((x) => x.monthId === m);
    if (!sm) continue;
    for (const p of sm.products) {
      const f = c.fifo[p.productId]?.months[m];
      if (!p.tiUnits && !p.fargoBook && p.counted == null && !f?.tiStock && !f?.fargoStock) continue;
      stockRows.push([monthName(m), product(p.productId), p.tiUnits, f?.tiStock ?? null, p.fargoBook, f?.fargoStock ?? null, f?.fargoStockTi ?? null, p.counted, p.difference]);
    }
  }
  sheets.push(
    table(
      t("Остатки", "Stock"),
      t("Остатки на конец месяца по товарам", "Month-end stock by product"),
      `${t("TI — по себестоимости; Fargo — по цене TI и по себестоимости TI; пересчёт — в месяцы инвентаризации", "TI at landed cost; Fargo at TI's prices and at TI cost; counts in count months")} · ${generated}`,
      [
        { header: t("Месяц", "Month"), width: 14 },
        { header: t("Товар", "Product"), width: 38 },
        { header: t("TI, шт", "TI, units"), numFmt: MONEY, width: 10 },
        { header: t("TI, сум", "TI, UZS"), numFmt: MONEY, width: 15 },
        { header: t("Fargo по учёту, шт", "Fargo book, units"), numFmt: MONEY, width: 13 },
        { header: t("Fargo, по цене TI", "Fargo, at TI price"), numFmt: MONEY, width: 16 },
        { header: t("Fargo, по себест. TI", "Fargo, at TI cost"), numFmt: MONEY, width: 16 },
        { header: t("Пересчёт, шт", "Counted, units"), numFmt: MONEY, width: 12 },
        { header: t("Разница, шт", "Difference, units"), numFmt: MONEY, width: 12 },
      ],
      stockRows
    )
  );

  // ── expenses ──
  const opexTi = ds.opexTi.filter((o) => inRange(o.monthId)).sort((a, b) => a.monthId.localeCompare(b.monthId) || a.categoryName.localeCompare(b.categoryName));
  sheets.push(
    table(
      t("Расходы TI", "OPEX TI"),
      t("Расходы Turbo Impex", "Turbo Impex expenses"),
      generated,
      [
        { header: t("Месяц", "Month"), width: 14 },
        { header: t("Статья", "Category"), width: 32 },
        { header: t("Группа", "P&L group"), width: 22 },
        { header: t("Банк", "Bank"), numFmt: MONEY, width: 15 },
        { header: t("Наличные", "Cash"), numFmt: MONEY, width: 15 },
        { header: t("Итого", "Total"), numFmt: MONEY, width: 15 },
        { header: t("Примечание", "Note"), width: 30 },
      ],
      opexTi.map((o) => [monthName(o.monthId), o.categoryName, o.plGroup, o.bankAmount, o.cashAmount, o.bankAmount + o.cashAmount, o.notes ?? null]),
      [t("Итого", "Total"), null, null, sum(opexTi, (o) => o.bankAmount), sum(opexTi, (o) => o.cashAmount), sum(opexTi, (o) => o.bankAmount + o.cashAmount), null]
    )
  );
  const opexFg = ds.opexFargo.filter((o) => inRange(o.monthId)).sort((a, b) => a.monthId.localeCompare(b.monthId) || a.categoryName.localeCompare(b.categoryName));
  sheets.push(
    table(
      t("Расходы Fargo", "OPEX Fargo"),
      t("Расходы Fargo", "Fargo expenses"),
      generated,
      [
        { header: t("Месяц", "Month"), width: 14 },
        { header: t("Статья", "Category"), width: 32 },
        { header: t("Группа", "P&L group"), width: 22 },
        { header: t("Сумма", "Amount"), numFmt: MONEY, width: 15 },
        { header: t("Примечание", "Note"), width: 30 },
      ],
      opexFg.map((o) => [monthName(o.monthId), o.categoryName, o.plGroup, o.amount, o.notes ?? null]),
      [t("Итого", "Total"), null, null, sum(opexFg, (o) => o.amount), null]
    )
  );

  // ── taxes ──
  sheets.push(
    table(
      t("Налог на прибыль TI", "TI profit tax"),
      t("Налог на прибыль TI по поданным декларациям", "TI profit tax from the filed returns"),
      generated,
      [
        { header: t("Квартал", "Quarter"), width: 14 },
        { header: t("Начислен в месяце", "Booked in month"), width: 16 },
        { header: t("Налог", "Tax"), numFmt: MONEY, width: 15 },
        { header: t("Заявленные расходы", "Declared expenses"), numFmt: MONEY, width: 17 },
        { header: t("Оплачен в месяце", "Paid in month"), width: 16 },
      ],
      ds.taxFilings.filter((f) => inRange(f.bookedMonthId)).map((f) => [f.quarterLabel, monthName(f.bookedMonthId), f.taxAmount, f.declaredExpenses, monthName(f.paidMonthId)])
    )
  );
  const vatAcc = ds.vatAccount.filter((v) => inRange(v.period)).sort((a, b) => a.period.localeCompare(b.period) || a.sortOrder - b.sortOrder);
  sheets.push(
    table(
      t("НДС TI — лицевой счёт", "TI VAT account"),
      t("НДС Turbo Impex — лицевой счёт (my.soliq.uz)", "Turbo Impex VAT — tax account (my.soliq.uz)"),
      generated,
      [
        { header: t("Месяц", "Counts in month"), width: 14 },
        { header: t("Дата операции", "Operation date"), width: 13 },
        { header: t("Операция", "Operation"), width: 36 },
        { header: t("Начислено", "Charged"), numFmt: MONEY2, width: 16 },
        { header: t("Уменьшено (зачёт)", "Reduced"), numFmt: MONEY2, width: 16 },
        { header: t("Уплачено / сальдо", "Paid / opening"), numFmt: MONEY2, width: 16 },
        { header: t("Возвращено", "Refunded"), numFmt: MONEY2, width: 14 },
        { header: t("Остаток после", "Balance after"), numFmt: MONEY2, width: 17 },
      ],
      vatAcc.map((v) => [monthName(v.period), day(v.date), v.description, v.charged, v.reduced, v.paid, v.refunded, v.balanceAfter])
    )
  );
  const charges = ds.vatCharges.filter((v) => inRange(v.monthId));
  if (charges.length)
    sheets.push(
      table(
        t("НДС TI — прочие начисления", "TI VAT — other charges"),
        t("НДС, начисленный TI вне счетов-фактур Fargo", "VAT charged to TI outside the Fargo invoices"),
        generated,
        [
          { header: t("Месяц", "Month"), width: 14 },
          { header: t("Что", "What"), width: 40 },
          { header: t("Сумма", "Amount"), numFmt: MONEY, width: 15 },
          { header: t("За чей счёт", "Borne by"), width: 16 },
        ],
        charges.map((v) => [monthName(v.monthId), v.description, v.amount, v.bearer === "TI" ? "Turbo Impex" : t("Прежний владелец", "Previous owner")])
      )
    );
  const fvr = ds.fargoVatReturns.filter((v) => inRange(v.monthId));
  sheets.push(
    table(
      t("НДС Fargo — декларации", "Fargo VAT returns"),
      t("Декларации Fargo по НДС", "Fargo's VAT returns"),
      generated,
      [
        { header: t("Месяц", "Month"), width: 14 },
        { header: t("Оборот без НДС", "Declared sales ex-VAT"), numFmt: MONEY, width: 18 },
        { header: t("НДС начислен", "Output VAT"), numFmt: MONEY, width: 15 },
        { header: t("НДС к зачёту", "Input VAT"), numFmt: MONEY, width: 15 },
        { header: t("Уплачено", "Paid"), numFmt: MONEY, width: 15 },
      ],
      fvr.map((v) => [monthName(v.monthId), v.declaredSales, v.outputVat, v.inputVat, v.paid]),
      [t("Итого", "Total"), sum(fvr, (v) => v.declaredSales), sum(fvr, (v) => v.outputVat), sum(fvr, (v) => v.inputVat), sum(fvr, (v) => v.paid)]
    )
  );

  // ── funding and money ──
  const byDate = <T extends { date: string }>(rows: T[]) => rows.filter((r) => inRange(r.date.slice(0, 7))).sort((a, b) => a.date.localeCompare(b.date));
  const tr = byDate(ds.transfers);
  sheets.push(
    table(
      t("Платежи Fargo", "Transfers"),
      t("Платежи Fargo → TI", "Payments Fargo → TI"),
      generated,
      [
        { header: t("Дата", "Date"), width: 11 },
        { header: t("Месяц", "Month"), width: 14 },
        { header: t("Наличные", "Cash"), numFmt: MONEY, width: 16 },
        { header: t("Перечисление", "Bank"), numFmt: MONEY, width: 16 },
        { header: t("Итого", "Total"), numFmt: MONEY, width: 16 },
        { header: t("Примечание", "Note"), width: 30 },
      ],
      tr.map((x) => [day(x.date), monthName(x.date.slice(0, 7)), x.cashAmount, x.bankAmount, x.cashAmount + x.bankAmount, x.notes ?? null]),
      [t("Итого", "Total"), null, sum(tr, (x) => x.cashAmount), sum(tr, (x) => x.bankAmount), sum(tr, (x) => x.cashAmount + x.bankAmount), null]
    )
  );
  const cap = byDate(ds.contributions);
  sheets.push(
    table(
      t("Взносы в капитал", "Capital contributions"),
      t("Взносы учредителей в капитал", "Shareholders' capital contributions"),
      generated,
      [
        { header: t("Дата", "Date"), width: 11 },
        { header: t("Месяц", "Month"), width: 14 },
        { header: "TI", numFmt: MONEY, width: 16 },
        { header: "Fargo", numFmt: MONEY, width: 16 },
        { header: t("Итого", "Total"), numFmt: MONEY, width: 16 },
        { header: t("Через банк Fargo", "Via Fargo's bank"), width: 14 },
        { header: t("Примечание", "Note"), width: 30 },
      ],
      cap.map((x) => [day(x.date), monthName(x.date.slice(0, 7)), x.tiAmount, x.fargoAmount, x.tiAmount + x.fargoAmount, x.viaFargo ? t("да", "yes") : null, x.notes ?? null]),
      [t("Итого", "Total"), null, sum(cap, (x) => x.tiAmount), sum(cap, (x) => x.fargoAmount), sum(cap, (x) => x.tiAmount + x.fargoAmount), null, null]
    )
  );
  const loans = ds.loans.filter((x) => inRange(x.monthId)).sort((a, b) => a.monthId.localeCompare(b.monthId));
  sheets.push(
    table(
      t("Займы", "Loans"),
      t("Займы и финансовая помощь TI", "TI loans and financial assistance"),
      generated,
      [
        { header: t("Месяц", "Month"), width: 14 },
        { header: t("Займодавец", "Lender"), width: 30 },
        { header: t("Получено", "Received"), numFmt: MONEY, width: 16 },
        { header: t("Возвращено", "Repaid"), numFmt: MONEY, width: 16 },
        { header: t("Примечание", "Note"), width: 30 },
      ],
      loans.map((x) => [monthName(x.monthId), x.lender, x.received, x.repaid, x.notes ?? null]),
      [t("Итого", "Total"), null, sum(loans, (x) => x.received), sum(loans, (x) => x.repaid), null]
    )
  );
  const prior = byDate(ds.priorOwner);
  sheets.push(
    table(
      t("Прежний владелец", "Previous owner"),
      t("Деньги прежнего владельца TI", "The previous owner's money"),
      generated,
      [
        { header: t("Дата", "Date"), width: 11 },
        { header: t("Месяц", "Month"), width: 14 },
        { header: t("Что", "What"), width: 36 },
        { header: t("Получено", "Received"), numFmt: MONEY, width: 16 },
        { header: t("Оплачено за него", "Paid on their behalf"), numFmt: MONEY, width: 16 },
        { header: t("Через банк Fargo", "Via Fargo's bank"), width: 14 },
        { header: t("Примечание", "Note"), width: 30 },
      ],
      prior.map((x) => [day(x.date), monthName(x.date.slice(0, 7)), x.description, x.received, x.paid, x.viaFargo ? t("да", "yes") : null, x.notes ?? null]),
      [t("Итого", "Total"), null, null, sum(prior, (x) => x.received), sum(prior, (x) => x.paid), null, null]
    )
  );
  const other = byDate(ds.otherReceipts);
  sheets.push(
    table(
      t("Прочие поступления", "Other receipts"),
      t("Прочие поступления TI", "TI's other receipts"),
      generated,
      [
        { header: t("Дата", "Date"), width: 11 },
        { header: t("Месяц", "Month"), width: 14 },
        { header: t("От кого", "Payer"), width: 30 },
        { header: t("Сумма", "Amount"), numFmt: MONEY, width: 16 },
        { header: t("Примечание", "Note"), width: 30 },
      ],
      other.map((x) => [day(x.date), monthName(x.date.slice(0, 7)), x.payer, x.amount, x.notes ?? null]),
      [t("Итого", "Total"), null, null, sum(other, (x) => x.amount), null]
    )
  );
  sheets.push(
    table(
      t("Дебиторка", "Receivables"),
      t("Дебиторская задолженность клиентов Fargo на конец месяца", "What Fargo's customers owe at month-end"),
      generated,
      [
        { header: t("Месяц", "Month"), width: 14 },
        { header: t("Клиент", "Customer"), width: 40 },
        { header: t("Сумма", "Amount"), numFmt: MONEY, width: 16 },
      ],
      ds.arEntries.filter((a) => inRange(a.monthId)).sort((a, b) => a.monthId.localeCompare(b.monthId) || b.amount - a.amount).map((a) => [monthName(a.monthId), a.customerName, a.amount])
    )
  );
  sheets.push(
    table(
      t("Инвентаризация", "Stock counts"),
      t("Пересчёт остатков на конец месяца", "Month-end stock counts"),
      generated,
      [
        { header: t("Месяц", "Month"), width: 14 },
        { header: t("Товар", "Product"), width: 38 },
        { header: t("Склад", "Warehouse"), width: 22 },
        { header: t("Кол-во", "Qty"), numFmt: MONEY, width: 10 },
      ],
      ds.stockCounts.filter((s) => inRange(s.monthId)).sort((a, b) => a.monthId.localeCompare(b.monthId)).map((s) => [monthName(s.monthId), product(s.productId), warehouse(s.warehouseId), s.qty])
    )
  );
  sheets.push(
    table(
      t("Денежные остатки", "Month balances"),
      t("Остатки на конец месяца: банк и касса TI, товары в пути", "Month-end balances: TI bank and cash, goods in transit"),
      generated,
      [
        { header: t("Месяц", "Month"), width: 14 },
        { header: t("Банк TI", "TI bank"), numFmt: MONEY, width: 16 },
        { header: t("Касса TI", "TI cash"), numFmt: MONEY, width: 16 },
        { header: t("Товары в пути (предоплата)", "Goods in transit (prepaid)"), numFmt: MONEY, width: 20 },
      ],
      ds.monthBalances.filter((b) => inRange(b.monthId)).sort((a, b) => a.monthId.localeCompare(b.monthId)).map((b) => [monthName(b.monthId), b.tiBank, b.tiCash, b.goodsInTransit])
    )
  );

  // ── contents first ──
  const contents: SheetSpec = {
    name: t("Содержание", "Contents"),
    title: t("Humana — финансовая модель (Turbo Impex и Fargo)", "Humana — financial model (Turbo Impex and Fargo)"),
    subtitle: `${t("Все суммы в сумах", "All amounts in UZS")} · ${generated}`,
    columns: [
      { header: t("Лист", "Sheet"), width: 30 },
      { header: t("Что на нём", "What it holds"), width: 90 },
    ],
    rows: sheets.map((s) => [s.name, s.title]),
  };
  return [contents, ...sheets];
}

/** One TI → Fargo invoice: the document as printed, and TI's cost and margin on it (a separate sheet, for TI only). */
export function invoiceSheets(ds: Dataset, lines: Computed["invoices"], locale: Locale): SheetSpec[] {
  const ru = locale === "ru";
  const t = (r: string, e: string) => (ru ? r : e);
  const product = (id: string) => {
    const p = ds.products.find((x) => x.id === id);
    return p ? (ru ? p.nameRu : p.nameEn || p.nameRu) : id;
  };
  const sum = (pick: (l: Computed["invoices"][number]) => number) => lines.reduce((s, l) => s + pick(l), 0);
  const head = lines[0];
  const title = `${t("Счёт-фактура", "Invoice")} № ${head.number} ${t("от", "of")} ${day(head.date)}`;
  const parties = `${t("Поставщик", "Seller")}: Turbo Impex · ${t("Покупатель", "Buyer")}: Fargo`;
  const doc: SheetSpec = {
    name: t("Счёт-фактура", "Invoice"),
    title,
    subtitle: parties,
    columns: [
      { header: "№", width: 5 },
      { header: t("Товар", "Product"), width: 40 },
      { header: t("Ед.", "Unit"), width: 6 },
      { header: t("Кол-во", "Qty"), numFmt: MONEY, width: 10 },
      { header: t("Цена без НДС", "Price ex-VAT"), numFmt: MONEY2, width: 14 },
      { header: t("Стоимость без НДС", "Value ex-VAT"), numFmt: MONEY2, width: 17 },
      { header: t("Ставка НДС", "VAT rate"), numFmt: PCT, width: 10 },
      { header: t("Сумма НДС", "VAT"), numFmt: MONEY2, width: 16 },
      { header: t("Стоимость с НДС", "Value incl. VAT"), numFmt: MONEY2, width: 17 },
    ],
    rows: [
      ...lines.map((l, i) => [i + 1, product(l.productId), t("шт", "pcs"), l.qty, l.price, l.amount, l.amount ? l.vat / l.amount : null, l.vat, l.amount + l.vat]),
      [null, t("Итого", "Total"), null, sum((l) => l.qty), null, sum((l) => l.amount), null, sum((l) => l.vat), sum((l) => l.amount + l.vat)],
    ],
    boldRows: [lines.length],
    freezeCols: 2,
  };
  const cost: SheetSpec = {
    name: t("Себестоимость и маржа", "Cost and margin"),
    title: `${title} — ${t("себестоимость и маржа TI", "TI cost and margin")}`,
    subtitle: t("Для учёта TI, не часть документа · себестоимость по FIFO", "For TI's own records, not part of the document · FIFO cost"),
    columns: [
      { header: t("Товар", "Product"), width: 40 },
      { header: t("Кол-во", "Qty"), numFmt: MONEY, width: 10 },
      { header: t("Стоимость без НДС", "Value ex-VAT"), numFmt: MONEY, width: 17 },
      { header: t("Себест. TI, шт", "TI unit cost"), numFmt: MONEY2, width: 14 },
      { header: t("Себестоимость TI", "TI cost"), numFmt: MONEY, width: 17 },
      { header: t("Маржа TI", "TI margin"), numFmt: MONEY, width: 16 },
      { header: t("Маржа, %", "Margin, %"), numFmt: PCT, width: 10 },
    ],
    rows: [
      ...lines.map((l) => [product(l.productId), l.qty, l.amount, l.tiUnitCost, l.tiCost, l.amount - l.tiCost, l.amount ? (l.amount - l.tiCost) / l.amount : null]),
      [t("Итого", "Total"), sum((l) => l.qty), sum((l) => l.amount), null, sum((l) => l.tiCost), sum((l) => l.amount - l.tiCost), sum((l) => l.amount) ? sum((l) => l.amount - l.tiCost) / sum((l) => l.amount) : null],
    ],
    boldRows: [lines.length],
  };
  return [doc, cost];
}
