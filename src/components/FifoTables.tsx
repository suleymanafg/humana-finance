"use client";

import { useT } from "@/lib/locale-context";
import { fmtN } from "@/lib/format";
import { SectionTitle, type MonthLite } from "./statement";

const dash = (v: number, d = 0) => (Math.abs(v) < (d ? 0.005 : 0.5) ? "—" : fmtN(v, d));

export default function FifoTables({
  summary,
  tiBatches,
  fargoBatches,
  monthly,
  months,
  productName,
  picker,
}: {
  summary: Array<{
    productId: string;
    name: string;
    unitsSold: number;
    fargoUnitCost: number;
    groupUnitCost: number;
    fargoUnits: number;
    fargoStock: number;
    fargoStockTi: number;
  }>;
  tiBatches: Array<{ key: string; label: string; monthId: string; qty: number; unit: number; left: number }>;
  fargoBatches: Array<{ key: string; label: string; date: string; qty: number; unit: number; tiUnit: number; left: number }>;
  monthly: Array<{
    monthId: string;
    unitsSold: number;
    fargoUnitCost: number;
    groupUnitCost: number;
    fargoCogs: number;
    groupCogs: number;
    loss: number;
  }>;
  months: MonthLite[];
  productName: string;
  picker: React.ReactNode;
}) {
  const { locale, l } = useT();
  const monthName = (id: string) => {
    const m = months.find((x) => x.id === id);
    return m ? (locale === "ru" ? m.nameRu : m.nameEn) : id;
  };
  const fmtDate = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

  return (
    <>
      <SectionTitle>{l({ ru: "Себестоимость единицы за месяц", en: "Unit cost in the month" })}</SectionTitle>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="stmt is-compact">
          <thead>
            <tr>
              <th>{l({ ru: "Товар", en: "Product" })}</th>
              <th>{l({ ru: "Продано, шт", en: "Units sold" })}</th>
              <th>{l({ ru: "Fargo: по ценам счетов TI", en: "Fargo: at TI invoice prices" })}</th>
              <th>{l({ ru: "Группа: по стоимости TI", en: "Group: at TI landed cost" })}</th>
              <th>{l({ ru: "У Fargo, шт", en: "At Fargo, units" })}</th>
              <th>{l({ ru: "Остаток по ценам счетов", en: "Stock at invoice prices" })}</th>
              <th>{l({ ru: "Остаток по стоимости TI", en: "Stock at TI cost" })}</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((r) => (
              <tr key={r.productId}>
                <td>{r.name}</td>
                <td>{dash(r.unitsSold)}</td>
                <td>{dash(r.fargoUnitCost)}</td>
                <td>{dash(r.groupUnitCost)}</td>
                <td>{dash(r.fargoUnits)}</td>
                <td>{dash(r.fargoStock)}</td>
                <td>{dash(r.fargoStockTi)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-8">{picker}</div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="min-w-0">
          <SectionTitle>{l({ ru: "Партии TI: фуры по порядку прихода", en: "TI batches: trucks in arrival order" })}</SectionTitle>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="stmt is-compact">
              <thead>
                <tr>
                  <th>{l({ ru: "Фура", en: "Truck" })}</th>
                  <th>{l({ ru: "Шт", en: "Units" })}</th>
                  <th>{l({ ru: "Себестоимость, шт", en: "Unit cost" })}</th>
                  <th>{l({ ru: "Осталось, шт", en: "Left" })}</th>
                </tr>
              </thead>
              <tbody>
                {tiBatches.map((b) => (
                  <tr key={b.key}>
                    <td>
                      {b.label} <span className="ml-1 text-[12px] text-muted">{monthName(b.monthId)}</span>
                    </td>
                    <td>{fmtN(b.qty)}</td>
                    <td>{fmtN(b.unit)}</td>
                    <td className={b.left > 0 ? "font-semibold" : "text-muted"}>{dash(b.left)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="min-w-0">
          <SectionTitle>{l({ ru: "Партии Fargo: счета-фактуры TI по дате", en: "Fargo batches: TI invoice lines by date" })}</SectionTitle>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="stmt is-compact">
              <thead>
                <tr>
                  <th>{l({ ru: "Счёт-фактура", en: "Invoice" })}</th>
                  <th>{l({ ru: "Шт", en: "Units" })}</th>
                  <th>{l({ ru: "Цена", en: "Price" })}</th>
                  <th>{l({ ru: "Себест. TI", en: "TI cost" })}</th>
                  <th>{l({ ru: "Осталось, шт", en: "Left" })}</th>
                </tr>
              </thead>
              <tbody>
                {fargoBatches.map((b) => (
                  <tr key={b.key}>
                    <td>
                      {b.label} <span className="ml-1 text-[12px] text-muted">{fmtDate(b.date)}</span>
                    </td>
                    <td>{fmtN(b.qty)}</td>
                    <td>{dash(b.unit)}</td>
                    <td>{fmtN(b.tiUnit)}</td>
                    <td className={b.left > 0 ? "font-semibold" : "text-muted"}>{dash(b.left)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <SectionTitle>{l({ ru: `По месяцам: ${productName}`, en: `By month: ${productName}` })}</SectionTitle>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="stmt is-compact">
          <thead>
            <tr>
              <th>{l({ ru: "Месяц", en: "Month" })}</th>
              <th>{l({ ru: "Продано, шт", en: "Units sold" })}</th>
              <th>{l({ ru: "Fargo, за шт", en: "Fargo, per unit" })}</th>
              <th>{l({ ru: "Группа, за шт", en: "Group, per unit" })}</th>
              <th>{l({ ru: "Себестоимость Fargo", en: "Fargo cost of goods" })}</th>
              <th>{l({ ru: "Себестоимость группы", en: "Group cost of goods" })}</th>
              <th>{l({ ru: "Потери", en: "Loss" })}</th>
            </tr>
          </thead>
          <tbody>
            {[...monthly].reverse().map((r) => (
              <tr key={r.monthId}>
                <td>{monthName(r.monthId)}</td>
                <td>{dash(r.unitsSold)}</td>
                <td>{dash(r.fargoUnitCost)}</td>
                <td>{dash(r.groupUnitCost)}</td>
                <td>{dash(r.fargoCogs)}</td>
                <td>{dash(r.groupCogs)}</td>
                <td>{dash(r.loss)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
