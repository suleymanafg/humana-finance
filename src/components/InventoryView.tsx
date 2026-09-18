"use client";

// «Запасы» — the daily answer to four questions, worst SKU first:
// what do I hold (+ what's coming), how long does it last WITH the pipeline,
// which slot must the reorder go into, and how much closes 4 months of cover.
import Link from "next/link";
import { Badge, Button, Card, CardHeader, PageTitle } from "./ui";
import { IconAlert, IconCheck, IconTruck } from "./icons";
import { useT } from "@/lib/locale-context";
import { fmtN } from "@/lib/format";
import type { OrderSlot, PlanningSettings } from "@/lib/planning/compute";
import type { Stage } from "@/lib/planning/cohort";
import type { TransitShipment } from "@/lib/planning/data";

const MONTH_RU = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (key: string, ru: boolean) => {
  const [y, m] = key.split("-").map(Number);
  return `${(ru ? MONTH_RU : MONTH_EN)[m - 1]} '${String(y).slice(2)}`;
};
const dateLabel = (iso: string, ru: boolean) =>
  new Date(iso + "T00:00:00").toLocaleDateString(ru ? "ru-RU" : "en-GB", { day: "numeric", month: "short" });

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

function coverTone(cover: number | null, minCover: number): string {
  if (cover === null) return "text-ok";
  if (cover < minCover - 2) return "text-danger";
  if (cover < minCover) return "text-warn";
  return "text-ok";
}

