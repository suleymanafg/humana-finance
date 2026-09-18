"use client";

// «Решения» — the section's landing screen, built to the owner's design canvas
// (Claude Design, "Supply Planning Section", 2026-09-18):
//   deadline hero · three scenario tiles with one-click «принять базовый»
//   · products ranked worst-first, each stated as one readable chain
//     (position → demand over the lead time → decision)
//   · the recruitment-wave card.
// All the math arrives precomputed from the server page; this component only
// renders it and composes the bilingual sentences.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { addMonths } from "@/lib/planning/compute";
import { dstr, monthLong, monthShort, pCover, pn, splitPack } from "@/lib/planning/ui-format";
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
  demandPerMonth: number; // the figure the projection actually consumes
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

// ── russian month grammar (the wave sentence needs several cases) ──
const RU_NOM = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const RU_PREP = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];
const RU_DAT = ["январю", "февралю", "марту", "апрелю", "маю", "июню", "июлю", "августу", "сентябрю", "октябрю", "ноябрю", "декабрю"];
const EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const partsOf = (key: string): [number, number] => {
  const [y, m] = key.split("-").map(Number);
  return [y, m - 1];
};
const monthTitle = (key: string, ru: boolean): string => {
  const [y, m] = partsOf(key);
  const name = ru ? RU_NOM[m] : EN[m];
  return `${name[0].toUpperCase()}${name.slice(1)} ${y}`;
};
const mCase = (key: string, list: string[], withYear = false): string => {
  const [y, m] = partsOf(key);
  return withYear ? `${list[m]} ${y}` : list[m];
};

/** The severity ladder, colours and wording exactly as drawn on the canvas. */
function severity(s: DecisionStatus, ru: boolean): { label: string; ink: string; bg: string } {
  switch (s) {
    case "stockout":
      return { label: ru ? "закончится" : "will run out", ink: "var(--danger)", bg: "var(--danger-soft)" };
    case "critical":
      return { label: ru ? "критично" : "critical", ink: "var(--danger)", bg: "var(--danger-soft)" };
    case "gap":
      return { label: ru ? "дефицит" : "gap", ink: "var(--warn-ink)", bg: "var(--warn-soft)" };
    case "reorder":
      return { label: ru ? "пора заказывать" : "time to reorder", ink: "var(--warn-ink)", bg: "var(--warn-soft)" };
    case "overstock":
      return { label: ru ? "избыток" : "overstocked", ink: "var(--info)", bg: "var(--info-soft)" };
    case "ok":
      return { label: ru ? "норма" : "fine", ink: "var(--ok)", bg: "var(--ok-soft)" };
  }
}
/** The spine / cover colour — the pill ink, except «норма» reads calmer. */
const spineOf = (s: DecisionStatus) => severity(s, true).ink;

/** The stage-wave sentence, built from the model numbers (never hardcoded). */
function waveSentence(w: WaveInfo, startMonth: string, ru: boolean): string {
  const n = w.stage[1];
  if (!w.rising) {
    return ru
      ? `Ступень ${n}: выраженной волны нет — модель держит ≈${pn(w.nowPerMonth)}/мес на ближайшие месяцы.`
      : `Stage ${n}: no pronounced wave — the model holds ≈${pn(w.nowPerMonth)}/mo over the coming months.`;
  }
  const peakYearDiffers = w.peakMonth.slice(0, 4) !== startMonth.slice(0, 4);
  const by = ru ? mCase(w.peakMonth, RU_DAT, peakYearDiffers) : monthTitle(w.peakMonth, false);
  const growth = ru
    ? `модель ждёт рост с ${pn(w.nowPerMonth)} до ${pn(w.peakPerMonth)}/мес к ${by}`
    : `the model expects growth from ${pn(w.nowPerMonth)} to ${pn(w.peakPerMonth)}/mo by ${by}`;
  if (w.stage === "P1") {
    return ru
      ? `Волна 1-й ступени: новые наборы потребляют Platin 1 сразу — ${growth}.`
      : `Stage 1 wave: new recruits consume Platin 1 right away — ${growth}.`;
  }
  const crossYear = w.recruitFromMonth.slice(0, 4) !== w.recruitToMonth.slice(0, 4);
  const window = ru
    ? `${mCase(w.recruitFromMonth, RU_PREP, crossYear)}–${mCase(w.recruitToMonth, RU_PREP, crossYear)}`
    : `${monthTitle(w.recruitFromMonth, false)}–${monthTitle(w.recruitToMonth, false)}`;
  const move =
    w.stage === "P2"
      ? ru ? "переходят на Platin 2" : "move on to Platin 2"
      : ru ? "доходят до Platin 3" : "reach Platin 3";
  return ru
    ? `Волна ${n}-й ступени: младенцы, набранные в ${window}, ${move} — ${growth}.`
    : `Stage ${n} wave: babies recruited in ${window} ${move} — ${growth}.`;
}

