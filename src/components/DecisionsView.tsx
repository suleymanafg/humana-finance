"use client";

// «Решения» — the daily working page of supply planning: the slot hero with
// three scenario recommendations and one-click «apply base to закуп», then
// per-SKU cards (position → demand → decision) sorted by severity. All the
// math arrives precomputed from the server page; this component renders,
// composes the bilingual sentences from those numbers, and posts.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Card, PageTitle } from "./ui";
import { IconAlert, IconCheck, IconTruck } from "./icons";
import PlanningTabs from "./PlanningTabs";
import { useT } from "@/lib/locale-context";
import { fmtN } from "@/lib/format";
import type { OrderSlot, PlanningSettings, TruckStats } from "@/lib/planning/compute";
import type { Stage } from "@/lib/planning/cohort";

export type DecisionStatus = "stockout" | "critical" | "gap" | "reorder" | "overstock" | "ok";

export interface WaveInfo {
  stage: Stage;
  nowPerMonth: number; // stage-level model demand this month
  peakPerMonth: number; // max over the next 6 months
  peakMonth: string;
  recruitFromMonth: string; // recruitment window feeding the stage at the peak
  recruitToMonth: string;
  rising: boolean;
}

export interface DecisionCard {
  skuId: string;
  name: string;
  stage: Stage | null;
  status: DecisionStatus;
  // положение
  stock: number;
  stockAsOf: string | null;
  coverOnHand: number; // months, on-hand only
  coverWithNear: number; // + arrivals within 2 months
  coverWithAll: number; // + all committed arrivals
  nearArrivalUnits: number; // «едет»
  laterArrivalUnits: number; // «закуп впереди»
  firstArrivalMonth: string | null;
  firstArrivalQty: number;
  stockoutMonth: string | null;
  fixable: boolean; // stockout not earlier than the slot's arrival
  // спрос
  runRate3m: number;
  model3m: number; // model avg over the next 3 months
  modelVsRunRate: number | null; // fraction
  forecastAvg: number | null; // manual IBP forecast avg, null when none entered
  forecastVsModel: number | null;
  wave: WaveInfo | null;
  // решение
  rec: { conservative: number; base: number; optimistic: number };
  coverUntilMonth: string | null; // with the base qty landed; null = beyond horizon
  purchasedAtSlot: number;
}

export interface DecisionRow {
  skuId: string;
  name: string;
  conservative: number;
  base: number;
  optimistic: number;
  purchased: number;
}

// ── russian month grammar (the sentences need four cases + adjective) ──
const RU_NOM = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const RU_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const RU_PREP = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];
const RU_DAT = ["январю", "февралю", "марту", "апрелю", "маю", "июню", "июлю", "августу", "сентябрю", "октябрю", "ноябрю", "декабрю"];
const RU_ADJ = ["январский", "февральский", "мартовский", "апрельский", "майский", "июньский", "июльский", "августовский", "сентябрьский", "октябрьский", "ноябрьский", "декабрьский"];
const EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const partsOf = (key: string): [number, number] => {
  const [y, m] = key.split("-").map(Number);
  return [y, m - 1];
};
/** «Декабрь 2026» / "December 2026" */
const monthTitle = (key: string, ru: boolean): string => {
  const [y, m] = partsOf(key);
  const name = ru ? RU_NOM[m] : EN[m];
  return `${name[0].toUpperCase()}${name.slice(1)} ${y}`;
};
/** lowercase month, optional year: «декабрь»/«декабря 2026» etc. */
const mCase = (key: string, list: string[], withYear = false): string => {
  const [y, m] = partsOf(key);
  return withYear ? `${list[m]} ${y}` : list[m];
};

function statusMeta(s: DecisionStatus, ru: boolean): { label: string; tone: "danger" | "warn" | "ok" } {
  switch (s) {
    case "stockout": return { label: ru ? "сток исчерпан" : "stocked out", tone: "danger" };
    case "critical": return { label: ru ? "критично" : "critical", tone: "danger" };
    case "gap": return { label: ru ? "разрыв впереди" : "gap ahead", tone: "warn" };
    case "reorder": return { label: ru ? "нужен заказ" : "order needed", tone: "warn" };
    case "overstock": return { label: ru ? "затоварка" : "overstock", tone: "warn" };
    case "ok": return { label: ru ? "в норме" : "ok", tone: "ok" };
  }
}

