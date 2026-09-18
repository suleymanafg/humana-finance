// «Решения» — merged risk + analysis page. All heavy math happens here:
// three scenario projections per SKU (base / conservative / optimistic),
// three-tier cover, the status ladder and the slot decision table; the view
// only renders the precomputed plain objects.
import { loadPlanning } from "@/lib/planning/data";
import {
  addMonths,
  monthKeyOf,
  nextOrderSlot,
  projectSku,
  recommendQty,
  truckStats,
  type SkuSituation,
} from "@/lib/planning/compute";
import { buildDemandModel } from "@/lib/planning/model";
import type { Stage } from "@/lib/planning/cohort";
import { getSession } from "@/lib/auth";
import PlanningShell from "@/components/PlanningShell";
import DecisionsView, {
  type DecisionCard,
  type DecisionRow,
  type DecisionStatus,
  type WaveInfo,
} from "@/components/DecisionsView";

export const dynamic = "force-dynamic";

const HORIZON = 14;
// mirrors cohort.ts STAGE_WINDOW (module-private there)
const STAGE_WINDOW: Record<Stage, [number, number]> = { P1: [0, 5], P2: [6, 11], P3: [12, 17] };

const SEVERITY: Record<DecisionStatus, number> = {
  stockout: 0,
  critical: 1,
  gap: 2,
  reorder: 3,
  overstock: 4,
  ok: 5,
};

const avg3 = (series: Record<string, number> | undefined, startMonth: string): number => {
  if (!series) return 0;
  const vals = [0, 1, 2].map((i) => series[addMonths(startMonth, i)] ?? 0);
  return vals.reduce((s, v) => s + v, 0) / 3;
};