/** Tiny projected-stock sparkline: red below zero, green dots on arrivals. */
function Trajectory({ points }: { points: InventoryRow["trajectory"] }) {
  const W = 132;
  const H = 30;
  const max = Math.max(...points.map((p) => p.closing), 1);
  const min = Math.min(...points.map((p) => p.closing), 0);
  const span = max - min || 1;
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * (W - 4) + 2;
  const y = (v: number) => H - 3 - ((v - min) / span) * (H - 6);
  const zeroY = y(0);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.closing).toFixed(1)}`).join(" ");
  return (
    <svg width={W} height={H} className="block">
      {min < 0 && <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="var(--danger)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" opacity="0.75" />
      {points.map((p, i) =>
        p.arrival ? <circle key={p.month} cx={x(i)} cy={y(p.closing)} r="2.4" fill="var(--ok)" /> : null
      )}
    </svg>
  );
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

  const totalStock = rows.reduce((s, r) => s + r.stock, 0);
  const totalPipeline = rows.reduce((s, r) => s + r.pipeline.reduce((a, e) => a + e.qty, 0), 0);
  const totalDemand = rows.reduce((s, r) => s + r.demandPerMonth, 0);
  const unfixable = rows.filter((r) => !r.fixable);
  const atRisk = rows.filter((r) => r.stockoutMonth !== null);

  return (
    <div className="pb-16">
      <PageTitle
        title={ru ? "Запасы" : "Inventory"}
        subtitle={
          ru
            ? "Сток + труба по каждому SKU: на сколько хватит, когда и сколько заказывать"
            : "Stock + pipeline per SKU: how long it lasts, when and how much to order"
        }
      />

      {/* the deadline call to action — what must be decided NOW */}
      {slotTotals.skuCount > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-accent/40 bg-accent-soft-bg px-5 py-3.5">
          <div>
            <div className="label-caps text-accent">
              {ru ? "К дедлайну" : "By the deadline"}{" "}
              {new Date(slot.deadline + "T00:00:00").toLocaleDateString(ru ? "ru-RU" : "en-GB", {
                day: "numeric",
                month: "long",
              })}{" "}
              · {ru ? "слот" : "slot"} {monthLabel(slot.shipMonth, ru)}
            </div>
            <div className="mt-0.5 text-[14px] font-semibold">
              {ru
                ? `Заказать ${slotTotals.skuCount} SKU · ${fmtN(slotTotals.units)} шт ≈ ${slotTotals.pallets.toFixed(1)} паллет (${(slotTotals.pallets / Math.max(1, settings.truckPallets)).toFixed(1)} фуры)`
                : `Order ${slotTotals.skuCount} SKUs · ${fmtN(slotTotals.units)} pcs ≈ ${slotTotals.pallets.toFixed(1)} pallets (${(slotTotals.pallets / Math.max(1, settings.truckPallets)).toFixed(1)} trucks)`}
              <span className="num ml-2 text-[12.5px] font-normal text-muted">
                €{fmtN(slotTotals.eur)}
                {eurRate > 0 && ` ≈ ${fmtN(slotTotals.eur * eurRate)} ${ru ? "сум" : "UZS"}`}
              </span>
            </div>
          </div>
          <span className="ml-auto flex items-center gap-2">
            <span
              className={`num rounded-full px-2.5 py-1 text-[11.5px] font-bold text-white ${
                slot.daysLeft <= 3 ? "bg-danger" : "bg-accent"
              }`}
            >
              {slot.daysLeft === 0 ? (ru ? "дедлайн сегодня" : "deadline today") : `${slot.daysLeft} ${ru ? "дн." : "days"}`}
            </span>
            <Link href="/planning/order">
              <Button>{ru ? "Собрать заказ" : "Build the order"} →</Button>
            </Link>
          </span>
        </div>
      )}

      {/* status strip */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-1">
        <span className="flex items-center gap-2">
          <span className="label-caps">{ru ? "На складе" : "On hand"}</span>
          <span className="num text-[14px] font-bold">{fmtN(totalStock)} {ru ? "шт" : "pcs"}</span>
        </span>
        <span className="h-4 w-px bg-border" />
        <span className="flex items-center gap-2">
          <IconTruck size={13} className="text-accent" />
          <span className="label-caps">{ru ? "Труба (транзит + заказы)" : "Pipeline"}</span>
          <span className="num text-[14px] font-bold">{fmtN(totalPipeline)} {ru ? "шт" : "pcs"}</span>
        </span>
        <span className="h-4 w-px bg-border" />
        <span className="flex items-center gap-2">
          <span className="label-caps">{ru ? "Спрос/мес" : "Demand/mo"}</span>
          <span className="num text-[14px] font-bold">{fmtN(totalDemand)}</span>
        </span>
        <span className="h-4 w-px bg-border" />
        <span className="flex items-center gap-2">
          <span className={`h-[7px] w-[7px] rounded-full ${unfixable.length > 0 ? "bg-danger" : atRisk.length > 0 ? "bg-warn" : "bg-ok"}`} />
          <span className="label-caps">{ru ? "Разрывы" : "Gaps"}</span>
          <span className={`num text-[14px] font-bold ${unfixable.length > 0 ? "text-danger" : atRisk.length > 0 ? "text-warn" : "text-ok"}`}>
            {atRisk.length} SKU
            {unfixable.length > 0 && ` · ${unfixable.length} ${ru ? "заказом не закрыть" : "unfixable"}`}
          </span>
        </span>
      </div>

      {/* the intelligence table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl w-full">
            <thead>
              <tr>
                <th>{ru ? "Товар" : "Product"}</th>
                <th className="text-right">{ru ? "Сток" : "Stock"}</th>
                <th>{ru ? "Приход" : "Incoming"}</th>
                <th className="text-right">{ru ? "Спрос/мес" : "Demand/mo"}</th>
                <th className="text-right">{ru ? "Хватит на" : "Lasts"}</th>
                <th>{ru ? "Прогноз остатка" : "Stock outlook"}</th>
                <th>{ru ? "Действие" : "Action"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const covered = r.stockoutMonth === null;
                return (
                  <tr key={r.skuId} className={!r.fixable ? "bg-danger-soft/25" : ""}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.name}</span>
                        <Badge tone={r.stage ? "accent" : "neutral"}>{r.stage ?? "Expert"}</Badge>
                      </div>
                      <div className="num text-[10.5px] text-muted">{ru ? "Арт." : "Art."} {r.article}</div>
                    </td>
                    <td className="text-right">
                      <div className="num font-semibold">{fmtN(r.stock)}</div>
                      {r.stockAsOf && <div className="num text-[10.5px] text-muted">{monthLabel(r.stockAsOf, ru)}</div>}
                    </td>
                    <td>
                      {r.pipeline.length === 0 ? (
                        <span className="text-muted/50">—</span>
                      ) : (
                        <div className="space-y-0.5">
                          {r.pipeline.slice(0, 3).map((e, i) => (
                            <div key={i} className="num flex items-center gap-1.5 text-[12px]">
                              {e.kind === "transit" ? (
                                <IconTruck size={11} className="shrink-0 text-accent" />
                              ) : (
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-soft" />
                              )}
                              <span className="font-medium">+{fmtN(e.qty)}</span>
                              <span className="text-muted">
                                {monthLabel(e.month, ru)}
                                {e.kind === "transit"
                                  ? ` · ${e.label ?? (ru ? "в пути" : "transit")}`
                                  : ` · ${ru ? "заказ" : "order"}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="num text-right text-muted">{r.demandPerMonth > 0 ? fmtN(r.demandPerMonth) : "—"}</td>
                    <td className="text-right">
                      <div className={`num text-[14px] font-bold ${coverTone(r.coverWithPipeline, settings.minCoverMonths)}`}>
                        {r.coverWithPipeline === null ? `12+` : r.coverWithPipeline.toFixed(1)} {ru ? "мес" : "mo"}
                      </div>
                      <div className="num text-[10.5px] text-muted" title={ru ? "только склад, без прихода" : "on-hand only"}>
                        {ru ? "без прихода" : "on hand"}: {r.coverOnHand.toFixed(1)}
                      </div>
                    </td>
                    <td>
                      <Trajectory points={r.trajectory} />
                      {r.stockoutMonth && (
                        <div className={`num text-[10px] font-semibold ${r.fixable ? "text-warn" : "text-danger"}`}>
                          {ru ? "ноль в" : "zero in"} {monthLabel(r.stockoutMonth, ru)}
                        </div>
                      )}
                    </td>
                    <td className="max-w-64">
                      {covered && r.recommendedNext <= 0 ? (
                        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ok">
                          <IconCheck size={13} /> {ru ? "запаса достаточно" : "sufficient"}
                        </span>
                      ) : !r.fixable ? (
                        <div className="text-[12px] leading-snug">
                          <span className="flex items-center gap-1 font-semibold text-danger">
                            <IconAlert size={12} /> {ru ? "Заказом не закрыть" : "Order can't close it"}
                          </span>
                          <div className="mt-0.5 text-muted">
                            {ru
                              ? `разрыв до прихода ${monthLabel(slot.arrivalMonth, ru)} — ускорить транзит / перераспределить`
                              : `gap before ${monthLabel(slot.arrivalMonth, ru)} arrival — expedite transit / rebalance`}
                          </div>
                          {r.recommendedNext > 0 && (
                            <div className="num mt-0.5 font-semibold text-accent">
                              {ru ? "и заказать" : "and order"} {fmtN(r.recommendedNext)} {ru ? "шт в слот" : "pcs in slot"}{" "}
                              {monthLabel(slot.shipMonth, ru)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-[12px] leading-snug">
                          <div className="num font-semibold text-accent">
                            {ru ? "Заказать" : "Order"} {fmtN(r.recommendedNext)} {ru ? "шт" : "pcs"}
                            <span className="font-normal text-muted"> · {ru ? "покрывает" : "covers"} {settings.minCoverMonths}+ {ru ? "мес" : "mo"}</span>
                          </div>
                          {r.orderSlotShip && r.slotDeadlineDate && (
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                              <span
                                className={`num inline-block rounded-md px-2 py-0.5 text-[11px] font-bold ${
                                  r.orderSlotShip === slot.shipMonth ? "bg-accent text-white" : "bg-accent-soft-bg text-accent"
                                }`}
                              >
                                {ru ? "слот" : "slot"} {monthLabel(r.orderSlotShip, ru)}
                              </span>
                              <span
                                className={`num text-[11px] font-semibold ${
                                  (r.slotDeadlineDays ?? 99) <= 3 ? "text-danger" : "text-muted"
                                }`}
                              >
                                {ru ? "дедлайн" : "deadline"} {dateLabel(r.slotDeadlineDate, ru)}
                                {r.slotDeadlineDays !== null &&
                                  (r.slotDeadlineDays <= 0
                                    ? ` · ${ru ? "сегодня!" : "today!"}`
                                    : ` · ${r.slotDeadlineDays} ${ru ? "дн." : "d"}`)}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* trucks on the road */}
      <Card className="mt-4 overflow-hidden">
        <CardHeader
          title={ru ? "Фуры в пути" : "Trucks in transit"}
          desc={
            ru
              ? "Учитываются в покрытии по ожидаемому месяцу прихода; в себестоимость попадают после отметки «Прибыла» на странице Поставок"
              : "Counted in cover at their expected arrival month; enter COGS once marked arrived on the Shipments page"
          }
        />
        {transit.length === 0 ? (
          <div className="px-5 pb-5 text-[13px] text-muted">
            {ru
              ? "Сейчас в пути ничего нет. Фура добавляется на странице «Поставки» со статусом «В пути» и датой прихода."
              : "Nothing on the road. Add a truck on the Shipments page with status In transit and an ETA."}
          </div>
        ) : (
          <table className="tbl w-full">
            <thead>
              <tr>
                <th>{ru ? "Фура" : "Truck"}</th>
                <th className="text-right">{ru ? "Штук" : "Units"}</th>
                <th>{ru ? "Ожидаемый приход" : "Expected arrival"}</th>
              </tr>
            </thead>
            <tbody>
              {transit.map((t) => (
                <tr key={t.id}>
                  <td className="font-medium">
                    <span className="flex items-center gap-2">
                      <IconTruck size={14} className="text-accent" /> {t.code}
                    </span>
                  </td>
                  <td className="num text-right">{fmtN(t.totalUnits)}</td>
                  <td className="num">
                    {t.etaDate
                      ? new Date(t.etaDate + "T00:00:00").toLocaleDateString(ru ? "ru-RU" : "en-GB", {
                          day: "numeric",
                          month: "long",
                        })
                      : `~${monthLabel(t.etaMonth, ru)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
