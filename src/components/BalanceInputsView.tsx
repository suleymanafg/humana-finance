"use client";

// «Ввод данных → Баланс» — organised by how often each thing is actually
// entered, which is what made the old flat grid feel messy:
//
//   ЗА МЕСЯЦ (three numbered steps, each with «Скопировать из <пред. месяц>»)
//     1 Остатки на складах   2 Дебиторка по клиентам   3 Прочие вводы месяца
//   РАЗОВЫЕ ОПЕРАЦИИ (collapsed) — capital contributions and Fargo→TI payments
//     are dated events, not monthly work
//   СВЕРКА (collapsed) — the settlement the payments are made against
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Input, Num, PageTitle } from "./ui";
import { IconCheck, IconPlus, IconTrash } from "./icons";
import { Collapsible } from "./analysis";
import EntryGrid from "./EntryGrid";
import MonthStrip from "./MonthStrip";
import { useT } from "@/lib/locale-context";
import { crud } from "@/lib/crud-client";
import { fmtN, parseNum, toNum } from "@/lib/format";
import type {
  ContributionIn,
  MonthBalanceIn,
  MonthIn,
  SettlementRow,
  TransferIn,
  WarehouseIn,
} from "@/lib/engine/types";
import type { DictKey } from "@/lib/i18n";

export interface StockRowUI {
  productId: string;
  name: string;
  unitCost: number;
  byWarehouse: Record<string, number>;
}
export interface ArRowUI {
  id: string;
  customerName: string;
  amount: number;
}

const pretty = (s: string) => (s.trim() === "" ? "" : fmtN(toNum(s)));