export default async function DecisionsPage() {
  const data = await loadPlanning();
  const session = await getSession();
  const slot = nextOrderSlot(new Date(), data.settings);
  const startMonth = monthKeyOf(new Date());
  const { settings } = data;

  // optimistic world: stage retention ×1.5, recruitment keeps ramping (+20%
  // over the trailing 3-month average) — the model is rebuilt once for all SKUs
  const recruitTail = Object.keys(data.recruitment).sort().slice(-3);
  const recruitAvg3 =
    recruitTail.length > 0
      ? recruitTail.reduce((s, k) => s + data.recruitment[k], 0) / recruitTail.length
      : 0;
  const optimisticModel = buildDemandModel(
    data.skus.map((s) => ({ id: s.id, name: s.name })),
    Object.fromEntries(data.skus.map((s) => [s.id, data.situations[s.id].actualSales])),
    data.recruitment,
    startMonth,
    18,
    {
      ...data.cohortParams,
      retention2: data.cohortParams.retention2 * 1.5,
      retention3: data.cohortParams.retention3 * 1.5,
      recruitmentAhead: recruitAvg3 * 1.2,
    }
  );

  // stage-level base-model series — the wave sentences quote stage totals
  const stageSeries: Record<Stage, Record<string, number>> = { P1: {}, P2: {}, P3: {} };
  for (const s of data.skus) {
    const st = data.model.stageBySku[s.id];
    if (!st) continue;
    for (const [m, q] of Object.entries(data.model.series[s.id] ?? {})) {
      stageSeries[st][m] = (stageSeries[st][m] ?? 0) + q;
    }
  }

  const near2 = addMonths(startMonth, 2);
  const cards: DecisionCard[] = [];
  const dormant: Array<{ skuId: string; name: string }> = [];
  const table: DecisionRow[] = [];

  for (const sku of data.skus.filter((s) => s.active)) {
    const sit = data.situations[sku.id];
    const base = projectSku(sit, startMonth, HORIZON, settings);
    const model3m = avg3(sit.model, startMonth);

    if (base.currentStock <= 0 && base.runRatePerMonth <= 0 && model3m <= 0) {
      dormant.push({ skuId: sku.id, name: sku.name });
      continue;
    }

    // conservative = pure run-rate; optimistic = boosted cohort model
    const consSit: SkuSituation = { ...sit, model: undefined, forecast: {} };
    const optSit: SkuSituation = { ...sit, model: optimisticModel.series[sku.id] };
    const cons = projectSku(consSit, startMonth, HORIZON, settings);
    const opt = projectSku(optSit, startMonth, HORIZON, settings);
    const rec = {
      conservative: recommendQty(cons, sku, slot.arrivalMonth, settings),
      base: recommendQty(base, sku, slot.arrivalMonth, settings),
      optimistic: recommendQty(opt, sku, slot.arrivalMonth, settings),
    };

    // committed arrivals: «едет» (≤ 2 months out) vs the rest of the pipeline
    const arrivalMonths = Object.keys(sit.arrivals)
      .filter((m) => m >= startMonth && (sit.arrivals[m] ?? 0) > 0)
      .sort();
    const firstArrivalMonth = arrivalMonths[0] ?? null;
    const firstArrivalQty = firstArrivalMonth ? sit.arrivals[firstArrivalMonth] : 0;
    const nearArrivalUnits = arrivalMonths
      .filter((m) => m <= near2)
      .reduce((s, m) => s + sit.arrivals[m], 0);
    const allArrivalUnits = arrivalMonths.reduce((s, m) => s + sit.arrivals[m], 0);

    // three-tier cover: same demand curve, stock topped up tier by tier
    const coverOnHand = base.currentCover;
    const coverWithNear = projectSku(
      { ...sit, currentStock: sit.currentStock + nearArrivalUnits, arrivals: {} },
      startMonth, HORIZON, settings
    ).currentCover;
    const coverWithAll = projectSku(
      { ...sit, currentStock: sit.currentStock + allArrivalUnits, arrivals: {} },
      startMonth, HORIZON, settings
    ).currentCover;

    const stockoutMonth = base.stockoutMonth;
    const fixable = !stockoutMonth || stockoutMonth >= slot.arrivalMonth;

    // with the base order landed: until when does stock last?
    let coverUntilMonth: string | null = null;
    if (rec.base > 0) {
      const withOrder = projectSku(
        {
          ...sit,
          arrivals: {
            ...sit.arrivals,
            [slot.arrivalMonth]: (sit.arrivals[slot.arrivalMonth] ?? 0) + rec.base,
          },
        },
        startMonth, HORIZON, settings
      );
      coverUntilMonth = withOrder.stockoutMonth ? addMonths(withOrder.stockoutMonth, -1) : null;
    }

    const status: DecisionStatus =
      base.currentStock <= 0 && nearArrivalUnits <= 0
        ? "stockout"
        : coverOnHand < 1 || (stockoutMonth !== null && (!firstArrivalMonth || stockoutMonth < firstArrivalMonth))
          ? "critical"
          : stockoutMonth !== null
            ? "gap"
            : rec.base > 0
              ? "reorder"
              : coverOnHand > 8
                ? "overstock"
                : "ok";

    const runRate3m = base.runRatePerMonth;
    const modelVsRunRate = runRate3m > 0 && model3m > 0 ? (model3m - runRate3m) / runRate3m : null;
    const forecastVals = [0, 1, 2, 3, 4, 5]
      .map((i) => sit.forecast[addMonths(startMonth, i)])
      .filter((v): v is number => v !== undefined && v > 0);
    const forecastAvg =
      forecastVals.length > 0 ? forecastVals.reduce((s, v) => s + v, 0) / forecastVals.length : null;
    const forecastVsModel = forecastAvg !== null && model3m > 0 ? (forecastAvg - model3m) / model3m : null;

    // wave facts: stage total now vs the peak over the next 6 months, plus
    // the recruitment window that feeds the stage at that peak
    const stage = data.model.stageBySku[sku.id] ?? null;
    let wave: WaveInfo | null = null;
    if (stage) {
      const ser = stageSeries[stage];
      const now = ser[startMonth] ?? 0;
      let peakMonth = startMonth;
      let peak = now;
      for (let i = 1; i <= 6; i++) {
        const m = addMonths(startMonth, i);
        if ((ser[m] ?? 0) > peak) {
          peak = ser[m];
          peakMonth = m;
        }
      }
      const [from, to] = STAGE_WINDOW[stage];
      wave = {
        stage,
        nowPerMonth: Math.round(now),
        peakPerMonth: Math.round(peak),
        peakMonth,
        recruitFromMonth: addMonths(peakMonth, -to),
        recruitToMonth: addMonths(peakMonth, -from),
        rising: now > 0 && peak > now * 1.08,
      };
    }

    const purchasedAtSlot = data.purchases[sku.id]?.[slot.shipMonth] ?? 0;

    cards.push({
      skuId: sku.id,
      name: sku.name,
      stage,
      status,
      stock: base.currentStock,
      stockAsOf: base.stockAsOf,
      coverOnHand,
      coverWithNear,
      coverWithAll,
      nearArrivalUnits,
      laterArrivalUnits: allArrivalUnits - nearArrivalUnits,
      firstArrivalMonth,
      firstArrivalQty,
      stockoutMonth,
      fixable,
      runRate3m: Math.round(runRate3m),
      model3m: Math.round(model3m),
      modelVsRunRate,
      forecastAvg: forecastAvg !== null ? Math.round(forecastAvg) : null,
      forecastVsModel,
      wave,
      rec,
      coverUntilMonth,
      purchasedAtSlot,
      demandPerMonth: Math.round(base.avgDemandPerMonth),
    });
    table.push({
      skuId: sku.id,
      name: sku.name,
      conservative: rec.conservative,
      base: rec.base,
      optimistic: rec.optimistic,
      purchased: purchasedAtSlot,
    });
  }

  cards.sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status]);

  const skusById = Object.fromEntries(data.skus.map((s) => [s.id, s]));
  // the canvas prints pallets/trucks under every scenario, not just the base
  const truckFor = (pick: (r: DecisionRow) => number) =>
    truckStats(table.map((r) => ({ skuId: r.skuId, qty: pick(r) })), skusById, settings);
  const baseTruck = truckFor((r) => r.base);
  const trucks = {
    conservative: truckFor((r) => r.conservative),
    base: baseTruck,
    optimistic: truckFor((r) => r.optimistic),
  };

  return (
    <PlanningShell slot={slot}>
      <DecisionsView
        cards={cards}
        dormant={dormant}
        table={table}
        baseTruck={baseTruck}
        trucks={trucks}
        slot={slot}
        startMonth={startMonth}
        settings={settings}
        eurRate={data.eurRate}
        recruitment={data.recruitment}
        recruitAvg3={Math.round(recruitAvg3)}
        packsPerBaby={data.cohortParams.packsPerBaby}
        isAdmin={session?.role === "ADMIN"}
      />
    </PlanningShell>
  );
}
