"use client";

// «План (IBP)» — a clean mirror of the IBP workflow, four layers per SKU:
//   Partner Forecast  — our demand forecast (editable; what goes into IBP)
//   Model Forecast    — the cohort model's estimate (computed; click to apply)
//   Partner Order     — committed orders by SHIP month (editable ahead; the
//                       deadline column is the current slot)
//   Partner Purchase  — actual buys: units that really arrived (history)
// Stock intelligence lives on the «Запасы» tab, decisions on «Решения».
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader, PageTitle } from "./ui";
import { IconAlert } from "./icons";
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
import type { Stage } from "@/lib/planning/cohort";
import type { DemandModelResult } from "@/lib/planning/model";

const MONTH_RU = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(key: string, ru: boolean): string {
  const [y, m] = key.split("-").map(Number);
  return `${(ru ? MONTH_RU : MONTH_EN)[m - 1]} '${String(y).slice(2)}`;
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

/** Everything the grid rows need besides their own SKU data. */
interface GridCtx {
  ru: boolean;
  isAdmin: boolean;
  startMonth: string;
  months: string[]; // the visible 12-month window (past + future mixed)
  slot: OrderSlot;
  forecastEdits: Edits;
  orderEdits: Edits;
  setForecast: (skuId: string, m: string, v: string) => void;
  setOrder: (skuId: string, m: string, v: string) => void;
  applyModel: (skuId: string, m: string, qty: number) => void;
}

/** Column accents: past/future divider + the deadline's ship-month tint. */
function colCls(m: string, ctx: GridCtx): string {
  let s = "";
  if (m === ctx.startMonth) s += "border-l border-border/70 ";
  if (m < ctx.startMonth) s += "bg-surface-low/40 ";
  if (m === ctx.slot.shipMonth) s += "bg-accent-soft-bg/50 ";
  return s;
}

const EMPTY_REC: Record<string, number> = {};

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
  actualArrivals: Record<string, Record<string, number>>; // skuId -> arrival month -> units
  isAdmin: boolean;
}