function coverBadgeClass(cover: number, minCover: number): string {
  if (cover < minCover - 1) return "bg-danger-soft text-danger";
  if (cover < minCover) return "bg-warn-soft text-warn";
  return "bg-ok-soft text-ok";
}

/** The stage-wave sentence, built from the model numbers (never hardcoded). */
function waveSentence(w: WaveInfo, startMonth: string, ru: boolean): string {
  const n = w.stage[1];
  if (!w.rising) {
    return ru
      ? `Ступень ${n}: выраженной волны нет — модель держит ≈${fmtN(w.nowPerMonth)}/мес на ближайшие месяцы.`
      : `Stage ${n}: no pronounced wave — the model holds ≈${fmtN(w.nowPerMonth)}/mo over the coming months.`;
  }
  const peakYearDiffers = w.peakMonth.slice(0, 4) !== startMonth.slice(0, 4);
  const by = ru ? mCase(w.peakMonth, RU_DAT, peakYearDiffers) : monthTitle(w.peakMonth, false);
  const growth = ru
    ? `модель ждёт рост с ${fmtN(w.nowPerMonth)} до ${fmtN(w.peakPerMonth)}/мес к ${by}`
    : `the model expects growth from ${fmtN(w.nowPerMonth)} to ${fmtN(w.peakPerMonth)}/mo by ${by}`;
  if (w.stage === "P1") {
    return ru
      ? `Волна 1-й ступени: новые наборы потребляют Platin 1 сразу — ${growth}.`
      : `Stage 1 wave: new recruits consume Platin 1 right away — ${growth}.`;
  }
  const crossYear = w.recruitFromMonth.slice(0, 4) !== w.recruitToMonth.slice(0, 4);
  const window = ru
    ? `${mCase(w.recruitFromMonth, RU_PREP, crossYear)}–${mCase(w.recruitToMonth, RU_PREP, crossYear)}`
    : `${monthTitle(w.recruitFromMonth, false)}–${monthTitle(w.recruitToMonth, false)}`;
  const move = w.stage === "P2"
    ? ru ? "переходят на Platin 2" : "move on to Platin 2"
    : ru ? "доходят до Platin 3" : "reach Platin 3";
  return ru
    ? `Волна ${n}-й ступени: младенцы, набранные в ${window}, ${move} — ${growth}.`
    : `Stage ${n} wave: babies recruited in ${window} ${move} — ${growth}.`;
}

/** «Рекомендуем 16 300: покрывает спрос до июня …» — facts only. */
function reasoning(c: DecisionCard, minCover: number, ru: boolean): string {
  const parts: string[] = [];
  if (c.rec.base > 0) {
    const until = c.coverUntilMonth
      ? ru ? `до ${mCase(c.coverUntilMonth, RU_GEN, true)}` : `until ${monthTitle(c.coverUntilMonth, false)}`
      : ru ? "до конца горизонта планирования" : "to the end of the planning horizon";
    parts.push(
      ru
        ? `Рекомендуем ${fmtN(c.rec.base)}: покрывает спрос ${until} при страховом запасе ${minCover} мес`
        : `Recommended ${fmtN(c.rec.base)}: covers demand ${until} with a ${minCover}-month safety floor`
    );
    if (c.nearArrivalUnits > 0 && c.firstArrivalMonth) {
      parts.push(
        ru
          ? `уже едет ${fmtN(c.nearArrivalUnits)} (${mCase(c.firstArrivalMonth, RU_NOM)})`
          : `${fmtN(c.nearArrivalUnits)} already en route (${monthTitle(c.firstArrivalMonth, false)})`
      );
    }
    parts.push(
      c.rec.conservative > 0
        ? ru
          ? `при консервативном сценарии хватит ${fmtN(c.rec.conservative)}`
          : `the conservative scenario needs only ${fmtN(c.rec.conservative)}`
        : ru
          ? "при консервативном сценарии заказ не обязателен"
          : "the conservative scenario needs no order"
    );
  } else {
    parts.push(
      ru
        ? `Заказ в этот слот не требуется: покрытие с учётом закупа ${c.coverWithAll.toFixed(1)} мес при минимуме ${minCover} мес`
        : `No order needed this slot: cover incl. committed purchases is ${c.coverWithAll.toFixed(1)} mo against the ${minCover}-mo floor`
    );
    if (c.rec.optimistic > 0) {
      parts.push(
        ru
          ? `при оптимистичном сценарии понадобилось бы ${fmtN(c.rec.optimistic)}`
          : `the optimistic scenario would need ${fmtN(c.rec.optimistic)}`
      );
    }
  }
  return parts.join("; ") + ".";
}