/**
 * One product's position → demand → decision, as a single sentence.
 * Every number in it is displayed, so the arithmetic can be followed:
 * stock + pipeline − demand over the lead time = what is left when the order lands.
 */
function chain(c: DecisionCard, slot: OrderSlot, leadMonths: number, ru: boolean): string {
  const pipeline = c.nearArrivalUnits + c.laterArrivalUnits;
  const consumed = c.demandPerMonth * leadMonths;
  const left = Math.round(c.stock + pipeline - consumed);

  const position = ru
    ? `${pn(c.stock)} на складе${pipeline > 0 ? ` + ${pn(pipeline)} в пути` : ""} − ${pn(consumed)} спроса за ${leadMonths} мес. поставки`
    : `${pn(c.stock)} on hand${pipeline > 0 ? ` + ${pn(pipeline)} in transit` : ""} − ${pn(consumed)} of demand over the ${leadMonths}-month lead`;

  const outcome =
    left > 0
      ? ru
        ? `останется ≈${pn(left)} к приходу`
        : `≈${pn(left)} left when it lands`
      : c.stockoutMonth
        ? ru
          ? `ноль с ${mCase(c.stockoutMonth, RU_NOM, true)}`
          : `out of stock from ${monthTitle(c.stockoutMonth, false)}`
        : ru
          ? "запас исчерпан"
          : "stock exhausted";

  const decision =
    c.rec.base > 0
      ? ru
        ? `заказать ${pn(c.rec.base)} до ${dstr(slot.deadline)}`
        : `order ${pn(c.rec.base)} by ${dstr(slot.deadline)}`
      : c.purchasedAtSlot > 0
        ? ru
          ? `${pn(c.purchasedAtSlot)} уже в закупе на этот дедлайн`
          : `${pn(c.purchasedAtSlot)} already committed for this deadline`
        : ru
          ? "в этот дедлайн заказ не нужен"
          : "no order needed this deadline";

  return `${position} → ${outcome} → ${decision}`;
}

