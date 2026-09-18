"use client";

// «Сценарии» — the what-if sandbox, built to the owner's design canvas:
// assumptions on the left, a 12-month model-vs-simulation projection on the
// right, and what the change would do to the next three order slots.
// Everything is recomputed client-side through the same cohort model the plan
// uses (model-vs-model, manual forecasts ignored). Nothing here persists.
import { useMemo, useState } from "react";
import { useT } from "@/lib/locale-context";
import { monthShort, monthTag, pn, pnSigned } from "@/lib/planning/ui-format";
import {
  addMonths,
  projectSku,
  recommendQty,
  truckStats,
  type OrderSlot,
  type PlanningSettings,
  type PlanningSkuIn,
  type SkuProjection,
  type SkuSituation,
} from "@/lib/planning/compute";
import type { CohortParams } from "@/lib/planning/cohort";
import { buildDemandModel } from "@/lib/planning/model";

const HORIZON = 14;
const CHART_MONTHS = 12;

function Slider({
  label,
  hint,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-bold">{label}</span>
        <span className="pnum text-[13px] font-bold" style={{ color: "var(--accent)" }}>
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full"
        style={{ accentColor: "var(--accent)" }}
      />
      <div className="text-[11px] font-semibold" style={{ color: "var(--faint)" }}>
        {hint}
      </div>
    </div>
  );
}