export default function DecisionsView({
  cards,
  dormant,
  table,
  baseTruck,
  slot,
  startMonth,
  settings,
  eurRate,
  recruitAvg3,
  packsPerBaby,
  isAdmin,
}: {
  cards: DecisionCard[];
  dormant: Array<{ skuId: string; name: string }>;
  table: DecisionRow[];
  baseTruck: TruckStats;
  slot: OrderSlot;
  startMonth: string;
  settings: PlanningSettings;
  eurRate: number;
  recruitAvg3: number;
  packsPerBaby: number;
  isAdmin: boolean;
}) {
  const { locale } = useT();
  const ru = locale === "ru";
  const router = useRouter();
  const [applying, setApplying] = useState(false);

  const [, shipM] = partsOf(slot.shipMonth);
  const slotLabel = `sales ${slot.shipMonth.slice(5)}-${slot.shipMonth.slice(0, 4)}`;
  const deadlineDay = Number(slot.deadline.slice(8));
  const deadlineStr = ru
    ? `${deadlineDay} ${mCase(slot.deadline.slice(0, 7), RU_GEN)}`
    : `${monthTitle(slot.deadline.slice(0, 7), false).split(" ")[0]} ${deadlineDay}`;

  const totals = table.reduce(
    (a, r) => ({
      conservative: a.conservative + r.conservative,
      base: a.base + r.base,
      optimistic: a.optimistic + r.optimistic,
      purchased: a.purchased + r.purchased,
    }),
    { conservative: 0, base: 0, optimistic: 0, purchased: 0 }
  );

  async function applyBase() {
    const msg = ru
      ? `Записать базовые количества в закуп на отгрузку «${monthTitle(slot.shipMonth, true)}»? Текущие строки закупа этого месяца будут заменены (нулевые — удалены).`
      : `Write the base quantities into the committed purchase for ship month ${monthTitle(slot.shipMonth, false)}? Existing lines for this month will be replaced (zeros removed).`;
    if (!confirm(msg)) return;
    setApplying(true);
    await fetch("/api/planning/purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shipMonth: slot.shipMonth,
        lines: table.map((r) => ({ skuId: r.skuId, qty: r.base })),
      }),
    });
    setApplying(false);
    router.refresh();
  }

  return (
    <div className="pb-16">
      <PageTitle
        title={ru ? "Решения" : "Decisions"}
        subtitle={
          ru
            ? `Что заказать и почему — ${RU_ADJ[shipM]} слот`
            : `What to order and why — the ${EN[shipM]} slot`
        }
      />
      <PlanningTabs />

      {/* slot hero — the navy decision band per the approved canvas */}
      <div className="mb-5 flex flex-wrap items-stretch gap-8 rounded-[14px] bg-sidebar p-6 text-sidebar-fg-strong">
        <div className="min-w-52">
          <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-sidebar-fg">
            {ru ? "Слот" : "Slot"} {slotLabel}
          </div>
          <div className="mt-1 font-display text-[25px] font-extrabold">{monthTitle(slot.shipMonth, ru)}</div>
          <div className="mt-1.5 text-[12px] text-sidebar-fg">
            {ru ? "дедлайн" : "deadline"} <span className="font-semibold text-sidebar-fg-strong">{deadlineStr}</span> ·{" "}
            <span className={`font-bold ${slot.daysLeft <= 3 ? "text-[#ffb85c]" : "text-sidebar-fg-strong"}`}>
              {slot.daysLeft === 0 ? (ru ? "сегодня" : "today") : `${slot.daysLeft} ${ru ? "дн." : "days"}`}
            </span>
          </div>
          <div className="mt-0.5 text-[12px] text-sidebar-fg">
            {ru ? "на складе" : "in warehouse"} ~{monthTitle(slot.arrivalMonth, ru)}
          </div>
        </div>
        <div className="min-w-0 flex-1 border-l border-white/15 pl-8">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[9.5px] uppercase tracking-[0.09em] text-sidebar-fg">
                  <th className="pb-1 text-left font-semibold">{ru ? "Товар" : "Product"}</th>
                  <th className="pb-1 text-right font-semibold">{ru ? "конс." : "cons."}</th>
                  <th className="pb-1 text-right font-semibold text-sidebar-fg-strong">{ru ? "база" : "base"}</th>
                  <th className="pb-1 text-right font-semibold">{ru ? "опт." : "opt."}</th>
                  <th className="pb-1 text-right font-semibold">{ru ? "в закупе" : "committed"}</th>
                </tr>
              </thead>
              <tbody>
                {table.map((r) => (
                  <tr key={r.skuId}>
                    <td className="py-0.5 pr-4 text-[#d9d7f2]">{r.name}</td>
                    <td className="num py-0.5 text-right text-[#8f8bcd]">{r.conservative > 0 ? fmtN(r.conservative) : "—"}</td>
                    <td className="num py-0.5 text-right text-[13.5px] font-bold">{r.base > 0 ? fmtN(r.base) : "—"}</td>
                    <td className="num py-0.5 text-right text-[#8f8bcd]">{r.optimistic > 0 ? fmtN(r.optimistic) : "—"}</td>
                    <td className={`num py-0.5 text-right ${r.purchased > 0 ? "" : "text-[#ffb85c]"}`}>
                      {r.purchased > 0 ? fmtN(r.purchased) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2.5 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-white/15 pt-2.5">
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-sidebar-fg">
              {ru ? "Итого, база" : "Total, base"}
            </span>
            <span className="num font-display text-[17px] font-extrabold">{fmtN(totals.base)} {ru ? "шт" : "pcs"}</span>
            <span className="num text-[12px] text-sidebar-fg">
              ≈ {baseTruck.pallets.toFixed(1)} {ru ? "паллет" : "pallets"} · {(baseTruck.pallets / settings.truckPallets).toFixed(1)}{" "}
              {ru ? "фуры" : "trucks"}
            </span>
            <span className="num text-[12px] text-sidebar-fg">
              €{fmtN(baseTruck.eurTotal)}
              {eurRate > 0 && ` (≈ ${fmtN(baseTruck.eurTotal * eurRate)} ${ru ? "сум" : "UZS"})`}
            </span>
          </div>
        </div>
        <div className="flex min-w-56 flex-col justify-center gap-2.5">
          {isAdmin && (
            <button
              type="button"
              onClick={() => void applyBase()}
              disabled={applying || totals.base <= 0}
              className="rounded-[9px] bg-white py-2.5 text-center text-[13px] font-bold text-accent transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {applying
                ? ru ? "Сохранение…" : "Saving…"
                : ru ? "Применить базовые в закуп" : "Apply base to purchase"}
            </button>
          )}
          <Link
            href="/planning/order"
            className="rounded-[9px] border border-white/30 py-2.5 text-center text-[12.5px] font-semibold text-white transition-colors hover:bg-white/10"
          >
            {ru ? "Собрать фуру" : "Build the truck"} →
          </Link>
        </div>
      </div>

      {/* per-SKU decision cards, worst first */}
      <div className="flex flex-col gap-4">
        {cards.map((c) => {
          const meta = statusMeta(c.status, ru);
          const spine =
            meta.tone === "danger" ? "border-l-danger" : meta.tone === "warn" ? "border-l-warn" : "border-l-ok";
          return (
            <Card key={c.skuId} className={`border-l-4 ${spine}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold">{c.name}</span>
                  {c.stage ? (
                    <Badge tone="accent">Platin {c.stage[1]}</Badge>
                  ) : (
                    <Badge>Expert</Badge>
                  )}
                </div>
                <Badge tone={meta.tone}>{meta.label}</Badge>
              </div>

              <div className="grid gap-x-10 gap-y-5 px-5 py-4 md:grid-cols-3">
                {/* положение */}
                <div>
                  <div className="label-caps mb-2">{ru ? "Положение" : "Position"}</div>
                  <div className="flex items-baseline gap-2">
                    <span className="num text-[17px] font-semibold">{fmtN(c.stock)}</span>
                    <span className="text-[12px] text-muted">
                      {ru ? "шт" : "pcs"}
                      {c.stockAsOf && ` (${monthTitle(c.stockAsOf, ru)})`}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${coverBadgeClass(
                        c.coverOnHand,
                        settings.minCoverMonths
                      )}`}
                    >
                      {c.coverOnHand.toFixed(1)} {ru ? "мес" : "mo"}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-[12.5px]">
                    <div
                      className="flex items-center gap-1.5"
                      title={
                        ru
                          ? `покрытие с учётом «едет»: ${c.coverWithNear.toFixed(1)} мес`
                          : `cover incl. en-route: ${c.coverWithNear.toFixed(1)} mo`
                      }
                    >
                      <IconTruck size={13} className="text-accent" />
                      <span className="text-muted">{ru ? "едет:" : "en route:"}</span>
                      {c.nearArrivalUnits > 0 && c.firstArrivalMonth ? (
                        <span className="num">
                          +{fmtN(c.nearArrivalUnits)}{" "}
                          <span className="text-muted">
                            ({ru ? mCase(c.firstArrivalMonth, RU_NOM) : monthTitle(c.firstArrivalMonth, false)})
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </div>
                    <div
                      title={
                        ru
                          ? `покрытие со всем закупом: ${c.coverWithAll.toFixed(1)} мес`
                          : `cover incl. all committed: ${c.coverWithAll.toFixed(1)} mo`
                      }
                    >
                      <span className="text-muted">{ru ? "закуп впереди:" : "committed ahead:"}</span>{" "}
                      {c.laterArrivalUnits > 0 ? (
                        <span className="num">
                          +{fmtN(c.laterArrivalUnits)}
                          {c.nearArrivalUnits <= 0 && c.firstArrivalMonth && (
                            <span className="text-muted">
                              {" "}({ru ? `с ${mCase(c.firstArrivalMonth, RU_GEN)}` : `from ${monthTitle(c.firstArrivalMonth, false)}`})
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </div>
                    <div>
                      <span className="text-muted">{ru ? "первый разрыв:" : "first gap:"}</span>{" "}
                      {c.stockoutMonth ? (
                        <span className="font-medium text-danger">{monthTitle(c.stockoutMonth, ru)}</span>
                      ) : (
                        <span className="text-ok">{ru ? "не ожидается" : "not expected"}</span>
                      )}
                    </div>
                    {c.stockoutMonth ? (
                      c.fixable ? (
                        <div className="flex items-center gap-1.5 text-ok">
                          <IconCheck size={13} />
                          {ru
                            ? `Разрыв закрывается этим слотом — приход в ${mCase(slot.arrivalMonth, RU_PREP, true)}`
                            : `This slot closes the gap — arrival in ${monthTitle(slot.arrivalMonth, false)}`}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 font-medium text-danger">
                          <IconAlert size={13} />
                          {ru
                            ? "Разрыв до прихода — заказом уже не закрыть"
                            : "The gap lands before the arrival — this order cannot close it"}
                        </div>
                      )
                    ) : (
                      <div className="flex items-center gap-1.5 text-ok">
                        <IconCheck size={13} />
                        {ru ? "Разрывов на горизонте нет" : "No gaps on the horizon"}
                      </div>
                    )}
                  </div>
                </div>

                {/* спрос */}
                <div>
                  <div className="label-caps mb-2">{ru ? "Спрос" : "Demand"}</div>
                  <div className="space-y-1 text-[12.5px]">
                    <div>
                      <span className="text-muted">{ru ? "ср. продажи 3м:" : "avg sales 3m:"}</span>{" "}
                      <span className="num">{fmtN(c.runRate3m)}</span>
                      <span className="text-muted">/{ru ? "мес" : "mo"}</span>
                    </div>
                    <div>
                      <span className="text-muted">{ru ? "модель на 3 мес:" : "model next 3 mo:"}</span>{" "}
                      <span className="num font-medium">{fmtN(c.model3m)}</span>
                      <span className="text-muted">/{ru ? "мес" : "mo"}</span>
                      {c.modelVsRunRate !== null && Math.abs(c.modelVsRunRate) >= 0.01 && (
                        <span className={`ml-1 num text-[11.5px] font-semibold ${c.modelVsRunRate > 0 ? "text-accent" : "text-muted"}`}>
                          {c.modelVsRunRate > 0 ? "+" : ""}
                          {(c.modelVsRunRate * 100).toFixed(0)}% vs run-rate
                        </span>
                      )}
                    </div>
                    {c.forecastAvg !== null && (
                      <div>
                        <span className="text-muted">{ru ? "ваш прогноз в IBP:" : "your IBP forecast:"}</span>{" "}
                        <span className="num">{fmtN(c.forecastAvg)}</span>
                        <span className="text-muted">/{ru ? "мес" : "mo"}</span>
                        {c.forecastVsModel !== null && Math.abs(c.forecastVsModel) > 0.25 && (
                          <span className="ml-1 inline-flex items-center gap-1 text-[11.5px] font-medium text-warn">
                            <IconAlert size={12} />
                            {ru
                              ? `прогноз отличается от модели на ${c.forecastVsModel > 0 ? "+" : ""}${(c.forecastVsModel * 100).toFixed(0)}%`
                              : `forecast differs from the model by ${c.forecastVsModel > 0 ? "+" : ""}${(c.forecastVsModel * 100).toFixed(0)}%`}
                          </span>
                        )}
                      </div>
                    )}
                    {c.wave && (
                      <p className="pt-1 leading-snug text-muted">{waveSentence(c.wave, startMonth, ru)}</p>
                    )}
                  </div>
                </div>

                {/* решение */}
                <div>
                  <div className="label-caps mb-2">{ru ? "Решение" : "Decision"}</div>
                  <div className="flex items-end gap-5">
                    <div>
                      <div className="text-[10.5px] uppercase tracking-wide text-muted">{ru ? "конс." : "cons."}</div>
                      <div className="num text-[14px] text-muted">{c.rec.conservative > 0 ? fmtN(c.rec.conservative) : "—"}</div>
                    </div>
                    <div>
                      <div className="text-[10.5px] uppercase tracking-wide text-accent">{ru ? "базово" : "base"}</div>
                      <div className="num font-display text-[22px] font-bold text-accent">
                        {c.rec.base > 0 ? fmtN(c.rec.base) : "0"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10.5px] uppercase tracking-wide text-muted">{ru ? "оптим." : "opt."}</div>
                      <div className="num text-[14px] text-muted">{c.rec.optimistic > 0 ? fmtN(c.rec.optimistic) : "—"}</div>
                    </div>
                  </div>
                  <p className="mt-2 text-[12.5px] leading-snug text-muted">
                    {reasoning(c, settings.minCoverMonths, ru)}
                  </p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* footnote: dormant list + model sources */}
      <div className="mt-5 space-y-1 text-[12px] leading-snug text-muted">
        {dormant.length > 0 && (
          <p>
            {ru ? "Не активны (нет стока и спроса):" : "Dormant (no stock, no demand):"}{" "}
            {dormant.map((d) => d.name).join(", ")}.
          </p>
        )}
        <p>
          {ru
            ? `Модель: ${fmtN(recruitAvg3)} подтверждённых рецептов/мес × удержание × ${packsPerBaby} банки; калибровка по факту продаж за 3 мес. Приоритет спроса: ручной прогноз → модель → run-rate.`
            : `Model: ${fmtN(recruitAvg3)} verified prescriptions/mo × retention × ${packsPerBaby} packs; calibrated on the last 3 months of actual sales. Demand priority: manual forecast → model → run-rate.`}
        </p>
      </div>
    </div>
  );
}
