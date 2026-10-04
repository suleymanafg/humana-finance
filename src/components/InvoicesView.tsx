"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { crud } from "@/lib/crud-client";
import { fmtN, fmtPct, parseNum } from "@/lib/format";
import { Button, Input, Modal, Select } from "./ui";
import { IconTrash } from "./icons";
import { Figure, SectionTitle } from "./statement";
import MonthTotals from "./MonthTotals";
import type { MonthLite } from "./statement";

export interface InvoiceRow {
  id: string;
  date: string; // YYYY-MM-DD
  number: string;
  productId: string;
  qty: number;
  price: number;
  amount: number;
  vat: number;
  ownUnitCost: number | null;
  notes: string | null;
  sortOrder: number;
  tiCost: number;
}

interface Draft {
  productId: string;
  qty: string;
  price: string;
  amount: string;
  vat: string;
  ownUnitCost: string;
}

const emptyLine = (): Draft => ({ productId: "", qty: "", price: "", amount: "", vat: "", ownUnitCost: "" });
const round2 = (v: number) => Math.round(v * 100) / 100;

export default function InvoicesView({
  months,
  monthId,
  rows,
  products,
  byMonth,
  vatRate,
  nextSortOrder,
  readOnly,
}: {
  months: MonthLite[];
  monthId: string;
  rows: InvoiceRow[];
  products: Array<{ id: string; name: string }>;
  byMonth: Array<{ monthId: string; values: number[] }>;
  vatRate: number;
  nextSortOrder: number;
  readOnly: boolean;
}) {
  const { locale, l } = useT();
  const router = useRouter();
  const [editing, setEditing] = useState<InvoiceRow | "new" | null>(null);
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id;

  const invoices = useMemo(() => {
    const groups = new Map<string, InvoiceRow[]>();
    for (const r of rows) {
      const key = `${r.date}|${r.number}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    return [...groups.entries()].map(([key, lines]) => ({ key, date: lines[0].date, number: lines[0].number, lines }));
  }, [rows]);

  const sum = (pick: (r: InvoiceRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const amount = sum((r) => r.amount);
  const vat = sum((r) => r.vat);
  const cost = sum((r) => r.tiCost);
  const fmtDate = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

  async function remove(id: string) {
    if (!confirm(l({ ru: "Удалить строку счёта-фактуры?", en: "Delete this invoice line?" }))) return;
    await crud("tiInvoiceLine", "delete", { id });
    router.refresh();
  }

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label={l({ ru: "Выставлено без НДС", en: "Invoiced ex-VAT" })} value={fmtN(amount)} sub={`${fmtN(sum((r) => r.qty))} ${l({ ru: "шт", en: "units" })}`} />
        <Figure label={l({ ru: "НДС по счетам", en: "VAT on the invoices" })} value={fmtN(vat)} sub={`${l({ ru: "с НДС", en: "incl. VAT" })} ${fmtN(amount + vat)}`} />
        <Figure label={l({ ru: "Себестоимость TI, FIFO", en: "TI cost, FIFO" })} value={fmtN(cost)} />
        <Figure
          label={l({ ru: "Маржа TI", en: "TI margin" })}
          value={fmtN(amount - cost)}
          sub={amount !== 0 ? fmtPct((amount - cost) / amount) : undefined}
          tone={amount - cost < 0 ? "neg" : undefined}
        />
      </div>

      <SectionTitle
        right={!readOnly && <Button onClick={() => setEditing("new")}>{l({ ru: "Добавить счёт-фактуру", en: "Add invoice" })}</Button>}
      >
        {l({ ru: "Счета-фактуры за месяц", en: "Invoices in the month" })}
      </SectionTitle>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="stmt">
          <thead>
            <tr>
              <th>{l({ ru: "Товар", en: "Product" })}</th>
              <th>{l({ ru: "Кол-во", en: "Qty" })}</th>
              <th>{l({ ru: "Цена без НДС", en: "Price ex-VAT" })}</th>
              <th>{l({ ru: "Сумма без НДС", en: "Amount ex-VAT" })}</th>
              <th>{l({ ru: "НДС", en: "VAT" })}</th>
              <th>{l({ ru: "Себестоимость TI", en: "TI cost" })}</th>
              <th>{l({ ru: "Маржа", en: "Margin" })}</th>
              {!readOnly && <th className="w-16" />}
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 && (
              <tr>
                <td colSpan={8} className="!py-8 !text-center text-muted">
                  {l({ ru: "В этом месяце счетов-фактур нет", en: "No invoices this month" })}
                </td>
              </tr>
            )}
            {invoices.map((inv) => (
              <Fragment key={inv.key}>
                <tr className="is-header">
                  <td colSpan={readOnly ? 7 : 8} className="!normal-case !tracking-normal">
                    <span className="text-[12.5px] font-semibold text-foreground">
                      {l({ ru: "Счёт-фактура", en: "Invoice" })} № {inv.number}
                    </span>
                    <span className="ml-2 text-[12px] font-normal text-muted">{fmtDate(inv.date)}</span>
                  </td>
                </tr>
                {inv.lines.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="pl-4">{productName(r.productId)}</span>
                      {r.ownUnitCost != null && (
                        <span className="ml-2 text-[11.5px] text-muted">
                          {l({ ru: "вне FIFO, своя себестоимость", en: "outside FIFO, own cost" })}
                        </span>
                      )}
                    </td>
                    <td>{fmtN(r.qty)}</td>
                    <td>{fmtN(r.price, 2)}</td>
                    <td>{fmtN(r.amount)}</td>
                    <td>{fmtN(r.vat)}</td>
                    <td>{fmtN(r.tiCost)}</td>
                    <td className={r.amount - r.tiCost < 0 ? "text-danger" : ""}>{fmtN(r.amount - r.tiCost)}</td>
                    {!readOnly && (
                      <td>
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setEditing(r)} className="text-[12px] text-muted hover:text-accent">
                            {l({ ru: "Изм.", en: "Edit" })}
                          </button>
                          <button
                            onClick={() => remove(r.id)}
                            className="text-muted hover:text-danger"
                            aria-label={l({ ru: "Удалить", en: "Delete" })}
                          >
                            <IconTrash size={13} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </Fragment>
            ))}
            {rows.length > 0 && (
              <tr className="is-subtotal">
                <td>{l({ ru: "Итого за месяц", en: "Month total" })}</td>
                <td>{fmtN(sum((r) => r.qty))}</td>
                <td />
                <td>{fmtN(amount)}</td>
                <td>{fmtN(vat)}</td>
                <td>{fmtN(cost)}</td>
                <td>{fmtN(amount - cost)}</td>
                {!readOnly && <td />}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <SectionTitle>{l({ ru: "По месяцам", en: "By month" })}</SectionTitle>
      <MonthTotals
        months={months}
        rows={byMonth}
        columns={[
          { ru: "Штук", en: "Units" },
          { ru: "Без НДС", en: "Ex-VAT" },
          { ru: "НДС", en: "VAT" },
          { ru: "Себестоимость TI", en: "TI cost" },
          { ru: "Маржа TI", en: "TI margin" },
        ]}
      />

      {editing && (
        <InvoiceModal
          monthId={monthId}
          products={products}
          vatRate={vatRate}
          row={editing === "new" ? null : editing}
          nextSortOrder={nextSortOrder}
          locale={locale}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function InvoiceModal({
  monthId,
  products,
  vatRate,
  row,
  nextSortOrder,
  locale,
  onClose,
  onSaved,
}: {
  monthId: string;
  products: Array<{ id: string; name: string }>;
  vatRate: number;
  row: InvoiceRow | null;
  nextSortOrder: number;
  locale: "ru" | "en";
  onClose: () => void;
  onSaved: () => void;
}) {
  const ru = locale === "ru";
  const [date, setDate] = useState(row?.date ?? `${monthId}-01`);
  const [number, setNumber] = useState(row?.number ?? "");
  const [lines, setLines] = useState<Draft[]>(
    row
      ? [
          {
            productId: row.productId,
            qty: String(row.qty),
            price: String(row.price),
            amount: String(row.amount),
            vat: String(row.vat),
            ownUnitCost: row.ownUnitCost == null ? "" : String(row.ownUnitCost),
          },
        ]
      : [emptyLine()]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = (v: string) => parseNum(v) ?? 0;
  const set = (i: number, patch: Partial<Draft>) =>
    setLines((ls) =>
      ls.map((x, j) => {
        if (j !== i) return x;
        const next = { ...x, ...patch };
        // amount and VAT follow quantity × price until typed over
        if ("qty" in patch || "price" in patch) {
          const amount = round2(n(next.qty) * n(next.price));
          next.amount = amount ? String(amount) : "";
          next.vat = amount ? String(round2(amount * vatRate)) : "";
        }
        if ("amount" in patch) next.vat = next.amount ? String(round2(n(next.amount) * vatRate)) : "";
        return next;
      })
    );
  const valid = number.trim() !== "" && date !== "" && lines.every((x) => x.productId && n(x.qty) !== 0);

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    for (const [i, x] of lines.entries()) {
      const data = {
        date,
        number: number.trim(),
        productId: x.productId,
        qty: n(x.qty),
        price: n(x.price),
        amount: n(x.amount),
        vat: n(x.vat),
        ownUnitCost: x.ownUnitCost.trim() === "" ? null : n(x.ownUnitCost),
        ...(row ? {} : { sortOrder: nextSortOrder + i }),
      };
      const res = row
        ? await crud("tiInvoiceLine", "update", { id: row.id, data })
        : await crud("tiInvoiceLine", "create", { data });
      if (res.error) {
        setError(res.error);
        setBusy(false);
        return;
      }
    }
    onSaved();
  }

  return (
    <Modal title={row ? (ru ? "Строка счёта-фактуры" : "Invoice line") : ru ? "Новая счёт-фактура" : "New invoice"} onClose={onClose} wide>
      <div className="mb-4 flex flex-wrap gap-3">
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">{ru ? "Номер" : "Number"}</span>
          <Input value={number} onChange={(e) => setNumber(e.target.value)} className="w-32" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">{ru ? "Дата" : "Date"}</span>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
        </label>
      </div>
      <table className="stmt">
        <thead>
          <tr>
            <th>{ru ? "Товар" : "Product"}</th>
            <th>{ru ? "Кол-во" : "Qty"}</th>
            <th>{ru ? "Цена без НДС" : "Price ex-VAT"}</th>
            <th>{ru ? "Сумма без НДС" : "Amount ex-VAT"}</th>
            <th>{ru ? "НДС" : "VAT"}</th>
            <th title={ru ? "Только для товара вне FIFO, например бесплатного от Humana" : "Only for goods outside FIFO, e.g. free goods from Humana"}>
              {ru ? "Своя себест., шт" : "Own cost, unit"}
            </th>
            {!row && <th className="w-8" />}
          </tr>
        </thead>
        <tbody>
          {lines.map((x, i) => (
            <tr key={i}>
              <td>
                <Select value={x.productId} onChange={(e) => set(i, { productId: e.target.value })} className="w-full min-w-56">
                  <option value="">{ru ? "Выберите товар" : "Choose a product"}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </td>
              <td>
                <Input value={x.qty} onChange={(e) => set(i, { qty: e.target.value })} className="w-20 text-right" />
              </td>
              <td>
                <Input value={x.price} onChange={(e) => set(i, { price: e.target.value })} className="w-28 text-right" />
              </td>
              <td>
                <Input value={x.amount} onChange={(e) => set(i, { amount: e.target.value })} className="w-36 text-right" />
              </td>
              <td>
                <Input value={x.vat} onChange={(e) => set(i, { vat: e.target.value })} className="w-32 text-right" />
              </td>
              <td>
                <Input value={x.ownUnitCost} onChange={(e) => set(i, { ownUnitCost: e.target.value })} placeholder="—" className="w-24 text-right" />
              </td>
              {!row && (
                <td>
                  <button
                    onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))}
                    className="text-muted hover:text-danger"
                    aria-label={ru ? "Убрать строку" : "Remove line"}
                  >
                    <IconTrash size={13} />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!row && (
        <button onClick={() => setLines((ls) => [...ls, emptyLine()])} className="mt-2 text-[12.5px] font-medium text-accent hover:underline">
          {ru ? "Добавить строку" : "Add a line"}
        </button>
      )}
      {error && <div className="mt-3 rounded-md border border-warn/40 bg-warn-soft p-2.5 text-[12.5px] text-warn">{error}</div>}
      <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" onClick={onClose}>
          {ru ? "Отмена" : "Cancel"}
        </Button>
        <Button onClick={save} disabled={!valid || busy}>
          {busy ? (ru ? "Сохранение…" : "Saving…") : ru ? "Сохранить" : "Save"}
        </Button>
      </div>
    </Modal>
  );
}
