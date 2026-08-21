"use client";

// «Сценарии» — the what-if sandbox: retention, recruitment and demand
// multipliers are recomputed fully client-side through the same cohort model
// the plan uses (model-vs-model, manual forecasts ignored). Nothing persists.
import { useMemo, useState } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button, Card, CardHeader, Input, PageTitle, Select } from "./ui";
import PlanningTabs from "./PlanningTabs";
import { useT } from "@/lib/locale-context";
import { fmtN } from "@/lib/format";
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
import { buildDemandModel, stageOf } from "@/lib/planning/model";

const MONTH_RU = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(key: string, ru: boolean): string {
  const [y, m] = key.split("-").map(Number);
  return `${(ru ? MONTH_RU : MONTH_EN)[m - 1]} '${String(y).slice(2)}`;
}

const HORIZON = 14;

type Group = "P1" | "P2" | "P3" | "Expert";
const GROUPS: Group[] = ["P1", "P2", "P3", "Expert"];
const groupOf = (s: PlanningSkuIn): Group => stageOf(s.name) ?? "Expert";

// chart palette (matches the app tokens; recharts needs literal colors)
const ACCENT = "#1f108e";
const MUTED = "#94a3b8";
const DANGER = "#ba1a1a";
const GROUP_COLOR: Record<Group, string> = { P1: "#1f108e", P2: "#4f46e5", P3: "#818cf8", Expert: "#94a3b8" };

/** signed delta: "+1,200" / "−300" / "0" */
const sgn = (v: number, decimals = 0): string =>
  v > 0 ? `+${fmtN(v, decimals)}` : v < 0 ? `−${fmtN(Math.abs(v), decimals)}` : "0";