/** Card wrapper for one monthly step: number, title, live total, done tick. */
function Step({
  n,
  title,
  hint,
  done,
  total,
  action,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  done: boolean;
  total?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${
            done ? "bg-ok-soft text-ok" : "bg-surface-low text-muted"
          }`}
        >
          {done ? <IconCheck size={15} /> : n}
        </span>
        <span className="min-w-0">
          <span className="block text-[14.5px] font-semibold leading-tight">{title}</span>
          {hint && <span className="block text-[12px] text-muted">{hint}</span>}
        </span>
        <span className="ml-auto flex items-center gap-3">
          {total !== undefined && <Num v={total} strong className="text-[15px]" />}
          {action}
        </span>
      </div>
      {children}
    </Card>
  );
}

export default function BalanceInputsView({
  months,
  monthId,
  monthsWithData,
  settlement,
  monthBalance,
  priorBalance,
  priorMonthId,
  warehouses,
  stock,
  priorStock,
  arEntries,
  priorAr,
  contributions,
  transfers,
  readOnly,
}: {
  months: MonthIn[];
  monthId: string;
  monthsWithData: string[];
  settlement: SettlementRow | null;
  monthBalance: MonthBalanceIn | null;
  priorBalance: MonthBalanceIn | null;
  priorMonthId: string | null;
  warehouses: WarehouseIn[];
  stock: StockRowUI[];
  priorStock: Record<string, Record<string, number>>;
  arEntries: ArRowUI[];
  priorAr: ArRowUI[];
  contributions: ContributionIn[];
  transfers: TransferIn[];
  readOnly: boolean;
}) {
  const { t, locale } = useT();
  const ru = locale === "ru";
  const monthName = (id: string) => {
    const m = months.find((x) => x.id === id);
    return m ? (ru ? m.nameRu : m.nameEn) : id;
  };
  const priorLabel = priorMonthId ? monthName(priorMonthId) : null;

  const stockTotalValue = stock.reduce(
    (s, r) => s + warehouses.reduce((a, w) => a + (r.byWarehouse[w.id] ?? 0), 0) * r.unitCost,
    0
  );
  const hasStock = stock.some((s) => warehouses.some((w) => (s.byWarehouse[w.id] ?? 0) !== 0));
  const doneCount = [hasStock, arEntries.length > 0, !!monthBalance].filter(Boolean).length;

  const contribTotal = contributions.reduce((s, c) => s + c.tiAmount + c.fargoAmount, 0);
  const transferTotal = transfers.reduce((s, x) => s + x.cashAmount + x.bankAmount, 0);

  return (
    <div className="pb-16">
      <PageTitle
        title={t("navBalance")}
        subtitle={
          ru
            ? "Данные, которые заполняются вручную и формируют баланс"
            : "The figures entered by hand that build the balance sheet"
        }
        right={
          <div className="flex items-center gap-2">
            <Link href={`/close?month=${monthId}`}>
              <Button variant="secondary">← {t("navClose")}</Button>
            </Link>
            <Link href={`/balance?month=${monthId}`}>
              <Button variant="secondary">{t("balanceStatement")} →</Button>
            </Link>
          </div>
        }
      />

      <MonthStrip months={months} monthId={monthId} hasData={new Set(monthsWithData)} />

      {/* monthly work */}
      <div className="mb-2 flex items-baseline gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.07em] text-accent/80">
          {ru ? "За месяц" : "This month"} — {monthName(monthId)}
        </h2>
        <span className="text-[12px] text-muted">
          {doneCount} / 3 {ru ? "заполнено" : "filled"}
        </span>
      </div>

      {/* key={monthId}: drafts are seeded from props in useState initializers,
          so each month must get a fresh mount or stale figures linger */}
      <StockStep
        key={`stock-${monthId}`}
        monthId={monthId}
        warehouses={warehouses}
        stock={stock}
        priorStock={priorStock}
        priorLabel={priorLabel}
        readOnly={readOnly}
        done={hasStock}
        total={stockTotalValue}
      />

      <ArStep
        key={`ar-${monthId}`}
        monthId={monthId}
        rows={arEntries}
        priorRows={priorAr}
        priorLabel={priorLabel}
        readOnly={readOnly}
        done={arEntries.length > 0}
      />

      <MonthInputsStep
        key={`mb-${monthId}`}
        monthId={monthId}
        balance={monthBalance}
        priorBalance={priorBalance}
        priorLabel={priorLabel}
        readOnly={readOnly}
      />

      {/* one-off ledgers — not monthly work, so they stay out of the way */}
      <div className="mb-2 mt-6 flex items-baseline gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.07em] text-accent/80">
          {ru ? "Разовые операции" : "One-off records"}
        </h2>
        <span className="text-[12px] text-muted">
          {ru ? "за всё время — добавляются по факту" : "all time — added as they happen"}
        </span>
      </div>

      <Collapsible
        title={t("contributions")}
        note={`${contributions.length} · ${fmtN(contribTotal)}`}
      >
        <EntryGrid
          entity="contribution"
          cols={[
            { field: "date", labelKey: "date", type: "date" },
            { field: "tiAmount", label: "Turbo Impex", type: "number" },
            { field: "fargoAmount", label: "Fargo", type: "number" },
          ]}
          rows={contributions.map((c) => ({ ...c, date: c.date.slice(0, 10) }))}
          readOnly={readOnly}
          sumFields={["tiAmount", "fargoAmount"]}
        />
      </Collapsible>

      <Collapsible title={t("transfers")} note={`${transfers.length} · ${fmtN(transferTotal)}`}>
        <EntryGrid
          entity="transfer"
          cols={[
            { field: "date", labelKey: "date", type: "date" },
            { field: "cashAmount", labelKey: "cash", type: "number" },
            { field: "bankAmount", labelKey: "bank", type: "number" },
          ]}
          rows={transfers.map((c) => ({ ...c, date: c.date.slice(0, 10) }))}
          readOnly={readOnly}
          sumFields={["cashAmount", "bankAmount"]}
        />
      </Collapsible>

      {settlement && (
        <Collapsible
          title={t("settlementTitle")}
          note={`${t("remainingBalance")}: ${fmtN(settlement.remaining)}`}
        >
          <div className="grid gap-x-8 gap-y-1 p-4 sm:grid-cols-2">
            {(
              [
                [t("revenue"), settlement.cumRevenue],
                [`− ${t("opexFargoTotal")}`, -settlement.cumFargoOpex],
                [`− ${t("retroBonus")}`, -settlement.cumRetro],
                [`− ${t("fargoVat")}`, -settlement.cumFargoVat],
                [`− ${t("fargoIncomeTax")}`, -settlement.cumFargoIncomeTax],
                [t("dueToTi"), settlement.dueToTi, true],
                [`− ${t("transfersMade")}`, -(settlement.cumTransfersCash + settlement.cumTransfersBank)],
                [`− ${t("outstandingAr")}`, -settlement.outstandingAr],
                [t("remainingBalance"), settlement.remaining, true],
              ] as Array<[string, number, boolean?]>
            ).map(([label, value, strong]) => (
              <div
                key={label}
                className={`flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-0 ${
                  strong ? "font-semibold" : ""
                }`}
              >
                <span className="text-[13px]">{label}</span>
                <Num v={value} strong={strong} />
              </div>
            ))}
          </div>
        </Collapsible>
      )}
    </div>
  );
}

// ── 1 · stock ────────────────────────────────────────────────────
function StockStep({
  monthId,
  warehouses,
  stock,
  priorStock,
  priorLabel,
  readOnly,
  done,
  total,
}: {
  monthId: string;
  warehouses: WarehouseIn[];
  stock: StockRowUI[];
  priorStock: Record<string, Record<string, number>>;
  priorLabel: string | null;
  readOnly: boolean;
  done: boolean;
  total: number;
}) {
  const { t, locale } = useT();
  const ru = locale === "ru";
  const router = useRouter();
  const key = (p: string, w: string) => `${p}|${w}`;
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    for (const s of stock)
      for (const w of warehouses) {
        const q = s.byWarehouse[w.id] ?? 0;
        d[key(s.productId, w.id)] = q === 0 ? "" : fmtN(q);
      }
    return d;
  });
  const [busy, setBusy] = useState(false);

  const qty = (p: string, w: string) => toNum(draft[key(p, w)] ?? "");
  const rowQty = (s: StockRowUI) => warehouses.reduce((a, w) => a + qty(s.productId, w.id), 0);
  const draftValue = stock.reduce((a, s) => a + rowQty(s) * s.unitCost, 0);

  function copyPrior() {
    const d: Record<string, string> = {};
    for (const s of stock)
      for (const w of warehouses) {
        const q = priorStock[s.productId]?.[w.id] ?? 0;
        d[key(s.productId, w.id)] = q === 0 ? "" : fmtN(q);
      }
    setDraft(d);
  }

  async function save() {
    setBusy(true);
    for (const s of stock)
      for (const w of warehouses) {
        const v = qty(s.productId, w.id);
        if (v !== (s.byWarehouse[w.id] ?? 0)) {
          await crud("stockCount", "upsert", {
            data: { monthId, productId: s.productId, warehouseId: w.id, qty: v },
          });
        }
      }
    setBusy(false);
    router.refresh();
  }

  return (
    <Step
      n={1}
      title={t("stockCounts")}
      hint={ru ? "Количество по складам на конец месяца" : "Month-end quantity per warehouse"}
      done={done}
      total={draftValue}
      action={
        !readOnly && (
          <span className="flex items-center gap-2">
            {priorLabel && (
              <Button variant="secondary" onClick={copyPrior}>
                {ru ? "Скопировать из" : "Copy from"} {priorLabel}
              </Button>
            )}
            <Button onClick={save} disabled={busy}>
              {busy ? t("saving") : t("save")}
            </Button>
          </span>
        )
      }
    >
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>{t("product")}</th>
              {warehouses.map((w) => (
                <th key={w.id} className="max-w-32 text-right">
                  <span className="block truncate" title={w.name}>
                    {w.name}
                  </span>
                </th>
              ))}
              <th className="text-right">{t("qty")}</th>
              <th className="text-right">{t("stockValue")}</th>
            </tr>
          </thead>
          <tbody>
            {stock.map((s) => (
              <tr key={s.productId}>
                <td className="max-w-[280px] truncate" title={s.name}>
                  {s.name}
                </td>
                {warehouses.map((w) => (
                  <td key={w.id} className="text-right">
                    {readOnly ? (
                      <Num v={qty(s.productId, w.id) || null} />
                    ) : (
                      <Input
                        value={draft[key(s.productId, w.id)] ?? ""}
                        onChange={(e) => setDraft({ ...draft, [key(s.productId, w.id)]: e.target.value })}
                        onBlur={(e) =>
                          setDraft((d) => ({ ...d, [key(s.productId, w.id)]: pretty(e.target.value) }))
                        }
                        className="num w-24 text-right"
                      />
                    )}
                  </td>
                ))}
                <td className="text-right">
                  <Num v={rowQty(s)} strong />
                </td>
                <td className="text-right">
                  <Num v={rowQty(s) * s.unitCost} />
                </td>
              </tr>
            ))}
            <tr className="row-grand font-semibold">
              <td>{t("total")}</td>
              {warehouses.map((w) => (
                <td key={w.id} className="text-right">
                  <Num v={stock.reduce((a, s) => a + qty(s.productId, w.id), 0)} strong />
                </td>
              ))}
              <td className="text-right">
                <Num v={stock.reduce((a, s) => a + rowQty(s), 0)} strong />
              </td>
              <td className="text-right">
                <Num v={draftValue} strong />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-4 py-2 text-[11.5px] text-muted">
        {ru
          ? `Стоимость = количество × средняя себестоимость TI. Всего на конец месяца: ${fmtN(total)}`
          : `Value = qty × average TI cost. Saved month-end total: ${fmtN(total)}`}
      </p>
    </Step>
  );
}

// ── 2 · AR ───────────────────────────────────────────────────────
interface ArDraft {
  id?: string;
  customerName: string;
  amount: string;
}

function ArStep({
  monthId,
  rows,
  priorRows,
  priorLabel,
  readOnly,
  done,
}: {
  monthId: string;
  rows: ArRowUI[];
  priorRows: ArRowUI[];
  priorLabel: string | null;
  readOnly: boolean;
  done: boolean;
}) {
  const { t, locale } = useT();
  const ru = locale === "ru";
  const router = useRouter();
  const [draft, setDraft] = useState<ArDraft[]>(() =>
    rows.length > 0
      ? rows.map((r) => ({ id: r.id, customerName: r.customerName, amount: fmtN(r.amount) }))
      : [{ customerName: "", amount: "" }]
  );
  const [busy, setBusy] = useState(false);

  const draftTotal = draft.reduce((s, r) => s + toNum(r.amount), 0);
  // Compare row by row, not totals: stored amounts can carry kopecks the
  // 0-decimal inputs cannot show, which would flag every month as dirty.
  const filled = draft.filter((r) => r.customerName.trim() !== "" && toNum(r.amount) !== 0);
  const dirty =
    filled.length !== rows.length ||
    filled.some((r) => {
      const before = r.id ? rows.find((x) => x.id === r.id) : undefined;
      return (
        !before ||
        before.customerName !== r.customerName.trim() ||
        Math.abs(before.amount - toNum(r.amount)) >= 0.5
      );
    });
  const set = (i: number, patch: Partial<ArDraft>) =>
    setDraft((d) => d.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function copyPrior() {
    setDraft(
      priorRows.length > 0
        ? priorRows.map((r) => ({ customerName: r.customerName, amount: fmtN(r.amount) }))
        : [{ customerName: "", amount: "" }]
    );
  }

  async function save() {
    setBusy(true);
    const keep = new Set<string>();
    for (const r of draft) {
      const name = r.customerName.trim();
      const amount = toNum(r.amount);
      if (!name || amount === 0) continue;
      if (r.id) {
        keep.add(r.id);
        const before = rows.find((x) => x.id === r.id);
        if (before && (before.customerName !== name || before.amount !== amount)) {
          await crud("arEntry", "update", { id: r.id, data: { monthId, customerName: name, amount } });
        }
      } else {
        await crud("arEntry", "create", { data: { monthId, customerName: name, amount } });
      }
    }
    for (const existing of rows) if (!keep.has(existing.id)) await crud("arEntry", "delete", { id: existing.id });
    setBusy(false);
    router.refresh();
  }

  return (
    <Step
      n={2}
      title={t("arByCustomer")}
      hint={ru ? "Кто не рассчитался на конец месяца" : "Who still owes at month end"}
      done={done}
      total={draftTotal}
      action={
        !readOnly && (
          <span className="flex items-center gap-2">
            {priorLabel && priorRows.length > 0 && (
              <Button variant="secondary" onClick={copyPrior}>
                {ru ? "Скопировать из" : "Copy from"} {priorLabel}
              </Button>
            )}
            <Button onClick={save} disabled={busy}>
              {busy ? t("saving") : t("save")}
            </Button>
          </span>
        )
      }
    >
      <div className="space-y-1.5 p-4">
        {draft.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={r.customerName}
              onChange={(e) => set(i, { customerName: e.target.value })}
              placeholder={t("customer")}
              disabled={readOnly}
              className="min-w-0 flex-1"
            />
            <Input
              value={r.amount}
              onChange={(e) => set(i, { amount: e.target.value })}
              onBlur={(e) => set(i, { amount: pretty(e.target.value) })}
              placeholder={t("amount")}
              disabled={readOnly}
              className="num w-44 text-right"
            />
            {!readOnly && (
              <button
                onClick={() => setDraft((d) => (d.length > 1 ? d.filter((_, j) => j !== i) : d))}
                className="text-muted transition-colors hover:text-danger"
                title={t("delete")}
              >
                <IconTrash size={14} />
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button
            onClick={() => setDraft((d) => [...d, { customerName: "", amount: "" }])}
            className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline"
          >
            <IconPlus size={13} /> {ru ? "Добавить клиента" : "Add customer"}
          </button>
        )}
        <div className="flex items-baseline justify-between border-t border-border pt-2 text-[13px] font-semibold">
          <span>{t("total")}</span>
          <span className="num w-44 text-right">{fmtN(draftTotal)}</span>
        </div>
      </div>
      {dirty && (
        <p className="border-t border-border px-4 py-2 text-[11.5px] text-warn">
          {ru ? "Есть несохранённые изменения" : "Unsaved changes"}
        </p>
      )}
    </Step>
  );
}

// ── 3 · other monthly inputs ─────────────────────────────────────
const MB_FIELDS: Array<{ field: keyof Omit<MonthBalanceIn, "monthId">; key: DictKey; liability?: boolean }> = [
  { field: "tiBank", key: "tiBankBalance" },
  { field: "tiCash", key: "tiCashBalance" },
  { field: "goodsInTransit", key: "goodsInTransit" },
  { field: "vatPrepayment", key: "vatPrepayment" },
  { field: "priorVatBalance", key: "priorVatBalance", liability: true },
  { field: "nutribenLoan", key: "nutribenLoan", liability: true },
];

function MonthInputsStep({
  monthId,
  balance,
  priorBalance,
  priorLabel,
  readOnly,
}: {
  monthId: string;
  balance: MonthBalanceIn | null;
  priorBalance: MonthBalanceIn | null;
  priorLabel: string | null;
  readOnly: boolean;
}) {
  const { t, locale } = useT();
  const ru = locale === "ru";
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(MB_FIELDS.map(({ field }) => [field, balance ? fmtN(balance[field]) : ""]))
  );
  const [busy, setBusy] = useState(false);

  const assets = useMemo(
    () => MB_FIELDS.filter((f) => !f.liability).reduce((s, f) => s + toNum(draft[f.field] ?? ""), 0),
    [draft]
  );

  function copyPrior() {
    if (!priorBalance) return;
    setDraft(Object.fromEntries(MB_FIELDS.map(({ field }) => [field, fmtN(priorBalance[field])])));
  }

  async function save() {
    setBusy(true);
    const data: Record<string, unknown> = { monthId };
    for (const { field } of MB_FIELDS) data[field] = parseNum(draft[field] ?? "") ?? 0;
    await crud("monthBalance", "upsert", { data });
    setBusy(false);
    router.refresh();
  }

  return (
    <Step
      n={3}
      title={t("monthInputs")}
      hint={ru ? "Банк, товар в пути, НДС и займы" : "Bank, goods in transit, VAT and loans"}
      done={!!balance}
      total={assets}
      action={
        !readOnly && (
          <span className="flex items-center gap-2">
            {priorLabel && priorBalance && (
              <Button variant="secondary" onClick={copyPrior}>
                {ru ? "Скопировать из" : "Copy from"} {priorLabel}
              </Button>
            )}
            <Button onClick={save} disabled={busy}>
              {busy ? t("saving") : t("save")}
            </Button>
          </span>
        )
      }
    >
      <div className="grid gap-x-8 gap-y-2 p-4 sm:grid-cols-2">
        {MB_FIELDS.map(({ field, key, liability }) => (
          <div key={field} className="flex items-center justify-between gap-3">
            <label className="text-[13px]">
              {t(key)}
              <span className="ml-1.5 text-[11px] text-muted">
                {liability ? (ru ? "обяз." : "liab.") : (ru ? "актив" : "asset")}
              </span>
            </label>
            <Input
              value={draft[field] ?? ""}
              disabled={readOnly}
              onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
              onBlur={(e) => setDraft((d) => ({ ...d, [field]: pretty(e.target.value) }))}
              placeholder="0"
              className="num w-44 text-right"
            />
          </div>
        ))}
      </div>
      {!balance && (
        <p className="border-t border-border px-4 py-2 text-[11.5px]">
          <Badge tone="warn">{ru ? "не заполнено" : "not filled"}</Badge>{" "}
          <span className="text-muted">
            {ru
              ? "без этих значений баланс за месяц будет неполным"
              : "without these the month's balance sheet is incomplete"}
          </span>
        </p>
      )}
    </Step>
  );
}
