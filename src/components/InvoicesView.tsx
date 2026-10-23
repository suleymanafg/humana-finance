"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
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
  /** the product's name on an uploaded invoice */
  source?: string;
}

/** An invoice read from a Didox PDF, ready to check and save. */
interface Prefill {
  date: string;
  number: string;
  lines: Draft[];
  notices: Array<{ warn: boolean; text: string }>;
}

interface DidoxRead {
  number: string | null;
  date: string | null;
  seller: string | null;
  buyer: string | null;
  fromTiToFargo: boolean;
  lines: Array<{ name: string; productId: string | null; qty: number; price: number; amount: number; vat: number }>;
  total: number;
  addsUp: boolean;
  alreadyEntered: number;
  monthExists: boolean;
  monthClosed: boolean;
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
  const pathname = usePathname();
  const [editing, setEditing] = useState<InvoiceRow | "new" | null>(null);
  /** the invoice opened as a document (date|number) */
  const [open, setOpen] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id;
  const monthName = (id: string) => {
    const m = months.find((x) => x.id === id);
    return m ? l({ ru: m.nameRu, en: m.nameEn }) : id;
  };

  const invoices = useMemo(() => {
    const groups = new Map<string, InvoiceRow[]>();
    for (const r of rows) {
      const key = `${r.date}|${r.number}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    return [...groups.entries()].map(([key, lines]) => ({ key, date: lines[0].date, number: lines[0].number, lines }));
  }, [rows]);
  const openInvoice = invoices.find((x) => x.key === open) ?? null;

  const sum = (pick: (r: InvoiceRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const amount = sum((r) => r.amount);
  const vat = sum((r) => r.vat);
  const cost = sum((r) => r.tiCost);
  const fmtDate = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

  async function readDidox(file: File) {
    setReading(true);
    setReadError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/import/ti-invoice", { method: "POST", body });
      const data = (await res.json()) as DidoxRead & { error?: string };
      if (!res.ok || data.error) {
        const reasons: Record<string, { ru: string; en: string }> = {
          "no-text": {
            ru: "В этом PDF нет текста. Нужна счёт-фактура, скачанная из Didox, а не скан.",
            en: "This PDF has no text. Use the invoice downloaded from Didox, not a scan.",
          },
          "no-lines": {
            ru: "Строки счёт-фактуры не найдены. Внесите её вручную.",
            en: "No invoice lines were found. Enter the invoice by hand.",
          },
          unreadable: { ru: "Не удалось открыть PDF.", en: "The PDF could not be opened." },
          "too-large": { ru: "Файл больше 15 МБ.", en: "The file is over 15 MB." },
          forbidden: { ru: "Нет прав на внесение данных.", en: "You cannot enter data." },
        };
        setReadError(l(reasons[data.error ?? ""] ?? { ru: `Ошибка: ${data.error ?? res.status}`, en: `Error: ${data.error ?? res.status}` }));
        return;
      }
      setPrefill(prefillFrom(data));
      setEditing("new");
    } catch {
      setReadError(l({ ru: "Нет связи с сервером.", en: "The server could not be reached." }));
    } finally {
      setReading(false);
    }
  }

  function prefillFrom(d: DidoxRead): Prefill {
    const ru = locale === "ru";
    const date = d.date ?? `${monthId}-01`;
    const notices: Prefill["notices"] = [
      {
        warn: false,
        text: ru
          ? `Из Didox: счёт-фактура № ${d.number ?? "—"} от ${d.date ? fmtDate(d.date) : "—"}, строк: ${d.lines.length}, ${fmtN(d.total)} сум с НДС. Проверьте и сохраните.`
          : `From Didox: invoice № ${d.number ?? "—"} of ${d.date ? fmtDate(d.date) : "—"}, ${d.lines.length} lines, ${fmtN(d.total)} UZS incl. VAT. Check it and save.`,
      },
    ];
    const add = (warn: boolean, text: { ru: string; en: string }) => notices.push({ warn, text: l(text) });
    if (!d.date || !d.number) add(true, { ru: "Номер или дата не прочитаны — укажите их.", en: "The number or date was not read — fill it in." });
    if (d.date && d.date.slice(0, 7) !== monthId)
      add(false, { ru: `Месяц по дате счёт-фактуры: ${monthName(d.date.slice(0, 7))}.`, en: `Month by the invoice date: ${monthName(d.date.slice(0, 7))}.` });
    if (!d.fromTiToFargo)
      add(true, {
        ru: `Это не счёт-фактура Turbo Impex для Fargo: ${d.seller ?? "—"} → ${d.buyer ?? "—"}.`,
        en: `This is not an invoice from Turbo Impex to Fargo: ${d.seller ?? "—"} → ${d.buyer ?? "—"}.`,
      });
    const unknown = d.lines.filter((x) => !x.productId).map((x) => `«${x.name}»`);
    if (unknown.length > 0)
      add(true, { ru: `Товар не узнан: ${unknown.join(", ")}. Выберите его в строке.`, en: `Product not recognised: ${unknown.join(", ")}. Choose it in the line.` });
    if (!d.addsUp)
      add(true, { ru: "Строки не сходятся с итогом счёт-фактуры — сверьте с PDF.", en: "The lines do not add up to the invoice total — check against the PDF." });
    if (d.alreadyEntered > 0)
      add(true, {
        ru: `Эта счёт-фактура уже внесена (строк: ${d.alreadyEntered}). Сохранение добавит её второй раз.`,
        en: `This invoice is already entered (${d.alreadyEntered} lines). Saving adds it a second time.`,
      });
    if (!d.monthExists)
      add(true, {
        ru: `Месяца ${date.slice(0, 7)} нет в справочнике — добавьте его в настройках, иначе счёт-фактура не будет видна.`,
        en: `Month ${date.slice(0, 7)} is not in the reference data — add it in Settings, or the invoice will not show.`,
      });
    else if (d.monthClosed)
      add(true, { ru: `${monthName(date.slice(0, 7))} закрыт — сохранить может только администратор.`, en: `${monthName(date.slice(0, 7))} is closed — only an administrator can save.` });
    return {
      date,
      number: d.number ?? "",
      lines: d.lines.map((x) => ({
        productId: x.productId ?? "",
        qty: String(x.qty),
        price: String(x.price),
        amount: String(x.amount),
        vat: String(x.vat),
        ownUnitCost: "",
        source: x.name,
      })),
      notices,
    };
  }

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
        right={
          !readOnly && (
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readDidox(file);
                  e.target.value = "";
                }}
              />
              <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={reading}>
                {reading ? l({ ru: "Читаю PDF…", en: "Reading the PDF…" }) : l({ ru: "Загрузить из Didox", en: "Upload from Didox" })}
              </Button>
              <Button
                onClick={() => {
                  setPrefill(null);
                  setEditing("new");
                }}
              >
                {l({ ru: "Добавить счёт-фактуру", en: "Add invoice" })}
              </Button>
            </div>
          )
        }
      >
        {l({ ru: "Счета-фактуры за месяц", en: "Invoices in the month" })}
      </SectionTitle>
      {readError && <p className="-mt-1 mb-3 text-[12.5px] text-danger">{readError}</p>}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="stmt">
          <thead>
            <tr>
              <th>{l({ ru: "Счёт-фактура", en: "Invoice" })}</th>
              <th>{l({ ru: "Дата", en: "Date" })}</th>
              <th>{l({ ru: "Строк", en: "Lines" })}</th>
              <th>{l({ ru: "Кол-во", en: "Qty" })}</th>
              <th>{l({ ru: "Без НДС", en: "Ex-VAT" })}</th>
              <th>{l({ ru: "НДС", en: "VAT" })}</th>
              <th>{l({ ru: "С НДС", en: "Incl. VAT" })}</th>
              <th>{l({ ru: "Себестоимость TI", en: "TI cost" })}</th>
              <th>{l({ ru: "Маржа", en: "Margin" })}</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 && (
              <tr>
                <td colSpan={9} className="!py-8 !text-center text-muted">
                  {l({ ru: "В этом месяце счетов-фактур нет", en: "No invoices this month" })}
                </td>
              </tr>
            )}
            {invoices.map((inv) => {
              const s = (pick: (r: InvoiceRow) => number) => inv.lines.reduce((t, r) => t + pick(r), 0);
              return (
                <tr key={inv.key} onClick={() => setOpen(inv.key)} className="cursor-pointer hover:bg-surface-low">
                  <td>
                    <span className="font-medium text-accent">№ {inv.number}</span>
                  </td>
                  <td>{fmtDate(inv.date)}</td>
                  <td>{inv.lines.length}</td>
                  <td>{fmtN(s((r) => r.qty))}</td>
                  <td>{fmtN(s((r) => r.amount))}</td>
                  <td>{fmtN(s((r) => r.vat))}</td>
                  <td>{fmtN(s((r) => r.amount + r.vat))}</td>
                  <td>{fmtN(s((r) => r.tiCost))}</td>
                  <td className={s((r) => r.amount - r.tiCost) < 0 ? "text-danger" : ""}>{fmtN(s((r) => r.amount - r.tiCost))}</td>
                </tr>
              );
            })}
            {rows.length > 0 && (
              <tr className="is-subtotal">
                <td>{l({ ru: "Итого за месяц", en: "Month total" })}</td>
                <td />
                <td>{rows.length}</td>
                <td>{fmtN(sum((r) => r.qty))}</td>
                <td>{fmtN(amount)}</td>
                <td>{fmtN(vat)}</td>
                <td>{fmtN(amount + vat)}</td>
                <td>{fmtN(cost)}</td>
                <td>{fmtN(amount - cost)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {invoices.length > 0 && (
        <p className="mt-2 text-[12px] text-muted">{l({ ru: "Нажмите на счёт-фактуру — откроется документ со всеми строками и выгрузкой в Excel.", en: "Click an invoice to open the document with every line and an Excel download." })}</p>
      )}

      {openInvoice && (
        <InvoiceDocument
          invoice={openInvoice}
          productName={productName}
          fmtDate={fmtDate}
          locale={locale}
          readOnly={readOnly}
          onClose={() => setOpen(null)}
          onEdit={(r) => {
            setOpen(null);
            setEditing(r);
          }}
          onRemove={(id) => {
            setOpen(null);
            void remove(id);
          }}
        />
      )}

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
          prefill={editing === "new" ? prefill : null}
          nextSortOrder={nextSortOrder}
          locale={locale}
          onClose={() => {
            setEditing(null);
            setPrefill(null);
          }}
          onSaved={(date) => {
            setEditing(null);
            setPrefill(null);
            // an invoice dated in another month is shown there
            const m = date.slice(0, 7);
            if (m !== monthId && months.some((x) => x.id === m)) router.push(`${pathname}?month=${m}`);
            else router.refresh();
          }}
        />
      )}
    </>
  );
}

/** One invoice as a document: every line as printed, the totals, TI's cost and margin, an Excel download. */
function InvoiceDocument({
  invoice,
  productName,
  fmtDate,
  locale,
  readOnly,
  onClose,
  onEdit,
  onRemove,
}: {
  invoice: { date: string; number: string; lines: InvoiceRow[] };
  productName: (id: string) => string;
  fmtDate: (d: string) => string;
  locale: "ru" | "en";
  readOnly: boolean;
  onClose: () => void;
  onEdit: (r: InvoiceRow) => void;
  onRemove: (id: string) => void;
}) {
  const ru = locale === "ru";
  const s = (pick: (r: InvoiceRow) => number) => invoice.lines.reduce((t, r) => t + pick(r), 0);
  const amount = s((r) => r.amount);
  const margin = s((r) => r.amount - r.tiCost);
  const href = `/api/export/invoice?number=${encodeURIComponent(invoice.number)}&date=${invoice.date}&locale=${locale}`;
  return (
    <Modal title={`${ru ? "Счёт-фактура" : "Invoice"} № ${invoice.number} ${ru ? "от" : "of"} ${fmtDate(invoice.date)}`} onClose={onClose} wide="xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[13px] text-muted">
          {ru ? "Поставщик" : "Seller"}: <span className="text-foreground">Turbo Impex</span> · {ru ? "Покупатель" : "Buyer"}: <span className="text-foreground">Fargo</span>
        </div>
        <a href={href} className="inline-flex h-8 items-center rounded-md border border-border bg-surface px-3 text-[12.5px] text-foreground transition-colors hover:bg-surface-low">
          {ru ? "Скачать Excel" : "Download Excel"}
        </a>
      </div>
      <div className="overflow-x-auto">
        <table className="stmt is-compact">
          <thead>
            <tr>
              <th>№</th>
              <th>{ru ? "Товар" : "Product"}</th>
              <th>{ru ? "Кол-во, шт" : "Qty, pcs"}</th>
              <th>{ru ? "Цена без НДС" : "Price ex-VAT"}</th>
              <th>{ru ? "Стоимость без НДС" : "Value ex-VAT"}</th>
              <th>{ru ? "Ставка" : "Rate"}</th>
              <th>{ru ? "НДС" : "VAT"}</th>
              <th>{ru ? "С НДС" : "Incl. VAT"}</th>
              {!readOnly && <th className="w-16" />}
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((r, i) => (
              <tr key={r.id}>
                <td>{i + 1}</td>
                <td>
                  {productName(r.productId)}
                  {r.ownUnitCost != null && <span className="ml-2 text-[11.5px] text-muted">{ru ? "вне FIFO, своя себестоимость" : "outside FIFO, own cost"}</span>}
                </td>
                <td>{fmtN(r.qty)}</td>
                <td>{fmtN(r.price, 2)}</td>
                <td>{fmtN(r.amount, 2)}</td>
                <td>{r.amount ? fmtPct(r.vat / r.amount) : "—"}</td>
                <td>{fmtN(r.vat, 2)}</td>
                <td>{fmtN(r.amount + r.vat, 2)}</td>
                {!readOnly && (
                  <td>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => onEdit(r)} className="text-[12px] text-muted hover:text-accent">
                        {ru ? "Изм." : "Edit"}
                      </button>
                      <button onClick={() => onRemove(r.id)} className="text-muted hover:text-danger" aria-label={ru ? "Удалить" : "Delete"}>
                        <IconTrash size={13} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            <tr className="is-subtotal">
              <td />
              <td>{ru ? "Итого" : "Total"}</td>
              <td>{fmtN(s((r) => r.qty))}</td>
              <td />
              <td>{fmtN(amount, 2)}</td>
              <td />
              <td>{fmtN(s((r) => r.vat), 2)}</td>
              <td>{fmtN(amount + s((r) => r.vat), 2)}</td>
              {!readOnly && <td />}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-5 text-[12.5px] font-semibold">{ru ? "Себестоимость и маржа TI (для учёта, не часть документа)" : "TI cost and margin (for TI's records, not part of the document)"}</div>
      <table className="stmt is-compact mt-2">
        <thead>
          <tr>
            <th>{ru ? "Товар" : "Product"}</th>
            <th>{ru ? "Себест., шт" : "Unit cost"}</th>
            <th>{ru ? "Себестоимость TI" : "TI cost"}</th>
            <th>{ru ? "Маржа" : "Margin"}</th>
            <th>%</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((r) => (
            <tr key={r.id}>
              <td>{productName(r.productId)}</td>
              <td>{r.qty ? fmtN(r.tiCost / r.qty) : "—"}</td>
              <td>{fmtN(r.tiCost)}</td>
              <td className={r.amount - r.tiCost < 0 ? "text-danger" : ""}>{fmtN(r.amount - r.tiCost)}</td>
              <td>{r.amount ? fmtPct((r.amount - r.tiCost) / r.amount) : "—"}</td>
            </tr>
          ))}
          <tr className="is-subtotal">
            <td>{ru ? "Итого" : "Total"}</td>
            <td />
            <td>{fmtN(s((r) => r.tiCost))}</td>
            <td className={margin < 0 ? "text-danger" : ""}>{fmtN(margin)}</td>
            <td>{amount ? fmtPct(margin / amount) : "—"}</td>
          </tr>
        </tbody>
      </table>
    </Modal>
  );
}

function InvoiceModal({
  monthId,
  products,
  vatRate,
  row,
  prefill,
  nextSortOrder,
  locale,
  onClose,
  onSaved,
}: {
  monthId: string;
  products: Array<{ id: string; name: string }>;
  vatRate: number;
  row: InvoiceRow | null;
  prefill: Prefill | null;
  nextSortOrder: number;
  locale: "ru" | "en";
  onClose: () => void;
  onSaved: (date: string) => void;
}) {
  const ru = locale === "ru";
  const [date, setDate] = useState(row?.date ?? prefill?.date ?? `${monthId}-01`);
  const [number, setNumber] = useState(row?.number ?? prefill?.number ?? "");
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
      : prefill?.lines ?? [emptyLine()]
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
    onSaved(date);
  }

  return (
    <Modal title={row ? (ru ? "Строка счёта-фактуры" : "Invoice line") : ru ? "Новая счёт-фактура" : "New invoice"} onClose={onClose} wide="xl">
      {prefill && (
        <div className="mb-4 space-y-1.5">
          {prefill.notices.map((n, i) => (
            <div
              key={i}
              className={`rounded-md border p-2.5 text-[12.5px] ${n.warn ? "border-warn/40 bg-warn-soft text-warn" : "border-border bg-surface-low text-muted"}`}
            >
              {n.text}
            </div>
          ))}
        </div>
      )}
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
      <table className="stmt is-compact">
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
                <Select
                  value={x.productId}
                  onChange={(e) => set(i, { productId: e.target.value })}
                  className={`w-full min-w-56 ${x.source && !x.productId ? "!border-warn" : ""}`}
                >
                  <option value="">{ru ? "Выберите товар" : "Choose a product"}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                {x.source && (
                  <div className="mt-1 text-[11.5px] text-muted">
                    {ru ? "в счёт-фактуре" : "on the invoice"}: {x.source}
                  </div>
                )}
              </td>
              <td>
                <Input numeric value={x.qty} onChange={(e) => set(i, { qty: e.target.value })} className="w-20 text-right" />
              </td>
              <td>
                <Input numeric value={x.price} onChange={(e) => set(i, { price: e.target.value })} className="w-28 text-right" />
              </td>
              <td>
                <Input numeric value={x.amount} onChange={(e) => set(i, { amount: e.target.value })} className="w-36 text-right" />
              </td>
              <td>
                <Input numeric value={x.vat} onChange={(e) => set(i, { vat: e.target.value })} className="w-32 text-right" />
              </td>
              <td>
                <Input numeric value={x.ownUnitCost} onChange={(e) => set(i, { ownUnitCost: e.target.value })} placeholder="—" className="w-24 text-right" />
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
