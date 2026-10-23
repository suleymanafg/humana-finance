// The financial model as a live-formula Excel workbook — the layout of the
// simplified workbook given to Fargo (Settings, P&L and balance sheet for TI,
// Fargo and the group, the settlement, trucks, FIFO cost, stock and every data
// tab), built from the app's records up to the chosen month. Only the records
// are values; every figure on the statement tabs, the cost of goods and the
// stock is a formula, so Excel recalculates it on opening and any number can
// be traced to its rows. The formulas follow the engine (src/lib/engine):
// trucks → TI's FIFO by truck (invoices and free samples in date order) →
// Fargo's FIFO by invoice (each month's sales, then its write-offs, then what
// the latest count found missing) → P&L, VAT, settlement, balance sheets.
// A last tab, «App check», sets the workbook's key figures against the app's.
// Russian or English.
import ExcelJS from "exceljs";
import type { Computed, Dataset } from "./engine/types";
import { arrivedInOrder, invoicesInOrder, isImportVat } from "./engine/costing";
import { FARGO_GROUPS, FARGO_WRITEOFF_GROUP, GROUP_LABELS, TI_GROUPS } from "./groups";

type Locale = "ru" | "en";

const SHEETS = {
  settings: ["Настройки", "Settings"],
  plTi: ["ОПиУ TI", "P&L TI"],
  plFg: ["ОПиУ Fargo", "P&L Fargo"],
  plGr: ["ОПиУ консолид.", "P&L Consolidated"],
  bsTi: ["Баланс TI", "BS TI"],
  bsFg: ["Баланс Fargo", "BS Fargo"],
  bsGr: ["Баланс консолид.", "BS Consolidated"],
  settle: ["Расчёты с Fargo", "Settlement"],
  ship: ["Поставки", "Shipments"],
  cogs: ["Себестоимость FIFO", "COGS"],
  stock: ["Остатки товара", "Stock"],
  sales: ["Продажи", "Sales"],
  shipExp: ["Расходы на импорт", "Shipment expenses"],
  inv: ["Счета-фактуры TI", "TI invoices"],
  tiWo: ["Образцы TI", "TI write-offs"],
  fgWo: ["Списания Fargo", "Fargo write-offs"],
  counts: ["Инвентаризация", "Stock counts"],
  opexTi: ["Расходы TI", "OPEX TI"],
  opexFg: ["Расходы Fargo", "OPEX Fargo"],
  tr: ["Платежи Fargo", "Transfers"],
  cap: ["Капитал", "Capital"],
  loans: ["Займы", "Loans"],
  prior: ["Прежний владелец", "Previous owner"],
  other: ["Прочие поступления", "Other receipts"],
  ar: ["Дебиторка", "AR"],
  mb: ["Деньги на конец месяца", "Month balances"],
  vat: ["НДС TI — лицевой счёт", "TI VAT account"],
  vatCh: ["НДС — прочие начисления", "VAT charges"],
  tax: ["Налог на прибыль TI", "TI tax filings"],
  lists: ["Справочники", "Lists"],
  check: ["Сверка с приложением", "App check"],
} as const;
type SheetKey = keyof typeof SHEETS;

const MONEY = "#,##0;-#,##0";
const UNITS = "#,##0;-#,##0";
const UNIT2 = "#,##0.00;-#,##0.00";
const PCT = "0.0%";
const DATE = "dd.mm.yyyy";
const MONTHFMT = "0";
const FILL_HEAD = "FFEEF0FD";
const FILL_SECTION = "FFF7F7FB";

const ym = (m: string) => Number(m.replace("-", ""));
const L = (n: number) => {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
/** Excel date serial of an ISO date (UTC day). */
const serial = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86400000) + 25569;
const str = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** "Humana Platin 1 MP 400 гр х 4 шт" → "Platin 1 400g"; promo packs keep «АКЦИЯ». */
function shortName(nameRu: string): string {
  const promo = /АКЦИЯ/i.test(nameRu);
  const base = nameRu
    .replace(/\(АКЦИЯ\)\s*/i, "")
    .replace(/^Humana\s+/i, "")
    .replace(/\s*[хx]\s*\d+\s*шт\.?\s*$/i, "")
    .replace(/\s+(MP|FS|BIB|DS)\b/g, "")
    .replace(/\s*(\d+)\s*гр?\.?$/i, " $1g")
    .trim();
  return promo ? `${base} АКЦИЯ` : base;
}

type Cell = ExcelJS.Cell;

class Sheet {
  ws: ExcelJS.Worksheet;
  constructor(wb: ExcelJS.Workbook, public name: string) {
    this.ws = wb.addWorksheet(name.slice(0, 31));
  }
  cell(r: number, c: number): Cell {
    return this.ws.getRow(r).getCell(c);
  }
  v(r: number, c: number, value: string | number | null | undefined, fmt?: string): Cell {
    const cell = this.cell(r, c);
    cell.value = value === undefined || value === "" ? null : value;
    if (fmt) cell.numFmt = fmt;
    return cell;
  }
  /** A formula; `result` is stored with it so the figure shows before Excel recalculates (Protected View). */
  f(r: number, c: number, formula: string, fmt?: string, result?: number | string): Cell {
    const cell = this.cell(r, c);
    cell.value = (result === undefined ? { formula } : { formula, result }) as ExcelJS.CellFormulaValue;
    if (fmt) cell.numFmt = fmt;
    return cell;
  }
  title(text: string, note?: string) {
    const t = this.v(1, 1, text);
    t.font = { bold: true, size: 13 };
    if (note) {
      const n = this.v(2, 1, note);
      n.font = { italic: true, size: 9, color: { argb: "FF64748B" } };
    }
  }
  header(r: number, labels: string[], from = 1) {
    labels.forEach((label, i) => {
      const cell = this.v(r, from + i, label);
      cell.font = { bold: true, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_HEAD } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = { bottom: { style: "thin", color: { argb: "FFCBD5E1" } } };
    });
  }
  section(r: number, text: string, lastCol: number) {
    const cell = this.v(r, 1, text);
    cell.font = { bold: true };
    for (let c = 1; c <= lastCol; c++) this.cell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_SECTION } };
  }
  bold(r: number, lastCol: number, rule = true) {
    for (let c = 1; c <= lastCol; c++) {
      const cell = this.cell(r, c);
      cell.font = { ...(cell.font ?? {}), bold: true };
      if (rule) cell.border = { top: { style: "thin", color: { argb: "FF94A3B8" } } };
    }
  }
  widths(ws: number[]) {
    ws.forEach((w, i) => (this.ws.getColumn(i + 1).width = w));
  }
  freeze(x: number, y: number) {
    this.ws.views = [{ state: "frozen", xSplit: x, ySplit: y }];
  }
}

/** One line of a statement tab: a formula per month column (x = column letter, i = month index). */
interface Line {
  id?: string;
  label: string;
  kind: "head" | "line" | "sub" | "total" | "ratio" | "memo" | "blank";
  f?: (x: string, i: number) => string;
  /** the B column: "sum" over the months to REPORT_TO (flows), "last" — the value at REPORT_TO (positions) */
  b?: "sum" | "last" | null;
  ratio?: [string, string];
  fmt?: string;
}

