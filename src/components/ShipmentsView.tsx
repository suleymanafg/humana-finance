"use client";

// COGS workspace redesigned per the owner's Stitch mock (2026-07-31):
//   metric tiles → «Поставки» list where clicking a row expands its full
//   detail inline (product lines + import expenses, both editable) →
//   secondary analytics collapsed below. «Новая поставка» opens a single
//   modal where the whole shipment — lines, rate, expenses — is entered at
//   once with a live landed-cost summary. Simplicity first.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input, Modal, Num, PageTitle, Select } from "./ui";
import { IconAlert, IconChevronDown, IconChevronRight, IconDownload, IconPlus, IconTrash } from "./icons";
import {
  Collapsible,
  MetricStrip,
  Money,
  ShareBar,
  Th,
  fmtN,
  fmtPct,
  useSort,
  type Metric,
} from "./analysis";
import { useT } from "@/lib/locale-context";
import { crud } from "@/lib/crud-client";
import { toNum } from "@/lib/format";
import type { MonthIn, ProductCost, ShipmentCost } from "@/lib/engine/types";

interface ProductLite {
  id: string;
  nameRu: string;
  price: number;
  isPromo: boolean;
  productLine: string | null;
  costProductId: string;
}

interface ExpenseRow {
  id: string;
  monthId: string;
  shipmentId: string;
  shipmentCode: string;
  categoryId: string;
  categoryName: string;
  amount: number;
  notes: string | null;
}

interface Option {
  value: string;
  label: string;
}

/** Air freight is materially more expensive than trucking — worth flagging. */
const isAir = (code: string) => /avia|авиа|air/i.test(code);

const num = toNum;

// ── inline-editable Fargo transfer cost on an existing line ──────────
function FargoCell({
  lineId,
  value,
  readOnly,
  onSaved,
}: {
  lineId: string;
  value: number | null;
  readOnly: boolean;
  onSaved: () => void;
}) {
  const [text, setText] = useState(value == null ? "" : fmtN(value));
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    setText(value == null ? "" : fmtN(value));
  }
  if (readOnly) {
    return value == null ? (
      <Badge tone="warn">—</Badge>
    ) : (
      <span className="num">{fmtN(value)}</span>
    );
  }
  const missing = text.trim() === "";
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={async () => {
        const v = text.trim() === "" ? null : num(text);
        setText(v == null ? "" : fmtN(v));
        if (v !== value) {
          await crud("shipmentLine", "update", { id: lineId, data: { fargoUnitCost: v } });
          onSaved();
        }
      }}
      placeholder="—"
      className={`num w-24 rounded-md border px-2 py-1 text-right text-[12.5px] outline-none focus:border-accent ${
        missing ? "border-warn/50 bg-warn-soft placeholder:text-warn" : "border-border bg-surface"
      }`}
    />
  );
}

// ── generic inline-editable numeric field on an existing record ──────
// Same behaviour as FargoCell: plain input, commit on blur, server figures
// (amounts, TI cost, load factor) recompute via router.refresh().
function NumEditCell({
  entity,
  id,
  field,
  value,
  decimals = 0,
  readOnly,
  onSaved,
  width = "w-24",
}: {
  entity: "shipmentLine" | "importExpense";
  id: string;
  field: string;
  value: number;
  decimals?: number;
  readOnly: boolean;
  onSaved: () => void;
  width?: string;
}) {
  const [text, setText] = useState(fmtN(value, decimals));
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    setText(fmtN(value, decimals));
  }
  if (readOnly) return <span className="num">{fmtN(value, decimals)}</span>;
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={async () => {
        const v = num(text);
        setText(fmtN(v, decimals));
        if (v !== value) {
          await crud(entity, "update", { id, data: { [field]: v } });
          onSaved();
        }
      }}
      className={`num ${width} rounded-md border border-border bg-surface px-2 py-1 text-right text-[12.5px] outline-none focus:border-accent`}
    />
  );
}

// ── shipment-level FX rate: edit once, apply to every line ───────────
function ShipmentRateEdit({
  lines,
  onSaved,
}: {
  lines: Array<{ id: string; rate: number }>;
  onSaved: () => void;
}) {
  const { locale } = useT();
  const ru = locale === "ru";
  const uniform = lines.every((l) => l.rate === lines[0]?.rate);
  const current = lines.at(-1)?.rate ?? 0;
  const [text, setText] = useState(current === 0 ? "" : fmtN(current));
  const [busy, setBusy] = useState(false);

  async function apply() {
    const v = num(text);
    if (v <= 0) return;
    setBusy(true);
    for (const l of lines) {
      if (l.rate !== v) await crud("shipmentLine", "update", { id: l.id, data: { rate: v } });
    }
    setBusy(false);
    onSaved();
  }

  return (
    <span className="flex items-center gap-1.5">
      <span className="text-[11.5px] normal-case tracking-normal text-muted">
        {ru ? "Курс EUR→UZS" : "EUR→UZS rate"}
        {!uniform && ` (${ru ? "разные по строкам" : "varies by line"})`}
      </span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => setText(num(e.target.value) === 0 ? "" : fmtN(num(e.target.value)))}
        placeholder="14 500"
        className="num w-24 rounded-md border border-border bg-surface px-2 py-1 text-right text-[12px] outline-none focus:border-accent"
      />
      <Button variant="secondary" onClick={apply} disabled={busy || num(text) <= 0}>
        {busy ? "…" : ru ? "Ко всем строкам" : "Apply to all"}
      </Button>
    </span>
  );
}

