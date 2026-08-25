"use client";

// «План (IBP)» — a month-focused worksheet. One month is in focus at a time,
// picked on the month rail (history plain · closed months indigo with a lock ·
// open months green · the deadline month badged). Below it, one row per SKU
// with the four IBP numbers side by side:
//   Model Forecast → Partner Forecast → Partner Order → Partner Purchase
// Open months edit in place; a closed month opens only via «Изменить» and its
// inputs turn amber to mark the override. Stock intelligence lives on
// «Запасы», decisions on «Решения».
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, PageTitle } from "./ui";
import { IconCheck, IconLock, IconPencil } from "./icons";
import PlanningTabs from "./PlanningTabs";
import { useT } from "@/lib/locale-context";
import { fmtN } from "@/lib/format";
import {
  addMonths,
  type OrderSlot,
  type PlanningSettings,
  type PlanningSkuIn,
  type SkuProjection,
  type SkuSituation,
} from "@/lib/planning/compute";
import type { DemandModelResult } from "@/lib/planning/model";

const MONTH_RU = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(key: string, ru: boolean): string {
  const [y, m] = key.split("-").map(Number);
  return `${(ru ? MONTH_RU : MONTH_EN)[m - 1]} '${String(y).slice(2)}`;
}
function monthShort(key: string, ru: boolean): string {
  return (ru ? MONTH_RU : MONTH_EN)[Number(key.split("-")[1]) - 1];
}

// edits are keyed "skuId|monthKey" and hold the raw input string
type Edits = Record<string, string>;
const cellKey = (skuId: string, m: string) => `${skuId}|${m}`;

