"use client";

// «Запасы» — built to the owner's design canvas: one table answering what is
// held, what is on the way, how long it lasts with the pipeline counted, and
// how much has to be ordered by the next deadline. Worst cover first.
// Beside it: the trucks actually on the road, and the cover-policy tally.
import Link from "next/link";
import { useT } from "@/lib/locale-context";
import { dstr, monthLong, monthTag, pCover, pn, splitPack } from "@/lib/planning/ui-format";
import type { OrderSlot, PlanningSettings } from "@/lib/planning/compute";
import type { Stage } from "@/lib/planning/cohort";
import type { TransitShipment } from "@/lib/planning/data";

export interface PipelineEvent {
  month: string;
  qty: number;
  kind: "transit" | "order";
  label: string | null; // truck code for transit
}

export interface InventoryRow {
  skuId: string;
  name: string;
  article: string;
  stage: Stage | null;
  stock: number;
  stockAsOf: string | null;
  demandPerMonth: number;
  coverOnHand: number;
  coverWithPipeline: number | null; // months until stockout incl. arrivals; null = beyond horizon
  pipeline: PipelineEvent[];
  stockoutMonth: string | null;
  fixable: boolean;
  orderSlotShip: string | null;
  slotDeadlineDate: string | null;
  slotDeadlineDays: number | null;
  recommendedNext: number;
  trajectory: Array<{ month: string; closing: number; arrival: boolean }>;
  priceEur: number;
  pcsPerPallet: number;
}

/** Cover pill colours, at the canvas thresholds (0.7 × policy, policy). */
function coverPill(cover: number | null, minCover: number): { bg: string; ink: string } {
  if (cover === null) return { bg: "var(--ok-soft)", ink: "var(--ok)" };
  if (cover < minCover * 0.7) return { bg: "var(--danger-soft)", ink: "var(--danger)" };
  if (cover < minCover) return { bg: "var(--warn-soft)", ink: "var(--warn-ink)" };
  return { bg: "var(--ok-soft)", ink: "var(--ok)" };
}