// ── ghost row: add a product line to an existing shipment ────────────
function AddLineRow({
  shipmentId,
  defaultRate,
  productOptions,
  onDone,
}: {
  shipmentId: string;
  defaultRate: number;
  productOptions: Option[];
  onDone: () => void;
}) {
  const { t, locale } = useT();
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [priceEur, setPriceEur] = useState("");
  const [rate, setRate] = useState(defaultRate > 0 ? String(defaultRate) : "");
  const [busy, setBusy] = useState(false);
  const valid = productId && num(qty) > 0 && num(priceEur) > 0 && num(rate) > 0;

  async function save() {
    if (!valid) return;
    setBusy(true);
    await crud("shipmentLine", "create", {
      data: {
        shipmentId,
        productId,
        qty: num(qty),
        priceEur: num(priceEur),
        rate: num(rate),
        fargoUnitCost: null,
      },
    });
    setProductId("");
    setQty("");
    setPriceEur("");
    setBusy(false);
    onDone();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
      <Select value={productId} onChange={(e) => setProductId(e.target.value)} className="min-w-56 text-[12.5px]">
        <option value="">{locale === "ru" ? "+ Добавить товар…" : "+ Add product…"}</option>
        {productOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <Input value={qty} onChange={(e) => setQty(e.target.value)} placeholder={t("qty")} className="w-20 text-right" />
      <Input value={priceEur} onChange={(e) => setPriceEur(e.target.value)} placeholder="EUR" className="w-24 text-right" />
      <Input value={rate} onChange={(e) => setRate(e.target.value)} placeholder={t("rate")} className="w-28 text-right" />
      <Button variant="secondary" onClick={save} disabled={!valid || busy}>
        <IconPlus size={13} /> {t("add")}
      </Button>
    </div>
  );
}

// ── ghost row: add an import expense to an existing shipment ─────────
function AddExpenseRow({
  shipmentId,
  monthId,
  categoryOptions,
  onDone,
}: {
  shipmentId: string;
  monthId: string;
  categoryOptions: Option[];
  onDone: () => void;
}) {
  const { t, locale } = useT();
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = categoryId && num(amount) > 0;

  async function save() {
    if (!valid) return;
    setBusy(true);
    await crud("importExpense", "create", {
      data: { monthId, shipmentId, categoryId, amount: num(amount) },
    });
    setCategoryId("");
    setAmount("");
    setBusy(false);
    onDone();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
      <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="min-w-44 text-[12.5px]">
        <option value="">{locale === "ru" ? "+ Статья расходов…" : "+ Expense item…"}</option>
        {categoryOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t("amount")} className="w-36 text-right" />
      <Button variant="secondary" onClick={save} disabled={!valid || busy}>
        <IconPlus size={13} /> {t("add")}
      </Button>
    </div>
  );
}

// ── the «Новая поставка» modal: whole shipment entered in one place ──
interface DraftLine {
  productId: string;
  qty: string;
  priceEur: string;
}
interface DraftExpense {
  categoryId: string;
  amount: string;
}

function NewShipmentModal({
  months,
  productOptions,
  categoryOptions,
  defaultMonthId,
  onClose,
}: {
  months: MonthIn[];
  productOptions: Option[];
  categoryOptions: Option[];
  defaultMonthId: string;
  onClose: () => void;
}) {
  const { t, locale } = useT();
  const router = useRouter();
  const ru = locale === "ru";
  const [code, setCode] = useState("");
  const [monthId, setMonthId] = useState(defaultMonthId);
  const [rate, setRate] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ productId: "", qty: "", priceEur: "" }]);
  const [exps, setExps] = useState<DraftExpense[]>([{ categoryId: "", amount: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setExp = (i: number, patch: Partial<DraftExpense>) =>
    setExps((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const rateN = num(rate);
  const validLines = lines.filter((l) => l.productId && num(l.qty) > 0 && num(l.priceEur) > 0);
  const validExps = exps.filter((x) => x.categoryId && num(x.amount) > 0);
  const purchaseEur = validLines.reduce((a, l) => a + num(l.qty) * num(l.priceEur), 0);
  const purchaseUzs = purchaseEur * rateN;
  const expensesSum = validExps.reduce((a, x) => a + num(x.amount), 0);
  const coeff = purchaseUzs > 0 ? 1 + expensesSum / purchaseUzs : 1;
  const canSave = code.trim() !== "" && rateN > 0 && validLines.length > 0;

  const productName = (id: string) => productOptions.find((o) => o.value === id)?.label ?? id;

  async function save() {
    if (!canSave || busy) return;
    setBusy(true);
    setError(null);
    const created = await crud("shipment", "create", { data: { code: code.trim(), monthId } });
    if (created.error || !created.id) {
      setError(created.error ?? "error");
      setBusy(false);
      return;
    }
    for (const l of validLines) {
      const res = await crud("shipmentLine", "create", {
        data: {
          shipmentId: created.id,
          productId: l.productId,
          qty: num(l.qty),
          priceEur: num(l.priceEur),
          rate: rateN,
          fargoUnitCost: null,
        },
      });
      if (res.error) {
        setError(res.error);
        setBusy(false);
        return;
      }
    }
    for (const x of validExps) {
      const res = await crud("importExpense", "create", {
        data: { monthId, shipmentId: created.id, categoryId: x.categoryId, amount: num(x.amount) },
      });
      if (res.error) {
        setError(res.error);
        setBusy(false);
        return;
      }
    }
    router.refresh();
    onClose();
  }

  return (
    <Modal title={t("addShipment")} onClose={onClose} wide>
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="min-w-0 space-y-4">
          {/* header fields */}
          <div className="flex flex-wrap gap-3">
            <label className="block">
              <span className="label-caps mb-1 block">{ru ? "Код поставки" : "Shipment code"}</span>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={ru ? "Фура №13" : "Truck #13"}
                className="w-36"
              />
            </label>
            <label className="block">
              <span className="label-caps mb-1 block">{t("month")}</span>
              <Select value={monthId} onChange={(e) => setMonthId(e.target.value)}>
                {months.map((m) => (
                  <option key={m.id} value={m.id}>
                    {ru ? m.nameRu : m.nameEn}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="label-caps mb-1 block">{ru ? "Курс EUR→UZS" : "EUR→UZS rate"}</span>
              <Input
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="14 500"
                className="w-32 text-right"
              />
            </label>
          </div>

          {/* product lines */}
          <div>
            <div className="label-caps mb-1.5">{ru ? "Товары" : "Products"}</div>
            <div className="space-y-1.5">
              {lines.map((l, i) => {
                const sumEur = num(l.qty) * num(l.priceEur);
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Select
                      value={l.productId}
                      onChange={(e) => setLine(i, { productId: e.target.value })}
                      className="min-w-64 flex-1 text-[12.5px]"
                    >
                      <option value="">{ru ? "Выберите товар…" : "Select product…"}</option>
                      {productOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                    <Input
                      value={l.qty}
                      onChange={(e) => setLine(i, { qty: e.target.value })}
                      placeholder={t("qty")}
                      className="w-20 text-right"
                    />
                    <Input
                      value={l.priceEur}
                      onChange={(e) => setLine(i, { priceEur: e.target.value })}
                      placeholder="€"
                      className="w-24 text-right"
                    />
                    <span className="num w-24 text-right text-[12px] text-muted">
                      {sumEur > 0 ? `€${fmtN(sumEur, 2)}` : ""}
                    </span>
                    <button
                      onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))}
                      className="text-muted transition-colors hover:text-danger"
                      title={t("delete")}
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => setLines((ls) => [...ls, { productId: "", qty: "", priceEur: "" }])}
              className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline"
            >
              <IconPlus size={13} /> {ru ? "Добавить товар" : "Add product"}
            </button>
          </div>

          {/* import expenses */}
          <div>
            <div className="label-caps mb-1.5">
              {t("importExpenses")}{" "}
              <span className="normal-case text-muted">
                ({ru ? "можно заполнить позже" : "can be filled in later"})
              </span>
            </div>
            <div className="space-y-1.5">
              {exps.map((x, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Select
                    value={x.categoryId}
                    onChange={(e) => setExp(i, { categoryId: e.target.value })}
                    className="min-w-56 flex-1 text-[12.5px]"
                  >
                    <option value="">{ru ? "Категория…" : "Category…"}</option>
                    {categoryOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                  <Input
                    value={x.amount}
                    onChange={(e) => setExp(i, { amount: e.target.value })}
                    placeholder={`${t("amount")} UZS`}
                    className="w-36 text-right"
                  />
                  <button
                    onClick={() => setExps((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : xs))}
                    className="text-muted transition-colors hover:text-danger"
                    title={t("delete")}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => setExps((xs) => [...xs, { categoryId: "", amount: "" }])}
              className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline"
            >
              <IconPlus size={13} /> {ru ? "Добавить статью расходов" : "Add expense item"}
            </button>
          </div>
        </div>

        {/* live summary */}
        <div className="min-w-0">
          <div className="quiet-card sticky top-2 rounded-xl bg-surface-low p-4">
            <div className="label-caps mb-3">{ru ? "Итого по поставке" : "Shipment summary"}</div>
            <div className="space-y-1.5 text-[13px]">
              <div className="flex justify-between gap-3">
                <span className="text-muted">{ru ? "Закупка (EUR)" : "Purchase (EUR)"}</span>
                <span className="num font-medium">€{fmtN(purchaseEur, 2)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted">{ru ? "Закупка (UZS)" : "Purchase (UZS)"}</span>
                <span className="num font-medium">{fmtN(purchaseUzs)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted">{t("importExpenses")}</span>
                <span className="num font-medium">{fmtN(expensesSum)}</span>
              </div>
              <div className="flex justify-between gap-3 border-t border-border pt-1.5">
                <span className="text-muted">{ru ? "Коэффициент нагрузки" : "Load factor"}</span>
                <span className="num font-semibold text-accent">×{coeff.toFixed(4)}</span>
              </div>
            </div>
            {validLines.length > 0 && rateN > 0 && (
              <>
                <div className="label-caps mb-1.5 mt-4">
                  {ru ? "Себестоимость за единицу (TI)" : "Unit cost (TI)"}
                </div>
                <div className="space-y-1 text-[12px]">
                  {validLines.map((l, i) => (
                    <div key={i} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate text-muted" title={productName(l.productId)}>
                        {productName(l.productId)}
                      </span>
                      <span className="num shrink-0 font-medium">
                        {fmtN(num(l.priceEur) * rateN * coeff)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {expensesSum === 0 && validLines.length > 0 && (
              <p className="mt-3 text-[11.5px] text-muted">
                {ru
                  ? "Без импортных расходов коэффициент = 1. Добавьте расходы позже — себестоимость пересчитается."
                  : "With no import expenses the factor is 1. Add them later and unit costs recalculate."}
              </p>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-warn/40 bg-warn-soft p-2.5 text-[12.5px] text-warn">{error}</div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button onClick={save} disabled={!canSave || busy}>
          {busy ? t("saving") : ru ? "Сохранить поставку" : "Save shipment"}
        </Button>
      </div>
    </Modal>
  );
}

// ─────────────────────────── the page ───────────────────────────

export default function ShipmentsView({
  months,
  products,
  shipmentCosts,
  productCosts,
  soldQty,
  soldRevenue,
  ytdCogs,
  ytdRevenue,
  ytdGpMargin,
  expenses,
  importCategories,
  readOnly,
}: {
  months: MonthIn[];
  products: ProductLite[];
  shipmentCosts: ShipmentCost[];
  productCosts: Record<string, ProductCost>;
  soldQty: Record<string, number>;
  soldRevenue: Record<string, number>;
  ytdCogs: number;
  ytdRevenue: number;
  ytdGpMargin: number;
  expenses: ExpenseRow[];
  importCategories: Array<{ id: string; name: string }>;
  readOnly: boolean;
}) {
  const { t, locale } = useT();
  const router = useRouter();
  const ru = locale === "ru";
  const [showNew, setShowNew] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const monthLabel = (id: string) => {
    const m = months.find((x) => x.id === id);
    return m ? (ru ? m.nameRu : m.nameEn) : id;
  };
  const productOptions = useMemo(
    () => products.filter((p) => !p.isPromo).map((p) => ({ value: p.id, label: p.nameRu })),
    [products]
  );
  const categoryOptions = useMemo(
    () => importCategories.map((c) => ({ value: c.id, label: c.name })),
    [importCategories]
  );
  const productName = (id: string) => products.find((p) => p.id === id)?.nameRu ?? id;

  // ── totals across all shipments ───────────────────────────────
  const totals = useMemo(() => {
    const purchaseUzs = shipmentCosts.reduce((s, x) => s + x.purchaseTotal, 0);
    const expensesTotal = shipmentCosts.reduce((s, x) => s + x.expenseTotal, 0);
    const purchaseEur = shipmentCosts.reduce(
      (s, x) => s + x.lines.reduce((a, l) => a + l.qty * l.priceEur, 0),
      0
    );
    const units = shipmentCosts.reduce((s, x) => s + x.lines.reduce((a, l) => a + l.qty, 0), 0);
    return {
      purchaseUzs,
      expensesTotal,
      purchaseEur,
      units,
      eurWeighted: purchaseEur > 0 ? purchaseUzs / purchaseEur : 0,
      loadFactor: purchaseUzs > 0 ? 1 + expensesTotal / purchaseUzs : 1,
      landedPerUnit: units > 0 ? (purchaseUzs + expensesTotal) / units : 0,
    };
  }, [shipmentCosts]);

  const metrics: Metric[] = [
    {
      label: ru ? "Закупка (EUR)" : "Purchase (EUR)",
      value: `€${fmtN(totals.purchaseEur)}`,
      hint: `${fmtN(totals.units)} ${ru ? "шт." : "units"}`,
    },
    {
      label: ru ? "Закупка (UZS)" : "Purchase (UZS)",
      value: fmtN(totals.purchaseUzs),
      hint: `${t("eurRate")} ${fmtN(totals.eurWeighted, 0)}`,
    },
    {
      label: t("importExpenses"),
      value: fmtN(totals.expensesTotal),
      hint: `${fmtPct(totals.purchaseUzs > 0 ? totals.expensesTotal / totals.purchaseUzs : 0)} ${t("expensesShare")}`,
    },
    {
      label: t("kpiAvgLoadFactor"),
      value: `×${totals.loadFactor.toFixed(4)}`,
      hint: `${fmtN(totals.landedPerUnit)} / ${t("perUnit")}`,
    },
  ];

  // newest first
  const shipmentsSorted = useMemo(
    () =>
      [...shipmentCosts].sort(
        (a, b) =>
          b.monthId.localeCompare(a.monthId) ||
          b.code.localeCompare(a.code, undefined, { numeric: true })
      ),
    [shipmentCosts]
  );
  const expensesByShipment = useMemo(() => {
    const m = new Map<string, ExpenseRow[]>();
    for (const e of expenses) {
      const list = m.get(e.shipmentId) ?? [];
      list.push(e);
      m.set(e.shipmentId, list);
    }
    return m;
  }, [expenses]);

  const missingFargoCount = shipmentCosts.reduce(
    (a, s) => a + s.lines.filter((l) => l.fargoUnitCost == null).length,
    0
  );

  async function deleteShipment(id: string) {
    if (!confirm(t("confirmDelete"))) return;
    await crud("shipment", "delete", { id });
    setExpandedId(null);
    router.refresh();
  }
  async function deleteLine(id: string) {
    if (!confirm(t("confirmDelete"))) return;
    await crud("shipmentLine", "delete", { id });
    router.refresh();
  }
  async function deleteExpense(id: string) {
    if (!confirm(t("confirmDelete"))) return;
    await crud("importExpense", "delete", { id });
    router.refresh();
  }

  // ── secondary analytics (collapsed) ───────────────────────────
  const marginRows = useMemo(() => {
    return products
      .map((p) => {
        const cost = productCosts[p.costProductId]?.avgTiCost ?? 0;
        const fargoCost = productCosts[p.costProductId]?.avgFargoCost ?? 0;
        const hasFargo = productCosts[p.costProductId]?.hasFargoCost ?? false;
        const sold = soldQty[p.id] ?? 0;
        const revenue = soldRevenue[p.id] ?? 0;
        const realised = sold !== 0 ? revenue / sold : p.price;
        const gpUnit = realised - cost;
        return {
          product: p,
          cost,
          fargoCost,
          hasFargo,
          sold,
          revenue,
          realised,
          gpUnit,
          gpTotal: sold * gpUnit,
          gpPct: realised !== 0 ? gpUnit / realised : 0,
        };
      })
      .filter((r) => r.sold !== 0);
  }, [products, productCosts, soldQty, soldRevenue]);

  const marginSort = useSort(marginRows, "gpTotal", {
    name: (r) => r.product.nameRu,
    cost: (r) => r.cost,
    realised: (r) => r.realised,
    gpUnit: (r) => r.gpUnit,
    gpPct: (r) => r.gpPct,
    gpTotal: (r) => r.gpTotal,
    sold: (r) => r.sold,
  });
  const maxGp = Math.max(1, ...marginRows.map((r) => Math.abs(r.gpTotal)));

  const balanceRows = useMemo(() => {
    const byCostId = new Map<string, { name: string; purchased: number; sold: number; cost: number }>();
    for (const p of products) {
      const key = p.costProductId;
      const entry =
        byCostId.get(key) ?? {
          name: products.find((x) => x.id === key)?.nameRu ?? p.nameRu,
          purchased: productCosts[key]?.totalQty ?? 0,
          sold: 0,
          cost: productCosts[key]?.avgTiCost ?? 0,
        };
      entry.sold += soldQty[p.id] ?? 0;
      byCostId.set(key, entry);
    }
    return [...byCostId.values()]
      .filter((r) => r.purchased !== 0 || r.sold !== 0)
      .map((r) => ({ ...r, balance: r.purchased - r.sold, value: (r.purchased - r.sold) * r.cost }));
  }, [products, productCosts, soldQty]);

  const balanceTotals = balanceRows.reduce(
    (a, r) => ({ purchased: a.purchased + r.purchased, sold: a.sold + r.sold, value: a.value + r.value }),
    { purchased: 0, sold: 0, value: 0 }
  );
  const maxBalanceQty = Math.max(1, ...balanceRows.map((r) => Math.max(r.purchased, r.sold)));

  const defaultMonthId = shipmentsSorted[0]?.monthId ?? months[0]?.id ?? "";

  return (
    <div>
      <PageTitle
        title={t("navShipments")}
        subtitle={t("descShipmentsLong")}
        right={
          <div className="flex items-center gap-2">
            <a href={`/api/export/shipments?locale=${locale}`}>
              <Button variant="secondary">
                <IconDownload size={14} /> {t("export")}
              </Button>
            </a>
            {!readOnly && (
              <Button onClick={() => setShowNew(true)}>
                <IconPlus size={14} /> {t("addShipment")}
              </Button>
            )}
          </div>
        }
      />

      <MetricStrip metrics={metrics} />

      {missingFargoCount > 0 && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-warn/20 bg-warn-soft px-4 py-3 text-[13px] text-warn">
          <IconAlert size={15} />
          <span>
            {missingFargoCount}{" "}
            {ru
              ? "строк поставок без себестоимости Fargo — НДС Fargo по этим товарам занижен, пока они не заполнены."
              : "shipment lines have no Fargo cost — Fargo VAT for those products is understated until filled in."}
          </span>
        </div>
      )}

      {/* shipments — click a row to expand its detail */}
      <div className="quiet-card mb-5 overflow-hidden rounded-xl">
        <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
          <h2 className="font-display text-[16px] font-semibold">{ru ? "Поставки" : "Shipments"}</h2>
          <span className="text-[12px] text-muted">
            {shipmentCosts.length} {ru ? "поставок" : "shipments"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl min-w-max w-full">
            <thead>
              <tr>
                <th className="w-8" />
                <th>{ru ? "Код" : "Code"}</th>
                <th>{t("month")}</th>
                <th className="text-right">{ru ? "Позиций" : "Lines"}</th>
                <th className="text-right">{ru ? "Закупка EUR" : "Purchase EUR"}</th>
                <th className="text-right">{ru ? "Закупка UZS" : "Purchase UZS"}</th>
                <th className="text-right">{t("importExpenses")}</th>
                <th className="text-right">{ru ? "Коэфф." : "Factor"}</th>
                <th className="text-right">{ru ? "Статус" : "Status"}</th>
              </tr>
            </thead>
            <tbody>
              {shipmentsSorted.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-[13px] text-muted">
                    {t("noData")}
                  </td>
                </tr>
              )}
              {shipmentsSorted.map((s) => {
                const open = expandedId === s.shipmentId;
                const purchaseEur = s.lines.reduce((a, l) => a + l.qty * l.priceEur, 0);
                const shipExpenses = expensesByShipment.get(s.shipmentId) ?? [];
                const lastRate = s.lines.at(-1)?.rate ?? 0;
                return [
                  <tr
                    key={s.shipmentId}
                    className={`cursor-pointer ${open ? "!bg-accent-soft/40" : ""}`}
                    onClick={() => setExpandedId(open ? null : s.shipmentId)}
                  >
                    <td className="text-muted">
                      {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    </td>
                    <td className={`font-medium ${open ? "text-accent" : ""}`}>
                      <span className="flex items-center gap-1.5">
                        {s.code}
                        {isAir(s.code) && <Badge tone="accent">{ru ? "авиа" : "air"}</Badge>}
                      </span>
                    </td>
                    <td className="text-muted">{monthLabel(s.monthId)}</td>
                    <td className="text-right">
                      <Num v={s.lines.length} />
                    </td>
                    <td className="num text-right">€{fmtN(purchaseEur, 0)}</td>
                    <td className="text-right">
                      <Num v={s.purchaseTotal} />
                    </td>
                    <td className="text-right">
                      <Num v={s.expenseTotal} />
                    </td>
                    <td className="num text-right">×{s.loadFactor.toFixed(3)}</td>
                    <td className="text-right">
                      {s.hasMissingFargoCost ? (
                        <Badge tone="warn">Fargo —</Badge>
                      ) : (
                        <Badge tone="ok">✓</Badge>
                      )}
                    </td>
                  </tr>,
                  open && (
                    <tr key={`${s.shipmentId}-detail`}>
                      <td colSpan={9} className="!bg-surface-low/60 !p-0">
                        <div className="grid gap-5 p-4 lg:grid-cols-[3fr_2fr]">
                          {/* product lines */}
                          <div className="min-w-0">
                            <div className="label-caps mb-1.5 flex flex-wrap items-center justify-between gap-2">
                              <span>{ru ? "Детализация товаров" : "Product lines"}</span>
                              {!readOnly && s.lines.length > 0 && (
                                <ShipmentRateEdit
                                  key={`rate-${s.shipmentId}`}
                                  lines={s.lines.map((l) => ({ id: l.id, rate: l.rate }))}
                                  onSaved={() => router.refresh()}
                                />
                              )}
                            </div>
                            <table className="tbl w-full">
                              <thead>
                                <tr>
                                  <th>{t("product")}</th>
                                  <th className="text-right">{t("qty")}</th>
                                  <th className="text-right">{ru ? "Цена EUR" : "Price EUR"}</th>
                                  <th className="text-right">{t("rate")}</th>
                                  <th className="text-right">{ru ? "Сумма UZS" : "Amount UZS"}</th>
                                  <th className="text-right">{ru ? "Себест. TI" : "TI cost"}</th>
                                  <th className="text-right">Fargo</th>
                                  {!readOnly && <th className="w-8" />}
                                </tr>
                              </thead>
                              <tbody>
                                {s.lines.map((l) => (
                                  <tr key={l.id}>
                                    <td className="max-w-[240px] truncate" title={productName(l.productId)}>
                                      {productName(l.productId)}
                                    </td>
                                    <td className="text-right">
                                      <NumEditCell
                                        entity="shipmentLine"
                                        id={l.id}
                                        field="qty"
                                        value={l.qty}
                                        readOnly={readOnly}
                                        onSaved={() => router.refresh()}
                                        width="w-20"
                                      />
                                    </td>
                                    <td className="text-right">
                                      <NumEditCell
                                        entity="shipmentLine"
                                        id={l.id}
                                        field="priceEur"
                                        value={l.priceEur}
                                        decimals={2}
                                        readOnly={readOnly}
                                        onSaved={() => router.refresh()}
                                        width="w-24"
                                      />
                                    </td>
                                    <td className="text-right">
                                      <NumEditCell
                                        entity="shipmentLine"
                                        id={l.id}
                                        field="rate"
                                        value={l.rate}
                                        readOnly={readOnly}
                                        onSaved={() => router.refresh()}
                                        width="w-24"
                                      />
                                    </td>
                                    <td className="text-right">
                                      <Num v={l.purchaseAmount} />
                                    </td>
                                    <td className="text-right">
                                      <Num v={l.tiUnitCost} />
                                    </td>
                                    <td className="text-right">
                                      <FargoCell
                                        lineId={l.id}
                                        value={l.fargoUnitCost}
                                        readOnly={readOnly}
                                        onSaved={() => router.refresh()}
                                      />
                                    </td>
                                    {!readOnly && (
                                      <td>
                                        <button
                                          onClick={() => deleteLine(l.id)}
                                          className="text-muted transition-colors hover:text-danger"
                                          title={t("delete")}
                                        >
                                          <IconTrash size={13} />
                                        </button>
                                      </td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {!readOnly && (
                              <div className="mt-2">
                                <AddLineRow
                                  shipmentId={s.shipmentId}
                                  defaultRate={lastRate}
                                  productOptions={productOptions}
                                  onDone={() => router.refresh()}
                                />
                              </div>
                            )}
                          </div>

                          {/* import expenses */}
                          <div className="min-w-0">
                            <div className="label-caps mb-1.5">{t("importExpenses")}</div>
                            {shipExpenses.length === 0 ? (
                              <div className="py-3 text-[12.5px] text-muted">{t("noData")}</div>
                            ) : (
                              <table className="tbl w-full">
                                <tbody>
                                  {shipExpenses.map((e) => (
                                    <tr key={e.id}>
                                      <td className="max-w-[200px] truncate" title={e.categoryName}>
                                        {e.categoryName}
                                      </td>
                                      <td className="text-right">
                                        <NumEditCell
                                          entity="importExpense"
                                          id={e.id}
                                          field="amount"
                                          value={e.amount}
                                          readOnly={readOnly}
                                          onSaved={() => router.refresh()}
                                          width="w-32"
                                        />
                                      </td>
                                      {!readOnly && (
                                        <td className="w-8">
                                          <button
                                            onClick={() => deleteExpense(e.id)}
                                            className="text-muted transition-colors hover:text-danger"
                                            title={t("delete")}
                                          >
                                            <IconTrash size={13} />
                                          </button>
                                        </td>
                                      )}
                                    </tr>
                                  ))}
                                  <tr className="font-semibold">
                                    <td>{t("total")}</td>
                                    <td className="text-right">
                                      <Num v={s.expenseTotal} strong />
                                    </td>
                                    {!readOnly && <td />}
                                  </tr>
                                </tbody>
                              </table>
                            )}
                            {!readOnly && (
                              <div className="mt-2">
                                <AddExpenseRow
                                  shipmentId={s.shipmentId}
                                  monthId={s.monthId}
                                  categoryOptions={categoryOptions}
                                  onDone={() => router.refresh()}
                                />
                              </div>
                            )}
                            {!readOnly && (
                              <div className="mt-4 border-t border-border pt-3">
                                <button
                                  onClick={() => deleteShipment(s.shipmentId)}
                                  className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-danger hover:underline"
                                >
                                  <IconTrash size={13} /> {ru ? "Удалить поставку" : "Delete shipment"}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* secondary analytics, collapsed by default */}
      <Collapsible title={t("marginPerSku")} note={t("marginPerSkuNote")}>
        <div className="overflow-x-auto">
          <table className="tbl min-w-max">
            <thead>
              <tr>
                <Th sortKey="name" sort={marginSort.sort} onSort={marginSort.onSort}>
                  {t("product")}
                </Th>
                <Th sortKey="sold" sort={marginSort.sort} onSort={marginSort.onSort} numeric>
                  {t("sold")}
                </Th>
                <Th sortKey="realised" sort={marginSort.sort} onSort={marginSort.onSort} numeric>
                  {t("realisedPrice")}
                </Th>
                <Th sortKey="cost" sort={marginSort.sort} onSort={marginSort.onSort} numeric>
                  {t("avgTiCost")}
                </Th>
                <Th numeric>{t("avgFargoCost")}</Th>
                <Th sortKey="gpUnit" sort={marginSort.sort} onSort={marginSort.onSort} numeric>
                  {t("gpUnit")}
                </Th>
                <Th sortKey="gpPct" sort={marginSort.sort} onSort={marginSort.onSort} numeric>
                  {t("gpMargin")}
                </Th>
                <Th sortKey="gpTotal" sort={marginSort.sort} onSort={marginSort.onSort} numeric>
                  {t("contribution")}
                </Th>
              </tr>
            </thead>
            <tbody>
              {marginSort.sorted.map((r) => (
                <tr key={r.product.id}>
                  <td className="max-w-[260px]">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate" title={r.product.nameRu}>
                        {r.product.nameRu}
                      </span>
                      {r.product.isPromo && <Badge tone="accent">promo</Badge>}
                    </div>
                    <div className="text-[11px] text-muted">{r.product.productLine ?? "—"}</div>
                  </td>
                  <td className="text-right">
                    <Num v={r.sold} />
                  </td>
                  <td>
                    <Money v={r.realised} sub={`${t("listPrice")} ${fmtN(r.product.price)}`} />
                  </td>
                  <td className="text-right">
                    <Num v={r.cost} />
                  </td>
                  <td className="text-right">
                    {r.hasFargo ? <Num v={r.fargoCost} /> : <Badge tone="warn">—</Badge>}
                  </td>
                  <td className="text-right">
                    <Num v={r.gpUnit} />
                  </td>
                  <td className="text-right">
                    <span className={`num ${r.gpPct < 0.25 ? "text-warn" : ""}`}>{fmtPct(r.gpPct)}</span>
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16">
                        <ShareBar value={Math.abs(r.gpTotal)} max={maxGp} />
                      </div>
                      <Money v={r.gpTotal} strong />
                    </div>
                  </td>
                </tr>
              ))}
              <tr className="row-section font-semibold">
                <td>{t("total")}</td>
                <td className="text-right">
                  <Num v={marginRows.reduce((a, r) => a + r.sold, 0)} strong />
                </td>
                <td colSpan={4} />
                <td className="text-right">
                  <span className="num">{fmtPct(ytdGpMargin)}</span>
                </td>
                <td>
                  <Money v={ytdRevenue - ytdCogs} strong />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Collapsible>

      <Collapsible title={t("purchasedVsSold")} note={t("purchasedVsSoldNote")}>
        <div className="overflow-x-auto">
          <table className="tbl min-w-max">
            <thead>
              <tr>
                <th>{t("product")}</th>
                <th className="text-right">{t("purchased")}</th>
                <th className="text-right">{t("sold")}</th>
                <th className="w-40"></th>
                <th className="text-right">{t("coverage")}</th>
                <th className="text-right">{t("stockValue")}</th>
              </tr>
            </thead>
            <tbody>
              {balanceRows
                .slice()
                .sort((a, b) => b.value - a.value)
                .map((r) => (
                  <tr key={r.name}>
                    <td className="max-w-[260px] truncate" title={r.name}>
                      {r.name}
                    </td>
                    <td className="text-right">
                      <Num v={r.purchased} />
                    </td>
                    <td className="text-right">
                      <Num v={r.sold} />
                    </td>
                    <td>
                      <div className="space-y-1">
                        <ShareBar value={r.purchased} max={maxBalanceQty} />
                        <ShareBar value={r.sold} max={maxBalanceQty} tone="warn" />
                      </div>
                    </td>
                    <td className="text-right">
                      <span className={`num ${r.balance < 0 ? "text-danger" : ""}`}>{fmtN(r.balance)}</span>
                    </td>
                    <td>
                      <Money v={r.value} />
                    </td>
                  </tr>
                ))}
              <tr className="row-section font-semibold">
                <td>{t("total")}</td>
                <td className="text-right">
                  <Num v={balanceTotals.purchased} strong />
                </td>
                <td className="text-right">
                  <Num v={balanceTotals.sold} strong />
                </td>
                <td />
                <td className="text-right">
                  <Num v={balanceTotals.purchased - balanceTotals.sold} strong />
                </td>
                <td>
                  <Money v={balanceTotals.value} strong />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border px-4 py-2 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-4 rounded-full bg-accent" /> {t("purchased")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-4 rounded-full bg-warn" /> {t("sold")}
          </span>
        </div>
      </Collapsible>

      {showNew && (
        <NewShipmentModal
          months={months}
          productOptions={productOptions}
          categoryOptions={categoryOptions}
          defaultMonthId={defaultMonthId}
          onClose={() => setShowNew(false)}
        />
      )}
    </div>
  );
}
