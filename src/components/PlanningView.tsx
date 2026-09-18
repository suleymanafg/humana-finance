"use client";

// «План (IBP)» — the record of what was promised to the factory, built to the
// owner's design canvas: a month rail carrying each month's place in the IBP
// cycle, then one row per product for the selected month —
//   Прогноз модели · Прогноз партнёра · Заказ партнёра · Закупка партнёра · Открытые заказы
// Months inside the lead time are locked and need a deliberate «Разблокировать»
// before they can be corrected; edits are saved explicitly.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { addMonths } from "@/lib/planning/compute";
import { dstr, monthLong, monthShort, pn, splitPack } from "@/lib/planning/ui-format";
import type {
  OrderSlot,
  PlanningSettings,
  PlanningSkuIn,
  SkuProjection,
  SkuSituation,
} from "@/lib/planning/compute";
import type { DemandModelResult } from "@/lib/planning/model";

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

/** A month's place in the IBP cycle, as the canvas colours it. */
type MonthState = "history" | "closed" | "deadline" | "open";
function monthState(m: string, startMonth: string, shipMonth: string): MonthState {
  if (m < startMonth) return "history";
  if (m < shipMonth) return "closed";
  return m === shipMonth ? "deadline" : "open";
}

const STATE_STYLE: Record<MonthState, { bg: string; fg: string; border: string }> = {
  history: { bg: "var(--past)", fg: "var(--past-ink)", border: "var(--past-border)" },
  closed: { bg: "var(--info-soft)", fg: "var(--info)", border: "var(--info-border)" },
  deadline: { bg: "var(--accent)", fg: "#ffffff", border: "var(--accent)" },
  open: { bg: "var(--surface)", fg: "var(--foreground)", border: "var(--border-strong)" },
};

