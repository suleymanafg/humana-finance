import { pageContext, type SearchParams } from "@/lib/page-context";
import { prisma } from "@/lib/db";
import { loadTransition, stockViews } from "@/lib/transition/data";
import { LOT_STATUS, optionsOf } from "@/lib/transition/model";
import { fmtN } from "@/lib/format";
import { Figure, Notice, SectionTitle, Toolbar } from "@/components/statement";
import EntryGrid from "@/components/EntryGrid";
import ImportButton from "@/components/transition/ImportButton";

export default async function TransitionStock({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const data = await loadTransition();
  const s = await stockViews(data);
  const monthName = (id: string | null) => {
    const m = ctx.dataset.months.find((x) => x.id === id);
    return m ? ctx.l({ ru: m.nameRu, en: m.nameEn }) : "—";
  };
  // active SKUs, plus any SKU a lot already points at
  const lotProducts = s.lots.map((l) => l.productId).filter(Boolean);
  const activeProducts = await prisma.product.findMany({
    where: { OR: [{ active: true }, { id: { in: lotProducts } }] },
    orderBy: { sortOrder: "asc" },
    select: { id: true, nameRu: true },
  });
  const productOptions = [{ value: "", label: "—" }, ...activeProducts.map((p) => ({ value: p.id, label: p.nameRu }))];
  const shortQty = s.totals.expiredQty + s.totals.lt90Qty;

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Figure
          label={ctx.l({ ru: "Стоимость выкупа", en: "Buyback value" })}
          value={fmtN(s.totals.value)}
          sub={ctx.l({ ru: "по цене счёта TI→Fargo без НДС", en: "at the TI→Fargo invoice price ex-VAT" })}
        />
        <Figure label={ctx.l({ ru: "Штук к выкупу", en: "Units to buy back" })} value={fmtN(s.totals.qty)} />
        <Figure
          label={ctx.l({ ru: "Срок < 90 дней или истёк", en: "Expiry < 90 days or past" })}
          value={fmtN(shortQty)}
          tone={shortQty > 0 ? "neg" : undefined}
          sub={ctx.l({ ru: `истёк ${fmtN(s.totals.expiredQty)} · 90–180 дн. ${fmtN(s.totals.lt180Qty)}`, en: `${fmtN(s.totals.expiredQty)} past · 90–180 days ${fmtN(s.totals.lt180Qty)}` })}
        />
        <Figure
          label={ctx.l({ ru: "До августа 2025 (не выкупаем)", en: "Before Aug 2025 (not bought)" })}
          value={fmtN(s.totals.preAugQty)}
          sub={ctx.l({ ru: "собственный товар Fargo", en: "Fargo's own stock" })}
        />
        <Figure
          label={ctx.l({ ru: "Нужно уточнить", en: "To clarify" })}
          value={String(s.totals.toClarify)}
          sub={ctx.l({ ru: `без товара ${s.totals.unmatched} · без цены ${s.totals.unpriced}`, en: `${s.totals.unmatched} no product · ${s.totals.unpriced} no price` })}
        />
      </div>

      <Toolbar>
        <p className="max-w-3xl text-[12.5px] text-muted">
          {ctx.l({
            ru: "Остатки Humana у Fargo по партиям. Цена выкупа по умолчанию — последняя цена счёта TI→Fargo без НДС; впишите свою, когда решение принято. Товар до августа 2025 и списанный в стоимость не входят.",
            en: "Fargo's Humana stock by batch. The default buyback price is the latest TI→Fargo invoice price ex-VAT; enter your own once decided. Stock from before August 2025 and written-off stock are left out of the value.",
          })}
        </p>
        <div className="ml-auto">
          <ImportButton
            kind="stock"
            title={{ ru: "Загрузить остатки Fargo", en: "Upload Fargo's stock" }}
            hint={{
              ru: "Выгрузка остатков по партиям из 1С Fargo. Товар находится по коду (артикул, код 1С) или по названию.",
              en: "A stock-by-batch export from Fargo's 1C. Items are matched by code (article, 1C code) or by name.",
            }}
            replaceLabel={{ ru: "Заменить ранее загруженный список (новый пересчёт)", en: "Replace the previously uploaded list (a new count)" }}
            fields={[
              { key: "item", label: { ru: "Товар", en: "Item" }, required: true, synonyms: ["номенклат", "товар", "наимен", "продукт", "item", "product", "sku"] },
              { key: "code", label: { ru: "Код / артикул", en: "Code / article" }, synonyms: ["код", "артикул", "code", "article"] },
              { key: "batch", label: { ru: "Партия / серия", en: "Batch" }, synonyms: ["парти", "сери", "batch", "lot"] },
              { key: "expiry", label: { ru: "Срок годности", en: "Expiry" }, synonyms: ["срок", "годн", "expir", "best before"] },
              { key: "qty", label: { ru: "Количество", en: "Quantity" }, required: true, synonyms: ["колич", "остат", "кол-во", "qty", "quantity", "шт"] },
              { key: "location", label: { ru: "Склад / филиал", en: "Warehouse / branch" }, synonyms: ["склад", "филиал", "место", "warehouse", "location", "branch"] },
              { key: "countDate", label: { ru: "Дата пересчёта", en: "Count date" }, synonyms: ["дата", "date"] },
              { key: "preAug2025", label: { ru: "До августа 2025 (да/нет)", en: "Before Aug 2025 (yes/no)" }, synonyms: ["до август", "старый", "pre"] },
              { key: "unitPrice", label: { ru: "Цена выкупа", en: "Buyback price" }, synonyms: ["цена", "price"] },
            ]}
          />
        </div>
      </Toolbar>

      {s.lots.length > 0 && s.skus.some((x) => x.difference !== null && Math.abs(x.difference) >= 1) && (
        <Notice>
          {ctx.l({
            ru: "По некоторым SKU посчитанное количество расходится с учётным остатком у Fargo — см. таблицу ниже.",
            en: "For some SKUs the counted quantity differs from Fargo's book stock — see the table below.",
          })}
        </Notice>
      )}

      <SectionTitle>{ctx.l({ ru: "Сверка по SKU", en: "Reconciliation by SKU" })}</SectionTitle>
      <div className="mb-2 overflow-hidden rounded-lg border border-border bg-surface">
        <table className="tbl">
          <thead>
            <tr>
              <th>{ctx.l({ ru: "SKU", en: "SKU" })}</th>
              <th className="text-right">{ctx.l({ ru: "По списку Fargo", en: "Fargo's list" })}</th>
              <th className="text-right">
                {ctx.l({ ru: "Учётный остаток", en: "Book stock" })} · {monthName(s.bookMonth)}
              </th>
              <th className="text-right">{ctx.l({ ru: "Разница", en: "Difference" })}</th>
              <th className="text-right">
                {ctx.l({ ru: "Пересчёт", en: "Count" })} · {monthName(s.countMonth)}
              </th>
              <th className="text-right">{ctx.l({ ru: "Стоимость выкупа", en: "Buyback value" })}</th>
            </tr>
          </thead>
          <tbody>
            {s.skus.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted">
                  {ctx.l({ ru: "Нет данных", en: "No data" })}
                </td>
              </tr>
            )}
            {s.skus.map((x) => (
              <tr key={x.productId || x.name}>
                <td className={!x.productId ? "text-warn" : ""}>{x.name}</td>
                <td className="num text-right">{fmtN(x.lotsQty)}</td>
                <td className="num text-right">{x.book === null ? "—" : fmtN(x.book)}</td>
                <td className={`num text-right ${x.difference !== null && Math.abs(x.difference) >= 1 ? "font-semibold text-danger" : ""}`}>
                  {x.difference === null ? "—" : fmtN(x.difference)}
                </td>
                <td className="num text-right">{x.counted === null ? "—" : fmtN(x.counted)}</td>
                <td className="num text-right">{fmtN(x.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-muted">
        {ctx.l({
          ru: "Учётный остаток = отгружено TI→Fargo − продано − списано у Fargo, по данным приложения на конец последнего месяца.",
          en: "Book stock = shipped TI→Fargo − sold − written off at Fargo, from the app's data at the end of the latest month.",
        })}
      </p>

      <SectionTitle>{ctx.l({ ru: "Партии", en: "Batches" })}</SectionTitle>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <EntryGrid
          entity="trStockLot"
          rows={s.lots.map((l) => ({ ...l, unitPrice: l.unitPrice }))}
          defaults={{ status: "COUNTED", preAug2025: false }}
          sumFields={["qty", "value"]}
          cols={[
            { field: "itemName", label: ctx.l({ ru: "Товар (как у Fargo)", en: "Item (as Fargo lists it)" }), type: "text", width: "220px" },
            { field: "productId", label: ctx.l({ ru: "SKU в приложении", en: "SKU in the app" }), type: "select", options: productOptions, width: "200px" },
            { field: "batch", label: ctx.l({ ru: "Партия", en: "Batch" }), type: "text", width: "100px" },
            { field: "expiry", label: ctx.l({ ru: "Годен до", en: "Expiry" }), type: "date", width: "130px" },
            { field: "daysToExpiry", label: ctx.l({ ru: "Дней", en: "Days" }), type: "number", readOnly: true, width: "70px" },
            { field: "qty", label: ctx.l({ ru: "Кол-во", en: "Qty" }), type: "number", width: "90px" },
            { field: "location", label: ctx.l({ ru: "Склад / филиал", en: "Location" }), type: "text", width: "130px" },
            { field: "preAug2025", label: ctx.l({ ru: "До авг. 2025", en: "Pre Aug 2025" }), type: "bool", width: "90px" },
            { field: "unitPrice", label: ctx.l({ ru: "Своя цена", en: "Own price" }), type: "number", nullable: true, width: "100px" },
            { field: "priceUsed", label: ctx.l({ ru: "Цена выкупа", en: "Buyback price" }), type: "number", readOnly: true, width: "110px" },
            { field: "value", label: ctx.l({ ru: "Стоимость", en: "Value" }), type: "number", readOnly: true, width: "130px" },
            { field: "status", label: ctx.l({ ru: "Статус", en: "Status" }), type: "select", options: optionsOf(LOT_STATUS, ctx.locale), width: "150px" },
            { field: "notes", label: ctx.l({ ru: "Заметки", en: "Notes" }), type: "text", width: "160px" },
          ]}
          emptyLabel={ctx.l({ ru: "Загрузите выгрузку остатков Fargo по партиям", en: "Upload Fargo's stock-by-batch export" })}
        />
      </div>
    </>
  );
}