export function modelWorkbook(ds: Dataset, c: Computed, reportMonth: string, locale: Locale): ExcelJS.Workbook {
  const ru = locale === "ru";
  const t = (r: string, e: string) => (ru ? r : e);
  const N = (k: SheetKey) => SHEETS[k][ru ? 0 : 1];
  const Q = (k: SheetKey) => `'${N(k).replace(/'/g, "''")}'!`;

  const months = ds.months.map((m) => m.id).filter((m) => m <= reportMonth);
  const first = months[0];
  const inRange = (m: string | null | undefined) => !!m && m <= reportMonth;
  const nM = months.length;
  const lastCol = L(2 + nM); // months live in C …
  const mcol = (i: number) => L(3 + i);

  // ── reference data ──
  const products = [...ds.products].sort((a, b) => a.sortOrder - b.sortOrder);
  const keyOf = new Map<string, string>();
  for (const p of products) {
    let k = shortName(p.nameRu);
    while ([...keyOf.values()].includes(k)) k += "*";
    keyOf.set(p.id, k);
  }
  const costIdOf = (id: string) => {
    const p = ds.products.find((x) => x.id === id);
    return p?.isPromo && p.regularProductId ? p.regularProductId : id;
  };
  const key = (id: string) => keyOf.get(id) ?? id;
  const costKey = (id: string) => key(costIdOf(id));
  const costProducts = [...new Set(products.map((p) => costIdOf(p.id)))];
  const channels = [...ds.channels].sort((a, b) => a.sortOrder - b.sortOrder);
  const channelName = new Map(channels.map((x) => [x.id, x.name]));
  const productSort = new Map(products.map((p, i) => [p.id, i]));
  const channelSort = new Map(channels.map((x, i) => [x.id, i]));
  const group = (g: string | null) => (GROUP_LABELS[g ?? "UNMAPPED"] ?? GROUP_LABELS.UNMAPPED)[locale];

  // truck codes must be unique: expenses and lines find their truck by it
  const truckCode = new Map<string, string>();
  for (const s of ds.shipments) {
    let code = s.code;
    while ([...truckCode.values()].includes(code)) code += " (2)";
    truckCode.set(s.id, code);
  }
  const shipments = c.shipments.filter((s) => inRange(s.monthId));
  const arrived = arrivedInOrder(shipments);
  const shipOrder = [...arrived, ...shipments.filter((s) => s.status !== "ARRIVED")];

  /** rows of the trucks and their lines on the Shipments tab (set when it is written) */
  const SHIP = { truckFirst: 4, truckLast: 4, lineFirst: 8, lineLast: 8 };
  const wb = new ExcelJS.Workbook();
  wb.creator = "Humana Finance";
  wb.calcProperties.fullCalcOnLoad = true;
  const S = {} as Record<SheetKey, Sheet>;
  for (const k of Object.keys(SHEETS) as SheetKey[]) S[k] = new Sheet(wb, N(k));

  // ═══════════════════════ data tabs ═══════════════════════
  /** the previous owner's VAT before the first month — a formula cell, so referenced directly (not by name) */
  let priorVatCell = "0";

  // Settings
  {
    const s = S.settings;
    s.title(t("Настройки", "Settings"), t("Ставки и параметры, которые используют формулы. Отчётный месяц можно сменить на более ранний.", "Rates and parameters the formulas use. The report month can be set to an earlier one."));
    s.header(3, [t("Параметр", "Parameter"), t("Значение", "Value"), t("Имя в формулах", "Name in formulas")]);
    const rows: Array<[string, string | number, string, string?]> = [
      [t("Ставка НДС", "VAT rate"), ds.taxes.vatRate, "VAT_RATE", PCT],
      [t("Декларируемая наценка по наличным продажам (себестоимость Fargo × (1 + наценка))", "Deemed margin on cash sales (Fargo cost × (1 + margin))"), ds.taxes.deemedCashMargin, "DEEMED_MARGIN", PCT],
      [t("Оборотный налог Fargo", "Fargo turnover tax"), ds.taxes.fargoIncomeTaxRate, "FARGO_TAX_RATE", "0.0%"],
      [t("Отчётный месяц (итоги и остатки «на конец»)", "Report month (totals to, balances at)"), ym(reportMonth), "REPORT_TO", MONTHFMT],
      [t("Первый месяц совместной работы", "First month of joint operations"), ym(first), "START_MONTH", MONTHFMT],
      [t("Fargo вычитает свои списания из долга (1 — да, 0 — нет)", "Fargo deducts its write-offs from what it owes (1 yes, 0 no)"), ds.taxes.writeOffDeduct ? 1 : 0, "WRITEOFF_DEDUCT", "0"],
    ];
    rows.forEach(([label, value, name, fmt], i) => {
      s.v(4 + i, 1, label);
      s.v(4 + i, 2, value, fmt);
      s.v(4 + i, 3, name);
      wb.definedNames.add(`${Q("settings")}$B$${4 + i}`, name);
    });
    const r = 4 + rows.length;
    s.v(r, 1, t("Переплата НДС прежнего владельца до первого месяца (лицевой счёт)", "The previous owner's VAT overpayment before the first month (tax account)"));
    const V = Q("vat");
    s.f(r, 2, `SUMIFS(${V}$E:$E,${V}$A:$A,"<"&START_MONTH)-SUMIFS(${V}$D:$D,${V}$A:$A,"<"&START_MONTH)+SUMIFS(${V}$F:$F,${V}$A:$A,"<"&START_MONTH)-SUMIFS(${V}$G:$G,${V}$A:$A,"<"&START_MONTH)`, MONEY);
    s.v(r, 3, `${N("settings")}!B${r}`);
    priorVatCell = `${Q("settings")}$B${r}`;
    s.widths([78, 18, 20]);
  }

  // Lists — products and channels
  {
    const s = S.lists;
    s.title(t("Товары и каналы", "Products and channels"));
    s.header(3, [t("Товар", "Product"), t("Полное название", "Full name"), t("Цена, сум", "List price, UZS"), t("Акция", "Promo"), t("Себестоимость как", "Cost product")]);
    products.forEach((p, i) => {
      s.v(4 + i, 1, key(p.id));
      s.v(4 + i, 2, p.nameRu);
      s.v(4 + i, 3, p.price, MONEY);
      s.v(4 + i, 4, p.isPromo ? 1 : 0);
      s.v(4 + i, 5, costKey(p.id));
    });
    s.header(3, [t("Канал", "Channel"), t("Доля наличных", "Cash share")], 7);
    channels.forEach((ch, i) => {
      s.v(4 + i, 7, ch.name);
      s.v(4 + i, 8, ch.cashPct, PCT);
    });
    s.widths([24, 44, 14, 8, 22, 4, 30, 12]);
  }
  const LI = Q("lists");

  // Sales
  {
    const s = S.sales;
    s.title(t("Продажи Fargo (1С) по месяцам, товарам и каналам", "Fargo sales (1C) by month, product and channel"), t("Выручка = кол-во × цена из справочника, с НДС. Себестоимость за штуку — из листа FIFO.", "Sales = qty × list price, VAT included. Cost per unit comes from the FIFO tab."));
    s.header(3, [
      t("Месяц", "Month"), t("Товар", "Product"), t("Канал", "Channel"), t("Кол-во", "Qty"), t("Сумма по счёту (если есть)", "Invoiced amount (if known)"), t("Цена", "List price"),
      t("ПРОДАЖИ с НДС", "SALES incl. VAT"), t("Доля наличных", "Cash share"), t("Наличные", "Cash sales"), t("Перечисление", "Bank sales"), t("Себестоимость как", "Cost product"),
      t("Себест. Fargo за шт (FIFO)", "Fargo FIFO cost per unit"), t("Декларируемые продажи за наличные (без НДС)", "Declared cash sales (ex-VAT)"), t("НДС — перечисление", "Output VAT — bank"), t("НДС — наличные", "Output VAT — cash"), t("Оборотный налог", "Turnover tax"),
    ]);
    const rows = ds.sales
      .filter((x) => inRange(x.monthId) && keyOf.has(x.productId) && channelName.has(x.channelId))
      .sort((a, b) => a.monthId.localeCompare(b.monthId) || (productSort.get(a.productId)! - productSort.get(b.productId)!) || (channelSort.get(a.channelId)! - channelSort.get(b.channelId)!));
    rows.forEach((x, i) => {
      const r = 4 + i;
      s.v(r, 1, ym(x.monthId), MONTHFMT);
      s.v(r, 2, key(x.productId));
      s.v(r, 3, channelName.get(x.channelId)!);
      s.v(r, 4, x.qty, UNITS);
      s.v(r, 5, x.amount ?? null, MONEY);
      s.f(r, 6, `IFERROR(INDEX(${LI}$C:$C,MATCH(B${r},${LI}$A:$A,0)),0)`, MONEY);
      s.f(r, 7, `IF(E${r}="",D${r}*F${r},E${r})`, MONEY);
      s.f(r, 8, `IFERROR(INDEX(${LI}$H:$H,MATCH(C${r},${LI}$G:$G,0)),0)`, PCT);
      s.f(r, 9, `G${r}*H${r}`, MONEY);
      s.f(r, 10, `G${r}-I${r}`, MONEY);
      s.f(r, 11, `IFERROR(INDEX(${LI}$E:$E,MATCH(B${r},${LI}$A:$A,0)),B${r})`);
      s.f(r, 12, `IFERROR(INDEX(${Q("cogs")}$C$${COGS_UNIT_FIRST}:$${lastCol}$${COGS_UNIT_FIRST + costProducts.length - 1},MATCH(K${r},${Q("cogs")}$A$${COGS_UNIT_FIRST}:$A$${COGS_UNIT_FIRST + costProducts.length - 1},0),MATCH(A${r},${Q("cogs")}$C$3:$${lastCol}$3,0)),0)`, UNIT2);
      s.f(r, 13, `D${r}*H${r}*L${r}*(1+DEEMED_MARGIN)`, MONEY);
      s.f(r, 14, `J${r}*VAT_RATE/(1+VAT_RATE)`, MONEY);
      s.f(r, 15, `M${r}*VAT_RATE`, MONEY);
      s.f(r, 16, `G${r}*FARGO_TAX_RATE`, MONEY);
    });
    s.widths([9, 22, 24, 9, 14, 11, 15, 9, 15, 15, 22, 13, 15, 14, 14, 13]);
    s.freeze(0, 3);
  }

  // TI invoices — in the order Fargo receives them
  const invLines = invoicesInOrder(c.invoices.filter((l) => inRange(l.monthId)));
  const invRow = new Map(invLines.map((l, i) => [l.id, 4 + i]));
  {
    const s = S.inv;
    s.title(t("Счета-фактуры TI → Fargo", "TI → Fargo invoices"), t("Строки по порядку поставки (дата, затем порядок в счёте). Себестоимость TI — FIFO по фурам, лист FIFO.", "Lines in delivery order (date, then order on the invoice). TI cost — FIFO by truck, FIFO tab."));
    s.header(3, [
      t("Строка", "Line"), t("Дата", "Date"), t("Месяц", "Month"), t("№ счёта", "Invoice №"), t("Товар", "Product"), t("Кол-во", "Qty"), t("Цена без НДС", "Price ex-VAT"), t("Стоимость без НДС", "Value ex-VAT"),
      t("НДС", "VAT"), t("С НДС", "Value incl. VAT"), t("Вне FIFO (1/0)", "Outside TI FIFO (1/0)"), t("Своя себест., шт", "Own unit cost"), t("Себестоимость как", "Cost product"), t("Себест. TI, шт", "TI unit cost"), t("СЕБЕСТОИМОСТЬ TI", "TI COST"),
    ]);
    invLines.forEach((l, i) => {
      const r = 4 + i;
      s.v(r, 1, i + 1);
      s.v(r, 2, serial(l.date), DATE);
      s.f(r, 3, `YEAR(B${r})*100+MONTH(B${r})`, MONTHFMT);
      s.v(r, 4, l.number);
      s.v(r, 5, key(l.productId));
      s.v(r, 6, l.qty, UNITS);
      s.v(r, 7, l.price, UNIT2);
      s.v(r, 8, l.amount, MONEY);
      s.v(r, 9, l.vat, MONEY);
      s.f(r, 10, `H${r}+I${r}`, MONEY);
      s.v(r, 11, l.ownUnitCost != null ? 1 : 0);
      s.v(r, 12, l.ownUnitCost ?? null, MONEY);
      s.f(r, 13, `IFERROR(INDEX(${LI}$E:$E,MATCH(E${r},${LI}$A:$A,0)),E${r})`);
      // column N is written with the FIFO tab (it points at the line's row there)
      s.f(r, 15, `F${r}*N${r}`, MONEY);
    });
    s.widths([7, 11, 9, 9, 22, 9, 12, 16, 14, 16, 9, 11, 22, 12, 16]);
    s.freeze(0, 3);
  }

  // TI write-offs (free samples) — in the order the engine uses them
  const tiWo = ds.writeOffs
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => inRange(w.date.slice(0, 7)) && keyOf.has(w.productId))
    .sort((a, b) => a.w.date.slice(0, 10).localeCompare(b.w.date.slice(0, 10)) || a.i - b.i)
    .map(({ w }) => w);
  const tiWoRow = new Map(tiWo.map((w, i) => [w.id, 4 + i]));
  {
    const s = S.tiWo;
    s.title(t("Образцы и лаборатория — товар TI, отданный бесплатно", "Samples and laboratory — TI goods given away"), t("Себестоимость — FIFO по фурам, после счетов того же дня.", "Cost — FIFO by truck, after the same day's invoices."));
    s.header(3, [t("Дата", "Date"), t("Месяц", "Month"), t("Товар", "Product"), t("Кол-во", "Qty"), t("Причина", "Reason"), t("Себестоимость как", "Cost product"), t("Себест., шт", "Unit cost"), t("СУММА", "VALUE"), t("Порядок", "Order")]);
    tiWo.forEach((w, i) => {
      const r = 4 + i;
      s.v(r, 1, serial(w.date), DATE);
      s.f(r, 2, `YEAR(A${r})*100+MONTH(A${r})`, MONTHFMT);
      s.v(r, 3, key(w.productId));
      s.v(r, 4, w.qty, UNITS);
      s.v(r, 5, w.reason ?? null);
      s.f(r, 6, `IFERROR(INDEX(${LI}$E:$E,MATCH(C${r},${LI}$A:$A,0)),C${r})`);
      // G is written with the FIFO tab
      s.f(r, 8, `D${r}*G${r}`, MONEY);
      s.v(r, 9, i + 1);
    });
    s.widths([11, 9, 22, 9, 36, 22, 12, 14, 8]);
  }

  // Fargo write-offs (expired, damaged)
  const fgWo = ds.fargoWriteOffs.filter((w) => inRange(w.date.slice(0, 7)) && keyOf.has(w.productId)).sort((a, b) => a.date.localeCompare(b.date));
  {
    const s = S.fgWo;
    s.title(t("Списания Fargo: просрочка, брак", "Fargo write-offs: expired, damaged"), t("В FIFO месяца — после продаж месяца, до разницы по инвентаризации. Сумма строки — её доля в списании товара за месяц.", "In the month's FIFO — after the month's sales, before the count difference. A row's value is its share of the product's write-off that month."));
    s.header(3, [t("Дата", "Date"), t("Месяц", "Month"), t("Товар", "Product"), t("Кол-во", "Qty"), t("Причина", "Reason"), t("Себестоимость как", "Cost product"), t("Примечание", "Note"), t("По ценам счетов TI", "At TI invoice prices"), t("По себестоимости TI", "At TI landed cost")]);
    const CG = Q("cogs");
    fgWo.forEach((w, i) => {
      const r = 4 + i;
      s.v(r, 1, serial(w.date), DATE);
      s.f(r, 2, `YEAR(A${r})*100+MONTH(A${r})`, MONTHFMT);
      s.v(r, 3, key(w.productId));
      s.v(r, 4, w.qty, UNITS);
      s.v(r, 5, w.reason);
      s.f(r, 6, `IFERROR(INDEX(${LI}$E:$E,MATCH(C${r},${LI}$A:$A,0)),C${r})`);
      s.v(r, 7, w.notes ?? null);
      s.f(r, 8, `IFERROR(D${r}/SUMIFS($D:$D,$F:$F,F${r},$B:$B,B${r})*SUMIFS(${CG}$R:$R,${CG}$A:$A,B${r},${CG}$AB:$AB,F${r}),0)`, MONEY);
      s.f(r, 9, `IFERROR(D${r}/SUMIFS($D:$D,$F:$F,F${r},$B:$B,B${r})*SUMIFS(${CG}$U:$U,${CG}$A:$A,B${r},${CG}$AB:$AB,F${r}),0)`, MONEY);
    });
    s.widths([11, 9, 22, 9, 12, 22, 30, 16, 16]);
  }

  // Stock counts
  {
    const s = S.counts;
    s.title(t("Инвентаризация склада Fargo на конец месяца", "Fargo's month-end stock counts"), t("Месяц считается пересчитанным, если в нём есть хоть одна ненулевая строка.", "A month counts as counted once it has a non-zero row."));
    s.header(3, [t("Месяц", "Month"), t("Товар", "Product"), t("Склад", "Warehouse"), t("Кол-во", "Qty"), t("Себестоимость как", "Cost product")]);
    const wh = new Map(ds.warehouses.map((w) => [w.id, w.name]));
    ds.stockCounts
      .filter((x) => inRange(x.monthId) && keyOf.has(x.productId))
      .sort((a, b) => a.monthId.localeCompare(b.monthId) || productSort.get(a.productId)! - productSort.get(b.productId)!)
      .forEach((x, i) => {
        const r = 4 + i;
        s.v(r, 1, ym(x.monthId), MONTHFMT);
        s.v(r, 2, key(x.productId));
        s.v(r, 3, wh.get(x.warehouseId) ?? x.warehouseId);
        s.v(r, 4, x.qty, UNITS);
        s.f(r, 5, `IFERROR(INDEX(${LI}$E:$E,MATCH(B${r},${LI}$A:$A,0)),B${r})`);
      });
    s.widths([9, 22, 22, 10, 22]);
  }

  // OPEX
  {
    const s = S.opexTi;
    s.title(t("Расходы Turbo Impex", "Turbo Impex expenses"));
    s.header(3, [t("Месяц", "Month"), t("Статья", "Category"), t("Группа ОПиУ", "P&L group"), t("Банк", "Bank"), t("Наличные", "Cash"), t("ИТОГО", "TOTAL")]);
    ds.opexTi
      .filter((e) => inRange(e.monthId))
      .sort((a, b) => a.monthId.localeCompare(b.monthId))
      .forEach((e, i) => {
        const r = 4 + i;
        s.v(r, 1, ym(e.monthId), MONTHFMT);
        s.v(r, 2, e.categoryName);
        s.v(r, 3, group(e.plGroup));
        s.v(r, 4, e.bankAmount, MONEY);
        s.v(r, 5, e.cashAmount, MONEY);
        s.f(r, 6, `D${r}+E${r}`, MONEY);
      });
    s.widths([9, 36, 28, 15, 15, 15]);
  }
  {
    const s = S.opexFg;
    s.title(t("Расходы Fargo (включая ретро-бонусы)", "Fargo expenses (incl. retro bonuses)"), t(`Группа «${GROUP_LABELS[FARGO_WRITEOFF_GROUP].ru}» — не операционный расход.`, `The «${GROUP_LABELS[FARGO_WRITEOFF_GROUP].en}» group is not an operating cost.`));
    s.header(3, [t("Месяц", "Month"), t("Статья", "Category"), t("Группа ОПиУ", "P&L group"), t("Сумма", "Amount")]);
    ds.opexFargo
      .filter((e) => inRange(e.monthId))
      .sort((a, b) => a.monthId.localeCompare(b.monthId))
      .forEach((e, i) => {
        const r = 4 + i;
        s.v(r, 1, ym(e.monthId), MONTHFMT);
        s.v(r, 2, e.categoryName);
        s.v(r, 3, group(e.plGroup));
        s.v(r, 4, e.amount, MONEY);
      });
    s.widths([9, 36, 34, 15]);
  }

  // Shipment expenses — every expense of the trucks shown (they make the landed cost)
  {
    const s = S.shipExp;
    s.title(t("Расходы на импорт по поставкам", "Import expenses per truck"), t("НДС на таможне (отметка 1) — не часть себестоимости.", "Import VAT at customs (flag 1) is not part of the landed cost."));
    s.header(3, [t("Поставка", "Truck"), t("Месяц", "Month"), t("Статья", "Category"), t("Сумма, сум", "Amount, UZS"), t("Оплачено в месяце (если позже)", "Paid in month (if later)"), t("Примечание", "Note"), t("НДС на таможне (1/0)", "Import VAT (1/0)")]);
    const ids = new Set(shipments.map((x) => x.shipmentId));
    ds.importExpenses
      .filter((e) => ids.has(e.shipmentId))
      .sort((a, b) => shipOrder.findIndex((x) => x.shipmentId === a.shipmentId) - shipOrder.findIndex((x) => x.shipmentId === b.shipmentId))
      .forEach((e, i) => {
        const r = 4 + i;
        s.v(r, 1, truckCode.get(e.shipmentId) ?? e.shipmentId);
        s.v(r, 2, ym(e.monthId), MONTHFMT);
        s.v(r, 3, e.categoryName);
        s.v(r, 4, e.amount, MONEY);
        s.v(r, 5, e.paidMonthId ? ym(e.paidMonthId) : null, MONTHFMT);
        s.v(r, 6, e.notes ?? null);
        s.v(r, 7, isImportVat(e.categoryName) ? 1 : 0);
      });
    s.widths([14, 9, 24, 15, 14, 30, 10]);
  }

  // Money tabs
  const dated = <T extends { date: string }>(rows: T[]) => rows.filter((x) => inRange(x.date.slice(0, 7))).sort((a, b) => a.date.localeCompare(b.date));
  {
    const s = S.tr;
    s.title(t("Платежи Fargo → TI", "Payments Fargo → TI"));
    s.header(3, [t("Дата", "Date"), t("Месяц", "Month"), t("Наличные", "Cash"), t("Перечисление", "Bank"), t("ИТОГО", "TOTAL"), t("Примечание", "Note")]);
    dated(ds.transfers).forEach((x, i) => {
      const r = 4 + i;
      s.v(r, 1, serial(x.date), DATE);
      s.f(r, 2, `YEAR(A${r})*100+MONTH(A${r})`, MONTHFMT);
      s.v(r, 3, x.cashAmount, MONEY);
      s.v(r, 4, x.bankAmount, MONEY);
      s.f(r, 5, `C${r}+D${r}`, MONEY);
      s.v(r, 6, x.notes ?? null);
    });
    s.widths([11, 9, 16, 16, 16, 40]);
  }
  {
    const s = S.cap;
    s.title(t("Взносы в капитал", "Capital contributions"));
    s.header(3, [t("Дата", "Date"), t("Месяц", "Month"), "TI", "Fargo", t("ИТОГО", "TOTAL"), t("Примечание", "Note"), t("Со счёта Fargo (1/0)", "Sent from Fargo's bank (1/0)")]);
    dated(ds.contributions).forEach((x, i) => {
      const r = 4 + i;
      s.v(r, 1, serial(x.date), DATE);
      s.f(r, 2, `YEAR(A${r})*100+MONTH(A${r})`, MONTHFMT);
      s.v(r, 3, x.tiAmount, MONEY);
      s.v(r, 4, x.fargoAmount, MONEY);
      s.f(r, 5, `C${r}+D${r}`, MONEY);
      s.v(r, 6, x.notes ?? null);
      s.v(r, 7, x.viaFargo ? 1 : 0);
    });
    s.widths([11, 9, 16, 16, 16, 40, 12]);
  }
  {
    const s = S.loans;
    s.title(t("Займы и финансовая помощь TI", "TI loans and financial assistance"));
    s.header(3, [t("Месяц", "Month"), t("Займодавец", "Lender / source"), t("Получено", "Received"), t("Возвращено", "Repaid"), t("Примечание", "Note")]);
    ds.loans
      .filter((x) => inRange(x.monthId))
      .sort((a, b) => a.monthId.localeCompare(b.monthId))
      .forEach((x, i) => {
        const r = 4 + i;
        s.v(r, 1, ym(x.monthId), MONTHFMT);
        s.v(r, 2, x.lender);
        s.v(r, 3, x.received, MONEY);
        s.v(r, 4, x.repaid, MONEY);
        s.v(r, 5, x.notes ?? null);
      });
    s.widths([9, 30, 16, 16, 40]);
  }
  {
    const s = S.prior;
    s.title(t("Деньги прежнего владельца TI", "The previous owner's money"));
    s.header(3, [t("Дата", "Date"), t("Месяц", "Month"), t("Что", "What"), t("Получено от прежнего владельца", "Received from previous owner"), t("Оплачено за него", "Paid on their behalf"), t("Примечание", "Note"), t("Через счёт Fargo (1/0)", "Via Fargo's bank (1/0)")]);
    dated(ds.priorOwner).forEach((x, i) => {
      const r = 4 + i;
      s.v(r, 1, serial(x.date), DATE);
      s.f(r, 2, `YEAR(A${r})*100+MONTH(A${r})`, MONTHFMT);
      s.v(r, 3, x.description);
      s.v(r, 4, x.received, MONEY);
      s.v(r, 5, x.paid, MONEY);
      s.v(r, 6, x.notes ?? null);
      s.v(r, 7, x.viaFargo ? 1 : 0);
    });
    s.widths([11, 9, 40, 16, 16, 40, 12]);
  }
  {
    const s = S.other;
    s.title(t("Прочие поступления TI (деньги других покупателей)", "TI's other receipts (other customers' money)"));
    s.header(3, [t("Дата", "Date"), t("Месяц", "Month"), t("От кого", "Payer"), t("Сумма", "Amount"), t("Примечание", "Note")]);
    dated(ds.otherReceipts).forEach((x, i) => {
      const r = 4 + i;
      s.v(r, 1, serial(x.date), DATE);
      s.f(r, 2, `YEAR(A${r})*100+MONTH(A${r})`, MONTHFMT);
      s.v(r, 3, x.payer);
      s.v(r, 4, x.amount, MONEY);
      s.v(r, 5, x.notes ?? null);
    });
    s.widths([11, 9, 30, 16, 40]);
  }
  {
    const s = S.ar;
    s.title(t("Дебиторская задолженность покупателей Fargo на конец месяца", "What Fargo's customers owe at month-end"));
    s.header(3, [t("Месяц", "Month"), t("Покупатель", "Customer"), t("Сумма", "Amount")]);
    ds.arEntries
      .filter((x) => inRange(x.monthId))
      .sort((a, b) => a.monthId.localeCompare(b.monthId) || b.amount - a.amount)
      .forEach((x, i) => {
        s.v(4 + i, 1, ym(x.monthId), MONTHFMT);
        s.v(4 + i, 2, x.customerName);
        s.v(4 + i, 3, x.amount, MONEY);
      });
    s.widths([9, 40, 16]);
  }
  {
    const s = S.mb;
    s.title(t("Деньги TI и предоплаты на конец месяца", "TI's month-end money and prepayments"), t("Вводятся при закрытии месяца; без них баланс TI за месяц не строится.", "Entered at the month close; without them TI's balance sheet for the month is not built."));
    s.header(3, [t("Месяц", "Month"), t("Банк TI", "TI bank"), t("Касса TI", "TI cash"), t("Товары в пути (предоплата)", "Goods in transit (prepaid)")]);
    ds.monthBalances
      .filter((x) => inRange(x.monthId))
      .sort((a, b) => a.monthId.localeCompare(b.monthId))
      .forEach((x, i) => {
        s.v(4 + i, 1, ym(x.monthId), MONTHFMT);
        s.v(4 + i, 2, x.tiBank, MONEY);
        s.v(4 + i, 3, x.tiCash, MONEY);
        s.v(4 + i, 4, x.goodsInTransit, MONEY);
      });
    s.widths([9, 16, 16, 20]);
  }
  {
    const s = S.vat;
    s.title(t("НДС Turbo Impex — лицевой счёт (my.soliq.uz)", "Turbo Impex VAT — tax account (my.soliq.uz)"), t("Остаток = уменьшено − начислено + уплачено − возвращено, нарастающим итогом.", "Balance = reduced − charged + paid − refunded, cumulative."));
    s.header(3, [t("Учитывается в месяце", "Counts in month"), t("Дата операции", "Operation date"), t("Операция", "Operation"), t("Начислено", "Charged"), t("Уменьшено (зачёт)", "Reduced (зачёт)"), t("Уплачено / сальдо", "Paid / opening"), t("Возвращено", "Refunded"), t("Остаток после (по КЛС)", "Balance after (per КЛС)")]);
    ds.vatAccount
      .filter((x) => x.period <= reportMonth)
      .sort((a, b) => a.period.localeCompare(b.period) || a.sortOrder - b.sortOrder)
      .forEach((x, i) => {
        const r = 4 + i;
        s.v(r, 1, ym(x.period), MONTHFMT);
        if (x.date) s.v(r, 2, serial(x.date), DATE);
        s.v(r, 3, x.description);
        s.v(r, 4, x.charged, UNIT2);
        s.v(r, 5, x.reduced, UNIT2);
        s.v(r, 6, x.paid, UNIT2);
        s.v(r, 7, x.refunded, UNIT2);
        s.v(r, 8, x.balanceAfter, UNIT2);
      });
    s.widths([12, 12, 40, 16, 16, 16, 14, 18]);
  }
  {
    const s = S.vatCh;
    s.title(t("НДС, начисленный TI вне счетов-фактур Fargo", "VAT charged to TI outside the Fargo invoices"), t("TI — расход TI; PRIOR_OWNER — за счёт переплаты прежнего владельца.", "TI — a TI cost; PRIOR_OWNER — paid from the previous owner's overpayment."));
    s.header(3, [t("Месяц", "Month"), t("Что", "What"), t("Сумма", "Amount"), t("За чей счёт", "Borne by")]);
    ds.vatCharges
      .filter((x) => inRange(x.monthId))
      .sort((a, b) => a.monthId.localeCompare(b.monthId))
      .forEach((x, i) => {
        s.v(4 + i, 1, ym(x.monthId), MONTHFMT);
        s.v(4 + i, 2, x.description);
        s.v(4 + i, 3, x.amount, MONEY);
        s.v(4 + i, 4, x.bearer);
      });
    s.widths([9, 50, 16, 14]);
  }
  {
    const s = S.tax;
    s.title(t("Налог на прибыль TI (поданные декларации)", "TI profit tax (filed returns)"));
    s.header(3, [t("Период", "Period"), t("Начислен в месяце", "Booked in month"), t("Налог", "Tax amount"), t("Заявленные расходы", "Declared expenses"), t("Оплачен в месяце", "Paid in month")]);
    ds.taxFilings
      .filter((x) => inRange(x.bookedMonthId))
      .forEach((x, i) => {
        s.v(4 + i, 1, x.quarterLabel);
        s.v(4 + i, 2, ym(x.bookedMonthId), MONTHFMT);
        s.v(4 + i, 3, x.taxAmount, MONEY);
        s.v(4 + i, 4, x.declaredExpenses, MONEY);
        s.v(4 + i, 5, x.paidMonthId ? ym(x.paidMonthId) : null, MONTHFMT);
      });
    s.widths([36, 14, 16, 16, 14]);
  }

  // Shipments — trucks, then their lines
  const shipLineRow = new Map<string, number>();
  {
    const s = S.ship;
    const SE = Q("shipExp");
    const truckFirst = 4;
    const truckLast = truckFirst + shipOrder.length - 1;
    const linesHead = truckLast + 3;
    const lineFirst = linesHead + 1;
    const allLines = shipOrder.flatMap((sh) => sh.lines.map((l) => ({ sh, l })));
    const lineLast = Math.max(lineFirst, lineFirst + allLines.length - 1);
    const TR = (col: string) => `$${col}$${truckFirst}:$${col}$${Math.max(truckFirst, truckLast)}`;
    const LR = (col: string) => `$${col}$${lineFirst}:$${col}$${lineLast}`;
    s.title(t("Поставки — фуры, строки и себестоимость", "Shipments — trucks, lines and landed cost"));
    s.v(2, 1, t("1. ФУРЫ", "1. TRUCKS")).font = { bold: true };
    s.header(3, [t("Фура", "Truck"), t("Месяц прибытия", "Arrival month"), t("Статус", "Status"), t("Штук", "Units"), t("Закупка, сум", "Purchase, UZS"), t("Расходы (без НДС)", "Expenses (excl. VAT)"), t("Строки со своей себест.: сумма", "Fixed-cost lines: landed"), t("Строки со своей себест.: закупка", "Fixed-cost lines: purchase"), t("Коэффициент", "Load factor"), t("СЕБЕСТОИМОСТЬ", "LANDED COST")]);
    shipOrder.forEach((sh, i) => {
      const r = truckFirst + i;
      s.v(r, 1, truckCode.get(sh.shipmentId)!);
      s.v(r, 2, ym(sh.monthId), MONTHFMT);
      s.v(r, 3, sh.status);
      s.f(r, 4, `SUMIFS(${LR("E")},${LR("A")},A${r})`, UNITS);
      s.f(r, 5, `SUMIFS(${LR("I")},${LR("A")},A${r})`, MONEY);
      s.f(r, 6, `SUMIFS(${SE}$D:$D,${SE}$A:$A,A${r})-SUMIFS(${SE}$D:$D,${SE}$A:$A,A${r},${SE}$G:$G,1)`, MONEY);
      s.f(r, 7, `SUMIFS(${LR("N")},${LR("A")},A${r})`, MONEY);
      s.f(r, 8, `SUMIFS(${LR("O")},${LR("A")},A${r})`, MONEY);
      s.f(r, 9, `IF(E${r}-H${r}>0,(E${r}+F${r}-G${r})/(E${r}-H${r}),1)`, "0.0000");
      s.f(r, 10, `E${r}+F${r}`, MONEY);
    });
    s.v(linesHead - 1, 1, t("2. СТРОКИ ФУР", "2. TRUCK LINES")).font = { bold: true };
    s.header(linesHead, [t("Фура", "Truck"), t("Месяц прибытия", "Arrival month"), t("Статус", "Status"), t("Товар", "Product"), t("Кол-во", "Qty"), t("Цена, EUR", "Price, EUR"), t("Курс, сум/EUR", "Rate, UZS/EUR"), t("Цена, сум", "Price, UZS"), t("Закупка, сум", "Purchase, UZS"), t("Своя себест., шт", "Fixed unit cost (own cost)"), t("Коэффициент", "Load factor"), t("Себест., шт", "Landed unit cost"), t("СЕБЕСТОИМОСТЬ", "LANDED VALUE"), t("Своя: сумма", "Fixed: landed"), t("Своя: закупка", "Fixed: purchase"), t("Себестоимость как", "Cost product")]);
    allLines.forEach(({ sh, l }, i) => {
      const r = lineFirst + i;
      shipLineRow.set(l.id, r);
      s.v(r, 1, truckCode.get(sh.shipmentId)!);
      s.f(r, 2, `IFERROR(INDEX(${TR("B")},MATCH(A${r},${TR("A")},0)),0)`, MONTHFMT);
      s.f(r, 3, `IFERROR(INDEX(${TR("C")},MATCH(A${r},${TR("A")},0)),"")`);
      s.v(r, 4, key(l.productId));
      s.v(r, 5, l.qty, UNITS);
      s.v(r, 6, l.priceEur, "#,##0.000");
      s.v(r, 7, l.rate, UNIT2);
      s.f(r, 8, `F${r}*G${r}`, UNIT2);
      s.f(r, 9, `E${r}*H${r}`, MONEY);
      s.v(r, 10, l.fixedUnitCost ?? null, MONEY);
      s.f(r, 11, `IFERROR(INDEX(${TR("I")},MATCH(A${r},${TR("A")},0)),1)`, "0.0000");
      s.f(r, 12, `IF(J${r}<>"",J${r},H${r}*K${r})`, UNIT2);
      s.f(r, 13, `E${r}*L${r}`, MONEY);
      s.f(r, 14, `IF(J${r}<>"",E${r}*J${r},0)`, MONEY);
      s.f(r, 15, `IF(J${r}<>"",I${r},0)`, MONEY);
      s.f(r, 16, `IFERROR(INDEX(${LI}$E:$E,MATCH(D${r},${LI}$A:$A,0)),D${r})`);
    });
    s.widths([14, 11, 11, 22, 9, 9, 12, 12, 16, 12, 10, 12, 16, 12, 12, 22]);
    SHIP.truckFirst = truckFirst;
    SHIP.truckLast = Math.max(truckFirst, truckLast);
    SHIP.lineFirst = lineFirst;
    SHIP.lineLast = lineLast;
  }
  const SH = Q("ship");
  const SHL = (col: string) => `${SH}$${col}$${SHIP.lineFirst}:$${col}$${SHIP.lineLast}`;
  const SHT = (col: string) => `${SH}$${col}$${SHIP.truckFirst}:$${col}$${SHIP.truckLast}`;

  // ═══════════════════════ Stock (units) ═══════════════════════
  const IV = Q("inv");
  const TW = Q("tiWo");
  const FW = Q("fgWo");
  const SA = Q("sales");
  const SC = Q("counts");
  const stockDiffRow = new Map<string, number>();
  {
    const s = S.stock;
    const cols = months.length;
    s.title(t("Остатки товара — штуки на конец месяца (TI и Fargo)", "Stock — units at month-end (TI and Fargo)"));
    months.forEach((m, i) => (s.v(3, 3 + i, ym(m), MONTHFMT).font = { bold: true }));
    let r = 4;
    const each = (fn: (x: string, i: number) => string, row: number, fmt = UNITS) => months.forEach((_, i) => s.f(row, 3 + i, fn(mcol(i), i), fmt));
    // TI warehouse
    s.section(r++, t("СКЛАД TI — все товары", "TI WAREHOUSE — all products"), 2 + cols);
    const tiOpen = r++, tiIn = r++, tiOut = r++, tiSamples = r++, tiClose = r++;
    s.v(tiOpen, 1, t("На начало месяца", "Opening stock"));
    each((x, i) => (i === 0 ? "0" : `${mcol(i - 1)}${tiClose}`), tiOpen);
    s.v(tiIn, 1, t("+ Поступило (фуры)", "+ Arrived (trucks)"));
    each((x) => `SUMIFS(${SHL("E")},${SHL("B")},${x}$3,${SHL("C")},"ARRIVED")`, tiIn);
    s.v(tiOut, 1, t("− Отгружено Fargo (счета TI)", "− Delivered to Fargo (TI invoices)"));
    each((x) => `SUMIFS(${IV}$F:$F,${IV}$C:$C,${x}$3)`, tiOut);
    s.v(tiSamples, 1, t("− Образцы и лаборатория", "− Free samples (TI write-offs)"));
    each((x) => `SUMIFS(${TW}$D:$D,${TW}$B:$B,${x}$3)`, tiSamples);
    s.v(tiClose, 1, t("На конец месяца", "Closing stock"));
    each((x) => `${x}${tiOpen}+${x}${tiIn}-${x}${tiOut}-${x}${tiSamples}`, tiClose);
    s.bold(tiClose, 2 + cols);
    r++;
    // Fargo warehouse
    s.section(r++, t("СКЛАД FARGO — все товары", "FARGO WAREHOUSE — all products"), 2 + cols);
    const fOpen = r++, fIn = r++, fSold = r++, fWo = r++, fClose = r++, fCount = r++, fDiff = r++;
    s.v(fOpen, 1, t("На начало месяца (по учёту)", "Opening book stock"));
    each((x, i) => (i === 0 ? "0" : `${mcol(i - 1)}${fClose}`), fOpen);
    s.v(fIn, 1, t("+ Получено от TI", "+ Received from TI"));
    each((x) => `${x}${tiOut}`, fIn);
    s.v(fSold, 1, t("− Продано", "− Sold"));
    each((x) => `SUMIFS(${SA}$D:$D,${SA}$A:$A,${x}$3)`, fSold);
    s.v(fWo, 1, t("− Списано: просрочка, брак", "− Written off: expired, damaged"));
    each((x) => `SUMIFS(${FW}$D:$D,${FW}$B:$B,${x}$3)`, fWo);
    s.v(fClose, 1, t("На конец месяца (по учёту)", "Closing book stock"));
    each((x) => `${x}${fOpen}+${x}${fIn}-${x}${fSold}-${x}${fWo}`, fClose);
    s.bold(fClose, 2 + cols);
    s.v(fCount, 1, t("Пересчитано (инвентаризация)", "Counted (month-end count)"));
    each((x) => `IF(COUNTIFS(${SC}$A:$A,${x}$3,${SC}$D:$D,"<>0")=0,"",SUMIFS(${SC}$D:$D,${SC}$A:$A,${x}$3))`, fCount);
    s.v(fDiff, 1, t("Разница: учёт − пересчёт", "Difference: book − counted"));
    each((x) => `IF(${x}${fCount}="","",${x}${fClose}-${x}${fCount})`, fDiff);
    r++;
    // by product
    const block = (title: string, fn: (pk: string, x: string, k: number) => string, total: "sum" | "sumIfAny" = "sum") => {
      s.section(r++, title, 2 + cols);
      const firstRow = r;
      costProducts.forEach((pid, k) => {
        s.v(r, 1, key(pid));
        months.forEach((_, i) => s.f(r, 3 + i, fn(key(pid), mcol(i), k), UNITS));
        r++;
      });
      const lastRow = r - 1;
      s.v(r, 1, t("Итого", "Total"));
      months.forEach((_, i) => {
        const x = mcol(i);
        s.f(r, 3 + i, total === "sumIfAny" ? `IF(COUNT(${x}${firstRow}:${x}${lastRow})=0,"",SUM(${x}${firstRow}:${x}${lastRow}))` : `SUM(${x}${firstRow}:${x}${lastRow})`, UNITS);
      });
      s.bold(r, 2 + cols);
      r += 2;
      return firstRow;
    };
    block(t("TI ПО ТОВАРАМ — на складе TI", "TI STOCK BY PRODUCT"), (pk, x) =>
      `SUMIFS(${SHL("E")},${SHL("P")},${str(pk)},${SHL("B")},"<="&${x}$3,${SHL("C")},"ARRIVED")-SUMIFS(${IV}$F:$F,${IV}$M:$M,${str(pk)},${IV}$C:$C,"<="&${x}$3)-SUMIFS(${TW}$D:$D,${TW}$F:$F,${str(pk)},${TW}$B:$B,"<="&${x}$3)`);
    const bookFirst = block(t("FARGO ПО ТОВАРАМ — по учёту (получено − продано − списано)", "FARGO BOOK STOCK BY PRODUCT (received − sold − written off)"), (pk, x) =>
      `SUMIFS(${IV}$F:$F,${IV}$M:$M,${str(pk)},${IV}$C:$C,"<="&${x}$3)-SUMIFS(${SA}$D:$D,${SA}$K:$K,${str(pk)},${SA}$A:$A,"<="&${x}$3)-SUMIFS(${FW}$D:$D,${FW}$F:$F,${str(pk)},${FW}$B:$B,"<="&${x}$3)`);
    const countFirst = block(t("FARGO ПО ТОВАРАМ — пересчитано", "FARGO COUNTED BY PRODUCT"), (pk, x) =>
      `IF(COUNTIFS(${SC}$A:$A,${x}$3,${SC}$D:$D,"<>0")=0,"",SUMIFS(${SC}$D:$D,${SC}$E:$E,${str(pk)},${SC}$A:$A,${x}$3))`, "sumIfAny");
    const diffFirst = block(t("FARGO ПО ТОВАРАМ — разница учёт − пересчёт (в месяцы инвентаризации)", "FARGO DIFFERENCE BY PRODUCT: book − counted (count months)"), (_pk, x, k) =>
      `IF(${x}${countFirst + k}="","",${x}${bookFirst + k}-${x}${countFirst + k})`, "sumIfAny");
    s.section(r++, t("РАЗНИЦА НА ДАТУ — по последней инвентаризации (используется в FIFO)", "DIFFERENCE TO DATE — latest count (used in COGS)"), 2 + cols);
    costProducts.forEach((pid, k) => {
      s.v(r, 1, key(pid));
      stockDiffRow.set(pid, r);
      months.forEach((_, i) => {
        const x = mcol(i);
        const d = `${x}${diffFirst + k}`;
        s.f(r, 3 + i, i === 0 ? `IF(${d}="",0,${d})` : `IF(${d}="",${mcol(i - 1)}${r},${d})`, UNITS);
      });
      r++;
    });
    s.widths([40, 2, ...months.map(() => 11)]);
    s.freeze(2, 3);
  }
  const ST = Q("stock");

  // ═══════════════════════ COGS (FIFO) ═══════════════════════
  {
    const s = S.cogs;
    s.title(t("Себестоимость FIFO: фуры → поставки TI → продажи Fargo", "COGS — FIFO: trucks → TI deliveries → Fargo sales"));
    s.v(2, 1, t("ИТОГО — все товары", "SUMMARY — all products")).font = { bold: true };
    months.forEach((m, i) => s.v(3, 3 + i, ym(m), MONTHFMT));
    const blocksFirst = COGS_UNIT_FIRST + costProducts.length + 2;
    const MR = (col: string) => `$${col}$${blocksFirst}:$${col}$5000`;
    const summary: Array<[number, string, (x: string) => string]> = [
      [4, t("TI: себестоимость поставленного Fargo (FIFO по фурам)", "TI: cost of goods delivered to Fargo (FIFO by truck)"), (x) => `SUMIFS(${IV}$O:$O,${IV}$C:$C,${x}$3)`],
      [5, t("TI: себестоимость образцов", "TI: cost of free samples"), (x) => `SUMIFS(${TW}$H:$H,${TW}$B:$B,${x}$3)`],
      [6, t("Fargo: себестоимость продаж (цены счетов TI)", "Fargo: cost of goods sold (TI invoice prices)"), (x) => `SUMIFS(${MR("Q")},${MR("A")},${x}$3)`],
      [7, t("Fargo: списания (цены счетов TI)", "Fargo: write-offs (TI invoice prices)"), (x) => `SUMIFS(${MR("R")},${MR("A")},${x}$3)`],
      [8, t("Fargo: потери по инвентаризации (цены счетов TI)", "Fargo: stock loss at the count (TI invoice prices)"), (x) => `SUMIFS(${MR("S")},${MR("A")},${x}$3)`],
      [9, t("Группа: себестоимость продаж (себестоимость TI)", "Group: cost of goods sold (TI landed cost)"), (x) => `SUMIFS(${MR("T")},${MR("A")},${x}$3)`],
      [10, t("Группа: списания (себестоимость TI)", "Group: write-offs (TI landed cost)"), (x) => `SUMIFS(${MR("U")},${MR("A")},${x}$3)`],
      [11, t("Группа: потери по инвентаризации (себестоимость TI)", "Group: stock loss at the count (TI landed cost)"), (x) => `SUMIFS(${MR("V")},${MR("A")},${x}$3)`],
      [13, t("Товар у TI на конец месяца (себестоимость)", "TI stock at month-end (landed cost)"), (x) => `SUMIFS(${SHT("J")},${SHT("B")},"<="&${x}$3,${SHT("C")},"ARRIVED")-SUMIFS(${IV}$O:$O,${IV}$C:$C,"<="&${x}$3)-SUMIFS(${TW}$H:$H,${TW}$B:$B,"<="&${x}$3)`],
      [14, t("Товар у Fargo на конец месяца (цены счетов TI)", "Fargo stock at month-end (TI invoice prices)"), (x) => `SUMIFS(${MR("Z")},${MR("A")},${x}$3)`],
      [15, t("Товар у Fargo на конец месяца (себестоимость TI)", "Fargo stock at month-end (TI landed cost)"), (x) => `SUMIFS(${MR("AA")},${MR("A")},${x}$3)`],
    ];
    for (const [r, label, fn] of summary) {
      s.v(r, 1, label);
      months.forEach((_, i) => s.f(r, 3 + i, fn(mcol(i)), MONEY));
    }
    s.v(COGS_UNIT_FIRST - 1, 1, t("СЕБЕСТОИМОСТЬ FARGO ЗА ПРОДАННУЮ ШТУКУ (используется в «Продажах»)", "FARGO FIFO COST PER UNIT SOLD (used in «Sales»)")).font = { bold: true };

    let r = blocksFirst;
    const head = (labels: string[]) => {
      s.header(r, labels);
      r++;
    };
    const curve = (x: string, unit: string, cu: string, cv: string) =>
      `IF(${x}<=0,${x}*INDEX(${unit},1),INDEX(${cv},MATCH(${x},${cu},1))+(${x}-INDEX(${cu},MATCH(${x},${cu},1)))*INDEX(${unit},MATCH(${x},${cu},1)))`;

    costProducts.forEach((pid, pIndex) => {
      const pk = key(pid);
      s.section(r++, pk.toUpperCase(), 28);
      // 1) TI batches
      s.v(r++, 1, t("1) Партии TI — строки фур в порядке прибытия", "1) TI batches — truck lines in arrival order")).font = { italic: true };
      head(["#", t("Фура", "Truck"), t("Месяц прибытия", "Arrival month"), t("Штук", "Units"), t("Себестоимость", "Landed value"), t("За шт", "Unit cost"), t("Штук до", "Cum units before"), t("Сумма до", "Cum value before")]);
      const batches = arrived.flatMap((sh) => sh.lines.filter((l) => l.inFifo && l.costProductId === pid).map((l) => ({ sh, l })));
      const bFirst = r;
      batches.forEach(({ l }, k) => {
        const lr = shipLineRow.get(l.id)!;
        s.v(r, 1, k + 1);
        s.f(r, 2, `${SH}A${lr}`);
        s.f(r, 3, `${SH}B${lr}`, MONTHFMT);
        s.f(r, 4, `${SH}E${lr}`, UNITS);
        s.f(r, 5, `${SH}M${lr}`, MONEY);
        s.f(r, 6, `IFERROR(E${r}/D${r},0)`, UNIT2);
        s.v(r, 7, k === 0 ? 0 : null);
        s.v(r, 8, k === 0 ? 0 : null);
        if (k > 0) {
          s.f(r, 7, `G${r - 1}+D${r - 1}`, UNITS);
          s.f(r, 8, `H${r - 1}+E${r - 1}`, MONEY);
        }
        r++;
      });
      const bLast = r - 1;
      // one batch: every unit at its cost (also beyond it, as the engine continues at the last batch)
      const tiCurve = (x: string) => (batches.length === 0 ? "0" : batches.length === 1 ? `${x}*$F${bFirst}` : curve(x, `$F${bFirst}:$F${bLast}`, `$G${bFirst}:$G${bLast}`, `$H${bFirst}:$H${bLast}`));
      r++;
      // 2) deliveries to Fargo
      s.v(r++, 1, t("2) Поставки Fargo — строки счетов TI по порядку (себестоимость TI по FIFO; партии Fargo)", "2) Deliveries to Fargo — TI invoice lines in order (TI cost by FIFO; Fargo's batches)")).font = { italic: true };
      head([t("Строка", "Line"), t("Дата", "Date"), t("№ счёта", "Invoice №"), t("Штук", "Units"), t("Вне FIFO", "Outside TI FIFO"), t("Своя себест., шт", "Own unit cost"), t("Позиция TI до", "TI position before"), t("Позиция TI после", "TI position after"), t("СЕБЕСТОИМОСТЬ TI", "TI COST"), t("Себест. TI, шт", "TI unit cost"), t("Стоимость по счёту (без НДС)", "Invoice value (ex-VAT)"), t("Цена за шт", "Invoice unit price"), t("Fargo: штук до", "Fargo: cum units before"), t("Fargo: сумма до", "Fargo: cum invoice value before"), t("Fargo: себест. TI до", "Fargo: cum TI cost before")]);
      const lines = invLines.filter((l) => l.costProductId === pid);
      const dFirst = r;
      lines.forEach((l, k) => {
        const ir = invRow.get(l.id)!;
        s.f(r, 1, `${IV}A${ir}`);
        s.f(r, 2, `${IV}B${ir}`, DATE);
        s.f(r, 3, `${IV}D${ir}`);
        s.f(r, 4, `${IV}F${ir}`, UNITS);
        s.f(r, 5, `${IV}K${ir}`);
        s.f(r, 6, `IF(${IV}L${ir}="","",${IV}L${ir})`, MONEY);
        // TI position: earlier in-FIFO invoice lines of the product, plus samples given before this date
        s.f(r, 7, `SUMIFS(${IV}$F:$F,${IV}$M:$M,${str(pk)},${IV}$K:$K,0,${IV}$A:$A,"<"&A${r})+SUMIFS(${TW}$D:$D,${TW}$F:$F,${str(pk)},${TW}$A:$A,"<"&B${r})`, UNITS);
        s.f(r, 8, `G${r}+IF(E${r}=1,0,D${r})`, UNITS);
        s.f(r, 9, `IF(E${r}=1,D${r}*F${r},${tiCurve(`H${r}`)}-${tiCurve(`G${r}`)})`, MONEY);
        s.f(r, 10, `IFERROR(I${r}/D${r},0)`, UNIT2);
        s.f(r, 11, `${IV}H${ir}`, MONEY);
        s.f(r, 12, `IFERROR(K${r}/D${r},0)`, UNIT2);
        if (k === 0) {
          s.v(r, 13, 0);
          s.v(r, 14, 0);
          s.v(r, 15, 0);
        } else {
          s.f(r, 13, `M${r - 1}+D${r - 1}`, UNITS);
          s.f(r, 14, `N${r - 1}+K${r - 1}`, MONEY);
          s.f(r, 15, `O${r - 1}+I${r - 1}`, MONEY);
        }
        S.inv.f(ir, 14, `${Q("cogs")}J${r}`, UNIT2);
        r++;
      });
      const dLast = r - 1;
      const fargoAt = (x: string, unitCol: "L" | "J", cumCol: "N" | "O") =>
        lines.length === 0 ? "0" : lines.length === 1 ? `${x}*${unitCol}${dFirst}` : curve(x, `${unitCol}${dFirst}:${unitCol}${dLast}`, `$M${dFirst}:$M${dLast}`, `${cumCol}${dFirst}:${cumCol}${dLast}`);
      r++;
      // 3) TI samples
      s.v(r++, 1, t("3) Образцы TI — после счетов до их даты", "3) Free samples (TI write-offs) — after the deliveries up to their date")).font = { italic: true };
      head([t("Порядок", "Order"), t("Дата", "Date"), t("Причина", "Reason"), t("Штук", "Units"), "", "", t("Позиция TI до", "TI position before"), t("Позиция TI после", "TI position after"), t("СЕБЕСТОИМОСТЬ TI", "TI COST"), t("Себест. TI, шт", "TI unit cost")]);
      for (const w of tiWo.filter((x) => costIdOf(x.productId) === pid)) {
        const wr = tiWoRow.get(w.id)!;
        s.f(r, 1, `${TW}I${wr}`);
        s.f(r, 2, `${TW}A${wr}`, DATE);
        s.f(r, 3, `${TW}E${wr}`);
        s.f(r, 4, `${TW}D${wr}`, UNITS);
        s.f(r, 7, `SUMIFS(${IV}$F:$F,${IV}$M:$M,${str(pk)},${IV}$K:$K,0,${IV}$B:$B,"<="&B${r})+SUMIFS(${TW}$D:$D,${TW}$F:$F,${str(pk)},${TW}$I:$I,"<"&A${r})`, UNITS);
        s.f(r, 8, `G${r}+D${r}`, UNITS);
        s.f(r, 9, `${tiCurve(`H${r}`)}-${tiCurve(`G${r}`)}`, MONEY);
        s.f(r, 10, `IFERROR(I${r}/D${r},0)`, UNIT2);
        S.tiWo.f(wr, 7, `${Q("cogs")}J${r}`, UNIT2);
        r++;
      }
      r++;
      // 4) Fargo by month
      s.v(r++, 1, t("4) Fargo по месяцам — продажи, затем списания, затем разница по инвентаризации расходуют поставки по порядку", "4) Fargo by month — sales, then write-offs, then the count difference use up the deliveries in order")).font = { italic: true };
      head([
        t("Месяц", "Month"), t("Продано, шт", "Units sold"), t("Продано с начала", "Cum units sold"), t("Разница на дату", "Count difference to date"), t("Разница прошлого месяца", "Count difference, previous month"),
        t("Списано, шт", "Written off"), t("Списано с начала", "Cum written off"), t("Позиция после продаж", "Position after sales"), t("Позиция после списаний", "Position after write-offs"), t("Позиция после инвентаризации", "Position after count"),
        t("Цены счетов: после продаж", "Invoice prices: after sales"), t("Цены счетов: после списаний", "Invoice prices: after write-offs"), t("Цены счетов: после инвентаризации", "Invoice prices: after count"),
        t("Себест. TI: после продаж", "TI cost: after sales"), t("Себест. TI: после списаний", "TI cost: after write-offs"), t("Себест. TI: после инвентаризации", "TI cost: after count"),
        t("СЕБЕСТОИМОСТЬ FARGO", "FARGO COGS"), t("Списания Fargo", "Fargo write-offs"), t("Потери Fargo", "Fargo stock loss"), t("СЕБЕСТОИМОСТЬ ГРУППЫ", "GROUP COGS"), t("Списания группы", "Group write-offs"), t("Потери группы", "Group stock loss"),
        t("Себест. Fargo за проданную шт", "Fargo cost per unit sold"), t("Получено: по ценам счетов", "Received to date: invoice value"), t("Получено: себест. TI", "Received to date: TI cost"), t("Товар Fargo: цены счетов", "Fargo stock: invoice prices"), t("Товар Fargo: себест. TI", "Fargo stock: TI cost"), t("Товар", "Product"),
      ]);
      const diffRow = stockDiffRow.get(pid)!;
      const mFirst = r;
      months.forEach((m, i) => {
        const prev = r - 1;
        s.v(r, 1, ym(m), MONTHFMT);
        s.f(r, 2, i === 0 ? `C${r}` : `C${r}-C${prev}`, UNITS);
        s.f(r, 3, `SUMIFS(${SA}$D:$D,${SA}$K:$K,${str(pk)},${SA}$A:$A,"<="&A${r})`, UNITS);
        s.f(r, 4, `${ST}${mcol(i)}${diffRow}`, UNITS);
        if (i === 0) s.v(r, 5, 0);
        else s.f(r, 5, `D${prev}`, UNITS);
        s.f(r, 6, `SUMIFS(${FW}$D:$D,${FW}$F:$F,${str(pk)},${FW}$B:$B,A${r})`, UNITS);
        s.f(r, 7, i === 0 ? `F${r}` : `G${prev}+F${r}`, UNITS);
        s.f(r, 8, `C${r}+G${r}-F${r}+E${r}`, UNITS);
        s.f(r, 9, `C${r}+G${r}+E${r}`, UNITS);
        s.f(r, 10, `C${r}+G${r}+D${r}`, UNITS);
        s.f(r, 11, fargoAt(`H${r}`, "L", "N"), MONEY);
        s.f(r, 12, fargoAt(`I${r}`, "L", "N"), MONEY);
        s.f(r, 13, fargoAt(`J${r}`, "L", "N"), MONEY);
        s.f(r, 14, fargoAt(`H${r}`, "J", "O"), MONEY);
        s.f(r, 15, fargoAt(`I${r}`, "J", "O"), MONEY);
        s.f(r, 16, fargoAt(`J${r}`, "J", "O"), MONEY);
        s.f(r, 17, i === 0 ? `K${r}` : `K${r}-M${prev}`, MONEY);
        s.f(r, 18, `L${r}-K${r}`, MONEY);
        s.f(r, 19, `M${r}-L${r}`, MONEY);
        s.f(r, 20, i === 0 ? `N${r}` : `N${r}-P${prev}`, MONEY);
        s.f(r, 21, `O${r}-N${r}`, MONEY);
        s.f(r, 22, `P${r}-O${r}`, MONEY);
        s.f(r, 23, `IFERROR(Q${r}/B${r},0)`, UNIT2);
        s.f(r, 24, `SUMIFS(${IV}$H:$H,${IV}$M:$M,${str(pk)},${IV}$C:$C,"<="&A${r})`, MONEY);
        s.f(r, 25, `SUMIFS(${IV}$O:$O,${IV}$M:$M,${str(pk)},${IV}$C:$C,"<="&A${r})`, MONEY);
        s.f(r, 26, `X${r}-M${r}`, MONEY);
        s.f(r, 27, `Y${r}-P${r}`, MONEY);
        s.v(r, 28, pk);
        r++;
      });
      // the unit-cost table up top reads this block's months
      const ur = COGS_UNIT_FIRST + pIndex;
      s.v(ur, 1, pk);
      months.forEach((_, i) => s.f(ur, 3 + i, `W${mFirst + i}`, UNIT2));
      r += 2;
    });
    s.widths([24, 13, 13, 13, 12, 12, 13, 13, 13, 13, ...Array(18).fill(15)]);
    s.freeze(1, 3);
  }

  // ═══════════════════════ statements ═══════════════════════
  const rowsOf = {} as Record<"plTi" | "plFg" | "plGr" | "bsTi" | "bsFg" | "bsGr", Record<string, number>>;
  const R = (sheet: keyof typeof rowsOf, id: string) => {
    const r = rowsOf[sheet]?.[id];
    if (!r) throw new Error(`no row ${sheet}.${id}`);
    return r;
  };
  const layout = (sheet: keyof typeof rowsOf, lines: Line[]) => {
    const map: Record<string, number> = {};
    let r = 4;
    lines.forEach((l) => {
      if (l.kind === "head" && r > 4) r++;
      (l as Line & { row: number }).row = r;
      if (l.id) map[l.id] = r;
      r++;
    });
    rowsOf[sheet] = map;
    return lines as Array<Line & { row: number }>;
  };
  const ei = (m: string) => c.monthIds.indexOf(m);
  const writeStatement = (
    k: keyof typeof rowsOf,
    sheetKey: SheetKey,
    title: string,
    lines: Array<Line & { row: number }>,
    ms: string[],
    position: boolean,
    val: Record<string, (i: number) => number>
  ) => {
    const s = S[sheetKey];
    const last = L(2 + ms.length);
    // the app's figures, stored with the formulas (they are the same — the App check tab proves it)
    const monthValue = (id: string | undefined, m: string) => (id && val[id] ? val[id](ei(m)) : undefined);
    const total = (l: Line) => {
      if (!l.id || !val[l.id]) return undefined;
      if (l.b === "last" || (position && l.b !== "sum")) return ms.includes(reportMonth) ? val[l.id](ei(reportMonth)) : 0;
      return ms.reduce((sum, m) => sum + val[l.id!](ei(m)), 0);
    };
    const ratio = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined ? undefined : b ? a / b : 0);
    s.title(title);
    s.f(3, 2, position ? `${str(t("На ", "At "))}&TEXT(REPORT_TO,"0000-00")` : `${str(t("Итого по ", "Total to "))}&TEXT(REPORT_TO,"0000-00")`, undefined, `${position ? t("На ", "At ") : t("Итого по ", "Total to ")}${reportMonth}`);
    s.cell(3, 2).font = { bold: true };
    ms.forEach((m, i) => {
      const cell = s.v(3, 3 + i, ym(m), MONTHFMT);
      cell.font = { bold: true };
      cell.alignment = { horizontal: "right" };
    });
    for (const l of lines) {
      if (l.kind === "head") {
        s.section(l.row, l.label, 2 + ms.length);
        continue;
      }
      s.v(l.row, 1, l.label);
      const fmt = l.fmt ?? (l.kind === "ratio" ? PCT : MONEY);
      ms.forEach((m, i) => {
        const result = l.kind === "ratio" && l.ratio ? ratio(monthValue(l.ratio[0], m), monthValue(l.ratio[1], m)) : monthValue(l.id, m);
        if (l.f) s.f(l.row, 3 + i, l.f(L(3 + i), i), fmt, result);
      });
      if (l.kind === "ratio" && l.ratio) {
        const [a, b] = l.ratio.map((id) => lines.find((x) => x.id === id)!);
        s.f(l.row, 2, `IFERROR(B${R(k, l.ratio[0])}/B${R(k, l.ratio[1])},0)`, PCT, ratio(total(a), total(b)));
      } else if (l.b === "last" || (position && l.b !== "sum" && l.b !== null)) s.f(l.row, 2, `IFERROR(INDEX($C${l.row}:${last}${l.row},MATCH(REPORT_TO,$C$3:${last}$3,0)),0)`, fmt, total(l));
      else if (l.b !== null) s.f(l.row, 2, `SUMIFS($C${l.row}:${last}${l.row},$C$3:${last}$3,"<="&REPORT_TO)`, fmt, total(l));
      if (l.kind === "sub" || l.kind === "total") s.bold(l.row, 2 + ms.length);
      if (l.kind === "memo" || l.kind === "ratio") for (let col = 1; col <= 2 + ms.length; col++) s.cell(l.row, col).font = { italic: true, color: { argb: "FF64748B" } };
    }
    s.widths([62, 18, ...ms.map(() => 15)]);
    s.freeze(2, 3);
  };

  const OT = Q("opexTi");
  const OF = Q("opexFg");
  const TX = Q("tax");
  const VC = Q("vatCh");
  const CG = Q("cogs");
  const woLabel = group(FARGO_WRITEOFF_GROUP);

  // P&L TI
  const plTi = layout("plTi", [
    { kind: "head", label: t("ВЫРУЧКА (без НДС)", "REVENUE (ex-VAT)") },
    { id: "rev", kind: "line", label: t("Продажи Fargo (счета-фактуры, без НДС)", "Sales to Fargo (invoices, ex-VAT)"), f: (x) => `SUMIFS(${IV}$H:$H,${IV}$C:$C,${x}$3)` },
    { id: "units", kind: "memo", label: t("Отгружено, шт.", "Units delivered"), f: (x) => `SUMIFS(${IV}$F:$F,${IV}$C:$C,${x}$3)`, fmt: UNITS },
    { id: "cogs", kind: "line", label: t("− Себестоимость (FIFO по фурам)", "− Cost of goods (FIFO by truck)"), f: (x) => `${CG}${x}4` },
    { id: "samples", kind: "line", label: t("− Товар, переданный бесплатно (образцы и лаборатория)", "− Goods given away (samples and laboratory)"), f: (x) => `${CG}${x}5` },
    { id: "gross", kind: "sub", label: t("ВАЛОВАЯ ПРИБЫЛЬ", "GROSS PROFIT"), f: (x) => `${x}${R("plTi", "rev")}-${x}${R("plTi", "cogs")}-${x}${R("plTi", "samples")}` },
    { kind: "ratio", label: t("валовая маржа", "gross margin"), f: (x) => `IFERROR(${x}${R("plTi", "gross")}/${x}${R("plTi", "rev")},0)`, ratio: ["gross", "rev"] },
    { kind: "head", label: t("ОПЕРАЦИОННЫЕ РАСХОДЫ", "OPERATING EXPENSES") },
    ...TI_GROUPS.map((g, gi): Line => ({ id: `g${gi}`, kind: "line", label: GROUP_LABELS[g][locale], f: (x) => `SUMIFS(${OT}$F:$F,${OT}$A:$A,${x}$3,${OT}$C:$C,${str(group(g))})` })),
    { id: "gx", kind: "line", label: t("⚠ Не попало в группы выше", "⚠ Not in the groups above"), f: (x) => `SUMIFS(${OT}$F:$F,${OT}$A:$A,${x}$3)-SUM(${x}${R("plTi", "g0")}:${x}${R("plTi", `g${TI_GROUPS.length - 1}`)})` },
    { id: "opex", kind: "sub", label: t("Итого операционные расходы", "Total operating expenses"), f: (x) => `SUM(${x}${R("plTi", "g0")}:${x}${R("plTi", "gx")})` },
    { id: "ebitda", kind: "sub", label: "EBITDA", f: (x) => `${x}${R("plTi", "gross")}-${x}${R("plTi", "opex")}` },
    { kind: "ratio", label: t("маржа EBITDA", "EBITDA margin"), f: (x) => `IFERROR(${x}${R("plTi", "ebitda")}/${x}${R("plTi", "rev")},0)`, ratio: ["ebitda", "rev"] },
    { kind: "head", label: t("НАЛОГИ", "TAXES") },
    { id: "ptax", kind: "line", label: t("Налог на прибыль TI (по декларациям)", "TI profit tax (as filed)"), f: (x) => `SUMIFS(${TX}$C:$C,${TX}$B:$B,${x}$3)` },
    { id: "vatcost", kind: "line", label: t("НДС за счёт TI (вне счетов Fargo)", "VAT borne by TI (outside the Fargo invoices)"), f: (x) => `SUMIFS(${VC}$C:$C,${VC}$A:$A,${x}$3,${VC}$D:$D,"TI")` },
    { id: "net", kind: "total", label: t("ЧИСТАЯ ПРИБЫЛЬ — TURBO IMPEX", "NET PROFIT — TURBO IMPEX"), f: (x) => `${x}${R("plTi", "ebitda")}-${x}${R("plTi", "ptax")}-${x}${R("plTi", "vatcost")}` },
    { kind: "ratio", label: t("чистая маржа", "net margin"), f: (x) => `IFERROR(${x}${R("plTi", "net")}/${x}${R("plTi", "rev")},0)`, ratio: ["net", "rev"] },
  ]);

  // P&L Fargo
  const plFg = layout("plFg", [
    { kind: "head", label: t("ВЫРУЧКА (без НДС)", "REVENUE (ex-VAT)") },
    { id: "bank", kind: "line", label: t("Продажи по перечислению (цена ÷ 1,12)", "Bank sales (price ÷ 1.12)"), f: (x) => `SUMIFS(${SA}$J:$J,${SA}$A:$A,${x}$3)-SUMIFS(${SA}$N:$N,${SA}$A:$A,${x}$3)` },
    { id: "cash", kind: "line", label: t("Продажи за наличные (цена − НДС с декларируемой стоимости)", "Cash sales (price − VAT on the declared value)"), f: (x) => `SUMIFS(${SA}$I:$I,${SA}$A:$A,${x}$3)-SUMIFS(${SA}$O:$O,${SA}$A:$A,${x}$3)` },
    { id: "rev", kind: "sub", label: t("Выручка", "Revenue"), f: (x) => `${x}${R("plFg", "bank")}+${x}${R("plFg", "cash")}` },
    { id: "atPrice", kind: "memo", label: t("Справочно: продажи по ценам покупателям (с НДС)", "Memo: sales at customer prices (VAT included)"), f: (x) => `SUMIFS(${SA}$G:$G,${SA}$A:$A,${x}$3)` },
    { id: "units", kind: "memo", label: t("Продано, шт.", "Units sold"), f: (x) => `SUMIFS(${SA}$D:$D,${SA}$A:$A,${x}$3)`, fmt: UNITS },
    { id: "cogs", kind: "line", label: t("− Себестоимость (FIFO по счетам TI)", "− Cost of goods (FIFO by TI invoice)"), f: (x) => `${CG}${x}6` },
    { id: "wo", kind: "line", label: t("− Списания: просрочка, брак (по ценам счетов TI)", "− Write-offs: expired, damaged (TI invoice prices)"), f: (x) => `${CG}${x}7` },
    { id: "loss", kind: "line", label: t("− Потери товара по инвентаризации (по ценам счетов TI)", "− Stock loss at the count (TI invoice prices)"), f: (x) => `${CG}${x}8` },
    { id: "woRec", kind: "memo", label: t("в т.ч. списания, учтённые Fargo в расходах", "of which write-offs Fargo booked as expenses"), f: (x) => `SUMIFS(${OF}$D:$D,${OF}$A:$A,${x}$3,${OF}$C:$C,${str(woLabel)})` },
    { id: "gross", kind: "sub", label: t("ВАЛОВАЯ ПРИБЫЛЬ", "GROSS PROFIT"), f: (x) => `${x}${R("plFg", "rev")}-${x}${R("plFg", "cogs")}-${x}${R("plFg", "wo")}-${x}${R("plFg", "loss")}` },
    { kind: "ratio", label: t("валовая маржа", "gross margin"), f: (x) => `IFERROR(${x}${R("plFg", "gross")}/${x}${R("plFg", "rev")},0)`, ratio: ["gross", "rev"] },
    { kind: "head", label: t("ОПЕРАЦИОННЫЕ РАСХОДЫ — FARGO (вкл. ретро-бонусы)", "OPERATING EXPENSES — FARGO (incl. retro bonuses)") },
    ...FARGO_GROUPS.map((g, gi): Line => ({ id: `g${gi}`, kind: "line", label: GROUP_LABELS[g][locale], f: (x) => `SUMIFS(${OF}$D:$D,${OF}$A:$A,${x}$3,${OF}$C:$C,${str(group(g))})` })),
    { id: "gx", kind: "line", label: t("⚠ Не попало в группы выше", "⚠ Not in the groups above"), f: (x) => `SUMIFS(${OF}$D:$D,${OF}$A:$A,${x}$3)-${x}${R("plFg", "woRec")}-SUM(${x}${R("plFg", "g0")}:${x}${R("plFg", `g${FARGO_GROUPS.length - 1}`)})` },
    { id: "opex", kind: "sub", label: t("Итого операционные расходы", "Total operating expenses"), f: (x) => `SUM(${x}${R("plFg", "g0")}:${x}${R("plFg", "gx")})` },
    { id: "ebitda", kind: "sub", label: "EBITDA", f: (x) => `${x}${R("plFg", "gross")}-${x}${R("plFg", "opex")}` },
    { kind: "ratio", label: t("маржа EBITDA", "EBITDA margin"), f: (x) => `IFERROR(${x}${R("plFg", "ebitda")}/${x}${R("plFg", "rev")},0)`, ratio: ["ebitda", "rev"] },
    { id: "tax", kind: "line", label: t("Налог (1,9% от оборота по ценам покупателям)", "Turnover tax (1.9% of sales at customer prices)"), f: (x) => `SUMIFS(${SA}$P:$P,${SA}$A:$A,${x}$3)` },
    { id: "net", kind: "total", label: t("ЧИСТАЯ ПРИБЫЛЬ — FARGO (Humana)", "NET PROFIT — FARGO (Humana)"), f: (x) => `${x}${R("plFg", "ebitda")}-${x}${R("plFg", "tax")}` },
    { kind: "ratio", label: t("чистая маржа", "net margin"), f: (x) => `IFERROR(${x}${R("plFg", "net")}/${x}${R("plFg", "rev")},0)`, ratio: ["net", "rev"] },
    { kind: "head", label: t("НДС — FARGO", "VAT — FARGO") },
    { id: "vin", kind: "line", label: t("НДС к зачёту — полученные счета TI", "Input VAT — TI invoices received"), f: (x) => `SUMIFS(${IV}$I:$I,${IV}$C:$C,${x}$3)` },
    { id: "vbank", kind: "line", label: t("Начисленный НДС — перечисление (12/112 от цены)", "Output VAT — bank (12/112 of the price)"), f: (x) => `SUMIFS(${SA}$N:$N,${SA}$A:$A,${x}$3)` },
    { id: "vcash", kind: "line", label: t("Начисленный НДС — наличные (12% от декларируемых продаж)", "Output VAT — cash (12% of declared sales)"), f: (x) => `SUMIFS(${SA}$O:$O,${SA}$A:$A,${x}$3)` },
    { id: "vnet", kind: "sub", label: t("НДС за месяц (начислено − зачёт)", "VAT for the month (output − input)"), f: (x) => `${x}${R("plFg", "vbank")}+${x}${R("plFg", "vcash")}-${x}${R("plFg", "vin")}` },
    { id: "vpaid", kind: "line", label: t("НДС уплачен в бюджет (после переноса переплаты)", "VAT paid to the budget (after the credit carried)"), f: (x, i) => `MAX(0,${x}${R("plFg", "vnet")}-${i === 0 ? "0" : `${L(2 + i)}${R("plFg", "vcredit")}`})` },
    { id: "vcredit", kind: "line", label: t("Переплата НДС на конец месяца", "VAT credit at month-end"), b: "last", f: (x, i) => `MAX(0,${i === 0 ? "0" : `${L(2 + i)}${R("plFg", "vcredit")}`}-${x}${R("plFg", "vnet")})` },
  ]);

  // P&L Consolidated
  const PF = Q("plFg");
  const PT = Q("plTi");
  const plGr = layout("plGr", [
    { kind: "head", label: t("ВЫРУЧКА (внешние продажи, без НДС)", "REVENUE (external sales, ex-VAT)") },
    { id: "bank", kind: "line", label: t("Продажи по перечислению", "Bank sales"), f: (x) => `${PF}${x}${R("plFg", "bank")}` },
    { id: "cash", kind: "line", label: t("Продажи за наличные", "Cash sales"), f: (x) => `${PF}${x}${R("plFg", "cash")}` },
    { id: "rev", kind: "sub", label: t("Выручка", "Revenue"), f: (x) => `${x}${R("plGr", "bank")}+${x}${R("plGr", "cash")}` },
    { id: "units", kind: "memo", label: t("Продано, шт.", "Units sold"), f: (x) => `${PF}${x}${R("plFg", "units")}`, fmt: UNITS },
    { id: "cogs", kind: "line", label: t("− Себестоимость (FIFO по себестоимости TI)", "− Cost of goods (FIFO at TI landed cost)"), f: (x) => `${CG}${x}9` },
    { id: "samples", kind: "line", label: t("− Товар, переданный бесплатно (образцы и лаборатория)", "− Goods given away (samples and laboratory)"), f: (x) => `${PT}${x}${R("plTi", "samples")}` },
    { id: "wo", kind: "line", label: t("− Списания Fargo: просрочка, брак (по себестоимости TI)", "− Fargo write-offs: expired, damaged (TI landed cost)"), f: (x) => `${CG}${x}10` },
    { id: "loss", kind: "line", label: t("− Потери товара по инвентаризации (по себестоимости TI)", "− Stock loss at the count (TI landed cost)"), f: (x) => `${CG}${x}11` },
    { id: "gross", kind: "sub", label: t("ВАЛОВАЯ ПРИБЫЛЬ", "GROSS PROFIT"), f: (x) => `${x}${R("plGr", "rev")}-${x}${R("plGr", "cogs")}-${x}${R("plGr", "samples")}-${x}${R("plGr", "wo")}-${x}${R("plGr", "loss")}` },
    { kind: "ratio", label: t("валовая маржа", "gross margin"), f: (x) => `IFERROR(${x}${R("plGr", "gross")}/${x}${R("plGr", "rev")},0)`, ratio: ["gross", "rev"] },
    { kind: "head", label: t("ОПЕРАЦИОННЫЕ РАСХОДЫ", "OPERATING EXPENSES") },
    { id: "opexTi", kind: "line", label: t("Расходы Turbo Impex", "Turbo Impex expenses"), f: (x) => `${PT}${x}${R("plTi", "opex")}` },
    { id: "opexFg", kind: "line", label: t("Расходы Fargo (вкл. ретро-бонусы)", "Fargo expenses (incl. retro bonuses)"), f: (x) => `${PF}${x}${R("plFg", "opex")}` },
    { id: "opex", kind: "sub", label: t("Итого операционные расходы", "Total operating expenses"), f: (x) => `${x}${R("plGr", "opexTi")}+${x}${R("plGr", "opexFg")}` },
    { id: "ebitda", kind: "sub", label: "EBITDA", f: (x) => `${x}${R("plGr", "gross")}-${x}${R("plGr", "opex")}` },
    { kind: "ratio", label: t("маржа EBITDA", "EBITDA margin"), f: (x) => `IFERROR(${x}${R("plGr", "ebitda")}/${x}${R("plGr", "rev")},0)`, ratio: ["ebitda", "rev"] },
    { kind: "head", label: t("НАЛОГИ", "TAXES") },
    { id: "tFg", kind: "line", label: t("Оборотный налог Fargo (1,9%)", "Fargo turnover tax (1.9%)"), f: (x) => `${PF}${x}${R("plFg", "tax")}` },
    { id: "tTi", kind: "line", label: t("Налог на прибыль TI (по декларациям)", "TI profit tax (as filed)"), f: (x) => `${PT}${x}${R("plTi", "ptax")}` },
    { id: "tVat", kind: "line", label: t("НДС за счёт TI", "VAT borne by TI"), f: (x) => `${PT}${x}${R("plTi", "vatcost")}` },
    { id: "taxes", kind: "sub", label: t("Итого налоги", "Total taxes"), f: (x) => `${x}${R("plGr", "tFg")}+${x}${R("plGr", "tTi")}+${x}${R("plGr", "tVat")}` },
    { id: "net", kind: "total", label: t("ЧИСТАЯ ПРИБЫЛЬ — КОНСОЛИДИРОВАННАЯ", "NET PROFIT — CONSOLIDATED"), f: (x) => `${x}${R("plGr", "ebitda")}-${x}${R("plGr", "taxes")}` },
    { kind: "ratio", label: t("чистая маржа", "net margin"), f: (x) => `IFERROR(${x}${R("plGr", "net")}/${x}${R("plGr", "rev")},0)`, ratio: ["net", "rev"] },
  ]);

  // balance sheets: TI and the group need the month-end money; Fargo every month
  const withInputs = new Set(ds.monthBalances.map((b) => b.monthId));
  const bsMonths = months.filter((m) => withInputs.has(m));
  const MB = Q("mb");
  const VA = Q("vat");
  const PO = Q("prior");
  const LO = Q("loans");
  const OR = Q("other");
  const SE = Q("shipExp");
  const CP = Q("cap");
  const TRF = Q("tr");
  const AR = Q("ar");
  const vatBal = (x: string) => `(SUMIFS(${VA}$E:$E,${VA}$A:$A,"<="&${x}$3)-SUMIFS(${VA}$D:$D,${VA}$A:$A,"<="&${x}$3)+SUMIFS(${VA}$F:$F,${VA}$A:$A,"<="&${x}$3)-SUMIFS(${VA}$G:$G,${VA}$A:$A,"<="&${x}$3))`;
  const atMonth = (sheet: string, row: number, x: string, last = lastCol) => `INDEX(${sheet}$C$${row}:$${last}$${row},MATCH(${x}$3,${sheet}$C$3:$${last}$3,0))`;
  const toMonth = (sheet: string, row: number, x: string) => `SUMIFS(${sheet}$C$${row}:$${lastCol}$${row},${sheet}$C$3:$${lastCol}$3,"<="&${x}$3)`;
  const recvFromFargo = (x: string) => `SUMIFS(${IV}$J:$J,${IV}$C:$C,"<="&${x}$3)-SUMIFS(${TRF}$E:$E,${TRF}$B:$B,"<="&${x}$3)`;

  const bsTi = layout("bsTi", [
    { kind: "head", label: t("АКТИВЫ", "ASSETS") },
    { id: "bank", kind: "line", label: t("Денежные средства — банк", "Cash at bank"), f: (x) => `SUMIFS(${MB}$B:$B,${MB}$A:$A,${x}$3)` },
    { id: "cash", kind: "line", label: t("Денежные средства — касса", "Cash on hand"), f: (x) => `SUMIFS(${MB}$C:$C,${MB}$A:$A,${x}$3)` },
    { id: "recv", kind: "line", label: t("Дебиторская задолженность Fargo (счета с НДС − полученные оплаты)", "Fargo receivable (invoices incl. VAT − payments received)"), f: recvFromFargo },
    { id: "stock", kind: "line", label: t("Товар у TI (FIFO: неизрасходованные партии фур)", "Stock held by TI (FIFO: unused truck batches)"), f: (x) => atMonth(CG, 13, x) },
    { id: "transit", kind: "line", label: t("Товары в пути (предоплата в Германию)", "Goods in transit (prepaid to Germany)"), f: (x) => `SUMIFS(${MB}$D:$D,${MB}$A:$A,${x}$3)` },
    { id: "vatOver", kind: "line", label: t("Переплата НДС в бюджет — лицевой счёт", "VAT overpaid — tax account"), f: (x) => `MAX(0,${vatBal(x)})` },
    { id: "assets", kind: "sub", label: t("ИТОГО АКТИВЫ", "TOTAL ASSETS"), f: (x) => `SUM(${x}${R("bsTi", "bank")}:${x}${R("bsTi", "vatOver")})` },
    { kind: "head", label: t("ОБЯЗАТЕЛЬСТВА", "LIABILITIES") },
    { id: "vatDebt", kind: "line", label: t("Долг по НДС в бюджет — лицевой счёт", "VAT owed — tax account"), f: (x) => `MAX(0,-${vatBal(x)})` },
    { id: "priorVat", kind: "line", label: t("Прежнему владельцу — его переплата НДС (за вычетом его начислений)", "Previous owner — their VAT overpayment (less their charges)"), f: (x) => `${priorVatCell}-SUMIFS(${VC}$C:$C,${VC}$A:$A,"<="&${x}$3,${VC}$D:$D,"PRIOR_OWNER")` },
    { id: "priorCash", kind: "line", label: t("Прежнему владельцу — его деньги, прошедшие через TI", "Previous owner — their money passing through TI"), f: (x) => `SUMIFS(${PO}$D:$D,${PO}$B:$B,"<="&${x}$3)-SUMIFS(${PO}$E:$E,${PO}$B:$B,"<="&${x}$3)` },
    { id: "loans", kind: "line", label: t("Займы и финансовая помощь", "Loans and financial assistance"), f: (x) => `SUMIFS(${LO}$C:$C,${LO}$A:$A,"<="&${x}$3)-SUMIFS(${LO}$D:$D,${LO}$A:$A,"<="&${x}$3)` },
    { id: "other", kind: "line", label: t("Деньги других покупателей", "Other customers' money"), f: (x) => `SUMIFS(${OR}$D:$D,${OR}$B:$B,"<="&${x}$3)` },
    { id: "importUnpaid", kind: "line", label: t("Неоплаченные импортные услуги (оплата в следующем месяце)", "Import services unpaid (paid in a later month)"), f: (x) => `SUMIFS(${SE}$D:$D,${SE}$B:$B,"<="&${x}$3,${SE}$E:$E,">"&${x}$3,${SE}$G:$G,0)` },
    { id: "ptax", kind: "line", label: t("Налог на прибыль к уплате (начислен, не оплачен)", "Profit tax payable (booked, not paid)"), f: (x) => `SUMIFS(${TX}$C:$C,${TX}$B:$B,"<="&${x}$3)-SUMIFS(${TX}$C:$C,${TX}$E:$E,"<="&${x}$3)` },
    { id: "liab", kind: "sub", label: t("ИТОГО ОБЯЗАТЕЛЬСТВА", "TOTAL LIABILITIES"), f: (x) => `SUM(${x}${R("bsTi", "vatDebt")}:${x}${R("bsTi", "ptax")})` },
    { kind: "head", label: t("КАПИТАЛ", "EQUITY") },
    { id: "capTi", kind: "line", label: t("Капитал — Turbo Impex", "Capital — Turbo Impex"), f: (x) => `SUMIFS(${CP}$C:$C,${CP}$B:$B,"<="&${x}$3)` },
    { id: "capFg", kind: "line", label: t("Капитал — Fargo (вклад партнёра)", "Capital — Fargo (partner's contribution)"), f: (x) => `SUMIFS(${CP}$D:$D,${CP}$B:$B,"<="&${x}$3)` },
    { id: "retained", kind: "line", label: t("Нераспределённая прибыль (накопленная прибыль TI)", "Retained earnings (TI's profit to date)"), f: (x) => toMonth(PT, R("plTi", "net"), x) },
    { id: "equity", kind: "sub", label: t("ИТОГО КАПИТАЛ", "TOTAL EQUITY"), f: (x) => `SUM(${x}${R("bsTi", "capTi")}:${x}${R("bsTi", "retained")})` },
    { kind: "head", label: t("СВЕРКА", "RECONCILIATION") },
    { id: "unrec", kind: "total", label: t("НЕСВЕРЕННАЯ СУММА (активы − обязательства − капитал)", "UNRECONCILED (assets − liabilities − equity)"), f: (x) => `${x}${R("bsTi", "assets")}-${x}${R("bsTi", "liab")}-${x}${R("bsTi", "equity")}` },
  ]);
  const BT = Q("bsTi");
  const bsFg = layout("bsFg", [
    { kind: "head", label: t("АКТИВЫ", "ASSETS") },
    { id: "stock", kind: "line", label: t("Товар у Fargo (по ценам счетов TI, без НДС)", "Stock at Fargo (TI invoice prices, ex-VAT)"), f: (x) => atMonth(CG, 14, x) },
    { id: "vat", kind: "line", label: t("НДС к зачёту, перенесённый — Fargo", "VAT credit carried forward — Fargo"), f: (x) => atMonth(PF, R("plFg", "vcredit"), x) },
    { id: "ar", kind: "line", label: t("Дебиторская задолженность покупателей", "Customer receivables"), f: (x) => `SUMIFS(${AR}$C:$C,${AR}$A:$A,${x}$3)` },
    { id: "cashHeld", kind: "line", label: t("Деньги Humana у Fargo (собрано − расходы и налоги Fargo − оплачено TI)", "Humana money held by Fargo (collected − Fargo's costs and taxes − paid to TI)"), f: (x) =>
      `SUMIFS(${SA}$G:$G,${SA}$A:$A,"<="&${x}$3)-${x}${R("bsFg", "ar")}-(SUMIFS(${OF}$D:$D,${OF}$A:$A,"<="&${x}$3)-SUMIFS(${OF}$D:$D,${OF}$A:$A,"<="&${x}$3,${OF}$C:$C,${str(woLabel)}))-${toMonth(PF, R("plFg", "vpaid"), x)}-SUMIFS(${SA}$P:$P,${SA}$A:$A,"<="&${x}$3)-SUMIFS(${TRF}$E:$E,${TRF}$B:$B,"<="&${x}$3)` },
    { id: "assets", kind: "sub", label: t("ИТОГО АКТИВЫ", "TOTAL ASSETS"), f: (x) => `SUM(${x}${R("bsFg", "stock")}:${x}${R("bsFg", "cashHeld")})` },
    { kind: "head", label: t("ОБЯЗАТЕЛЬСТВА", "LIABILITIES") },
    { id: "toTi", kind: "line", label: t("Задолженность перед TI (счета с НДС − оплаты)", "Payable to TI (invoices incl. VAT − payments)"), f: recvFromFargo },
    { id: "liab", kind: "sub", label: t("ИТОГО ОБЯЗАТЕЛЬСТВА", "TOTAL LIABILITIES"), f: (x) => `${x}${R("bsFg", "toTi")}` },
    { kind: "head", label: t("КАПИТАЛ", "EQUITY") },
    { id: "retained", kind: "line", label: t("Нераспределённая прибыль Humana (накопленная прибыль Fargo)", "Retained Humana profit (Fargo's profit to date)"), f: (x) => toMonth(PF, R("plFg", "net"), x) },
    { id: "equity", kind: "sub", label: t("ИТОГО КАПИТАЛ", "TOTAL EQUITY"), f: (x) => `${x}${R("bsFg", "retained")}` },
    { kind: "head", label: t("ПРОВЕРКА", "CHECK") },
    { id: "check", kind: "total", label: t("Активы − обязательства − капитал (должно быть 0)", "Assets − liabilities − equity (should be 0)"), f: (x) => `ROUND(${x}${R("bsFg", "assets")}-${x}${R("bsFg", "liab")}-${x}${R("bsFg", "equity")},0)` },
  ]);
  const BF = Q("bsFg");
  const bsGr = layout("bsGr", [
    { kind: "head", label: t("АКТИВЫ", "ASSETS") },
    { id: "stock", kind: "line", label: t("Товар (FIFO, по себестоимости TI)", "Stock (FIFO, at TI landed cost)"), f: (x) => `${x}${R("bsGr", "atTi")}+${x}${R("bsGr", "atFg")}` },
    { id: "atTi", kind: "memo", label: t("в т.ч. у TI", "of which held by TI"), f: (x) => `${BT}${x}${R("bsTi", "stock")}` },
    { id: "atFg", kind: "memo", label: t("в т.ч. у Fargo", "of which at Fargo"), f: (x) => atMonth(CG, 15, x) },
    { id: "transit", kind: "line", label: t("Товары в пути (предоплата в Германию)", "Goods in transit (prepaid to Germany)"), f: (x) => `${BT}${x}${R("bsTi", "transit")}` },
    { id: "vat", kind: "line", label: t("НДС: переплата TI (лицевой счёт) + зачёт Fargo", "VAT: TI overpayment (tax account) + Fargo credit"), f: (x) => `${BT}${x}${R("bsTi", "vatOver")}+${atMonth(PF, R("plFg", "vcredit"), x)}` },
    { id: "ar", kind: "line", label: t("Дебиторская задолженность покупателей", "Customer receivables"), f: (x) => `SUMIFS(${AR}$C:$C,${AR}$A:$A,${x}$3)` },
    { id: "cash", kind: "line", label: t("Денежные средства TI (банк + касса)", "TI cash (bank + on hand)"), f: (x) => `${BT}${x}${R("bsTi", "bank")}+${BT}${x}${R("bsTi", "cash")}` },
    { id: "held", kind: "line", label: t("Деньги Humana у Fargo (расчёт)", "Humana money held by Fargo (derived)"), f: (x) => atMonth(BF, R("bsFg", "cashHeld"), x) },
    { id: "assets", kind: "sub", label: t("ИТОГО АКТИВЫ", "TOTAL ASSETS"), f: (x) => `${x}${R("bsGr", "stock")}+SUM(${x}${R("bsGr", "transit")}:${x}${R("bsGr", "held")})` },
    { kind: "head", label: t("ОБЯЗАТЕЛЬСТВА", "LIABILITIES") },
    { id: "liab", kind: "sub", label: t("ИТОГО ОБЯЗАТЕЛЬСТВА (как у TI)", "TOTAL LIABILITIES (as TI's)"), f: (x) => `${BT}${x}${R("bsTi", "liab")}` },
    { kind: "head", label: t("КАПИТАЛ", "EQUITY") },
    { id: "capTi", kind: "line", label: t("Капитал — Turbo Impex", "Capital — Turbo Impex"), f: (x) => `${BT}${x}${R("bsTi", "capTi")}` },
    { id: "capFg", kind: "line", label: t("Капитал — Fargo", "Capital — Fargo"), f: (x) => `${BT}${x}${R("bsTi", "capFg")}` },
    { id: "retained", kind: "line", label: t("Нераспределённая прибыль (накопленная консолидированная)", "Retained earnings (consolidated, to date)"), f: (x) => toMonth(Q("plGr"), R("plGr", "net"), x) },
    { id: "equity", kind: "sub", label: t("ИТОГО КАПИТАЛ", "TOTAL EQUITY"), f: (x) => `SUM(${x}${R("bsGr", "capTi")}:${x}${R("bsGr", "retained")})` },
    { kind: "head", label: t("СВЕРКА", "RECONCILIATION") },
    { id: "unrec", kind: "total", label: t("НЕСВЕРЕННАЯ СУММА (активы − обязательства − капитал)", "UNRECONCILED (assets − liabilities − equity)"), f: (x) => `${x}${R("bsGr", "assets")}-${x}${R("bsGr", "liab")}-${x}${R("bsGr", "equity")}` },
  ]);

  const opexOf = (rec: Record<string, number>, g: string) => rec[g] ?? 0;
  const groupVals = (groups: readonly string[], rec: (i: number) => Record<string, number>, total: (i: number) => number) => ({
    ...Object.fromEntries(groups.map((g, gi) => [`g${gi}`, (i: number) => opexOf(rec(i), g)])),
    gx: (i: number) => total(i) - groups.reduce((sum, g) => sum + opexOf(rec(i), g), 0),
  });
  const T = (i: number) => c.ti[i];
  const F = (i: number) => c.fargo[i];
  const G = (i: number) => c.group[i];
  const B = (i: number) => c.balance[i];
  writeStatement("plTi", "plTi", t("Отчёт о прибылях и убытках — Turbo Impex", "Profit and loss — Turbo Impex"), plTi, months, false, {
    rev: (i) => T(i).revenue, units: (i) => T(i).units, cogs: (i) => T(i).cogs, samples: (i) => T(i).giveaways, gross: (i) => T(i).grossProfit,
    ...groupVals(TI_GROUPS, (i) => T(i).opexByGroup, (i) => T(i).opex),
    opex: (i) => T(i).opex, ebitda: (i) => T(i).ebitda, ptax: (i) => T(i).profitTax, vatcost: (i) => T(i).vatCost, net: (i) => T(i).netProfit,
  });
  writeStatement("plFg", "plFg", t("Отчёт о прибылях и убытках — Fargo (только Humana)", "Profit and loss — Fargo (Humana only)"), plFg, months, false, {
    bank: (i) => F(i).bankRevenue, cash: (i) => F(i).cashRevenue, rev: (i) => F(i).revenue, atPrice: (i) => F(i).salesAtPrice, units: (i) => F(i).units,
    cogs: (i) => F(i).cogs, wo: (i) => F(i).writeOffLoss, loss: (i) => F(i).stockLoss, woRec: (i) => F(i).writeOffsRecorded, gross: (i) => F(i).grossProfit,
    ...groupVals(FARGO_GROUPS, (i) => F(i).opexByGroup, (i) => F(i).opex),
    opex: (i) => F(i).opex, ebitda: (i) => F(i).ebitda, tax: (i) => F(i).incomeTax, net: (i) => F(i).netProfit,
    vin: (i) => F(i).vat.input, vbank: (i) => F(i).vat.outputBank, vcash: (i) => F(i).vat.outputCash, vnet: (i) => F(i).vat.net, vpaid: (i) => F(i).vat.paid, vcredit: (i) => F(i).vat.creditOut,
  });
  writeStatement("plGr", "plGr", t("Отчёт о прибылях и убытках — Humana консолидированный (TI + Fargo)", "Profit and loss — Humana consolidated (TI + Fargo)"), plGr, months, false, {
    bank: (i) => G(i).bankRevenue, cash: (i) => G(i).cashRevenue, rev: (i) => G(i).revenue, units: (i) => G(i).units, cogs: (i) => G(i).cogs, samples: (i) => G(i).giveaways,
    wo: (i) => G(i).fargoWriteOffs, loss: (i) => G(i).stockLoss, gross: (i) => G(i).grossProfit, opexTi: (i) => G(i).opexTi, opexFg: (i) => G(i).opexFargo, opex: (i) => G(i).opex,
    ebitda: (i) => G(i).ebitda, tFg: (i) => G(i).fargoIncomeTax, tTi: (i) => G(i).tiProfitTax, tVat: (i) => G(i).tiVatCost, taxes: (i) => G(i).taxes, net: (i) => G(i).netProfit,
  });
  writeStatement("bsTi", "bsTi", t("Баланс — Turbo Impex (на конец месяца)", "Balance sheet — Turbo Impex (month-end)"), bsTi, bsMonths, true, {
    bank: (i) => B(i).ti.bank, cash: (i) => B(i).ti.cash, recv: (i) => B(i).ti.receivableFromFargo, stock: (i) => B(i).ti.stock, transit: (i) => B(i).ti.goodsInTransit, vatOver: (i) => B(i).ti.vatOverpaid,
    assets: (i) => B(i).ti.assets, vatDebt: (i) => B(i).ti.vatDebt, priorVat: (i) => B(i).ti.priorOwnerVat, priorCash: (i) => B(i).ti.priorOwnerCash, loans: (i) => B(i).ti.loans, other: (i) => B(i).ti.otherReceipts,
    importUnpaid: (i) => B(i).ti.importUnpaid, ptax: (i) => B(i).ti.profitTaxPayable, liab: (i) => B(i).ti.liabilities, capTi: (i) => B(i).ti.tiCapital, capFg: (i) => B(i).ti.fargoCapital,
    retained: (i) => B(i).ti.retained, equity: (i) => B(i).ti.equity, unrec: (i) => B(i).ti.unreconciled,
  });
  writeStatement("bsFg", "bsFg", t("Баланс — Fargo (только Humana, на конец месяца)", "Balance sheet — Fargo (Humana only, month-end)"), bsFg, months, true, {
    stock: (i) => B(i).fargo.stock, vat: (i) => B(i).fargo.vatCredit, ar: (i) => B(i).fargo.receivables, cashHeld: (i) => B(i).fargo.cashHeld, assets: (i) => B(i).fargo.assets,
    toTi: (i) => B(i).fargo.payableToTi, liab: (i) => B(i).fargo.liabilities, retained: (i) => B(i).fargo.retained, equity: (i) => B(i).fargo.equity, check: () => 0,
  });
  writeStatement("bsGr", "bsGr", t("Баланс — Humana консолидированный (на конец месяца)", "Balance sheet — Humana consolidated (month-end)"), bsGr, bsMonths, true, {
    stock: (i) => B(i).group.stock, atTi: (i) => B(i).group.stockAtTi, atFg: (i) => B(i).group.stockAtFargo, transit: (i) => B(i).group.goodsInTransit, vat: (i) => B(i).group.vat,
    ar: (i) => B(i).group.receivables, cash: (i) => B(i).group.tiCash, held: (i) => B(i).group.cashHeldByFargo, assets: (i) => B(i).group.assets, liab: (i) => B(i).group.liabilities,
    capTi: (i) => B(i).group.tiCapital, capFg: (i) => B(i).group.fargoCapital, retained: (i) => B(i).group.retained, equity: (i) => B(i).group.equity, unrec: (i) => B(i).group.unreconciled,
  });

  // Settlement — at REPORT_TO, two versions of the VAT on unsold goods
  {
    const s = S.settle;
    s.f(1, 1, `${str(t("Взаиморасчёты с Fargo на ", "Settlement with Fargo at "))}&TEXT(REPORT_TO,"0000-00")`, undefined, `${t("Взаиморасчёты с Fargo на ", "Settlement with Fargo at ")}${reportMonth}`).font = { bold: true, size: 13 };
    s.header(3, ["", t("НДС по непроданному товару — сейчас", "VAT on unsold goods — now"), t("НДС по непроданному товару — при продаже", "VAT on unsold goods — when sold")]);
    // the app's figures at the report month, stored with the formulas
    const ri = ei(reportMonth);
    const st = c.settlement[ri];
    const upto = c.fargo.slice(0, ri + 1);
    const sumF = (pick: (x: Computed["fargo"][number]) => number) => upto.reduce((a, x) => a + pick(x), 0);
    const v = {
      rev: sumF((x) => x.revenue), cogs: -sumF((x) => x.cogs), opex: -sumF((x) => x.opex), wo: -sumF((x) => x.writeOffLoss), loss: -sumF((x) => x.stockLoss), tax: -sumF((x) => x.incomeTax),
    };
    const grossV = v.rev + v.cogs;
    const beforeV = grossV + v.opex + v.wo + v.loss;
    const netV = beforeV + v.tax;
    const stockB = -st.fargoStock;
    const stockC = -st.fargoStock * (1 + ds.taxes.vatRate);
    const dueB = st.invoicesInclVatCum + stockB + netV - st.receivables - st.vatCredit - st.writeOffsDeductedCum;
    const dueC = st.invoicesInclVatCum + stockC + netV - st.receivables - st.vatCredit - st.writeOffsDeductedCum;
    const gotV = st.cashCum + st.bankCum;
    const actV = st.invoicesInclVatCum - st.allBankCum;
    const bankPart = (owes: number) => Math.min(Math.max(owes, 0), Math.max(actV, 0));
    let r = 5;
    const line = (label: string, b: string, cVal: string | null = null, kind: "line" | "sub" | "total" = "line", res?: [number, number?]) => {
      s.v(r, 1, label);
      s.f(r, 2, b, MONEY, res?.[0]);
      s.f(r, 3, cVal ?? `B${r}`, MONEY, res ? (res[1] ?? res[0]) : undefined);
      if (kind !== "line") s.bold(r, 3);
      return r++;
    };
    const sec = (label: string) => {
      s.section(r++, label, 3);
    };
    const B = (k: "plFg", id: string) => `${PF}$B$${R(k, id)}`;
    const atReport = (sheet: string, row: number) => `IFERROR(INDEX(${sheet}$C$${row}:$${lastCol}$${row},MATCH(REPORT_TO,${sheet}$C$3:$${lastCol}$3,0)),0)`;
    sec(t("1. ПРИБЫЛЬ FARGO ПО HUMANA (с первого месяца по отчётный)", "1. FARGO'S PROFIT FROM HUMANA (first month to the report month)"));
    const rev = line(t("Выручка (без НДС)", "Revenue (ex-VAT)"), B("plFg", "rev"), null, "line", [v.rev]);
    const cogs = line(t("− Себестоимость (цены счетов TI, FIFO)", "− Cost of goods (TI invoice prices, FIFO)"), `-${B("plFg", "cogs")}`, null, "line", [v.cogs]);
    const gross = line(t("Валовая прибыль", "Gross profit"), `B${rev}+B${cogs}`, null, "sub", [grossV]);
    const opex = line(t("− Операционные расходы (вкл. ретро-бонусы)", "− Operating expenses (incl. retro bonuses)"), `-${B("plFg", "opex")}`, null, "line", [v.opex]);
    const wo = line(t("− Списания: просрочка, брак", "− Write-offs: expired, damaged"), `-${B("plFg", "wo")}`, null, "line", [v.wo]);
    const loss = line(t("− Потери товара по инвентаризации", "− Stock loss at the count"), `-${B("plFg", "loss")}`, null, "line", [v.loss]);
    const before = line(t("Прибыль до налога", "Profit before tax"), `B${gross}+B${opex}+B${wo}+B${loss}`, null, "sub", [beforeV]);
    const tax = line(t("− Оборотный налог (1,9%)", "− Turnover tax (1.9%)"), `-${B("plFg", "tax")}`, null, "line", [v.tax]);
    const net = line(t("ЧИСТАЯ ПРИБЫЛЬ (по уже проданному товару)", "NET PROFIT (on goods already sold)"), `B${before}+B${tax}`, null, "total", [netV]);
    r++;
    sec(t("2. ЧТО FARGO ДОЛЖЕН ОПЛАТИТЬ TI", "2. WHAT FARGO HAS TO PAY TI"));
    const inv = line(t("Счета-фактуры TI с НДС (весь поставленный товар)", "TI invoices incl. VAT (all goods delivered)"), `SUMIFS(${IV}$J:$J,${IV}$C:$C,"<="&REPORT_TO)`, null, "line", [st.invoicesInclVatCum]);
    const stock = line(t("− Товар на складе Fargo (по инвентаризации): ещё не продан", "− Goods in Fargo's warehouse (per the count): not sold yet"), `-${atReport(CG, 14)}`, `B${r}*(1+VAT_RATE)`, "line", [stockB, stockC]);
    const sold = line(t("Причитается за уже проданный товар", "Due for the goods sold"), `B${inv}+B${stock}`, `C${inv}+C${stock}`, "sub", [st.invoicesInclVatCum + stockB, st.invoicesInclVatCum + stockC]);
    const plus = line(t("+ Чистая прибыль по проданному товару (раздел 1)", "+ Net profit on goods sold (section 1)"), `B${net}`, null, "line", [netV]);
    const ar = line(t("− Покупатели ещё должны Fargo", "− Customers still owe Fargo"), `-SUMIFS(${AR}$C:$C,${AR}$A:$A,REPORT_TO)`, null, "line", [-st.receivables]);
    const vat = line(t("− НДС к зачёту у Fargo, ещё не возмещённый", "− Fargo VAT credit not yet recovered"), `-${atReport(PF, R("plFg", "vcredit"))}`, null, "line", [-st.vatCredit]);
    const ded = line(t("− Списания, вычитаемые Fargo (если так договорено)", "− Write-offs deducted by Fargo (if agreed)"), `-WRITEOFF_DEDUCT*SUMIFS(${OF}$D:$D,${OF}$A:$A,"<="&REPORT_TO,${OF}$C:$C,${str(woLabel)})`, null, "line", [-st.writeOffsDeductedCum]);
    const due = line(t("Причитается TI на отчётную дату", "Due to TI at the report date"), `B${sold}+B${plus}+B${ar}+B${vat}+B${ded}`, `C${sold}+C${plus}+C${ar}+C${vat}+C${ded}`, "total", [dueB, dueC]);
    r++;
    sec(t("3. ПОЛУЧЕНО ОТ FARGO", "3. RECEIVED FROM FARGO"));
    const cash = line(t("Наличными (касса TI)", "In cash (TI cash desk)"), `SUMIFS(${TRF}$C:$C,${TRF}$B:$B,"<="&REPORT_TO)`, null, "line", [st.cashCum]);
    const bank = line(t("Перечислением — оплата за товар", "By bank — payments for goods"), `SUMIFS(${TRF}$D:$D,${TRF}$B:$B,"<="&REPORT_TO)`, null, "line", [st.bankCum]);
    const got = line(t("Итого получено", "Total received"), `B${cash}+B${bank}`, `C${cash}+C${bank}`, "total", [gotV]);
    r++;
    sec(t("4. ИТОГ", "4. RESULT"));
    const allBank = r + 5; // section 5's first line
    const actRow = r + 12; // section 5's last line
    const owes = line(t("ОСТАЛОСЬ ЗА FARGO (ДОЛГ ПЕРЕД TI)", "FARGO STILL OWES TI"), `B${due}-B${got}`, `C${due}-C${got}`, "total", [dueB - gotV, dueC - gotV]);
    const byBank = line(t("в т.ч. перечислением (сальдо по акту сверки)", "of which by bank (the act balance)"), `MIN(MAX(B${owes},0),MAX(B${actRow},0))`, `MIN(MAX(C${owes},0),MAX(C${actRow},0))`, "line", [bankPart(dueB - gotV), bankPart(dueC - gotV)]);
    line(t("в т.ч. наличными", "of which in cash"), `B${owes}-B${byBank}`, `C${owes}-C${byBank}`, "line", [dueB - gotV - bankPart(dueB - gotV), dueC - gotV - bankPart(dueC - gotV)]);
    r++;
    sec(t("5. БАНКОВСКИЕ ПЛАТЕЖИ FARGO — ЧТО ОНИ ВКЛЮЧАЮТ", "5. FARGO'S BANK PAYMENTS — WHAT THEY INCLUDE"));
    if (r !== allBank) throw new Error("settlement layout");
    const all = line(t("Все банковские платежи со счёта Fargo (как в акте сверки)", "All bank payments from Fargo's account (as in the act)"), `SUMIFS(${TRF}$D:$D,${TRF}$B:$B,"<="&REPORT_TO)+SUMIFS(${CP}$E:$E,${CP}$B:$B,"<="&REPORT_TO,${CP}$G:$G,1)+SUMIFS(${PO}$D:$D,${PO}$B:$B,"<="&REPORT_TO,${PO}$G:$G,1)`, null, "line", [st.allBankCum]);
    const capF = line(t("− Капитал Fargo", "− Fargo's capital"), `-SUMIFS(${CP}$D:$D,${CP}$B:$B,"<="&REPORT_TO,${CP}$G:$G,1)`, null, "line", [-st.fargoCapitalViaFargo]);
    const capT = line(t("− Капитал партнёров TI, перечисленный со счёта Fargo", "− TI partners' capital sent from Fargo's account"), `-SUMIFS(${CP}$C:$C,${CP}$B:$B,"<="&REPORT_TO,${CP}$G:$G,1)`, null, "line", [-st.tiCapitalViaFargo]);
    const pri = line(t("− Деньги прежнего владельца, прошедшие через Fargo", "− The previous owner's money via Fargo"), `-SUMIFS(${PO}$D:$D,${PO}$B:$B,"<="&REPORT_TO,${PO}$G:$G,1)`, null, "line", [-st.priorOwnerViaFargo]);
    line(t("Оплата за товар", "Payments for goods"), `B${all}+B${capF}+B${capT}+B${pri}`, null, "sub", [st.bankCum]);
    const inv2 = line(t("Счета-фактуры TI с НДС", "TI invoices incl. VAT"), `B${inv}`, null, "line", [st.invoicesInclVatCum]);
    const all2 = line(t("− Все банковские платежи со счёта Fargo", "− All bank payments from Fargo's account"), `-B${all}`, null, "line", [-st.allBankCum]);
    const act = line(t("Сальдо по акту сверки — к оплате перечислением", "Balance of the reconciliation act — due by bank"), `B${inv2}+B${all2}`, null, "total", [actV]);
    if (act !== actRow) throw new Error("settlement act row");
    s.widths([70, 22, 22]);
  }

  // App check — the workbook's key figures against the app's
  {
    const s = S.check;
    s.title(t("Сверка с приложением", "Check against the app"), t("Формула книги, число из приложения и разница. Разница 0 — книга считает так же, как приложение.", "The workbook's formula, the app's figure and the difference. 0 — the workbook calculates as the app does."));
    months.forEach((m, i) => s.v(3, 3 + i, ym(m), MONTHFMT));
    let r = 4;
    const idx = (m: string) => c.monthIds.indexOf(m);
    const add = (label: string, wbFormula: (x: string, m: string) => string | null, app: (i: number) => number, ms = months) => {
      s.section(r, label, 2 + months.length);
      const a = r + 1, b = r + 2, d = r + 3;
      s.v(a, 1, t("книга", "workbook"));
      s.v(b, 1, t("приложение", "app"));
      s.v(d, 1, t("разница", "difference"));
      months.forEach((m, i) => {
        const x = mcol(i);
        if (!ms.includes(m)) return;
        const f = wbFormula(x, m);
        if (!f) return;
        const appValue = Math.round(app(idx(m)) * 100) / 100;
        s.f(a, 3 + i, f, MONEY, appValue);
        s.v(b, 3 + i, appValue, MONEY);
        s.f(d, 3 + i, `ROUND(${x}${a}-${x}${b},0)`, MONEY, 0);
      });
      s.bold(d, 2 + months.length, false);
      r += 5;
    };
    const plAt = (sheet: string, row: number) => (x: string) => `${sheet}${x}${row}`;
    add(t("TI: выручка", "TI: revenue"), plAt(PT, R("plTi", "rev")), (i) => c.ti[i].revenue);
    add(t("TI: чистая прибыль", "TI: net profit"), plAt(PT, R("plTi", "net")), (i) => c.ti[i].netProfit);
    add(t("Fargo: выручка", "Fargo: revenue"), plAt(PF, R("plFg", "rev")), (i) => c.fargo[i].revenue);
    add(t("Fargo: себестоимость", "Fargo: cost of goods"), plAt(PF, R("plFg", "cogs")), (i) => c.fargo[i].cogs);
    add(t("Fargo: списания", "Fargo: write-offs"), plAt(PF, R("plFg", "wo")), (i) => c.fargo[i].writeOffLoss);
    add(t("Fargo: потери по инвентаризации", "Fargo: stock loss"), plAt(PF, R("plFg", "loss")), (i) => c.fargo[i].stockLoss);
    add(t("Fargo: чистая прибыль", "Fargo: net profit"), plAt(PF, R("plFg", "net")), (i) => c.fargo[i].netProfit);
    add(t("Консолидированная чистая прибыль", "Consolidated net profit"), plAt(Q("plGr"), R("plGr", "net")), (i) => c.group[i].netProfit);
    add(t("Fargo должен TI (деньги Humana у Fargo)", "Fargo owes TI (Humana money held by Fargo)"), (x) => `${BF}${x}${R("bsFg", "cashHeld")}`, (i) => c.settlement[i].owes);
    add(
      t("TI: несверенная сумма", "TI: unreconciled"),
      (_x, m) => `IFERROR(INDEX(${BT}$C$${R("bsTi", "unrec")}:$${L(2 + bsMonths.length)}$${R("bsTi", "unrec")},MATCH(${ym(m)},${BT}$C$3:$${L(2 + bsMonths.length)}$3,0)),0)`,
      (i) => c.balance[i].ti.unreconciled,
      bsMonths
    );
    s.widths([44, 2, ...months.map(() => 15)]);
    s.freeze(2, 3);
  }

  return wb;
}

/** the FIFO tab's cost-per-unit table starts here (summary rows above it) */
const COGS_UNIT_FIRST = 18;