export default function PlanningView({
  skus,
  situations,
  slot,
  startMonth,
  purchases,
  recruitment,
  model,
  actualArrivals,
  isAdmin,
}: PlanningViewProps) {
  const { locale } = useT();
  const ru = locale === "ru";
  const router = useRouter();
  const [forecastEdits, setForecastEdits] = useState<Edits>({});
  const [orderEdits, setOrderEdits] = useState<Edits>({});
  const [saving, setSaving] = useState(false);

  const active = skus.filter((s) => s.active);

  // a navigable 12-month window: back to the first data month, forward to the
  // model's horizon; ‹ › page by quarters, «сегодня» recenters
  const WINDOW = 12;
  const MIN_MONTH = "2025-08";
  const defaultStart = addMonths(startMonth, -4);
  const maxStart = addMonths(startMonth, 6);
  const [windowStart, setWindowStart] = useState(defaultStart);
  const allMonths = useMemo(
    () => Array.from({ length: WINDOW }, (_, i) => addMonths(windowStart, i)),
    [windowStart]
  );
  const clampStart = (m: string) => (m < MIN_MONTH ? MIN_MONTH : m > maxStart ? maxStart : m);

  // ── pending edits vs committed values ─────────────────────────
  const dirty = useMemo(() => {
    const fc: Array<{ skuId: string; monthKey: string; qty: number }> = [];
    for (const [key, raw] of Object.entries(forecastEdits)) {
      const [skuId, m] = key.split("|");
      const qty = parseQty(raw);
      if ((situations[skuId]?.forecast[m] ?? 0) !== qty) fc.push({ skuId, monthKey: m, qty });
    }
    const po: Array<{ skuId: string; shipMonth: string; qty: number }> = [];
    for (const [key, raw] of Object.entries(orderEdits)) {
      const [skuId, m] = key.split("|");
      const qty = parseQty(raw);
      if ((purchases[skuId]?.[m] ?? 0) !== qty) po.push({ skuId, shipMonth: m, qty });
    }
    return { fc, po, count: fc.length + po.length };
  }, [forecastEdits, orderEdits, situations, purchases]);

  async function saveAll() {
    setSaving(true);
    try {
      for (const f of dirty.fc) {
        await fetch("/api/planning/forecast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(f),
        });
      }
      const byMonth: Record<string, Array<{ skuId: string; qty: number }>> = {};
      for (const p of dirty.po) (byMonth[p.shipMonth] ??= []).push({ skuId: p.skuId, qty: p.qty });
      for (const [shipMonth, lines] of Object.entries(byMonth)) {
        await fetch("/api/planning/purchase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shipMonth, lines }),
        });
      }
      setForecastEdits({});
      setOrderEdits({});
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const ctx: GridCtx = {
    ru,
    isAdmin,
    startMonth,
    months: allMonths,
    slot,
    forecastEdits,
    orderEdits,
    setForecast: (skuId, m, v) => setForecastEdits((e) => ({ ...e, [cellKey(skuId, m)]: v })),
    setOrder: (skuId, m, v) => setOrderEdits((e) => ({ ...e, [cellKey(skuId, m)]: v })),
    applyModel: (skuId, m, qty) => setForecastEdits((e) => ({ ...e, [cellKey(skuId, m)]: String(qty) })),
  };

  // the stage-2 wave note, shown on the first P2 block
  const p2Wave = useMemo(() => {
    const ids = active.filter((s) => model.stageBySku[s.id] === "P2").map((s) => s.id);
    if (ids.length === 0) return null;
    const total = (m: string) => ids.reduce((sum, id) => sum + (model.series[id]?.[m] ?? 0), 0);
    const from = total(startMonth);
    let to = from;
    let toMonth = startMonth;
    for (let i = 1; i <= 14; i++) {
      const m = addMonths(startMonth, i);
      const t = total(m);
      if (t > to) {
        to = t;
        toMonth = m;
      }
    }
    return { from, to, toMonth };
  }, [active, model, startMonth]);
  const firstP2Id = active.find((s) => model.stageBySku[s.id] === "P2")?.id ?? null;

  // Partner Orders whose ship month has passed but the goods never (fully)
  // arrived — the "not picked up" exposure. Estimate: arrival = ship + 1 mo.
  const unpicked = useMemo(() => {
    const byMonth: Record<string, number> = {};
    let total = 0;
    for (const s of active) {
      const ord = purchases[s.id] ?? EMPTY_REC;
      for (const [ship, q] of Object.entries(ord)) {
        if (ship >= startMonth || q <= 0) continue;
        const arrived = actualArrivals[s.id]?.[addMonths(ship, 1)] ?? 0;
        const miss = Math.max(0, q - arrived);
        if (miss > 0) {
          byMonth[ship] = (byMonth[ship] ?? 0) + miss;
          total += miss;
        }
      }
    }
    return { byMonth, total };
  }, [active, purchases, actualArrivals, startMonth]);

  const [, dlMm, dlDd] = slot.deadline.split("-");
  const deadlineShort = `${dlDd}.${dlMm}`;

  return (
    <div className="pb-16">
      <PageTitle
        title={ru ? "Планирование закупок" : "Supply planning"}
        subtitle={
          ru
            ? "IBP: прогноз и заказы — вносится в систему Humana до 20-го числа"
            : "IBP: forecast and orders — entered into Humana's system by the 20th"
        }
        right={
          /* the order-slot pipeline, read left to right like the workflow */
          <div className="flex items-center rounded-[10px] border border-border bg-surface py-3">
            <div className="border-r border-border px-5">
              <div className="label-caps">{ru ? "Дедлайн слота" : "Slot deadline"}</div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="num font-display text-[17px] font-extrabold text-accent">
                  {new Date(slot.deadline + "T00:00:00").toLocaleDateString(ru ? "ru-RU" : "en-GB", {
                    day: "numeric",
                    month: "long",
                  })}
                </span>
                <span
                  className={`num rounded-full px-2 py-px text-[10.5px] font-bold text-white ${
                    slot.daysLeft <= 3 ? "bg-danger" : "bg-accent"
                  }`}
                >
                  {slot.daysLeft === 0 ? (ru ? "сегодня" : "today") : `${slot.daysLeft} ${ru ? "дн." : "d"}`}
                </span>
              </div>
            </div>
            <div className="border-r border-border px-5">
              <div className="label-caps">{ru ? "Производство" : "Production"}</div>
              <div className="num mt-0.5 text-[13.5px] font-semibold">
                {monthLabel(addMonths(slot.orderMonth, 1), ru).split(" ")[0].toLowerCase()} –{" "}
                {monthLabel(addMonths(slot.shipMonth, -1), ru).split(" ")[0].toLowerCase()}
              </div>
            </div>
            <div className="border-r border-border px-5">
              <div className="label-caps">{ru ? "Отгрузка" : "Ships"}</div>
              <div className="num mt-0.5 text-[13.5px] font-semibold">{monthLabel(slot.shipMonth, ru)}</div>
            </div>
            <div className="px-5">
              <div className="label-caps">{ru ? "На складе" : "In warehouse"}</div>
              <div className="num mt-0.5 text-[13.5px] font-semibold text-ok">~{monthLabel(slot.arrivalMonth, ru)}</div>
            </div>
          </div>
        }
      />
      <PlanningTabs />

      {/* unpicked Partner Orders — committed, ship month passed, goods absent */}
      {unpicked.total > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-warn/25 bg-warn-soft px-4 py-2.5 text-[12.5px] text-warn">
          <span className="flex items-center gap-1.5 font-semibold">
            <IconAlert size={14} />
            {ru ? "Не выбрано из Partner Orders:" : "Not picked up from Partner Orders:"}{" "}
            <span className="num">~{fmtN(unpicked.total)} {ru ? "шт" : "pcs"}</span>
          </span>
          {Object.entries(unpicked.byMonth)
            .sort()
            .map(([m, q]) => (
              <span key={m} className="num rounded-md bg-surface px-2 py-0.5 font-medium">
                {ru ? "отгрузка" : "ship"} {monthLabel(m, ru)}: {fmtN(q)}
              </span>
            ))}
          <span className="text-[11px] text-warn/80">
            {ru ? "оценка: приход = отгрузка + 1 мес" : "estimate: arrival = ship + 1 mo"}
          </span>
        </div>
      )}

      {/* the IBP grid */}
      <Card className="overflow-hidden">
        <CardHeader
          title={ru ? "IBP по SKU" : "IBP by SKU"}
          desc={
            ru
              ? "Partner Forecast — ваш прогноз спроса (кликните значение Model Forecast, чтобы применить его). Partner Order — заказ по месяцу ОТГРУЗКИ, колонка дедлайна выделена. Partner Purchase — фактический приход."
              : "Partner Forecast — your demand forecast (click a Model Forecast value to apply it). Partner Order — by SHIP month, the deadline column is highlighted. Partner Purchase — actual arrivals."
          }
          right={
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={windowStart <= MIN_MONTH}
                onClick={() => setWindowStart((w) => clampStart(addMonths(w, -3)))}
                className="rounded-md border border-border px-2.5 py-1 text-[13px] text-muted transition-colors hover:text-accent disabled:opacity-30"
              >
                ‹
              </button>
              <span className="num min-w-32 text-center text-[12px] font-medium text-muted">
                {monthLabel(allMonths[0], ru)} — {monthLabel(allMonths[allMonths.length - 1], ru)}
              </span>
              <button
                type="button"
                disabled={windowStart >= maxStart}
                onClick={() => setWindowStart((w) => clampStart(addMonths(w, 3)))}
                className="rounded-md border border-border px-2.5 py-1 text-[13px] text-muted transition-colors hover:text-accent disabled:opacity-30"
              >
                ›
              </button>
              {windowStart !== defaultStart && (
                <button
                  type="button"
                  onClick={() => setWindowStart(defaultStart)}
                  className="rounded-md px-2 py-1 text-[12px] font-medium text-accent hover:underline"
                >
                  {ru ? "сегодня" : "today"}
                </button>
              )}
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-border">
                <th className="sticky left-0 z-20 min-w-48 bg-surface px-4 py-2 text-left font-medium text-muted">
                  {ru ? "Товар" : "Product"}
                </th>
                {allMonths.map((m) => (
                  <th
                    key={m}
                    className={`min-w-16 whitespace-nowrap px-1.5 py-2 text-center font-medium ${
                      m < startMonth ? "text-muted/60" : "text-muted"
                    } ${colCls(m, ctx)}`}
                  >
                    {monthLabel(m, ru)}
                    {m === slot.shipMonth && (
                      <div className="mt-0.5">
                        <span className="inline-block rounded-full bg-accent px-1.5 py-px text-[9px] font-semibold text-white">
                          {ru ? "дедлайн" : "deadline"} {deadlineShort}
                        </span>
                      </div>
                    )}
                    {m === slot.arrivalMonth && (
                      <div className="text-[9px] uppercase tracking-wide text-ok">
                        {ru ? "приход" : "arrival"}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {active.map((sku) => (
                <SkuBlock
                  key={sku.id}
                  sku={sku}
                  sit={situations[sku.id]}
                  orders={purchases[sku.id] ?? EMPTY_REC}
                  arrivals={actualArrivals[sku.id] ?? EMPTY_REC}
                  stage={model.stageBySku[sku.id] ?? null}
                  waveNote={
                    sku.id === firstP2Id && p2Wave && p2Wave.to > p2Wave.from * 1.15
                      ? ru
                        ? `Волна 2-й ступени: модель ждёт ${fmtN(Math.round(p2Wave.from))} → ${fmtN(Math.round(p2Wave.to))}/мес к ${monthLabel(p2Wave.toMonth, ru)}`
                        : `Stage-2 wave: model expects ${fmtN(Math.round(p2Wave.from))} → ${fmtN(Math.round(p2Wave.to))}/mo by ${monthLabel(p2Wave.toMonth, ru)}`
                      : null
                  }
                  ctx={ctx}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <RecruitmentCard recruitment={recruitment} ru={ru} isAdmin={isAdmin} onSaved={() => router.refresh()} />

      {/* sticky save bar for pending grid edits */}
      {isAdmin && dirty.count > 0 && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 shadow-[0_8px_30px_rgba(15,23,42,0.18)]">
          <span className="text-[13px]">
            {ru ? "Изменено" : "Changed"}: <span className="num font-semibold">{dirty.count}</span>
          </span>
          <Button
            variant="ghost"
            onClick={() => {
              setForecastEdits({});
              setOrderEdits({});
            }}
          >
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

/** Frozen row-label cell of one grid row. */
function RowLabel({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <td
      className={`sticky left-0 z-10 whitespace-nowrap bg-surface py-1 pl-7 pr-4 text-left text-[10px] uppercase tracking-[0.06em] ${tone ?? "text-muted"}`}
    >
      {children}
    </td>
  );
}

/** One SKU: header line + the four IBP layers. */
function SkuBlock({
  sku,
  sit,
  orders,
  arrivals,
  stage,
  waveNote,
  ctx,
}: {
  sku: PlanningSkuIn;
  sit: SkuSituation;
  orders: Record<string, number>;
  arrivals: Record<string, number>;
  stage: Stage | null;
  waveNote?: string | null;
  ctx: GridCtx;
}) {
  return (
    <>
      <tr className="border-t border-border">
        <td className="sticky left-0 z-10 min-w-48 bg-surface px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold">{sku.name}</span>
            <Badge tone={stage ? "accent" : "neutral"}>{stage ?? "Expert"}</Badge>
          </div>
          <div className="num mt-0.5 text-[10.5px] text-muted">
            {ctx.ru ? "Арт." : "Art."} {sku.article}
          </div>
        </td>
        <td colSpan={ctx.months.length} className="bg-surface-low/25 px-3 text-right">
          {waveNote && (
            <span className="inline-block rounded-md bg-accent-soft-bg px-2.5 py-0.5 text-[10.5px] font-medium text-accent">
              {waveNote}
            </span>
          )}
        </td>
      </tr>
      <ForecastRow sku={sku} sit={sit} ctx={ctx} />
      <ModelRow sku={sku} sit={sit} ctx={ctx} />
      <OrderRow skuId={sku.id} orders={orders} arrivals={arrivals} ctx={ctx} />
      <PurchaseRow arrivals={arrivals} ctx={ctx} />
    </>
  );
}

/** Partner Forecast — our demand forecast, editable per future month. */
function ForecastRow({ sku, sit, ctx }: { sku: PlanningSkuIn; sit: SkuSituation; ctx: GridCtx }) {
  return (
    <tr>
      <RowLabel>Partner Forecast</RowLabel>
      {ctx.months.map((m) => {
        if (m < ctx.startMonth) {
          const q = sit.forecast[m];
          return (
            <td key={m} className={`px-1 py-1 text-center ${colCls(m, ctx)}`}>
              <span className="num text-[12px] text-muted/70">{q !== undefined && q > 0 ? fmtN(q) : "—"}</span>
            </td>
          );
        }
        const orig = sit.forecast[m] ?? 0;
        if (!ctx.isAdmin) {
          return (
            <td key={m} className={`px-1 py-1 text-center ${colCls(m, ctx)}`}>
              <span className="num text-[12px] font-medium">{orig > 0 ? fmtN(orig) : "—"}</span>
            </td>
          );
        }
        const raw = ctx.forecastEdits[cellKey(sku.id, m)];
        const dirtyCell = raw !== undefined && parseQty(raw) !== orig;
        return (
          <td key={m} className={`px-1 py-1 text-center ${colCls(m, ctx)}`}>
            <input
              className={`num h-7 w-[60px] rounded border bg-surface px-1 text-right text-[12px] font-medium focus:border-accent focus:outline-none ${
                dirtyCell ? "border-accent bg-accent-soft/30" : "border-border"
              }`}
              value={raw ?? (orig > 0 ? String(orig) : "")}
              onChange={(e) => ctx.setForecast(sku.id, m, e.target.value)}
              placeholder="0"
              inputMode="numeric"
            />
          </td>
        );
      })}
    </tr>
  );
}

/** Model Forecast — the cohort model's demand; a click applies it to the forecast. */
function ModelRow({ sku, sit, ctx }: { sku: PlanningSkuIn; sit: SkuSituation; ctx: GridCtx }) {
  const { ru } = ctx;
  return (
    <tr>
      <RowLabel tone="text-muted/70">Model Forecast</RowLabel>
      {ctx.months.map((m) => {
        if (m < ctx.startMonth) {
          return (
            <td key={m} className={`px-1 py-0.5 text-center ${colCls(m, ctx)}`}>
              <span className="text-[11.5px] text-muted/40">—</span>
            </td>
          );
        }
        const q = Math.round(sit.model?.[m] ?? 0);
        return (
          <td key={m} className={`px-1 py-0.5 text-center ${colCls(m, ctx)}`}>
            {ctx.isAdmin && q > 0 ? (
              <button
                type="button"
                className="num rounded px-1 text-[11.5px] italic text-muted underline decoration-border decoration-dotted underline-offset-2 transition-colors hover:bg-accent-soft/40 hover:text-accent"
                title={ru ? "Применить в Partner Forecast" : "Apply to Partner Forecast"}
                onClick={() => ctx.applyModel(sku.id, m, q)}
              >
                {fmtN(q)}
              </button>
            ) : (
              <span className="num text-[11.5px] italic text-muted/80">{q > 0 ? fmtN(q) : "—"}</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

/** Partner Order — committed orders by SHIP month; editable ahead of the deadline. */
function OrderRow({
  skuId,
  orders,
  arrivals,
  ctx,
}: {
  skuId: string;
  orders: Record<string, number>;
  arrivals: Record<string, number>;
  ctx: GridCtx;
}) {
  const { ru } = ctx;
  return (
    <tr>
      <RowLabel tone="text-accent">Partner Order</RowLabel>
      {ctx.months.map((m) => {
        const committed = orders[m] ?? 0;
        const cls = `px-1 py-1 text-center align-middle ${colCls(m, ctx)}`;
        if (m < ctx.startMonth || !ctx.isAdmin) {
          // past ship month: flag orders the trucks never (fully) picked up
          const arrived = arrivals[addMonths(m, 1)] ?? 0;
          const miss = m < ctx.startMonth ? Math.max(0, committed - arrived) : 0;
          return (
            <td key={m} className={cls}>
              <span
                className={`num text-[12px] ${
                  miss > 0 ? "font-semibold text-warn" : committed > 0 ? "font-semibold text-accent" : "text-muted/40"
                }`}
                title={
                  miss > 0
                    ? ru
                      ? `не выбрано ~${fmtN(miss)} шт (пришло ${fmtN(arrived)})`
                      : `~${fmtN(miss)} pcs not picked up (arrived ${fmtN(arrived)})`
                    : undefined
                }
              >
                {committed > 0 ? fmtN(committed) : "—"}
                {miss > 0 && <span className="ml-0.5 align-super text-[9px]">!</span>}
              </span>
            </td>
          );
        }
        const raw = ctx.orderEdits[cellKey(skuId, m)];
        const dirtyCell = raw !== undefined && parseQty(raw) !== committed;
        return (
          <td key={m} className={cls}>
            <input
              className={`num h-7 w-[60px] rounded border bg-surface px-1 text-right text-[12px] font-semibold text-accent focus:border-accent focus:outline-none ${
                dirtyCell
                  ? "border-accent bg-accent-soft/30"
                  : m === ctx.slot.shipMonth
                    ? "border-accent/50"
                    : "border-border"
              }`}
              value={raw ?? (committed > 0 ? String(committed) : "")}
              onChange={(e) => ctx.setOrder(skuId, m, e.target.value)}
              placeholder="0"
              inputMode="numeric"
            />
          </td>
        );
      })}
    </tr>
  );
}

/** Partner Purchase — actual units that arrived, per month (history). */
function PurchaseRow({ arrivals, ctx }: { arrivals: Record<string, number>; ctx: GridCtx }) {
  return (
    <tr className="border-b border-border/60">
      <RowLabel>Partner Purchase</RowLabel>
      {ctx.months.map((m) => {
        const act = arrivals[m] ?? 0;
        const future = m >= ctx.startMonth;
        return (
          <td key={m} className={`px-1 py-1 text-center ${colCls(m, ctx)}`}>
            <span className={`num text-[12px] ${future ? "text-muted/40" : act > 0 ? "font-medium" : "text-muted/40"}`}>
              {!future && act > 0 ? fmtN(act) : "—"}
            </span>
          </td>
        );
      })}
    </tr>
  );
}

/** Verified prescriptions by month — the demand engine behind the model.
 *  Admin can correct a month inline (click the value, Enter saves). */
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
  const [editing, setEditing] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);

  const recorded = Object.keys(recruitment).sort();
  const months = recorded.slice(-9);
  // one open slot for the next month, so a new count can always be typed in
  const nextKey = recorded.length > 0 ? addMonths(recorded[recorded.length - 1], 1) : null;
  const max = Math.max(...months.map((m) => recruitment[m]), 1);
  const tail = months.slice(-3);
  const ahead = tail.length > 0 ? tail.reduce((s, m) => s + recruitment[m], 0) / tail.length : 0;

  async function save(m: string) {
    setBusy(true);
    try {
      await fetch("/api/planning/recruitment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthKey: m, babies: parseQty(val) }),
      });
      setEditing(null);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4 overflow-hidden">
      <CardHeader
        title={ru ? "Медицинский канал" : "Medical channel"}
        desc={
          ru
            ? "Подтверждённые рецепты — вход модели спроса. Будущие месяцы считаются по среднему за последние 3 мес."
            : "Verified prescriptions — the demand model's input. Forward months assume the trailing 3-month average."
        }
      />
      <div className="flex flex-wrap items-end gap-8 px-5 py-4">
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
                    if (e.key === "Enter") void save(m);
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
                    isAdmin
                      ? "underline decoration-border-strong decoration-dashed underline-offset-2 hover:text-accent"
                      : "cursor-default"
                  }`}
                  title={isAdmin ? (ru ? "Изменить (Enter — сохранить)" : "Edit (Enter saves)") : undefined}
                  onClick={
                    isAdmin
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
                className="w-7 rounded-t bg-accent/60"
                style={{ height: `${6 + (recruitment[m] / max) * 44}px` }}
                title={`${monthLabel(m, ru)}: ${fmtN(recruitment[m])}`}
              />
              <span className="text-[9px] text-muted">{monthLabel(m, ru)}</span>
            </div>
          ))}
          {isAdmin && nextKey && (
            <div className="flex flex-col items-center gap-0.5">
              {editing === nextKey ? (
                <input
                  autoFocus
                  className="num h-6 w-14 rounded border border-accent bg-surface px-1 text-right text-[11px] focus:outline-none"
                  value={val}
                  disabled={busy}
                  placeholder="0"
                  onChange={(e) => setVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void save(nextKey);
                    if (e.key === "Escape") setEditing(null);
                  }}
                  onBlur={() => {
                    if (!busy) setEditing(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="text-[10px] font-semibold text-accent hover:underline"
                  title={ru ? "Внести число за этот месяц" : "Enter this month's count"}
                  onClick={() => {
                    setEditing(nextKey);
                    setVal("");
                  }}
                >
                  +
                </button>
              )}
              <div className="h-[6px] w-7 rounded-t border border-dashed border-border-strong" />
              <span className="text-[9px] text-muted">{monthLabel(nextKey, ru)}</span>
            </div>
          )}
        </div>
        <div className="border-l border-border pb-1 pl-6">
          <div className="label-caps">{ru ? "Прогноз набора" : "Recruitment ahead"}</div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="num font-display text-[19px] font-extrabold">{fmtN(Math.round(ahead))}</span>
            <span className="text-[11px] text-muted">{ru ? "рецептов/мес" : "Rx/mo"}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