export default function PlanningView({
  skus,
  situations,
  slot,
  startMonth,
  settings,
  purchases,
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
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // closed months a deliberate «Разблокировать» has opened for correction
  const [unlockedMonths, setUnlockedMonths] = useState<Set<string>>(new Set());

  const active = skus.filter((s) => s.active);

  // ── the month rail: 14 months, from four back to the far side of the slot ──
  const RAIL = 14;
  const railMonths = useMemo(
    () => Array.from({ length: RAIL }, (_, i) => addMonths(addMonths(startMonth, -4), i)),
    [startMonth]
  );
  const [selected, setSelected] = useState(slot.shipMonth);

  const selState = monthState(selected, startMonth, slot.shipMonth);
  const selUnlocked = unlockedMonths.has(selected);
  const selLocked = selState === "history" || selState === "closed";
  const selEditable = isAdmin && (!selLocked || selUnlocked);

  /** The IBP deadline that governs a ship month: the 20th, four months before. */
  const deadlineFor = (shipMonth: string) =>
    `${addMonths(shipMonth, -settings.productionLeadMonths)}-${String(settings.orderDeadlineDay).padStart(2, "0")}`;

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
      const now = new Date();
      setSavedAt(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
      router.refresh();
    } catch {
      // keep the edits; already-saved months re-save harmlessly on retry
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  // Open Orders — ONE rule for every month (the owner's ruling): cumulative
  // Partner Order − Partner Purchase (pickups at dispatch) since the epoch.
  // Positive = ordered but not collected; negative = collected beyond orders.
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
    return { sku, modelQty, forecast, order, purchase, fRaw, oRaw, openCum };
  });

  const totals = rows.reduce(
    (t, r) => ({
      model: t.model + (r.modelQty ?? 0),
      forecast: t.forecast + r.forecast,
      order: t.order + r.order,
      purchase: t.purchase + r.purchase,
      open: t.open + (r.openCum ?? 0),
    }),
    { model: 0, forecast: 0, order: 0, purchase: 0, open: 0 }
  );

  const statusLabel: Record<MonthState, string> = {
    history: ru ? "История" : "History",
    closed: ru ? "Зафиксировано" : "Committed",
    deadline: ru ? "Следующий дедлайн" : "Next deadline",
    open: ru ? "Открыт" : "Open",
  };

  const legend: Array<{ state: MonthState }> = [
    { state: "history" },
    { state: "closed" },
    { state: "deadline" },
    { state: "open" },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[22px] font-extrabold tracking-[-0.5px]">{ru ? "План (IBP)" : "Plan (IBP)"}</h1>
        <p className="text-[13px] font-semibold text-muted">
          {ru
            ? "Что мы обещали фабрике и что ещё не получено?"
            : "What have we committed to the factory, and what is outstanding?"}
        </p>
      </div>

      <div className="mb-1.5 flex flex-wrap items-end justify-between gap-4">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted">
          {ru ? "Месяц отгрузки" : "Shipping month"}
        </span>
        <div className="flex flex-wrap items-center gap-3.5">
          {legend.map((l) => (
            <span key={l.state} className="flex items-center gap-1.5 text-[11px] font-semibold text-muted">
              <span
                className="h-2.5 w-2.5 rounded-[3px] border"
                style={{ background: STATE_STYLE[l.state].bg, borderColor: STATE_STYLE[l.state].border }}
              />
              {statusLabel[l.state]}
            </span>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto px-0.5 pb-3 pt-0.5">
        {railMonths.map((m) => {
          const st = monthState(m, startMonth, slot.shipMonth);
          const style = STATE_STYLE[st];
          const on = m === selected;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setSelected(m)}
              className="flex w-[72px] shrink-0 flex-col items-center gap-0.5 rounded-[10px] border py-2"
              style={{
                background: style.bg,
                color: style.fg,
                borderColor: style.border,
                boxShadow: on ? "0 0 0 2px var(--accent)" : "none",
              }}
            >
              <span className="text-[13px] font-extrabold tracking-[-0.2px]">{monthShort(m, ru)}</span>
              <span className="text-[10px] font-bold opacity-75">&rsquo;{m.slice(2, 4)}</span>
              <span
                className="mt-0.5 h-[3px] w-6 rounded-sm"
                style={{ background: on ? (st === "deadline" ? "#ffffff" : "var(--accent)") : "transparent" }}
              />
            </button>
          );
        })}
      </div>

      <div className="pcard overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b px-[18px] py-3" style={{ borderColor: "var(--hair)" }}>
          <h2 className="text-[14px] font-extrabold">{monthLong(selected, ru)}</h2>
          <span
            className="ppill"
            style={{
              background: selState === "deadline" ? "var(--accent)" : STATE_STYLE[selState].bg,
              color: selState === "deadline" ? "#ffffff" : STATE_STYLE[selState].fg,
            }}
          >
            {statusLabel[selState]}
          </span>
          <span className="text-[11.5px] font-semibold text-muted">
            {ru ? "заказ до " : "order by "}
            <span className="pnum">{dstr(deadlineFor(selected))}</span>
          </span>

          <div className="flex-1" />

          {isAdmin && selLocked && !selUnlocked && (
            <div
              className="flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5"
              style={{ background: "var(--info-soft)", borderColor: "var(--info-border)" }}
            >
              <span className="text-[11.5px] font-bold" style={{ color: "var(--info)" }}>
                {ru ? "Месяц внутри срока поставки — заказ уже передан" : "Inside the lead time — the order is already placed"}
              </span>
              <button
                type="button"
                onClick={() => setUnlockedMonths((p) => new Set(p).add(selected))}
                className="rounded-[7px] border bg-surface px-2.5 py-1 text-[11.5px] font-extrabold transition-colors hover:bg-accent hover:text-white"
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
              >
                {ru ? "Разблокировать" : "Unlock"}
              </button>
            </div>
          )}
          {selUnlocked && (
            <div
              className="flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5"
              style={{ background: "var(--warn-soft)", borderColor: "var(--warn-border)" }}
            >
              <span className="text-[11.5px] font-extrabold" style={{ color: "var(--warn-ink)" }}>
                {ru ? "Редактирование зафиксированного месяца" : "Editing a committed month"}
              </span>
              <button
                type="button"
                onClick={() => relock(selected)}
                className="rounded-[7px] border bg-surface px-2.5 py-1 text-[11.5px] font-extrabold"
                style={{ borderColor: "var(--warn)", color: "var(--warn-ink)" }}
              >
                {ru ? "Заблокировать" : "Lock"}
              </button>
            </div>
          )}

          {dirty.count > 0 && (
            <span className="flex items-center gap-2 text-[12px] font-bold" style={{ color: "var(--warn-ink)" }}>
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: "var(--warn)" }} />
              {ru ? `Несохранённых: ${dirty.count}` : `${dirty.count} unsaved`}
            </span>
          )}
          {savedAt && dirty.count === 0 && (
            <span className="text-[12px] font-bold" style={{ color: "var(--ok)" }}>
              {ru ? `Сохранено в ${savedAt}` : `Saved at ${savedAt}`}
            </span>
          )}

          {isAdmin && (
            <>
              <button
                type="button"
                onClick={discardAll}
                disabled={dirty.count === 0}
                className="rounded-lg border bg-surface px-3 py-1.5 text-[12px] font-bold text-muted disabled:opacity-40"
                style={{ borderColor: "var(--border)" }}
              >
                {ru ? "Отменить" : "Discard"}
              </button>
              <button
                type="button"
                onClick={() => void saveAll()}
                disabled={dirty.count === 0 || saving}
                className="rounded-lg px-4 py-1.5 text-[12px] font-extrabold text-white disabled:opacity-50"
                style={{ background: dirty.count > 0 ? "var(--accent)" : "#9fb6dc" }}
              >
                {saving ? (ru ? "Сохранение…" : "Saving…") : ru ? "Сохранить" : "Save"}
              </button>
            </>
          )}
        </div>

        {saveError && (
          <div
            className="mx-[18px] mt-3 flex flex-wrap items-center gap-2.5 rounded-[10px] border px-3 py-2.5"
            style={{ background: "var(--danger-soft)", borderColor: "var(--danger-border)" }}
          >
            <span className="text-[12.5px] font-extrabold" style={{ color: "var(--danger)" }}>
              {ru ? "Не удалось сохранить." : "Save failed."}
            </span>
            <span className="text-[12.5px]" style={{ color: "#6b2b28" }}>
              {ru
                ? "Изменения сохранены в форме — попробуйте ещё раз."
                : "Your edits are still here — try again."}
            </span>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="ptable" style={{ minWidth: 960 }}>
            <thead>
              <tr>
                <th className="sticky left-0 z-[2]" style={{ minWidth: 200, background: "var(--surface-low)" }}>
                  {ru ? "Продукт" : "Product"}
                </th>
                <th>{ru ? "Прогноз модели" : "Model forecast"}</th>
                <th className="col-act">{ru ? "Прогноз партнёра" : "Partner forecast"}</th>
                <th className="col-act">{ru ? "Заказ партнёра" : "Partner order"}</th>
                <th>{ru ? "Закупка партнёра" : "Partner purchase"}</th>
                <th style={{ paddingRight: 18 }}>{ru ? "Открытые заказы" : "Open orders"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const { name, pack } = splitPack(r.sku.name);
                const fDirty = r.fRaw !== undefined && parseQty(r.fRaw) !== (situations[r.sku.id]?.forecast[selected] ?? 0);
                const oDirty = r.oRaw !== undefined && parseQty(r.oRaw) !== (purchases[r.sku.id]?.[selected] ?? 0);
                const open = r.openCum;
                const openInk =
                  open === null ? "var(--faint)" : open < 0 ? "var(--ok)" : open > 40000 ? "var(--danger)" : "var(--foreground)";
                return (
                  <tr key={r.sku.id}>
                    <td className="sticky left-0 z-[1]" style={{ background: "var(--surface)", borderRight: "1px solid var(--hair)" }}>
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-[13px] font-bold">{name}</span>
                        {pack && <span className="text-[11px] font-bold" style={{ color: "var(--sky)" }}>{pack}</span>}
                      </div>
                      <div className="pnum mt-0.5 text-[10.5px]" style={{ color: "var(--faint)" }}>
                        № {r.sku.article}
                      </div>
                    </td>
                    <td className="pnum text-[13px] text-muted">{r.modelQty !== null ? pn(r.modelQty) : "—"}</td>
                    <td className="col-act" style={{ padding: "5px 9px" }}>
                      <input
                        type="number"
                        min={0}
                        value={r.fRaw !== undefined ? r.fRaw : r.forecast === 0 ? "" : String(r.forecast)}
                        readOnly={!selEditable}
                        onChange={(e) =>
                          setForecastEdits((p) => ({ ...p, [cellKey(r.sku.id, selected)]: e.target.value }))
                        }
                        className="pinput"
                        style={fDirty ? { borderColor: "var(--accent)", background: "var(--accent-soft-bg)" } : undefined}
                      />
                    </td>
                    <td className="col-act" style={{ padding: "5px 9px" }}>
                      <input
                        type="number"
                        min={0}
                        value={r.oRaw !== undefined ? r.oRaw : r.order === 0 ? "" : String(r.order)}
                        readOnly={!selEditable}
                        onChange={(e) =>
                          setOrderEdits((p) => ({ ...p, [cellKey(r.sku.id, selected)]: e.target.value }))
                        }
                        className="pinput font-bold"
                        style={oDirty ? { borderColor: "var(--accent)", background: "var(--accent-soft-bg)" } : undefined}
                      />
                    </td>
                    <td className="pnum text-[13px]">{r.purchase === 0 ? "—" : pn(r.purchase)}</td>
                    <td style={{ paddingRight: 18 }}>
                      <div className="pnum text-[13px] font-bold" style={{ color: openInk }}>
                        {open === null ? "—" : pn(open)}
                      </div>
                      {open !== null && open !== 0 && (
                        <div className="text-[10px] font-bold" style={{ color: openInk, opacity: 0.8 }}>
                          {open < 0
                            ? ru ? "излишек" : "surplus"
                            : ru ? "к получению" : "to collect"}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky left-0 z-[1]" style={{ background: "var(--surface-low)", borderRight: "1px solid var(--border)" }}>
                  {ru ? "Итого" : "Total"}
                </td>
                <td className="pnum text-[13.5px]">{pn(totals.model)}</td>
                <td className="pnum col-act text-[13.5px]">{pn(totals.forecast)}</td>
                <td className="pnum col-act text-[13.5px]" style={{ color: "var(--accent)" }}>
                  {pn(totals.order)}
                </td>
                <td className="pnum text-[13.5px]">{totals.purchase === 0 ? "—" : pn(totals.purchase)}</td>
                <td
                  className="pnum text-[13.5px]"
                  style={{ paddingRight: 18, color: totals.open < 0 ? "var(--ok)" : "var(--foreground)" }}
                >
                  {selected >= BACKLOG_EPOCH ? pn(totals.open) : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div
          className="border-t px-[18px] py-3 text-[11.5px] font-semibold leading-relaxed text-muted"
          style={{ borderColor: "var(--hair)", background: "var(--surface-low)" }}
        >
          {ru
            ? `Открытые заказы — единая накопительная величина с января ${BACKLOG_EPOCH.slice(0, 4)}: всё заказанное минус всё полученное. Не обнуляется по месяцам; отрицательное значение означает излишек полученного. Закупка партнёра считается по дате отгрузки (инвойса).`
            : `Open orders is one running cumulative figure since January ${BACKLOG_EPOCH.slice(0, 4)}: everything ordered minus everything collected. It never resets per month; a negative figure means more was collected than ordered. Partner purchase is counted at the dispatch (invoice) date.`}
          {model.lastCompleteMonth && (
            <>
              {" "}
              {ru
                ? `Прогноз модели откалиброван по факту продаж включительно по ${monthLong(model.lastCompleteMonth, ru)}.`
                : `The model forecast is calibrated against actual sales through ${monthLong(model.lastCompleteMonth, ru)}.`}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
