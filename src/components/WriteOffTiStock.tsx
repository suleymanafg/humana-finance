"use client";

// Writes off what TI still holds at a month's end — samples, laboratory and
// gifts that never go to Fargo — in one step: every product with TI stock,
// its quantity filled in, dated the last day of the month.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { crud } from "@/lib/crud-client";
import { fmtN, parseNum } from "@/lib/format";
import { Button, Input, Modal } from "./ui";

export interface TiStockRow {
  productId: string;
  name: string;
  units: number;
  /** TI's stock of the product at landed cost (FIFO) */
  value: number;
}

export default function WriteOffTiStock({
  monthId,
  monthName,
  rows,
}: {
  monthId: string;
  monthName: string;
  rows: TiStockRow[];
}) {
  const { l } = useT();
  const router = useRouter();
  const held = rows.filter((r) => r.units > 0);
  const total = held.reduce((s, r) => s + r.units, 0);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [y, m] = monthId.split("-").map(Number);
  const [date, setDate] = useState(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (held.length === 0) return null;

  const qtyOf = (r: TiStockRow) => parseNum(qty[r.productId] ?? String(r.units)) ?? 0;
  const costOf = (r: TiStockRow) => (r.units > 0 ? (r.value / r.units) * qtyOf(r) : 0);
  const chosen = held.filter((r) => qtyOf(r) > 0);
  const tooMany = held.some((r) => qtyOf(r) > r.units);
  const inMonth = date.slice(0, 7) === monthId;

  async function save() {
    if (busy || chosen.length === 0 || tooMany || !inMonth) return;
    setBusy(true);
    setError(null);
    for (const r of chosen) {
      const res = await crud("tiWriteOff", "create", {
        data: { date, productId: r.productId, qty: qtyOf(r), reason: reason.trim() || null },
      });
      if (res.error) {
        setError(res.error === "month is closed" ? l({ ru: "Месяц закрыт.", en: "The month is closed." }) : res.error);
        setBusy(false);
        router.refresh();
        return;
      }
    }
    setBusy(false);
    setOpen(false);
    setQty({});
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {l({ ru: `Списать остаток TI · ${fmtN(total)} шт`, en: `Write off TI's stock · ${fmtN(total)} units` })}
      </Button>
      {open && (
        <Modal title={l({ ru: `Списание остатка TI — ${monthName}`, en: `Write off TI's stock — ${monthName}` })} onClose={() => setOpen(false)} wide>
          <p className="mb-4 text-[12.5px] text-muted">
            {l({
              ru: "Товар, который остался у TI и не пойдёт Fargo: образцы, лаборатория, подарки. Списывается по себестоимости TI (FIFO) и попадает в расходы TI этого месяца.",
              en: "Goods TI still holds that will not go to Fargo: samples, laboratory, gifts. Written off at TI's cost (FIFO), as TI's expense of this month.",
            })}
          </p>
          <table className="stmt is-compact">
            <thead>
              <tr>
                <th>{l({ ru: "Товар", en: "Product" })}</th>
                <th>{l({ ru: "У TI, шт", en: "Held by TI" })}</th>
                <th>{l({ ru: "Списать, шт", en: "Write off" })}</th>
                <th>{l({ ru: "Себестоимость", en: "Cost" })}</th>
              </tr>
            </thead>
            <tbody>
              {held.map((r) => (
                <tr key={r.productId}>
                  <td>{r.name}</td>
                  <td>{fmtN(r.units)}</td>
                  <td>
                    <Input
                      numeric
                      value={qty[r.productId] ?? String(r.units)}
                      onChange={(e) => setQty({ ...qty, [r.productId]: e.target.value })}
                      className={`w-20 text-right ${qtyOf(r) > r.units ? "!border-warn" : ""}`}
                    />
                  </td>
                  <td>{fmtN(costOf(r))}</td>
                </tr>
              ))}
              <tr className="is-subtotal">
                <td>{l({ ru: "Итого", en: "Total" })}</td>
                <td>{fmtN(total)}</td>
                <td>{fmtN(held.reduce((s, r) => s + qtyOf(r), 0))}</td>
                <td>{fmtN(held.reduce((s, r) => s + costOf(r), 0))}</td>
              </tr>
            </tbody>
          </table>
          <div className="mt-4 flex flex-wrap gap-3">
            <label className="block">
              <span className="mb-1 block text-[12px] text-muted">{l({ ru: "Дата", en: "Date" })}</span>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
            </label>
            <label className="block min-w-64 flex-1">
              <span className="mb-1 block text-[12px] text-muted">{l({ ru: "Причина", en: "Reason" })}</span>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={l({ ru: "например, образцы для лаборатории", en: "e.g. samples for the laboratory" })}
                className="w-full"
              />
            </label>
          </div>
          {(tooMany || !inMonth || error) && (
            <div className="mt-3 rounded-md border border-warn/40 bg-warn-soft p-2.5 text-[12.5px] text-warn">
              {error ??
                (tooMany
                  ? l({ ru: "Нельзя списать больше, чем есть у TI.", en: "You cannot write off more than TI holds." })
                  : l({ ru: `Дата должна быть в месяце ${monthName}.`, en: `The date must be in ${monthName}.` }))}
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {l({ ru: "Отмена", en: "Cancel" })}
            </Button>
            <Button onClick={save} disabled={busy || chosen.length === 0 || tooMany || !inMonth}>
              {busy ? l({ ru: "Списание…", en: "Writing off…" }) : l({ ru: "Списать", en: "Write off" })}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