export default function DecisionsView({
  cards,
  dormant,
  table,
  baseTruck,
  trucks,
  slot,
  startMonth,
  settings,
  eurRate,
  recruitment,
  recruitAvg3,
  packsPerBaby,
  isAdmin,
}: {
  cards: DecisionCard[];
  dormant: Array<{ skuId: string; name: string }>;
  table: DecisionRow[];
  baseTruck: TruckStats;
  trucks: { conservative: TruckStats; base: TruckStats; optimistic: TruckStats };
  slot: OrderSlot;
  startMonth: string;
  settings: PlanningSettings;
  eurRate: number;
  recruitment: Record<string, number>;
  recruitAvg3: number;
  packsPerBaby: number;
  isAdmin: boolean;
}) {
  const { locale } = useT();
  const ru = locale === "ru";
  const router = useRouter();
  const [applying, setApplying] = useState(false);

  // months from today until the order is on the shelf — what the chain spends
  const leadMonths = Math.max(
    1,
    Math.round(
      (Number(slot.arrivalMonth.slice(0, 4)) * 12 + Number(slot.arrivalMonth.slice(5))) -
        (Number(startMonth.slice(0, 4)) * 12 + Number(startMonth.slice(5)))
    )
  );

  const totals = table.reduce(
    (a, r) => ({
      conservative: a.conservative + r.conservative,
      base: a.base + r.base,
      optimistic: a.optimistic + r.optimistic,
      purchased: a.purchased + r.purchased,
    }),
    { conservative: 0, base: 0, optimistic: 0, purchased: 0 }
  );

  const scenarios = [
    {
      key: "conservative" as const,
      name: ru ? "Консервативный" : "Conservative",
      units: totals.conservative,
      truck: trucks.conservative,
      note: ru ? "Только по факту продаж, без модели." : "Run-rate only, model ignored.",
      lead: false,
    },
    {
      key: "base" as const,
      name: ru ? "Базовый" : "Base",
      units: totals.base,
      truck: trucks.base,
      note: ru ? "Текущая модель и набор сохраняются." : "Current model and recruitment hold.",
      lead: true,
    },
    {
      key: "optimistic" as const,
      name: ru ? "Оптимистичный" : "Optimistic",
      units: totals.optimistic,
      truck: trucks.optimistic,
      note: ru ? "Удержание выше, набор продолжает расти." : "Retention higher, recruitment keeps growing.",
      lead: false,
    },
  ];

  // recruitment: what was entered, then the trailing average carried forward
  const wave = (() => {
    const past = Object.keys(recruitment)
      .filter((m) => m <= startMonth && recruitment[m] > 0)
      .sort()
      .slice(-6)
      .map((m) => ({ month: m, qty: recruitment[m], forecast: false }));
    const ahead = [1, 2, 3].map((i) => ({
      month: addMonths(startMonth, i),
      qty: recruitAvg3,
      forecast: true,
    }));
    const bars = [...past, ...ahead];
    const max = Math.max(1, ...bars.map((b) => b.qty));
    return { bars, max };
  })();

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
    <div>
      <div className="mb-3.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[22px] font-extrabold tracking-[-0.5px]">{ru ? "Решения" : "Decisions"}</h1>
        <p className="text-[13px] font-semibold text-muted">
          {ru ? "Что требует внимания сейчас и что делать?" : "What needs attention now, and what should I do?"}
        </p>
      </div>

      {/* deadline hero + the three scenarios */}
      <div className="grid gap-3.5 lg:grid-cols-3">
        <div className="rounded-[14px] px-5 py-[18px] text-white" style={{ background: "var(--accent)" }}>
          <div className="text-[10.5px] font-extrabold uppercase tracking-[0.08em] opacity-80">
            {ru ? "Следующий заказ в IBP" : "Next IBP order"}
          </div>
          <div className="pnum mt-1.5 text-[30px] font-extrabold tracking-[-1px]">{dstr(slot.deadline)}</div>
          <div className="mt-0.5 text-[13.5px] font-bold opacity-90">
            {slot.daysLeft === 0
              ? ru ? "сегодня последний день" : "today is the last day"
              : ru ? `осталось ${slot.daysLeft} дн.` : `${slot.daysLeft} days left`}
          </div>
          <div className="my-3 h-px" style={{ background: "rgba(255,255,255,0.22)" }} />
          <div className="text-[12.5px] font-semibold leading-relaxed opacity-90">
            {ru ? "Этот заказ уходит отгрузкой " : "This order ships in "}
            <b>{monthLong(slot.shipMonth, ru)}</b>
            {ru ? ", на складе с " : ", in the warehouse from "}
            <b>{monthLong(slot.arrivalMonth, ru)}</b>.
          </div>
        </div>

        <div className="pcard px-5 py-4 lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[14px] font-extrabold">{ru ? "Рекомендуемый объём заказа" : "Recommended order quantity"}</h2>
            <span className="text-[11.5px] font-semibold text-muted">
              {ru ? "Три сценария спроса на этот дедлайн" : "Three demand scenarios for this deadline"}
            </span>
          </div>

          <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
            {scenarios.map((s) => (
              <div
                key={s.key}
                className="rounded-[11px] border px-3 py-3"
                style={{
                  borderColor: s.lead ? "var(--accent)" : "var(--border)",
                  background: s.lead ? "var(--accent-soft-bg)" : "var(--surface)",
                }}
              >
                <div
                  className="text-[11px] font-extrabold uppercase tracking-[0.05em]"
                  style={{ color: s.lead ? "var(--accent)" : "var(--muted)" }}
                >
                  {s.name}
                </div>
                <div className="pnum mt-1.5 text-[20px] font-bold tracking-[-0.8px]">{pn(s.units)}</div>
                <div className="mt-0.5 text-[11.5px] font-semibold text-muted">
                  {(s.truck.pallets / settings.truckPallets).toFixed(1)} {ru ? "фур" : "trucks"} ·{" "}
                  {s.truck.pallets.toFixed(1)} {ru ? "паллет" : "pallets"}
                </div>
                <div className="mt-1.5 text-[11.5px] font-semibold leading-snug text-muted">{s.note}</div>
              </div>
            ))}
          </div>

          <div className="mt-3.5 flex flex-wrap items-center gap-3">
            {isAdmin && (
              <button
                type="button"
                onClick={() => void applyBase()}
                disabled={applying || totals.base <= 0}
                className="rounded-[9px] px-4 py-2.5 text-[13px] font-extrabold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "var(--accent)" }}
              >
                {applying
                  ? ru ? "Сохранение…" : "Saving…"
                  : ru ? "Принять базовый сценарий →" : "Accept base scenario →"}
              </button>
            )}
            <span className="text-[12px] font-semibold text-muted">
              {ru
                ? "Перенесёт количества в «Заказ», где их можно поправить."
                : "Carries the quantities into Order, where you can adjust them."}
            </span>
            <span className="pnum text-[12px] font-semibold text-muted">
              €{pn(baseTruck.eurTotal)}
              {eurRate > 0 && ` ≈ ${pn(baseTruck.eurTotal * eurRate)} ${ru ? "сум" : "UZS"}`}
            </span>
          </div>
        </div>
      </div>

      {/* ranked products + the recruitment wave */}
      <div className="mt-4 flex flex-wrap items-start gap-3.5">
        <div className="pcard min-w-0 flex-[1_1_640px] overflow-hidden">
          <div className="flex flex-wrap items-baseline gap-3 border-b px-5 py-3" style={{ borderColor: "var(--hair)" }}>
            <h2 className="text-[14px] font-extrabold">{ru ? "Продукты по остроте" : "Products by severity"}</h2>
            <span className="text-[11.5px] font-semibold text-muted">
              {ru ? `Худшие сверху · ${cards.length} активных` : `Worst first · ${cards.length} active`}
            </span>
          </div>

          {cards.map((c) => {
            const sev = severity(c.status, ru);
            const { name, pack } = splitPack(c.name);
            return (
              <div
                key={c.skuId}
                className="flex flex-wrap items-start gap-4 border-b px-5 py-3"
                style={{ borderColor: "var(--hair-soft)" }}
              >
                <div
                  className="min-h-[34px] w-1 shrink-0 self-stretch rounded-[3px]"
                  style={{ background: spineOf(c.status) }}
                />
                <div className="min-w-0 flex-[1_1_260px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-extrabold tracking-[-0.2px]">{name}</span>
                    {pack && <span className="text-[11px] font-bold" style={{ color: "var(--sky)" }}>{pack}</span>}
                    <span className="ppill" style={{ background: sev.bg, color: sev.ink }}>
                      {sev.label}
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] font-semibold leading-relaxed" style={{ color: "#3f4e63" }}>
                    {chain(c, slot, leadMonths, ru)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div
                    className="pnum text-[17px] font-bold tracking-[-0.5px]"
                    style={{ color: spineOf(c.status) }}
                  >
                    {pCover(c.coverWithAll)}
                  </div>
                  <div
                    className="text-[10.5px] font-bold uppercase tracking-[0.05em]"
                    style={{ color: "var(--faint)" }}
                  >
                    {ru ? "мес. покрытия" : "months of cover"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-[12px] font-bold">
                  <Link href="/planning/inventory" className="text-accent hover:underline">
                    {ru ? "Запасы" : "Inventory"}
                  </Link>
                  <span style={{ color: "var(--border-strong)" }}>·</span>
                  <Link href="/planning/order" className="text-accent hover:underline">
                    {ru ? "Заказ" : "Order"}
                  </Link>
                </div>
              </div>
            );
          })}

          {dormant.length > 0 && (
            <div className="px-5 py-3 text-[11.5px] font-semibold text-muted">
              {ru ? "Без движения: " : "Dormant: "}
              {dormant.map((d) => d.name).join(", ")}
            </div>
          )}
        </div>

        <div className="pcard flex-[0_1_320px] px-[18px] py-4" style={{ minWidth: 280 }}>
          <h2 className="text-[13.5px] font-extrabold">{ru ? "Волна набора" : "Recruitment wave"}</h2>
          <p className="mt-1 text-[12px] font-semibold leading-snug text-muted">
            {ru
              ? `Проверенный рецепт = 1 ребёнок ≈ ${packsPerBaby} упак./мес., удержание падает со временем.`
              : `A verified prescription = 1 baby ≈ ${packsPerBaby} packs/mo., retention decays over time.`}
          </p>

          <div className="mt-3.5 flex h-[76px] items-end gap-1">
            {wave.bars.map((b) => (
              <div key={b.month} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t-[3px]"
                  style={{
                    height: `${Math.max(8, Math.round((b.qty / wave.max) * 100))}%`,
                    background: b.forecast ? "var(--accent)" : "var(--info-border)",
                  }}
                  title={`${monthLong(b.month, ru)}: ${pn(b.qty)}`}
                />
                <span className="text-[9.5px] font-bold" style={{ color: "var(--faint)" }}>
                  {monthShort(b.month, ru)}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-2.5 flex gap-3.5">
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted">
              <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--info-border)" }} />
              {ru ? "факт" : "actual"}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted">
              <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--accent)" }} />
              {ru ? "прогноз" : "forecast"}
            </span>
          </div>

          <div
            className="mt-3.5 rounded-[10px] border px-3 py-2.5"
            style={{ background: "var(--accent-soft-bg)", borderColor: "var(--accent-soft)" }}
          >
            <div className="pnum text-[18px] font-bold" style={{ color: "var(--accent)" }}>
              {pn(recruitAvg3)}
            </div>
            <div className="mt-0.5 text-[11.5px] font-bold" style={{ color: "#0b3a73" }}>
              {ru ? "детей в месяц (среднее за 3 мес.)" : "babies per month (3-month average)"}
            </div>
            {cards.find((c) => c.wave)?.wave && (
              <p className="mt-1.5 text-[11.5px] font-semibold leading-snug" style={{ color: "#3f4e63" }}>
                {waveSentence(cards.find((c) => c.wave)!.wave!, startMonth, ru)}
              </p>
            )}
          </div>

          <Link href="/planning/scenarios" className="mt-3 inline-block text-[12px] font-bold text-accent hover:underline">
            {ru ? "Открыть «Сценарии» →" : "Open Scenarios →"}
          </Link>
        </div>
      </div>
    </div>
  );
}