export default function ScenariosView({
  skus,
  situations,
  recruitment,
  cohortParams,
  settings,
  slot,
  startMonth,
  eurRate,
  purchases,
}: {
  skus: PlanningSkuIn[];
  situations: Record<string, SkuSituation>;
  recruitment: Record<string, number>;
  cohortParams: CohortParams;
  settings: PlanningSettings;
  slot: OrderSlot;
  startMonth: string;
  eurRate: number;
  purchases: Record<string, Record<string, number>>;
  isAdmin: boolean;
}) {
  const { locale } = useT();
  const ru = locale === "ru";

  const active = useMemo(() => skus.filter((s) => s.active), [skus]);
  const skusById = useMemo(() => Object.fromEntries(skus.map((s) => [s.id, s])), [skus]);
  const months = useMemo(() => Array.from({ length: HORIZON }, (_, i) => addMonths(startMonth, i)), [startMonth]);
  const actuals = useMemo(
    () => Object.fromEntries(skus.map((s) => [s.id, situations[s.id]?.actualSales ?? {}])),
    [skus, situations]
  );
  const trailing3 = useMemo(() => {
    const keys = Object.keys(recruitment).sort().slice(-3);
    if (keys.length === 0) return 0;
    return Math.round(keys.reduce((s, k) => s + recruitment[k], 0) / keys.length);
  }, [recruitment]);

  // ── the levers, in canvas order ───────────────────────────────
  // retention is one slider that moves all three stages together, expressed as
  // a percentage of the calibrated curve, so the stage shape is preserved
  const [retPct, setRetPct] = useState(100);
  const [recruits, setRecruits] = useState(() => trailing3);
  const [multPct, setMultPct] = useState(100);
  const [packs, setPacks] = useState(cohortParams.packsPerBaby);
  const [delay, setDelay] = useState(false);

  const dirty =
    retPct !== 100 || multPct !== 100 || recruits !== trailing3 || packs !== cohortParams.packsPerBaby || delay;

  function reset() {
    setRetPct(100);
    setRecruits(trailing3);
    setMultPct(100);
    setPacks(cohortParams.packsPerBaby);
    setDelay(false);
  }

  // ── model-vs-model recompute ──────────────────────────────────
  const worlds = useMemo(() => {
    const build = (params: CohortParams, k: number, delayed: boolean) => {
      const m = buildDemandModel(skus, actuals, recruitment, startMonth, 18, params);
      const projections: Record<string, SkuProjection> = {};
      for (const s of active) {
        const series = Object.fromEntries(Object.entries(m.series[s.id] ?? {}).map(([mo, v]) => [mo, v * k]));
        const base = situations[s.id];
        const arrivals = delayed
          ? Object.fromEntries(Object.entries(base.arrivals).map(([mo, q]) => [addMonths(mo, 1), q]))
          : base.arrivals;
        // scenarios reason from the model alone — manual forecasts are ignored
        const sit: SkuSituation = { ...base, model: series, forecast: {}, arrivals };
        projections[s.id] = projectSku(sit, startMonth, HORIZON, settings);
      }
      return projections;
    };
    const cap = (v: number) => Math.min(0.98, Math.max(0.05, v));
    const baseline = build(cohortParams, 1, false);
    const scenario = build(
      {
        ...cohortParams,
        retention1: cap(cohortParams.retention1 * (retPct / 100)),
        retention2: cap(cohortParams.retention2 * (retPct / 100)),
        retention3: cap(cohortParams.retention3 * (retPct / 100)),
        packsPerBaby: packs,
        recruitmentAhead: recruits,
      },
      multPct / 100,
      delay
    );
    return { baseline, scenario };
  }, [skus, active, actuals, situations, recruitment, startMonth, settings, cohortParams, retPct, recruits, multPct, packs, delay]);

  // ── the projection chart: model vs simulation, month by month ──
  const proj = useMemo(() => {
    const rows = months.slice(0, CHART_MONTHS).map((m, i) => {
      let base = 0;
      let scen = 0;
      for (const s of active) {
        base += worlds.baseline[s.id]?.cells[i]?.demand ?? 0;
        scen += worlds.scenario[s.id]?.cells[i]?.demand ?? 0;
      }
      return { month: m, base: Math.round(base), scen: Math.round(scen) };
    });
    const max = Math.max(1, ...rows.map((r) => Math.max(r.base, r.scen)));
    return { rows, max };
  }, [months, active, worlds]);

  const simTotal = proj.rows.reduce((s, r) => s + r.scen, 0);
  const modelTotal = proj.rows.reduce((s, r) => s + r.base, 0);
  const simDiff = simTotal - modelTotal;

  // trucks a year of simulated demand would need
  const trucksPerYear = useMemo(() => {
    const lines = active.map((s) => {
      let units = 0;
      for (let i = 0; i < CHART_MONTHS; i++) units += worlds.scenario[s.id]?.cells[i]?.demand ?? 0;
      return { skuId: s.id, qty: Math.round(units) };
    });
    const stats = truckStats(lines, skusById, settings);
    return settings.truckPallets > 0 ? stats.pallets / settings.truckPallets : 0;
  }, [active, worlds, skusById, settings]);

  const firstStockout = (projs: Record<string, SkuProjection>): string | null => {
    let min: string | null = null;
    for (const s of active) {
      const m = projs[s.id]?.stockoutMonth;
      if (m && (!min || m < min)) min = m;
    }
    return min;
  };
  const baseOut = firstStockout(worlds.baseline);
  const scenOut = firstStockout(worlds.scenario);
  const outInk =
    baseOut === scenOut
      ? "var(--foreground)"
      : !scenOut || (baseOut && scenOut > baseOut)
        ? "var(--ok)"
        : "var(--danger)";

  // ── what it would do to the next three order slots ────────────
  const slotRows = useMemo(
    () =>
      [0, 1, 2].map((i) => {
        const shipMonth = addMonths(slot.shipMonth, i);
        const arrival = addMonths(shipMonth, 1);
        const scenArrival = delay ? addMonths(arrival, 1) : arrival;
        const baseStats = truckStats(
          active.map((s) => ({ skuId: s.id, qty: recommendQty(worlds.baseline[s.id], s, arrival, settings) })),
          skusById,
          settings
        );
        const scenStats = truckStats(
          active.map((s) => ({ skuId: s.id, qty: recommendQty(worlds.scenario[s.id], s, scenArrival, settings) })),
          skusById,
          settings
        );
        return {
          shipMonth,
          committed: active.reduce((sum, s) => sum + (purchases[s.id]?.[shipMonth] ?? 0), 0),
          baseUnits: baseStats.totalUnits,
          scenUnits: scenStats.totalUnits,
          dUnits: scenStats.totalUnits - baseStats.totalUnits,
          dEur: scenStats.eurTotal - baseStats.eurTotal,
        };
      }),
    [slot.shipMonth, delay, active, worlds, skusById, settings, purchases]
  );

  const stat = (label: string, value: string, ink?: string) => (
    <div>
      <div className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted">{label}</div>
      <div className="pnum mt-1 text-[19px] font-bold" style={ink ? { color: ink } : undefined}>
        {value}
      </div>
    </div>
  );

  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[22px] font-extrabold tracking-[-0.5px]">{ru ? "Сценарии" : "Scenarios"}</h1>
        <p className="text-[13px] font-semibold text-muted">
          {ru
            ? "Что будет, если спрос, удержание или набор изменятся?"
            : "What happens if demand, retention or recruitment change?"}
        </p>
      </div>

      <div
        className="flex flex-wrap items-center gap-2.5 rounded-[10px] border px-3.5 py-2.5"
        style={{ background: "var(--warn-soft)", borderColor: "var(--warn-border)" }}
      >
        <span className="text-[12.5px] font-extrabold" style={{ color: "var(--warn-ink)" }}>
          {ru ? "Симуляция." : "Simulation."}
        </span>
        <span className="text-[12.5px] font-semibold" style={{ color: "#6b4a10" }}>
          {ru
            ? "Ничего не сохраняется и не становится заказом — реальные данные не меняются."
            : "Nothing is saved and nothing becomes an order — real data is untouched."}
        </span>
      </div>

      <div className="mt-3.5 flex flex-wrap items-start gap-3.5">
        <div className="pcard flex-[0_1_330px] px-[18px] py-4" style={{ minWidth: 290 }}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13.5px] font-extrabold">{ru ? "Допущения" : "Assumptions"}</h2>
            {dirty && (
              <span className="text-[11px] font-bold" style={{ color: "var(--warn-ink)" }}>
                {ru ? "изменено" : "changed"}
              </span>
            )}
          </div>

          <div className="mt-3.5 flex flex-col gap-4">
            <Slider
              label={ru ? "Удержание" : "Retention"}
              hint={
                ru
                  ? "Доля детей, остающихся на продукте месяц к месяцу"
                  : "Share of babies staying on the product month to month"
              }
              value={retPct}
              display={`${retPct} %`}
              min={60}
              max={140}
              step={1}
              onChange={setRetPct}
            />
            <Slider
              label={ru ? "Набор детей в месяц" : "Monthly recruitment"}
              hint={
                ru
                  ? `Проверенных рецептов в месяц · факт ${pn(trailing3)}`
                  : `Verified prescriptions per month · actual ${pn(trailing3)}`
              }
              value={recruits}
              display={pn(recruits)}
              min={0}
              max={Math.max(3200, Math.round(trailing3 * 2.5))}
              step={20}
              onChange={setRecruits}
            />
            <Slider
              label={ru ? "Множитель спроса" : "Demand multiplier"}
              hint={ru ? "Общая поправка к модели" : "Overall adjustment to the model"}
              value={multPct}
              display={`${(multPct / 100).toFixed(2)}×`}
              min={70}
              max={140}
              step={1}
              onChange={setMultPct}
            />
            <Slider
              label={ru ? "Банок на ребёнка" : "Packs per baby"}
              hint={ru ? "Потребление в месяц при полном удержании" : "Monthly consumption at full retention"}
              value={packs}
              display={packs.toFixed(1)}
              min={1}
              max={5}
              step={0.1}
              onChange={setPacks}
            />
          </div>

          <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-[12.5px] font-bold">
            <input
              type="checkbox"
              checked={delay}
              onChange={(e) => setDelay(e.target.checked)}
              style={{ accentColor: "var(--accent)" }}
            />
            {ru ? "Все поставки опаздывают на месяц" : "Every shipment arrives a month late"}
          </label>

          <button
            type="button"
            onClick={reset}
            className="mt-4 w-full rounded-[9px] border bg-surface px-3.5 py-2.5 text-[12.5px] font-extrabold text-muted transition-colors hover:border-accent hover:text-accent"
            style={{ borderColor: "var(--border)" }}
          >
            {ru ? "Сбросить к модели" : "Reset to model"}
          </button>
        </div>

        <div className="pcard min-w-0 flex-[1_1_560px] px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[13.5px] font-extrabold">
              {ru ? "Проекция спроса, 12 месяцев" : "Demand projection, 12 months"}
            </h2>
            <div className="flex gap-3.5">
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted">
                <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--border-strong)" }} />
                {ru ? "модель" : "model"}
              </span>
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted">
                <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--accent)" }} />
                {ru ? "симуляция" : "simulation"}
              </span>
            </div>
          </div>

          <div className="mt-4 flex h-[190px] items-end gap-2">
            {proj.rows.map((r) => {
              const d = r.base > 0 ? ((r.scen - r.base) / r.base) * 100 : 0;
              const deltaInk =
                Math.abs(d) < 3 ? "var(--faint)" : d > 0 ? "var(--accent)" : "var(--warn)";
              return (
                <div key={r.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
                  <span className="pnum text-[9.5px] font-bold" style={{ color: deltaInk }}>
                    {d >= 0 ? "+" : "−"}
                    {Math.abs(d).toFixed(0)}%
                  </span>
                  <div className="flex h-[130px] w-full items-end justify-center gap-[3px]">
                    <div
                      className="w-[42%] rounded-t-[3px]"
                      style={{ height: `${Math.max(3, (r.base / proj.max) * 100)}%`, background: "var(--border-strong)" }}
                      title={`${ru ? "модель" : "model"}: ${pn(r.base)}`}
                    />
                    <div
                      className="w-[42%] rounded-t-[3px]"
                      style={{ height: `${Math.max(3, (r.scen / proj.max) * 100)}%`, background: "var(--accent)" }}
                      title={`${ru ? "симуляция" : "simulation"}: ${pn(r.scen)}`}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-muted">{monthShort(r.month, ru)}</span>
                </div>
              );
            })}
          </div>

          <div
            className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-4"
            style={{ borderColor: "var(--hair)" }}
          >
            {stat(ru ? "Спрос за 12 мес." : "12-month demand", pn(simTotal))}
            {stat(
              ru ? "К модели" : "vs model",
              pnSigned(simDiff),
              Math.abs(simDiff) / Math.max(1, modelTotal) < 0.03
                ? "var(--muted)"
                : simDiff > 0
                  ? "var(--accent)"
                  : "var(--warn)"
            )}
            {stat(ru ? "Фур в год" : "Trucks per year", trucksPerYear.toFixed(1))}
            {stat(
              ru ? "Первый дефицит" : "First shortage",
              scenOut ? monthTag(scenOut, ru) : ru ? "нет" : "none",
              outInk
            )}
          </div>
        </div>
      </div>

      <div className="pcard mt-3.5 overflow-hidden">
        <div className="flex flex-wrap items-baseline gap-3 border-b px-[18px] py-3" style={{ borderColor: "var(--hair)" }}>
          <h2 className="text-[14px] font-extrabold">
            {ru ? "Что это значит для ближайших заказов" : "What this means for the next orders"}
          </h2>
          <span className="text-[11.5px] font-semibold text-muted">
            {ru
              ? "Рекомендация модели против симуляции — заказ не меняется"
              : "Model recommendation vs the simulation — no order is changed"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="ptable" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 150 }}>{ru ? "Отгрузка" : "Shipping"}</th>
                <th>{ru ? "В закупе" : "Committed"}</th>
                <th>{ru ? "Модель" : "Model"}</th>
                <th>{ru ? "Симуляция" : "Simulation"}</th>
                <th>{ru ? "Разница" : "Difference"}</th>
                <th style={{ paddingRight: 18 }}>{ru ? "Разница, €" : "Difference, €"}</th>
              </tr>
            </thead>
            <tbody>
              {slotRows.map((r) => (
                <tr key={r.shipMonth}>
                  <td className="text-[13px] font-bold">{monthTag(r.shipMonth, ru)}</td>
                  <td className="pnum text-[13px] text-muted">{r.committed > 0 ? pn(r.committed) : "—"}</td>
                  <td className="pnum text-[13px]">{pn(r.baseUnits)}</td>
                  <td className="pnum text-[13px] font-bold" style={{ color: "var(--accent)" }}>
                    {pn(r.scenUnits)}
                  </td>
                  <td
                    className="pnum text-[13px] font-bold"
                    style={{ color: r.dUnits === 0 ? "var(--faint)" : r.dUnits > 0 ? "var(--accent)" : "var(--warn)" }}
                  >
                    {pnSigned(r.dUnits)}
                  </td>
                  <td className="pnum text-[13px]" style={{ paddingRight: 18 }}>
                    {pnSigned(Math.round(r.dEur))}
                    {eurRate > 0 && r.dEur !== 0 && (
                      <div className="text-[10px] font-semibold" style={{ color: "var(--faint)" }}>
                        ≈ {pnSigned(Math.round(r.dEur * eurRate))} {ru ? "сум" : "UZS"}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
