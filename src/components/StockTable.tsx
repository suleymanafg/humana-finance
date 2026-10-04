"use client";

import { useT } from "@/lib/locale-context";
import { fmtN } from "@/lib/format";

export interface StockRow {
  productId: string;
  name: string;
  tiUnits: number;
  fargoBook: number;
  counted: number | null;
  difference: number | null;
  cumDifference: number;
  lossMonth: number;
  fargoUnits: number;
  valueTi: number;
}

const dash = (v: number | null) => (v == null || Math.abs(v) < 0.5 ? "—" : fmtN(v));

export default function StockTable({ rows, isCountMonth }: { rows: StockRow[]; isCountMonth: boolean }) {
  const { l } = useT();
  const sum = (pick: (r: StockRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="stmt is-compact">
        <thead>
          <tr>
            <th>{l({ ru: "Товар", en: "Product" })}</th>
            <th>{l({ ru: "У TI, шт", en: "Held by TI" })}</th>
            <th>{l({ ru: "У Fargo по учёту, шт", en: "Fargo, per books" })}</th>
            <th>{l({ ru: "Пересчитано, шт", en: "Counted" })}</th>
            <th>{l({ ru: "Расхождение, шт", en: "Difference" })}</th>
            <th>{l({ ru: "Потери за месяц", en: "Loss in the month" })}</th>
            <th>{l({ ru: "Остаток по стоимости TI", en: "Stock at TI cost" })}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.productId}>
              <td>{r.name}</td>
              <td>{dash(r.tiUnits)}</td>
              <td>{dash(r.fargoBook)}</td>
              <td>{isCountMonth ? dash(r.counted) : "—"}</td>
              <td className={(r.difference ?? 0) > 0 ? "text-danger" : ""}>{isCountMonth ? dash(r.difference) : "—"}</td>
              <td>{dash(r.lossMonth)}</td>
              <td>{dash(r.valueTi)}</td>
            </tr>
          ))}
          <tr className="is-subtotal">
            <td>{l({ ru: "Итого", en: "Total" })}</td>
            <td>{dash(sum((r) => r.tiUnits))}</td>
            <td>{dash(sum((r) => r.fargoBook))}</td>
            <td>{isCountMonth ? dash(sum((r) => r.counted ?? 0)) : "—"}</td>
            <td>{isCountMonth ? dash(sum((r) => r.difference ?? 0)) : "—"}</td>
            <td>{dash(sum((r) => r.lossMonth))}</td>
            <td>{dash(sum((r) => r.valueTi))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
