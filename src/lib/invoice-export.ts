// One TI → Fargo invoice as Excel: the document as printed, and TI's cost and
// margin on it on a separate sheet (for TI only).
import { MONEY, MONEY2, PCT, type SheetSpec } from "./excel";
import type { Computed, Dataset } from "./engine/types";

type Locale = "ru" | "en";

const day = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : null);

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