export default function InventoryView({
  rows,
  transit,
  slot,
  settings,
  eurRate,
  slotTotals,
}: {
  rows: InventoryRow[];
  transit: TransitShipment[];
  slot: OrderSlot;
  settings: PlanningSettings;
  eurRate: number;
  slotTotals: { skuCount: number; units: number; pallets: number; eur: number };
}) {
  const { locale } = useT();
  const ru = locale === "ru";

  const belowPolicy = rows.filter(
    (r) => r.coverWithPipeline !== null && r.coverWithPipeline < settings.minCoverMonths
  ).length;
  const belowInk =
    belowPolicy === 0 ? "var(--ok)" : belowPolicy > 3 ? "var(--danger)" : "var(--warn)";

  // trucks on the road, nearest arrival first
  const trucks = [...transit].sort((a, b) => a.etaMonth.localeCompare(b.etaMonth));

  return (
    <div>
      <div className="mb-3.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[22px] font-extrabold tracking-[-0.5px]">{ru ? "Запасы" : "Inventory"}</h1>
        <p className="text-[13px] font-semibold text-muted">
          {ru
            ? "Что на складе, что в пути и на сколько хватит?"
            : "What do I hold, what is on the way, how long does it last?"}
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-3.5">
        <div className="pcard min-w-0 flex-[1_1_680px] overflow-hidden">
          <div className="flex flex-wrap items-baseline gap-3 border-b px-[18px] py-3" style={{ borderColor: "var(--hair)" }}>
            <h2 className="text-[14px] font-extrabold">{ru ? "Склад и покрытие" : "Stock and cover"}</h2>
            <span className="text-[11.5px] font-semibold text-muted">
              {ru
                ? "Худшее покрытие сверху · с учётом поставок в пути"
                : "Worst cover first · pipeline included"}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="ptable" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 190 }}>{ru ? "Продукт" : "Product"}</th>
                  <th>{ru ? "На складе" : "On hand"}</th>
                  <th>{ru ? "В пути" : "In transit"}</th>
                  <th>{ru ? "Спрос/мес." : "Demand/mo."}</th>
                  <th>{ru ? "Покрытие" : "Cover"}</th>
                  <th className="text-left">{ru ? "Уйдёт в минус" : "Goes negative"}</th>
                  <th className="col-act" style={{ paddingRight: 18 }}>
                    {ru ? "Заказать к дедлайну" : "Order by deadline"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const { name, pack } = splitPack(r.name);
                  const pipelineUnits = r.pipeline.reduce((s, e) => s + e.qty, 0);
                  const pill = coverPill(r.coverWithPipeline, settings.minCoverMonths);
                  const negInk = !r.stockoutMonth
                    ? "var(--muted)"
                    : r.fixable
                      ? "var(--warn-ink)"
                      : "var(--danger)";
                  return (
                    <tr key={r.skuId}>
                      <td>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-bold">{name}</span>
                          {pack && <span className="text-[11px] font-bold" style={{ color: "var(--sky)" }}>{pack}</span>}
                        </div>
                        <div className="pnum mt-0.5 text-[10.5px]" style={{ color: "var(--faint)" }}>
                          № {r.article}
                          {r.stockAsOf && ` · ${monthTag(r.stockAsOf, ru)}`}
                        </div>
                      </td>
                      <td className="pnum text-[13px]">{pn(r.stock)}</td>
                      <td className="pnum text-[13px]" style={{ color: "var(--info)" }}>
                        {pipelineUnits > 0 ? pn(pipelineUnits) : "—"}
                      </td>
                      <td className="pnum text-[13px] text-muted">{pn(r.demandPerMonth)}</td>
                      <td>
                        <span
                          className="ppill pnum"
                          style={{ background: pill.bg, color: pill.ink, fontSize: "12.5px" }}
                        >
                          {r.coverWithPipeline === null
                            ? ru ? "хватает" : "covered"
                            : pCover(r.coverWithPipeline)}
                        </span>
                      </td>
                      <td className="text-left text-[12.5px] font-bold" style={{ color: negInk }}>
                        {r.stockoutMonth
                          ? monthTag(r.stockoutMonth, ru)
                          : ru ? "не уйдёт" : "not in horizon"}
                        {!r.fixable && r.stockoutMonth && (
                          <div className="text-[10.5px] font-bold" style={{ color: "var(--danger)" }}>
                            {ru ? "заказом уже не спасти" : "too late to fix by ordering"}
                          </div>
                        )}
                      </td>
                      <td className="col-act" style={{ paddingRight: 18 }}>
                        <div
                          className="pnum text-[13px] font-bold"
                          style={{ color: r.recommendedNext > 0 ? "var(--accent)" : "var(--faint)" }}
                        >
                          {r.recommendedNext > 0 ? pn(r.recommendedNext) : "—"}
                        </div>
                        {r.recommendedNext > 0 && r.slotDeadlineDate && (
                          <div className="text-[10.5px] font-bold" style={{ color: "var(--faint)" }}>
                            {dstr(r.slotDeadlineDate)}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div
            className="border-t px-[18px] py-3 text-[12px] font-semibold text-muted"
            style={{ borderColor: "var(--hair)", background: "var(--surface-low)" }}
          >
            {ru ? "Пополнение оформляется на экране " : "Replenishment is entered on "}
            <Link href="/planning/order" className="font-bold text-accent hover:underline">
              {ru ? "«Заказ»" : "Order"}
            </Link>
            {slotTotals.skuCount > 0 && (
              <>
                {" · "}
                <span className="pnum">
                  {ru
                    ? `${slotTotals.skuCount} SKU · ${pn(slotTotals.units)} шт · ${slotTotals.pallets.toFixed(1)} паллет · €${pn(slotTotals.eur)}`
                    : `${slotTotals.skuCount} SKUs · ${pn(slotTotals.units)} pcs · ${slotTotals.pallets.toFixed(1)} pallets · €${pn(slotTotals.eur)}`}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-[0_1_340px] flex-col gap-3.5" style={{ minWidth: 290 }}>
          <div className="pcard px-[18px] py-4">
            <h2 className="text-[13.5px] font-extrabold">{ru ? "Поставки в пути" : "Shipments in transit"}</h2>
            <p className="mt-0.5 text-[12px] font-semibold text-muted">
              {ru ? "Отгружено, ещё не получено" : "Dispatched, not yet received"}
            </p>
            {trucks.length === 0 ? (
              <p className="mt-3 text-[12.5px] font-semibold" style={{ color: "var(--faint)" }}>
                {ru ? "Сейчас в пути ничего нет." : "Nothing is on the road right now."}
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-2.5">
                {trucks.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-start gap-3 border-b pb-2.5 last:border-b-0 last:pb-0"
                    style={{ borderColor: "var(--hair-soft)" }}
                  >
                    <div
                      className="w-11 shrink-0 rounded-lg py-1.5 text-center"
                      style={{ background: "var(--info-soft)", color: "var(--info)" }}
                    >
                      <div className="text-[11px] font-extrabold">{monthTag(t.etaMonth, ru).split(" ")[0]}</div>
                      <div className="text-[10px] font-bold opacity-75">{t.etaMonth.slice(2, 4)}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="pnum text-[14px] font-bold">
                        {pn(t.totalUnits)} {ru ? "упак." : "packs"}
                      </div>
                      <div className="text-[11.5px] font-semibold text-muted">
                        {t.code}
                        {t.etaDate && ` · ${ru ? "прибытие" : "ETA"} ${dstr(t.etaDate.slice(0, 10))}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pcard px-[18px] py-4">
            <h2 className="text-[13.5px] font-extrabold">{ru ? "Политика покрытия" : "Cover policy"}</h2>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="pnum text-[26px] font-bold tracking-[-1px]" style={{ color: belowInk }}>
                {belowPolicy}
              </span>
              <span className="text-[12.5px] font-bold text-muted">
                {ru ? `из ${rows.length} продуктов` : `of ${rows.length} products`}
              </span>
            </div>
            <p className="mt-1.5 text-[12px] font-semibold leading-snug text-muted">
              {ru
                ? `ниже нормы ${settings.minCoverMonths} месяцев запаса с учётом того, что уже в пути.`
                : `below the ${settings.minCoverMonths}-month policy once the pipeline is counted.`}
            </p>
            <div
              className="mt-3 rounded-[10px] border px-3 py-2.5"
              style={{ background: "var(--accent-soft-bg)", borderColor: "var(--accent-soft)" }}
            >
              <div className="text-[11.5px] font-bold leading-snug" style={{ color: "#0b3a73" }}>
                {ru ? "Пополнение идёт в дедлайн " : "Replenishment goes into deadline "}
                <b className="pnum">{dstr(slot.deadline)}</b>
                {" → "}
                {ru ? "отгрузка " : "shipping "}
                <b>{monthLong(slot.shipMonth, ru)}</b>
              </div>
            </div>
            {eurRate > 0 && slotTotals.eur > 0 && (
              <p className="pnum mt-2.5 text-[11.5px] font-semibold text-muted">
                €{pn(slotTotals.eur)} ≈ {pn(slotTotals.eur * eurRate)} {ru ? "сум" : "UZS"}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