const TOOLTIP_STYLE = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  fontSize: 12,
};

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

  // ── scenario controls ─────────────────────────────────────────
  const [r1, setR1] = useState(cohortParams.retention1);
  const [r2, setR2] = useState(cohortParams.retention2);
  const [r3, setR3] = useState(cohortParams.retention3);
  const [packs, setPacks] = useState(cohortParams.packsPerBaby);
  const [recruitsRaw, setRecruitsRaw] = useState(""); // "" / 0 = auto (trailing 3-mo avg)
  const [mult, setMult] = useState<Record<Group, number>>({ P1: 1, P2: 1, P3: 1, Expert: 1 });
  const [delay, setDelay] = useState(false); // +1 month on every arrival
  const [stacked, setStacked] = useState(false);

  const recruitsNum = Math.max(0, Math.round(Number(recruitsRaw.replace(/[^\d]/g, "")) || 0));

  function reset() {
    setR1(cohortParams.retention1);
    setR2(cohortParams.retention2);
    setR3(cohortParams.retention3);
    setPacks(cohortParams.packsPerBaby);
    setRecruitsRaw("");
    setMult({ P1: 1, P2: 1, P3: 1, Expert: 1 });
    setDelay(false);
  }

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

  const [selSku, setSelSku] = useState(
    () => active.find((s) => /platin\s*1/i.test(s.name) && /400/.test(s.name))?.id ?? active[0]?.id ?? ""
  );

  // ── model-vs-model recompute ──────────────────────────────────
  const worlds = useMemo(() => {
    const build = (params: CohortParams, groupMult: Record<Group, number>, delayed: boolean) => {
      const m = buildDemandModel(skus, actuals, recruitment, startMonth, 18, params);
      const projections: Record<string, SkuProjection> = {};
      for (const s of active) {
        const k = groupMult[groupOf(s)];
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
    const baseline = build(cohortParams, { P1: 1, P2: 1, P3: 1, Expert: 1 }, false);
    const scenario = build(
      { ...cohortParams, retention1: r1, retention2: r2, retention3: r3, packsPerBaby: packs, recruitmentAhead: recruitsNum },
      mult,
      delay
    );
    return { baseline, scenario };
  }, [skus, active, actuals, situations, recruitment, startMonth, settings, cohortParams, r1, r2, r3, packs, recruitsNum, mult, delay]);

  const demandData = useMemo(
    () =>
      months.map((m, i) => {
        let base = 0;
        const byGroup: Record<Group, number> = { P1: 0, P2: 0, P3: 0, Expert: 0 };
        for (const s of active) {
          base += worlds.baseline[s.id]?.cells[i]?.demand ?? 0;
          byGroup[groupOf(s)] += worlds.scenario[s.id]?.cells[i]?.demand ?? 0;
        }
        const scen = byGroup.P1 + byGroup.P2 + byGroup.P3 + byGroup.Expert;
        return {
          name: monthLabel(m, ru),
          base: Math.round(base),
          scen: Math.round(scen),
          P1: Math.round(byGroup.P1),
          P2: Math.round(byGroup.P2),
          P3: Math.round(byGroup.P3),
          Expert: Math.round(byGroup.Expert),
        };
      }),
    [months, active, worlds, ru]
  );

  const stockData = useMemo(
    () =>
      months.map((m, i) => ({
        name: monthLabel(m, ru),
        base: Math.round(worlds.baseline[selSku]?.cells[i]?.closing ?? 0),
        scen: Math.round(worlds.scenario[selSku]?.cells[i]?.closing ?? 0),
      })),
    [months, worlds, selSku, ru]
  );

  // ── the next 3 order slots, recommended baseline vs scenario ──
  const slotRows = useMemo(
    () =>
      [0, 1, 2].map((i) => {
        const orderMonth = addMonths(slot.orderMonth, i);
        const shipMonth = addMonths(slot.shipMonth, i);
        const arrival = addMonths(shipMonth, 1);
        const scenArrival = delay ? addMonths(arrival, 1) : arrival;
        const baseLines = active.map((s) => ({
          skuId: s.id,
          qty: recommendQty(worlds.baseline[s.id], s, arrival, settings),
        }));
        const scenLines = active.map((s) => ({
          skuId: s.id,
          qty: recommendQty(worlds.scenario[s.id], s, scenArrival, settings),
        }));
        const baseStats = truckStats(baseLines, skusById, settings);
        const scenStats = truckStats(scenLines, skusById, settings);
        const committed = active.reduce((sum, s) => sum + (purchases[s.id]?.[shipMonth] ?? 0), 0);
        return {
          orderMonth,
          shipMonth,
          arrival,
          committed,
          baseUnits: baseStats.totalUnits,
          scenUnits: scenStats.totalUnits,
          baseEur: baseStats.eurTotal,
          scenEur: scenStats.eurTotal,
          dUnits: scenStats.totalUnits - baseStats.totalUnits,
          dEur: scenStats.eurTotal - baseStats.eurTotal,
          dTrucks: settings.truckPallets > 0 ? (scenStats.pallets - baseStats.pallets) / settings.truckPallets : 0,
        };
      }),
    [slot, delay, active, worlds, skusById, settings, purchases]
  );
  const highlight = slotRows.find((r) => r.shipMonth.endsWith("-12")) ?? slotRows[0];

  // ── KPIs ──────────────────────────────────────────────────────
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
  const outTone =
    baseOut === scenOut ? "" : !scenOut || (baseOut && scenOut > baseOut) ? "text-ok" : "text-danger";
  const baseCash = slotRows.reduce((s, r) => s + r.baseEur, 0);
  const scenCash = slotRows.reduce((s, r) => s + r.scenEur, 0);

  // one-line summary of the levers that differ from the base assumptions
  const activeSummary = useMemo(() => {
    const parts: string[] = [];
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    if (r1 !== cohortParams.retention1) parts.push(`${ru ? "удержание 1-й ступени" : "stage-1 retention"} ${pct(r1)}`);
    if (r2 !== cohortParams.retention2) parts.push(`${ru ? "удержание 2-й ступени" : "stage-2 retention"} ${pct(r2)}`);
    if (r3 !== cohortParams.retention3) parts.push(`${ru ? "удержание 3-й ступени" : "stage-3 retention"} ${pct(r3)}`);
    if (packs !== cohortParams.packsPerBaby) parts.push(`${packs} ${ru ? "банок/младенца" : "packs/baby"}`);
    if (recruitsNum > 0) parts.push(`${fmtN(recruitsNum)} ${ru ? "рецептов/мес" : "Rx/mo"}`);
    for (const g of ["P1", "P2", "P3", "Expert"] as const) {
      if (mult[g] !== 1) parts.push(`${g === "Expert" ? "Expert" : `Platin ${g[1]}`} ×${mult[g].toFixed(2)}`);
    }
    if (delay) parts.push(ru ? "фура +1 мес" : "truck +1 mo");
    return parts;
  }, [r1, r2, r3, packs, recruitsNum, mult, delay, cohortParams, ru]);

  return (
    <div className="pb-16">
      <PageTitle
        title={ru ? "Сценарии" : "Scenarios"}
        subtitle={
          ru
            ? "Песочница: как спрос, остатки и заказы реагируют на удержание, набор рецептов и рост спроса — ничего не сохраняется"
            : "Sandbox: how demand, stock and orders react to retention, recruitment and demand shifts — nothing is saved"
        }
        right={
          activeSummary.length > 0 ? (
            <span className="rounded-full border border-accent-soft bg-accent-soft-bg px-4 py-1.5 text-[11.5px] font-semibold text-accent">
              {ru ? "Активный сценарий: " : "Active scenario: "}
              {activeSummary.join(" · ")}
            </span>
          ) : (
            <span className="rounded-full border border-border bg-surface px-4 py-1.5 text-[11.5px] font-medium text-muted">
              {ru ? "База — параметры не изменены" : "Base — no changes"}
            </span>
          )
        }
      />
      <PlanningTabs />

      <div className="grid items-start gap-4 lg:grid-cols-[320px_1fr]">
        {/* ── control panel ── */}
        <Card className="self-start lg:sticky lg:top-4">
          <CardHeader
            title={ru ? "Параметры сценария" : "Scenario parameters"}
            right={
              <Button variant="ghost" onClick={reset}>
                {ru ? "Сброс" : "Reset"}
              </Button>
            }
          />
          <div className="space-y-4 px-4 pb-5 pt-4">
            <Slider
              label={ru ? "Удержание, ступень 1" : "Retention, stage 1"}
              value={r1} min={0.2} max={0.7} step={0.01}
              display={`${Math.round(r1 * 100)}%`}
              defaultValue={cohortParams.retention1}
              onChange={setR1}
            />
            <Slider
              label={ru ? "Удержание, ступень 2" : "Retention, stage 2"}
              value={r2} min={0} max={0.5} step={0.01}
              display={`${Math.round(r2 * 100)}%`}
              defaultValue={cohortParams.retention2}
              onChange={setR2}
            />
            <Slider
              label={ru ? "Удержание, ступень 3" : "Retention, stage 3"}
              value={r3} min={0} max={0.4} step={0.01}
              display={`${Math.round(r3 * 100)}%`}
              defaultValue={cohortParams.retention3}
              onChange={setR3}
            />
            <Slider
              label={ru ? "Банок на младенца, мес" : "Packs per baby, mo"}
              value={packs} min={2} max={4} step={0.5}
              display={packs.toFixed(1)}
              defaultValue={cohortParams.packsPerBaby}
              onChange={setPacks}
            />

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[12px] font-medium">{ru ? "Новые рецепты / мес" : "New prescriptions / mo"}</span>
                {recruitsNum > 0 && (
                  <button
                    type="button"
                    onClick={() => setRecruitsRaw("")}
                    className="text-[11px] text-muted transition-colors hover:text-accent"
                  >
                    {ru ? "авто" : "auto"}
                  </button>
                )}
              </div>
              <Input
                inputMode="numeric"
                value={recruitsRaw}
                onChange={(e) => setRecruitsRaw(e.target.value)}
                placeholder={`≈ ${fmtN(trailing3)} (${ru ? "авто" : "auto"})`}
                className="num w-full text-right"
              />
              <div className="mt-1 text-[11px] leading-snug text-muted">
                {ru ? "0 или пусто — среднее за последние 3 мес" : "0 or empty — trailing 3-month average"}
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <div className="label-caps mb-2">{ru ? "Рост спроса" : "Demand growth"}</div>
              <div className="space-y-3">
                {GROUPS.map((g) => (
                  <Slider
                    key={g}
                    label={g === "Expert" ? (ru ? "Эксперт (AC/AR/HN/SL)" : "Expert (AC/AR/HN/SL)") : `Platin ${g.slice(1)}`}
                    value={mult[g]} min={0.7} max={1.5} step={0.05}
                    display={`×${mult[g].toFixed(2)}`}
                    defaultValue={1}
                    onChange={(v) => setMult((m) => ({ ...m, [g]: v }))}
                  />
                ))}
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <div className="mb-1.5 text-[12px] font-medium">{ru ? "Задержка фуры" : "Truck delay"}</div>
              <div className="flex gap-1 rounded-lg border border-border bg-surface-low/60 p-0.5">
                {([false, true] as const).map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    onClick={() => setDelay(v)}
                    className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                      delay === v ? "bg-surface text-accent shadow-[0_1px_2px_rgba(15,23,42,0.08)]" : "text-muted hover:text-foreground"
                    }`}
                  >
                    {v ? (ru ? "+1 мес" : "+1 mo") : ru ? "Без задержки" : "On time"}
                  </button>
                ))}
              </div>
              <div className="mt-1 text-[11px] leading-snug text-muted">
                {ru ? "Сдвигает все приходы на месяц позже" : "Shifts every arrival one month later"}
              </div>
            </div>
          </div>
        </Card>

        {/* ── results ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader
              title={ru ? "Спрос, шт/мес" : "Demand, pcs/mo"}
              desc={
                ru
                  ? "Волна Platin 2 растёт вслед за набором рецептов — включите разбивку по ступеням, чтобы её увидеть"
                  : "The Platin 2 wave is rising behind the recruitment ramp — switch to the stage split to see it"
              }
              right={
                <Button variant={stacked ? "secondary" : "ghost"} onClick={() => setStacked((v) => !v)}>
                  {ru ? "По ступеням" : "By stage"}
                </Button>
              }
            />
            <div className="px-4 pb-4 pt-3">
              <div className="mb-2 flex flex-wrap items-center gap-4 text-[11.5px] text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-0 w-5 border-t-2 border-dashed" style={{ borderColor: MUTED }} />
                  {ru ? "база" : "baseline"}
                </span>
                {stacked ? (
                  GROUPS.map((g) => (
                    <span key={g} className="flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: GROUP_COLOR[g] }} />
                      {g === "Expert" ? (ru ? "Эксперт" : "Expert") : `Platin ${g.slice(1)}`}
                    </span>
                  ))
                ) : (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-0 w-5 border-t-2" style={{ borderColor: ACCENT }} />
                    {ru ? "сценарий" : "scenario"}
                  </span>
                )}
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={demandData}>
                  <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: "#64748b", fontWeight: 600 }} axisLine={false} tickLine={false} interval={1} />
                  <YAxis tick={{ fontSize: 10.5, fill: "#64748b" }} axisLine={false} tickLine={false} width={46} tickFormatter={(v) => fmtN(Number(v))} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => fmtN(Number(value))} />
                  {stacked &&
                    GROUPS.map((g) => (
                      <Area
                        key={g}
                        dataKey={g}
                        name={g === "Expert" ? (ru ? "Эксперт" : "Expert") : `Platin ${g.slice(1)}`}
                        stackId="scen"
                        stroke={GROUP_COLOR[g]}
                        fill={GROUP_COLOR[g]}
                        fillOpacity={0.55}
                        strokeWidth={1}
                      />
                    ))}
                  {!stacked && (
                    <Line dataKey="scen" name={ru ? "Сценарий" : "Scenario"} stroke={ACCENT} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: ACCENT, strokeWidth: 0 }} />
                  )}
                  <Line dataKey="base" name={ru ? "База" : "Baseline"} stroke={MUTED} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <CardHeader
              title={ru ? "Остаток, шт" : "Stock, pcs"}
              desc={ru ? "Прогнозный остаток на конец месяца: база vs сценарий" : "Projected end-of-month stock: baseline vs scenario"}
              right={
                <Select value={selSku} onChange={(e) => setSelSku(e.target.value)}>
                  {active.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              }
            />
            <div className="px-4 pb-4 pt-3">
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={stockData}>
                  <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: "#64748b", fontWeight: 600 }} axisLine={false} tickLine={false} interval={1} />
                  <YAxis tick={{ fontSize: 10.5, fill: "#64748b" }} axisLine={false} tickLine={false} width={46} tickFormatter={(v) => fmtN(Number(v))} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => fmtN(Number(value))} />
                  <ReferenceLine y={0} stroke={DANGER} strokeDasharray="4 3" strokeOpacity={0.6} />
                  <Line dataKey="base" name={ru ? "База" : "Baseline"} stroke={MUTED} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
                  <Line dataKey="scen" name={ru ? "Сценарий" : "Scenario"} stroke={ACCENT} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: ACCENT, strokeWidth: 0 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader
              title={ru ? "Слоты заказов" : "Order slots"}
              desc={
                ru
                  ? "Рекомендованный объём на следующие 3 слота: база vs сценарий"
                  : "Recommended volume for the next 3 slots: baseline vs scenario"
              }
            />
            <div className="overflow-x-auto">
              <table className="tbl w-full">
                <thead>
                  <tr>
                    <th>{ru ? "Заказ до" : "Order by"}</th>
                    <th>{ru ? "Отгрузка → приход" : "Ship → arrival"}</th>
                    <th className="text-right">{ru ? "Закуплено" : "Committed"}</th>
                    <th className="text-right">{ru ? "База, шт" : "Baseline, pcs"}</th>
                    <th className="text-right">{ru ? "Сценарий, шт" : "Scenario, pcs"}</th>
                    <th className="text-right">Δ {ru ? "шт" : "pcs"}</th>
                    <th className="text-right">Δ €</th>
                    <th className="text-right">Δ {ru ? "фур" : "trucks"}</th>
                  </tr>
                </thead>
                <tbody>
                  {slotRows.map((r) => (
                    <tr key={r.shipMonth}>
                      <td className="font-medium">
                        {monthLabel(r.orderMonth, ru)}
                        <span className="ml-1 text-[11px] text-muted">· {settings.orderDeadlineDay}-е</span>
                      </td>
                      <td className="text-muted">
                        {monthLabel(r.shipMonth, ru)} → {monthLabel(delay ? addMonths(r.arrival, 1) : r.arrival, ru)}
                      </td>
                      <td className="num text-right">{r.committed > 0 ? fmtN(r.committed) : "—"}</td>
                      <td className="num text-right text-muted">{fmtN(r.baseUnits)}</td>
                      <td className="num text-right font-semibold">{fmtN(r.scenUnits)}</td>
                      <td className={`num text-right ${r.dUnits > 0 ? "text-warn" : r.dUnits < 0 ? "text-ok" : "text-muted"}`}>
                        {sgn(r.dUnits)}
                      </td>
                      <td className={`num text-right ${r.dEur > 0 ? "text-warn" : r.dEur < 0 ? "text-ok" : "text-muted"}`}>
                        {r.dEur === 0 ? "0" : `${r.dEur > 0 ? "+" : "−"}€${fmtN(Math.abs(r.dEur))}`}
                      </td>
                      <td className="num text-right text-muted">{sgn(r.dTrucks, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {highlight && (
              <div className="border-t border-border bg-accent-soft-bg px-4 py-3 text-[13px]">
                <span className="font-semibold text-accent">
                  {highlight.shipMonth.endsWith("-12")
                    ? ru ? "Декабрьский слот:" : "December slot:"
                    : `${ru ? "Слот" : "Slot"} ${monthLabel(highlight.shipMonth, ru)}:`}
                </span>{" "}
                {ru
                  ? `сценарий требует ${sgn(highlight.dUnits)} шт (${highlight.dEur >= 0 ? "+" : "−"}€${fmtN(Math.abs(highlight.dEur))})`
                  : `the scenario needs ${sgn(highlight.dUnits)} pcs (${highlight.dEur >= 0 ? "+" : "−"}€${fmtN(Math.abs(highlight.dEur))})`}
              </div>
            )}
          </Card>

          {/* KPI chips */}
          <div className="flex flex-wrap gap-4">
            <div className="quiet-card min-w-56 flex-1 rounded-xl p-5">
              <div className="label-caps">{ru ? "Первый дефицит" : "First stockout"}</div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="num text-[14px] text-muted">
                  {baseOut ? monthLabel(baseOut, ru) : ru ? "нет" : "none"}
                </span>
                <span className="text-muted">→</span>
                <span className={`num font-display text-[22px] font-bold ${outTone}`}>
                  {scenOut ? monthLabel(scenOut, ru) : ru ? "нет" : "none"}
                </span>
              </div>
              <div className="mt-1 text-[11.5px] text-muted">
                {ru ? "самый ранний месяц ниже нуля по всем SKU" : "earliest below-zero month across SKUs"}
              </div>
            </div>
            <div className="quiet-card min-w-56 flex-1 rounded-xl p-5">
              <div className="label-caps">{ru ? "Кэш на предоплаты, 3 мес" : "Cash for prepayments, 3 mo"}</div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="num text-[14px] text-muted">€{fmtN(baseCash)}</span>
                <span className="text-muted">→</span>
                <span className="num font-display text-[22px] font-bold">€{fmtN(scenCash)}</span>
                <span className={`num text-[12.5px] ${scenCash - baseCash > 0 ? "text-warn" : "text-ok"}`}>
                  {scenCash - baseCash === 0 ? "" : `${scenCash - baseCash > 0 ? "+" : "−"}€${fmtN(Math.abs(scenCash - baseCash))}`}
                </span>
              </div>
              {eurRate > 0 && (
                <div className="num mt-1 text-[11.5px] text-muted">
                  ≈ {fmtN(scenCash * eurRate)} {ru ? "сум" : "UZS"}
                </div>
              )}
            </div>
          </div>

          <div className="text-[11.5px] leading-snug text-muted">
            {ru
              ? "Модель: подтверждённые рецепты набирают младенцев; когорта потребляет Platin 1 в 0–5 мес программы, Platin 2 в 6–11, Platin 3 в 12–17 с затуханием; калибровка по факту продаж (база + масштаб волны). Сценарии не сохраняются — это песочница."
              : "Model: verified prescriptions recruit babies; a cohort consumes Platin 1 at months 0–5 of the programme, Platin 2 at 6–11, Platin 3 at 12–17 fading; calibrated against actual sell-in (base + scaled wave). Scenarios are not saved — this is a sandbox."}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Labeled range slider with current value and a reset-to-default chip. */
function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  defaultValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  defaultValue: number;
  onChange: (v: number) => void;
}) {
  const isDefault = Math.abs(value - defaultValue) < 1e-9;
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium">{label}</span>
        <span className="flex items-center gap-1.5">
          <span className={`num text-[12px] font-semibold ${isDefault ? "text-muted" : "text-accent"}`}>{display}</span>
          {!isDefault && (
            <button
              type="button"
              onClick={() => onChange(defaultValue)}
              className="text-[11px] leading-none text-muted transition-colors hover:text-accent"
              title="Reset"
            >
              ↺
            </button>
          )}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-accent"
      />
    </div>
  );
}