function parseQty(raw: string): number {
  const s = raw.trim();
  if (s === "") return 0;
  const n = Number(s.replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export interface PlanningViewProps {
  skus: PlanningSkuIn[];
  situations: Record<string, SkuSituation>;
  projections: Record<string, SkuProjection>;
  slot: OrderSlot;
  startMonth: string;
  settings: PlanningSettings;
  eurRate: number;
  purchases: Record<string, Record<string, number>>; // skuId -> shipMonth -> committed qty
  recruitment: Record<string, number>;
  model: DemandModelResult;
  pickups: Record<string, Record<string, number>>; // skuId -> DISPATCH month -> units picked up
  isAdmin: boolean;
}

// cumulative Open Orders start here — the owner confirmed 2025 nets to zero
const BACKLOG_EPOCH = "2026-01";

/** A month's place in the IBP cycle. */
type MonthState = "history" | "closed" | "open";
function monthState(m: string, startMonth: string, shipMonth: string): MonthState {
  if (m < startMonth) return "history";
  return m < shipMonth ? "closed" : "open";
}

export default function PlanningView({
  skus,
  situations,
  slot,
  startMonth,
  purchases,
  recruitment,
  model,
  pickups,
  isAdmin,
}: PlanningViewProps) {
  const { locale } = useT();
  const ru = locale === "ru";
  const router = useRouter();
  const [forecastEdits, setForecastEdits] = useState<Edits>({});
  const [orderEdits, setOrderEdits] = useState<Edits>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // closed months a deliberate «Изменить» has opened for correction
  const [unlockedMonths, setUnlockedMonths] = useState<Set<string>>(new Set());

  const active = skus.filter((s) => s.active);

  // ── the month rail: 12 visible, pageable, deadline month in focus ──
  const RAIL = 12;
  const MIN_MONTH = "2025-08";
  const defaultRailStart = addMonths(startMonth, -4);
  const maxRailStart = addMonths(startMonth, 6);
  const [railStart, setRailStart] = useState(defaultRailStart);
  const railMonths = useMemo(() => Array.from({ length: RAIL }, (_, i) => addMonths(railStart, i)), [railStart]);
  const clampRail = (m: string) => (m < MIN_MONTH ? MIN_MONTH : m > maxRailStart ? maxRailStart : m);
  const [selected, setSelected] = useState(slot.shipMonth);

  const selState = monthState(selected, startMonth, slot.shipMonth);
  const selUnlocked = unlockedMonths.has(selected);
  const selEditable = isAdmin && (selState === "open" || selUnlocked);

  // ── pending edits vs committed values (locked months never save) ──
  const dirty = useMemo(() => {
    const editable = (m: string) => m >= slot.shipMonth || unlockedMonths.has(m);
    const fc: Array<{ skuId: string; monthKey: string; qty: number }> = [];
    for (const [key, raw] of Object.entries(forecastEdits)) {
      const [skuId, m] = key.split("|");
      const qty = parseQty(raw);
      if (editable(m) && (situations[skuId]?.forecast[m] ?? 0) !== qty) fc.push({ skuId, monthKey: m, qty });
    }
    const po: Array<{ skuId: string; shipMonth: string; qty: number }> = [];
    for (const [key, raw] of Object.entries(orderEdits)) {
      const [skuId, m] = key.split("|");
      const qty = parseQty(raw);
      if (editable(m) && (purchases[skuId]?.[m] ?? 0) !== qty) po.push({ skuId, shipMonth: m, qty });
    }
    return { fc, po, count: fc.length + po.length };
  }, [forecastEdits, orderEdits, situations, purchases, slot.shipMonth, unlockedMonths]);

  function discardAll() {
    setForecastEdits({});
    setOrderEdits({});
    setUnlockedMonths(new Set());
    setSaveError(false);
  }

  /** Re-locks one month, dropping its pending edits with it. */
  function relock(m: string) {
    setUnlockedMonths((prev) => {
      const next = new Set(prev);
      next.delete(m);
      return next;
    });
    const strip = (e: Edits): Edits => {
      const next: Edits = {};
      for (const [k, v] of Object.entries(e)) if (!k.endsWith(`|${m}`)) next[k] = v;
      return next;
    };
    setForecastEdits(strip);
    setOrderEdits(strip);
  }

  async function saveAll() {
    setSaving(true);
    setSaveError(false);
    try {
      for (const f of dirty.fc) {
        const res = await fetch("/api/planning/forecast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(f),
        });
        if (!res.ok) throw new Error(`forecast ${res.status}`);
      }
      const byMonth: Record<string, Array<{ skuId: string; qty: number }>> = {};
      for (const p of dirty.po) (byMonth[p.shipMonth] ??= []).push({ skuId: p.skuId, qty: p.qty });
      for (const [shipMonth, lines] of Object.entries(byMonth)) {
        const res = await fetch("/api/planning/purchase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shipMonth, lines }),
        });
        if (!res.ok) throw new Error(`purchase ${res.status}`);
      }
      discardAll();
      router.refresh();
    } catch {
      // keep the edits; already-saved months re-save harmlessly on retry
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  // the card: the same rule as the column, taken at the current month —
  // Σ positive (Partner Order − Partner Purchase)
  const ledgerOpenTotal = active.reduce((s, sku) => s + Math.max(0, cumOpenAt(sku.id, startMonth)), 0);

  // Open Orders — ONE rule for every month (the owner's ruling): cumulative
  // Partner Order − Partner Purchase (pickups at dispatch) since the epoch.
  // Positive = ordered but not collected; negative = collected beyond orders.
  // DMK's own ERP figure stays as a secondary reference on the card (it is
  // what the ordering engine books as incoming supply — the safe assumption).
  function cumOpenAt(skuId: string, m: string): number {
    let cum = 0;
    for (let t = BACKLOG_EPOCH; t <= m; t = addMonths(t, 1)) {
      cum += purchases[skuId]?.[t] ?? 0;
      cum -= pickups[skuId]?.[t] ?? 0;
    }
    return cum;
  }

  // per-SKU numbers for the selected month, live with pending edits
  const rows = active.map((sku) => {
    const sit = situations[sku.id];
    const rawModel = sit.model?.[selected];
    const modelQty = rawModel !== undefined ? Math.round(rawModel) : null;
    const fRaw = forecastEdits[cellKey(sku.id, selected)];
    const oRaw = orderEdits[cellKey(sku.id, selected)];
    const forecast = fRaw !== undefined ? parseQty(fRaw) : (sit.forecast[selected] ?? 0);
    const order = oRaw !== undefined ? parseQty(oRaw) : (purchases[sku.id]?.[selected] ?? 0);
    // pickup ex-works, DMK's convention: real dispatchDate when the truck has
    // one, else assumed arrival − 1 (ETA − 1 while in transit)
    const purchase = pickups[sku.id]?.[selected] ?? 0;
    const openCum = selected >= BACKLOG_EPOCH ? cumOpenAt(sku.id, selected) : null;
    const open = openCum !== null ? Math.max(0, openCum) : 0;
    return { sku, sit, modelQty, forecast, order, purchase, fRaw, oRaw, open, openCum };
  });
  const totals = rows.reduce(
    (t, r) => ({
      model: t.model + (r.modelQty ?? 0),
      forecast: t.forecast + r.forecast,
      order: t.order + r.order,
      backlog: t.backlog + r.open,
      purchase: t.purchase + r.purchase,
    }),
    { model: 0, forecast: 0, order: 0, backlog: 0, purchase: 0 }
  );

  const deadlineDate = new Date(slot.deadline + "T00:00:00").toLocaleDateString(ru ? "ru-RU" : "en-GB", {
    day: "numeric",
    month: "long",
  });

  const inputCls = (dirtyCell: boolean, forced: boolean) =>
    `num h-9 w-24 rounded-md border bg-surface px-2 text-right text-[14px] font-medium focus:outline-none ${
      forced
        ? dirtyCell
          ? "border-warn bg-warn-soft/40 text-warn"
          : "border-warn/50 text-warn focus:border-warn"
        : dirtyCell
          ? "border-accent bg-accent-soft/30"
          : "border-border focus:border-accent"
    }`;

  return (
    <div className="pb-16">
      <PageTitle
        title={ru ? "Планирование закупок" : "Supply planning"}
        subtitle={
          ru
            ? "IBP: прогноз и заказы — вносится в систему Humana до 20-го числа"
            : "IBP: forecast and orders — entered into Humana's system by the 20th"
        }
      />
      <PlanningTabs />

      {/* two things to know before touching the worksheet */}
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Card className="px-5 py-4">
          <div className="label-caps">{ru ? "Открытый слот" : "Open slot"}</div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="num font-display text-[22px] font-extrabold">{monthLabel(slot.shipMonth, ru)}</span>
            <span className="text-[13px] text-muted">{ru ? "отгрузка из Германии" : "ships from Germany"}</span>
          </div>
          <div className="mt-1.5 text-[13px]">
            {ru ? "Заказ до" : "Order by"} <span className="num font-semibold text-accent">{deadlineDate}</span>{" "}
            <span
              className={`num ml-1 rounded-full px-2 py-px text-[11px] font-bold text-white ${
                slot.daysLeft <= 3 ? "bg-danger" : "bg-accent"
              }`}
            >
              {slot.daysLeft === 0 ? (ru ? "сегодня" : "today") : `${slot.daysLeft} ${ru ? "дн." : "d"}`}
            </span>
            <span className="ml-2 text-muted">
              {ru ? "на складе" : "in stock"} ~{monthLabel(slot.arrivalMonth, ru)}
            </span>
          </div>
        </Card>
        <Card className="px-5 py-4">
          <div className="label-caps">{ru ? "Заказано, но не получено" : "Ordered, not received"}</div>
          {ledgerOpenTotal > 0 ? (
            <>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="num font-display text-[22px] font-extrabold text-warn">{fmtN(ledgerOpenTotal)}</span>
                <span className="text-[13px] text-muted">
                  {ru ? "шт — Partner Order − Partner Purchase" : "pcs — Partner Order − Partner Purchase"}
                </span>
              </div>
              <div className="mt-1.5 text-[12.5px] text-muted">
                {ru
                  ? "Накопленно с янв '26 — уменьшается с каждой новой фурой"
                  : "Cumulative since Jan '26 — every new truck reduces it"}
              </div>
            </>
          ) : (
            <div className="mt-1.5 flex items-center gap-2 text-[14px] text-ok">
              <IconCheck size={16} />
              {ru ? "Все заказы получены" : "All orders received"}
            </div>
          )}
        </Card>
      </div>

      {/* the worksheet: month rail + four numbers per SKU */}
      <Card className="overflow-hidden">
        {/* month rail — the cycle itself: history · closed (lock) · open (green) */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <button
            type="button"
            disabled={railStart <= MIN_MONTH}
            onClick={() => setRailStart((w) => clampRail(addMonths(w, -3)))}
            className="rounded-md border border-border px-2 py-1.5 text-[13px] text-muted transition-colors hover:text-accent disabled:opacity-30"
          >
            ‹
          </button>
          <div className="flex flex-1 gap-1 overflow-x-auto">
            {railMonths.map((m) => {
              const st = monthState(m, startMonth, slot.shipMonth);
              const isSel = m === selected;
              const base =
                st === "closed"
                  ? "bg-accent-soft-bg/70 text-accent/80"
                  : st === "open"
                    ? "bg-ok-soft text-ok"
                    : "text-muted hover:bg-surface-low";
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSelected(m)}
                  className={`flex min-w-16 flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 transition-shadow ${base} ${
                    isSel ? "ring-2 ring-accent" : ""
                  }`}
                >
                  <span className={`flex items-center gap-1 text-[12.5px] ${isSel ? "font-bold" : "font-medium"}`}>
                    {st === "closed" && <IconLock size={10} />}
                    {monthShort(m, ru)}
                    {(m.endsWith("-01") || m === railMonths[0]) && (
                      <span className="text-[10px] opacity-60">’{m.slice(2, 4)}</span>
                    )}
                  </span>
                  {m === slot.shipMonth ? (
                    <span className="num rounded-full bg-accent px-1.5 text-[9px] font-bold leading-4 text-white">
                      {ru ? "дедлайн" : "deadline"}
                    </span>
                  ) : (
                    <span className="text-[9px] leading-4 opacity-70">
                      {st === "closed" ? (ru ? "закрыт" : "closed") : st === "open" ? (ru ? "открыт" : "open") : " "}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            disabled={railStart >= maxRailStart}
            onClick={() => setRailStart((w) => clampRail(addMonths(w, 3)))}
            className="rounded-md border border-border px-2 py-1.5 text-[13px] text-muted transition-colors hover:text-accent disabled:opacity-30"
          >
            ›
          </button>
        </div>

        {/* the selected month's standing in the cycle, and the override control */}
        <div
          className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-5 py-2.5 ${
            selUnlocked ? "bg-warn-soft/50" : selState === "closed" ? "bg-accent-soft-bg/40" : ""
          }`}
        >
          <span className="num font-display text-[15px] font-bold">{monthLabel(selected, ru)}</span>
          {selState === "history" && (
            <span className="text-[13px] text-muted">{ru ? "история — только просмотр" : "history — view only"}</span>
          )}
          {selState === "open" && (
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-ok">
              <span className="inline-block h-2 w-2 rounded-full bg-ok" />
              {ru ? "открыт для ввода" : "open for entry"}
              {selected === slot.shipMonth && (
                <span className="text-muted">
                  · {ru ? "заказ до" : "order by"} {deadlineDate}
                </span>
              )}
            </span>
          )}
          {selState === "closed" && !selUnlocked && (
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-accent">
              <IconLock size={13} />
              {ru ? "закрыт — заказ уже в производстве" : "closed — the order is in production"}
            </span>
          )}
          {selUnlocked && (
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-warn">
              <IconPencil size={13} />
              {ru ? "открыт вручную — правки будут сохранены" : "opened manually — edits will be saved"}
            </span>
          )}
          {isAdmin && selState === "closed" && (
            <button
              type="button"
              onClick={() => (selUnlocked ? relock(selected) : setUnlockedMonths((p) => new Set(p).add(selected)))}
              className={`ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors ${
                selUnlocked
                  ? "bg-warn text-white hover:bg-warn/90"
                  : "border border-border bg-surface text-muted hover:border-warn/50 hover:text-warn"
              }`}
            >
              {selUnlocked ? <IconLock size={12} /> : <IconPencil size={12} />}
              {selUnlocked ? (ru ? "Закрыть снова" : "Re-lock") : ru ? "Изменить" : "Edit"}
            </button>
          )}
        </div>

        {/* one row per SKU, the four IBP numbers side by side */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="min-w-52 px-5 py-3 text-[12px] font-medium text-muted">{ru ? "Товар" : "Product"}</th>
                <Th title="Model Forecast" sub={ru ? "модель спроса" : "demand model"} />
                <Th title="Partner Forecast" sub={ru ? "внесено в IBP" : "entered in IBP"} />
                <Th title="Partner Order" sub={ru ? "заказ — отгрузка в этом мес." : "order — ships this month"} />
                <Th title="Open Orders" sub={ru ? "заказано − вывезено · накопленно" : "ordered − picked up · cumulative"} />
                <Th title="Partner Purchase" sub={ru ? "фактический вывоз у DMK" : "actual pickup ex-works"} />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ sku, modelQty, forecast, order, purchase, fRaw, oRaw, open, openCum }) => {
                const stage = model.stageBySku[sku.id] ?? null;
                const origF = situations[sku.id].forecast[selected] ?? 0;
                const origO = purchases[sku.id]?.[selected] ?? 0;
                return (
                  <tr key={sku.id} className="border-b border-border/50 last:border-b-0">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-semibold">{sku.name}</span>
                        <Badge tone={stage ? "accent" : "neutral"}>{stage ?? "Expert"}</Badge>
                      </div>
                      <div className="num mt-0.5 text-[11px] text-muted">
                        {ru ? "Арт." : "Art."} {sku.article}
                      </div>
                    </td>
                    {/* Model Forecast + apply */}
                    <td className="px-3 py-2.5 text-right">
                      <span className="num text-[14px] italic text-muted">
                        {modelQty !== null && modelQty > 0 ? fmtN(modelQty) : "—"}
                      </span>
                      {selEditable && modelQty !== null && modelQty > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setForecastEdits((e) => ({ ...e, [cellKey(sku.id, selected)]: String(modelQty) }))
                          }
                          title={ru ? "Применить в Partner Forecast" : "Apply to Partner Forecast"}
                          className="ml-1.5 rounded px-1 text-[12px] font-semibold text-accent hover:bg-accent-soft/50"
                        >
                          →
                        </button>
                      )}
                    </td>
                    {/* Partner Forecast */}
                    <td className="px-3 py-2.5 text-right">
                      {selEditable ? (
                        <input
                          className={inputCls(fRaw !== undefined && parseQty(fRaw) !== origF, selUnlocked)}
                          value={fRaw ?? (origF > 0 ? String(origF) : "")}
                          onChange={(e) =>
                            setForecastEdits((ed) => ({ ...ed, [cellKey(sku.id, selected)]: e.target.value }))
                          }
                          placeholder="0"
                          inputMode="numeric"
                        />
                      ) : (
                        <span className={`num text-[14px] ${forecast > 0 ? "font-medium" : "text-muted/50"}`}>
                          {forecast > 0 ? fmtN(forecast) : "—"}
                        </span>
                      )}
                    </td>
                    {/* Partner Order */}
                    <td className="px-3 py-2.5 text-right">
                      {selEditable ? (
                        <input
                          className={inputCls(oRaw !== undefined && parseQty(oRaw) !== origO, selUnlocked)}
                          value={oRaw ?? (origO > 0 ? String(origO) : "")}
                          onChange={(e) =>
                            setOrderEdits((ed) => ({ ...ed, [cellKey(sku.id, selected)]: e.target.value }))
                          }
                          placeholder="0"
                          inputMode="numeric"
                        />
                      ) : (
                        <span
                          className={`num text-[14px] ${order > 0 ? "font-semibold text-accent" : "text-muted/50"}`}
                        >
                          {order > 0 ? fmtN(order) : "—"}
                        </span>
                      )}
                    </td>
                    {/* Open Orders — history: cumulative through the month (amber = still
                        to pick up, green = picked up beyond orders); today: DMK live */}
                    <td className="px-3 py-2.5 text-right">
                      <span
                        className={`num text-[14px] ${
                          open > 0
                            ? "font-semibold text-warn"
                            : openCum !== null && openCum < 0
                              ? "font-semibold text-ok"
                              : "text-muted/40"
                        }`}
                      title={
                          openCum !== null
                            ? ru
                              ? `Partner Order − Partner Purchase, накопленно с янв '26 к концу ${monthLabel(selected, ru)}${
                                  openCum < 0 ? `. Вывезено на ${fmtN(-openCum)} шт больше заказов.` : ""
                                }`
                              : `Partner Order − Partner Purchase, cumulative since Jan '26 through ${monthLabel(selected, ru)}${
                                  openCum < 0 ? `. ${fmtN(-openCum)} pcs picked up beyond orders.` : ""
                                }`
                            : undefined
                        }
                      >
                        {open > 0 ? fmtN(open) : openCum !== null && openCum < 0 ? `+${fmtN(-openCum)}` : "—"}
                      </span>
                    </td>
                    {/* Partner Purchase — by pickup month (DMK's convention) */}
                    <td className="px-3 py-2.5 pr-5 text-right">
                      <span
                        className={`num text-[14px] ${purchase > 0 ? "font-medium" : "text-muted/50"}`}
                        title={
                          purchase > 0
                            ? ru
                              ? "Вывоз со склада DMK в этом месяце; приход в Ташкент — примерно на месяц позже"
                              : "Picked up from DMK this month; arrives in Tashkent about a month later"
                            : undefined
                        }
                      >
                        {purchase > 0 ? fmtN(purchase) : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-surface-low/40">
                <td className="px-5 py-2.5 text-[12px] font-semibold uppercase tracking-[0.05em] text-muted">
                  {ru ? "Итого" : "Total"}
                </td>
                <td className="num px-3 py-2.5 text-right text-[14px] font-semibold italic text-muted">
                  {totals.model > 0 ? fmtN(totals.model) : "—"}
                </td>
                <td className="num px-3 py-2.5 text-right text-[14px] font-bold">
                  {totals.forecast > 0 ? fmtN(totals.forecast) : "—"}
                </td>
                <td className="num px-3 py-2.5 text-right text-[14px] font-bold text-accent">
                  {totals.order > 0 ? fmtN(totals.order) : "—"}
                </td>
                <td className="num px-3 py-2.5 text-right text-[14px] font-bold text-warn">
                  {totals.backlog > 0 ? fmtN(totals.backlog) : "—"}
                </td>
                <td className="num px-3 py-2.5 pr-5 text-right text-[14px] font-bold">
                  {totals.purchase > 0 ? fmtN(totals.purchase) : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <RecruitmentCard recruitment={recruitment} ru={ru} isAdmin={isAdmin} onSaved={() => router.refresh()} />

      {/* sticky save bar: appears as soon as anything is pending */}
      {isAdmin && dirty.count > 0 && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 shadow-[0_8px_30px_rgba(15,23,42,0.18)]">
          <span className="flex items-center gap-1.5 text-[13px]">
            <IconPencil size={13} className="text-accent" />
            {ru ? "Изменено" : "Changed"}: <span className="num font-semibold">{dirty.count}</span>
          </span>
          {saveError && (
            <span className="text-[12px] font-medium text-danger">
              {ru ? "Не сохранилось — попробуйте ещё раз" : "Save failed — try again"}
            </span>
          )}
          <Button variant="ghost" onClick={discardAll}>
            {ru ? "Отменить" : "Discard"}
          </Button>
          <Button disabled={saving} onClick={() => void saveAll()}>
            {saving ? (ru ? "Сохранение…" : "Saving…") : ru ? "Сохранить" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Column header: the IBP field name over a quiet explainer. */
function Th({ title, sub }: { title: string; sub: string }) {
  return (
    <th className="min-w-32 px-3 py-3 text-right last:pr-5">
      <div className="text-[12px] font-semibold text-foreground">{title}</div>
      <div className="text-[10.5px] font-normal text-muted">{sub}</div>
    </th>
  );
}

/** Verified prescriptions — the demand driver. New month goes in directly;
 *  correcting history takes the pencil toggle first. */
function RecruitmentCard({
  recruitment,
  ru,
  isAdmin,
  onSaved,
}: {
  recruitment: Record<string, number>;
  ru: boolean;
  isAdmin: boolean;
  onSaved: () => void;
}) {
  const [editOn, setEditOn] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const [newVal, setNewVal] = useState("");
  const [busy, setBusy] = useState(false);
  const canEdit = isAdmin && editOn;

  const recorded = Object.keys(recruitment).sort();
  const months = recorded.slice(-6);
  const nextKey = recorded.length > 0 ? addMonths(recorded[recorded.length - 1], 1) : null;
  const max = Math.max(...months.map((m) => recruitment[m]), 1);
  const last = recorded[recorded.length - 1];
  const prev = recorded[recorded.length - 2];
  const trend =
    last && prev && recruitment[prev] > 0
      ? ((recruitment[last] - recruitment[prev]) / recruitment[prev]) * 100
      : null;

  async function save(m: string, raw: string) {
    setBusy(true);
    try {
      await fetch("/api/planning/recruitment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthKey: m, babies: parseQty(raw) }),
      });
      setEditing(null);
      setNewVal("");
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4 px-5 py-4">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <div className="label-caps">{ru ? "Медицинский канал" : "Medical channel"}</div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            {ru ? "Подтверждённые рецепты — драйвер модели спроса" : "Verified prescriptions — the demand model's driver"}
            {trend !== null && (
              <span className={`num ml-2 font-semibold ${trend >= 0 ? "text-ok" : "text-danger"}`}>
                {trend >= 0 ? "+" : ""}
                {trend.toFixed(1)}% {ru ? "к прошлому мес." : "vs last mo."}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-end gap-2">
          {months.map((m) => (
            <div key={m} className="flex flex-col items-center gap-0.5">
              {editing === m ? (
                <input
                  autoFocus
                  className="num h-6 w-14 rounded border border-accent bg-surface px-1 text-right text-[11px] focus:outline-none"
                  value={val}
                  disabled={busy}
                  onChange={(e) => setVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void save(m, val);
                    if (e.key === "Escape") setEditing(null);
                  }}
                  onBlur={() => {
                    if (!busy) setEditing(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={`num text-[10px] text-muted ${
                    canEdit
                      ? "underline decoration-border-strong decoration-dashed underline-offset-2 hover:text-accent"
                      : "cursor-default"
                  }`}
                  title={canEdit ? (ru ? "Изменить (Enter — сохранить)" : "Edit (Enter saves)") : undefined}
                  onClick={
                    canEdit
                      ? () => {
                          setEditing(m);
                          setVal(String(recruitment[m]));
                        }
                      : undefined
                  }
                >
                  {fmtN(recruitment[m])}
                </button>
              )}
              <div
                className="w-8 rounded-t bg-accent/60"
                style={{ height: `${5 + (recruitment[m] / max) * 30}px` }}
                title={`${monthLabel(m, ru)}: ${fmtN(recruitment[m])}`}
              />
              <span className="text-[9px] text-muted">{monthShort(m, ru)}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && nextKey && (
            <>
              <div>
                <div className="label-caps">{ru ? `Рецепты за ${monthLabel(nextKey, ru)}` : `Rx for ${monthLabel(nextKey, ru)}`}</div>
                <input
                  className="num mt-1 h-8 w-28 rounded-md border border-border bg-surface px-2 text-right text-[13px] focus:border-accent focus:outline-none"
                  value={newVal}
                  disabled={busy}
                  placeholder="0"
                  inputMode="numeric"
                  onChange={(e) => setNewVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && parseQty(newVal) > 0) void save(nextKey, newVal);
                  }}
                />
              </div>
              <Button disabled={busy || parseQty(newVal) <= 0} onClick={() => void save(nextKey, newVal)}>
                {busy ? "…" : ru ? "Внести" : "Add"}
              </Button>
            </>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setEditOn((v) => !v);
                setEditing(null);
              }}
              title={ru ? "Исправить прошлые месяцы" : "Correct past months"}
              className={`self-end rounded-md px-2 py-1.5 text-[11.5px] font-medium transition-colors ${
                editOn
                  ? "bg-accent-soft-bg font-semibold text-accent"
                  : "border border-border text-muted hover:border-accent/40 hover:text-accent"
              }`}
            >
              <IconPencil size={11} />
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
