"use client";

// «Капитал» — the budget for shareholders: how much capital the business needs
// and when, where the sum comes from, what 2027 earns, and what changes the
// answer. Every figure opens into how it is made and where its parts come from.
// The model runs here in the browser, so the what-if sliders recompute the
// whole page at once; with the sliders at zero it is the app's estimate.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/locale-context";
import { fmtN } from "@/lib/format";
import { shortMonth } from "@/lib/statement-ui";
import { runBudget, yearIndexes, total, type BudgetInputs, type BudgetSupply } from "@/lib/budget/model";
import { capitalAnswer } from "@/lib/budget/capital";
import { applyScenario, type Scenario } from "@/lib/budget/scenario";

export interface CapitalViewProps {
  asOf: string;
  lastClosed: string | null;
  inputs: BudgetInputs;
  supply: BudgetSupply | null;
  alreadyIn: number;
  original: { ask: number; net2027: number };
  isAdmin: boolean;
}

type Bi = { ru: string; en: string };
type Src = { href: string; label: Bi };

function Source({ href, label }: Src) {
  const { l } = useT();
  return (
    <Link href={href} className="ml-1 whitespace-nowrap rounded bg-surface-low px-1.5 py-0.5 text-[11px] font-medium text-accent hover:underline">
      {l(label)} →
    </Link>
  );
}

function Row({ label, value, strong, src, indent }: { label: Bi; value: string; strong?: boolean; src?: Src; indent?: boolean }) {
  const { l } = useT();
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${strong ? "border-t border-border font-semibold" : ""}`}>
      <span className={indent ? "pl-4 text-muted" : ""}>
        {l(label)}
        {src && <Source {...src} />}
      </span>
      <span className="figure-num whitespace-nowrap">{value}</span>
    </div>
  );
}

function Kpi({ active, onToggle, label, value, sub, d }: { active: boolean; onToggle: () => void; label: Bi; value: string; sub: string; d?: React.ReactNode }) {
  const { l } = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`min-w-0 rounded-xl border bg-surface px-5 py-4 text-left transition-colors hover:border-accent ${active ? "border-accent ring-1 ring-accent" : "border-border"}`}
    >
      <div className="text-[12.5px] text-muted">{l(label)}</div>
      <div className="figure-num mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.02em]">
        {value}
        {d}
      </div>
      <div className="mt-2 text-[12.5px] text-muted">{sub}</div>
      <div className="mt-2 text-[11.5px] font-medium text-accent">{active ? l({ ru: "Скрыть расчёт", en: "Hide" }) : l({ ru: "Как получено →", en: "How it's made →" })}</div>
    </button>
  );
}

function Slider({ label, value, min, max, step, fmt, active, onChange }: { label: Bi; value: number; min: number; max: number; step: number; fmt: (v: number) => string; active: boolean; onChange: (v: number) => void }) {
  const { l } = useT();
  return (
    <label className="block">
      <div className="flex items-baseline justify-between text-[13px]">
        <span>{l(label)}</span>
        <span className={`figure-num font-semibold ${active ? "text-accent" : ""}`}>{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1.5 w-full accent-[var(--accent)]" />
    </label>
  );
}


function compute(inputs: BudgetInputs, supply: BudgetSupply | undefined) {
  const run = runBudget(inputs, { supply });
  const cap = capitalAnswer(run, inputs);
  return { run, cap };
}

export default function CapitalView({ asOf, lastClosed, inputs, supply, alreadyIn, original, isAdmin }: CapitalViewProps) {
  const { locale, l } = useT();
  const ru = locale === "ru";
  const base: Scenario = { sales: 0, price: 0, fx: 0, days: 0, reserve: inputs.reserveMonths };
  const [s, setS] = useState<Scenario>(base);
  const changed = JSON.stringify(s) !== JSON.stringify(base);
  const baseCalc = useMemo(() => compute(inputs, supply ?? undefined), [inputs, supply]);
  const calc = useMemo(() => {
    const a = applyScenario(inputs, supply, s);
    return compute(a.inputs, a.supply);
  }, [inputs, supply, s]);
  const { run, cap } = calc;
  const H = run.months.length;
  const [open, setOpen] = useState<null | "ask" | "tight" | "revenue" | "profit">(null);
  const [month, setMonth] = useState<number>(() => Math.max(0, run.months.indexOf(cap.worstMonth)));

  // ── formatting ──
  const bn = (v: number | null | undefined, d = 2) => (v == null ? "—" : `${(v / 1e9).toFixed(d).replace(".", ru ? "," : ".")}`);
  const bnT = (v: number | null | undefined, d = 2) => `${bn(v, d)} ${ru ? "млрд" : "bn"}`;
  const pct = (v: number, d = 1) => `${(v * 100).toFixed(d).replace(".", ru ? "," : ".")}%`;
  const units = (v: number) => fmtN(v).replace(/,/g, " ");
  const m = (id: string) => shortMonth(id, locale);
  const mLong = (id: string) => {
    const [y, mm] = id.split("-").map(Number);
    return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString(ru ? "ru-RU" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  };
  const dstr = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

  // ── the answer ──
  const ask = Math.max(0, cap.ask - alreadyIn);
  const baseAsk = Math.max(0, baseCalc.cap.ask - alreadyIn);
  const bringMonths = run.months.map((mo, i) => ({ mo, i, v: cap.monthly.bringIn[i] })).filter((x) => x.v > 1e6);
  const worst = Math.max(0, run.months.indexOf(cap.worstMonth));
  const y27 = cap.years.find((y) => y.year === 2027);
  const idx27 = yearIndexes(run, 2027);
  const sum27 = (line: number[]) => total(line, idx27);
  const units27 = sum27(run.sales.marketUnits);
  const atList27 = sum27(run.sales.marketAtList);
  const net27 = y27?.netRevenue ?? 0;
  const trucks27 = sum27(run.stock.trucks);
  const paidHq27 = -sum27(run.cash.paidHq);

  const delta = (a: number, b: number) => {
    const d = a - b;
    if (Math.abs(d) < 5e6) return null;
    return <span className={`ml-1.5 text-[12px] font-medium ${d > 0 ? "text-danger" : "text-ok"}`}>{d > 0 ? "+" : "−"}{bn(Math.abs(d))}</span>;
  };
  const deltaGood = (a: number, b: number) => {
    const d = a - b;
    if (Math.abs(d) < 5e6) return null;
    return <span className={`ml-1.5 text-[12px] font-medium ${d > 0 ? "text-ok" : "text-danger"}`}>{d > 0 ? "+" : "−"}{bn(Math.abs(d))}</span>;
  };

  // ── pieces ──
  const SRC = {
    demand: { href: "/planning/demand", label: { ru: "Спрос", en: "Demand" } },
    orders: { href: "/planning/orders", label: { ru: "План поставок", en: "Supply plan" } },
    inputs: { href: "/budget/inputs", label: { ru: "Допущения", en: "Assumptions" } },
    books: { href: "/statements/balance", label: { ru: "Учёт", en: "The books" } },
    statements: { href: "/budget/statements?view=cash", label: { ru: "Движение денег", en: "Cash flow" } },
    pnl: { href: "/budget/statements", label: { ru: "ОПиУ по месяцам", en: "P&L by month" } },
  } satisfies Record<string, { href: string; label: Bi }>;

  // the month's money, line by line
  const flow = (i: number) => {
    const c = run.cash;
    return [
      { label: { ru: "Деньги на начало месяца", en: "Cash at the start of the month" }, v: c.open[i], strong: true },
      { label: { ru: "+ Получено от покупателей", en: "+ Collected from customers" }, v: c.collected[i] },
      { label: { ru: "+ Fargo платит TI", en: "+ Fargo pays TI" }, v: c.fargoPaid[i] },
      { label: { ru: "− Оплата товара Humana HQ", en: "− Goods paid to Humana HQ" }, v: c.paidHq[i], src: SRC.orders },
      { label: { ru: "− Импорт: доставка, таможня, НДС", en: "− Import: freight, customs, VAT" }, v: c.importCosts[i] + c.importVat[i] },
      { label: { ru: "− Операционные расходы", en: "− Operating costs" }, v: c.opex[i], src: SRC.inputs },
      { label: { ru: "− НДС и налог на прибыль", en: "− VAT and profit tax" }, v: c.vatPaid[i] + c.taxPaid[i] },
      { label: { ru: "± Займы и прочее", en: "± Loans and other" }, v: c.loans[i] + c.priorOwnerPaid[i] },
      { label: { ru: "Деньги на конец месяца (без нового капитала)", en: "Cash at month end (no new capital)" }, v: cap.monthly.cashWithoutNew[i], strong: true },
      { label: { ru: "Минимальный остаток", en: "Minimum cash to keep" }, v: cap.monthly.reserve[i] },
    ].filter((x) => x.strong || Math.abs(x.v) >= 5e6);
  };

  // ── chart: cash without new capital vs the minimum, and capital to bring in ──
  const W = 900;
  const CH = 250;
  const padL = 46;
  const padR = 10;
  const padT = 14;
  const padB = 28;
  const cashLine = cap.monthly.cashWithoutNew;
  const reserveLine = cap.monthly.reserve;
  const bars = cap.monthly.bringIn;
  const hi = Math.max(0, ...cashLine, ...reserveLine, ...bars);
  const lo = Math.min(0, ...cashLine);
  const span = hi - lo || 1;
  const yv = (v: number) => padT + ((hi - v) / span) * (CH - padT - padB);
  const colW = (W - padL - padR) / H;
  const xc = (i: number) => padL + colW * (i + 0.5);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${xc(i).toFixed(1)},${yv(v).toFixed(1)}`).join(" ");
  const ticks = (() => {
    const step = Math.pow(10, Math.floor(Math.log10(span / 4)));
    const nice = [1, 2, 2.5, 5, 10].map((k) => k * step).find((k) => span / k <= 6) ?? step * 10;
    const out: number[] = [];
    for (let t = Math.ceil(lo / nice) * nice; t <= hi + 1; t += nice) out.push(t);
    return out;
  })();

  // ── where the money is tied up at the tightest month ──
  const b = cap.bridge;
  const tied = [
    { label: { ru: "Товар на складе TI", en: "Stock in TI's warehouse" }, v: cap.monthly.stock[worst], src: SRC.orders },
    { label: { ru: "Оплачено HQ, товар в пути", en: "Paid to HQ, goods on the way" }, v: cap.monthly.transit[worst], src: SRC.orders },
    { label: { ru: "Долг покупателей", en: "What customers owe" }, v: cap.monthly.customersOwe[worst], src: SRC.inputs },
    { label: { ru: "У Fargo (товар и долг)", en: "With Fargo (stock and debt)" }, v: cap.monthly.withFargo[worst], src: SRC.books },
    { label: { ru: "Минимальный остаток денег", en: "Minimum cash to keep" }, v: cap.monthly.reserve[worst], src: SRC.inputs },
  ];
  const covered = [
    { label: { ru: "Собственные средства на 30.09.2026", en: "Own funds on 30 Sep 2026" }, v: -b.ownFunds, src: SRC.books },
    { label: { ru: "Прибыль с октября 2026", en: "Profit since October 2026" }, v: -b.profit, src: SRC.pnl },
    { label: { ru: "Неоплаченные налоги, займы и счета", en: "Taxes, loans and bills not yet paid" }, v: -b.unpaid, src: SRC.books },
  ];
  const tiedMax = Math.max(b.needed, 1);

  // ── 2027 P&L ──
  const pnl27 = [
    { label: { ru: "Чистая выручка", en: "Net revenue" }, v: sum27(run.pnl.netRevenue), strong: true },
    { label: { ru: "Себестоимость и потери", en: "Cost of goods and losses" }, v: sum27(run.pnl.tiCogs) + sum27(run.pnl.fargoCogs) + sum27(run.pnl.returns) },
    { label: { ru: "Валовая прибыль", en: "Gross profit" }, v: sum27(run.pnl.grossProfit), strong: true },
    { label: { ru: "Медицина (МП и мед. инвестиции)", en: "Medical (reps and investment)" }, v: sum27(run.pnl.medical), indent: true },
    { label: { ru: "Продажи и дистрибуция", en: "Sales and distribution" }, v: sum27(run.pnl.sales), indent: true },
    { label: { ru: "Бэк-офис и администрация", en: "Back office and administration" }, v: sum27(run.pnl.admin), indent: true },
    { label: { ru: "Маркетинг", en: "Marketing" }, v: sum27(run.pnl.marketing), indent: true },
    { label: { ru: "Операционная прибыль (EBITDA)", en: "Operating profit (EBITDA)" }, v: sum27(run.pnl.ebitda), strong: true },
    { label: { ru: "Налог на прибыль", en: "Profit tax" }, v: sum27(run.pnl.profitTax), indent: true },
    { label: { ru: "Чистая прибыль", en: "Net profit" }, v: sum27(run.pnl.netProfit), strong: true },
  ];
  const quarters = [1, 2, 3, 4].map((q) => {
    const idx = idx27.filter((i) => Math.ceil(Number(run.months[i].slice(5)) / 3) === q);
    return { q, ebitda: total(run.pnl.ebitda, idx), net: total(run.pnl.netProfit, idx), revenue: total(run.pnl.netRevenue, idx) };
  });
  const qMax = Math.max(1, ...quarters.map((q) => Math.abs(q.ebitda)));

  // ── assumptions ──
  const avgDiscount = inputs.channels.reduce((t, c) => t + c.discount * c.mix, 0) / Math.max(1e-9, inputs.channels.reduce((t, c) => t + c.mix, 0));
  const opexMonth = (i: number) => -run.pnl.opex[i];
  const opex27 = idx27.length ? idx27.reduce((t, i) => t + opexMonth(i), 0) / idx27.length : 0;

  const signed = (v: number, f: (x: number) => string) => (v === 0 ? "0" : `${v > 0 ? "+" : "−"}${f(Math.abs(v))}`);

  const explain = () => {
    if (!open) return null;
    return (
      <div className="mt-3 rounded-xl border border-accent/40 bg-surface px-6 py-5 text-[13.5px]">
        {open === "ask" && (
          <>
            <div className="mb-2 font-semibold">{l({ ru: "Как получена сумма капитала", en: "How the capital figure is made" })}</div>
            <p className="mb-3 text-muted">
              {l({
                ru: "Для каждого месяца считаются деньги на конец без нового капитала. Сумма — это самая большая нехватка до минимального остатка за весь период.",
                en: "For each month, cash at month end is worked out without new capital. The sum is the largest shortfall below the minimum cash over the whole period.",
              })}
            </p>
            <Row label={{ ru: `Деньги на конец ${m(cap.worstMonth)} без нового капитала (самый низкий месяц)`, en: `Cash at the end of ${m(cap.worstMonth)} without new capital (the lowest month)` }} value={bnT(cap.monthly.cashWithoutNew[worst])} src={SRC.statements} />
            <Row label={{ ru: `Минимальный остаток: ${String(s.reserve).replace(".", ",")} мес. расходов`, en: `Minimum cash: ${s.reserve} month(s) of costs` }} value={bnT(cap.monthly.reserve[worst])} src={SRC.inputs} />
            <Row label={{ ru: "Нужно капитала всего", en: "Capital needed in all" }} value={bnT(cap.ask)} strong />
            {alreadyIn > 0.5 && <Row label={{ ru: "Уже внесено акционерами", en: "Already put in by shareholders" }} value={`− ${bnT(alreadyIn)}`} />}
            <Row label={{ ru: "Осталось внести", en: "Still to bring in" }} value={bnT(ask)} strong />
            <div className="mt-3 text-muted">
              {l({ ru: "По месяцам: ", en: "By month: " })}
              {bringMonths.map((x) => `${m(x.mo)} ${bn(x.v)}`).join(" · ")}
            </div>
          </>
        )}
        {open === "tight" && (
          <>
            <div className="mb-2 font-semibold">{l({ ru: `Деньги в ${mLong(cap.worstMonth)}`, en: `The money in ${mLong(cap.worstMonth)}` })}</div>
            {flow(worst).map((r) => (
              <Row key={r.label.en} label={r.label} value={bnT(r.v)} strong={r.strong} src={"src" in r ? r.src : undefined} />
            ))}
          </>
        )}
        {open === "revenue" && (
          <>
            <div className="mb-2 font-semibold">{l({ ru: "Как получена выручка 2027", en: "How 2027 revenue is made" })}</div>
            <Row label={{ ru: "Продано банок за год", en: "Tins sold in the year" }} value={units(units27)} src={SRC.demand} />
            <Row label={{ ru: "× средняя цена по прайсу (с НДС)", en: "× average list price (incl. VAT)" }} value={`${units(units27 ? atList27 / units27 : 0)} ${ru ? "сум" : "UZS"}`} src={SRC.inputs} />
            <Row label={{ ru: "= Продажи по прайсу", en: "= Sales at list price" }} value={bnT(atList27)} strong />
            <Row label={{ ru: `− Скидки и ретро-бонусы (в среднем ${pct(avgDiscount)}), НДС ${pct(inputs.vatRate, 0)}, доля Fargo`, en: `− Discounts and retro bonuses (avg ${pct(avgDiscount)}), VAT ${pct(inputs.vatRate, 0)}, Fargo's share` }} value={`− ${bnT(atList27 - net27)}`} src={SRC.inputs} />
            <Row label={{ ru: "= Чистая выручка", en: "= Net revenue" }} value={bnT(net27)} strong />
            <p className="mt-3 text-muted">
              {l({
                ru: "Продажи в штуках — из модели спроса: рецепты врачей (фольги) × банок на ребёнка по стадиям + база по фактическим продажам; где товара не хватит, продажи уменьшены.",
                en: "Units come from the demand model: doctors' prescriptions (foils) × tins per baby by stage + a base from actual sales; where stock runs short, sales are reduced.",
              })}
            </p>
          </>
        )}
        {open === "profit" && (
          <>
            <div className="mb-2 font-semibold">{l({ ru: "Как получена чистая прибыль 2027", en: "How 2027 net profit is made" })}</div>
            {pnl27.map((r) => (
              <Row key={r.label.en} label={r.label} value={bnT(r.v)} strong={r.strong} indent={r.indent} />
            ))}
            <div className="mt-3">
              <Source {...SRC.pnl} />
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[13px] text-muted">
            Humana Uzbekistan · {l({ ru: `оценка на ${dstr(asOf)}`, en: `estimate as of ${dstr(asOf)}` })}
            {lastClosed && l({ ru: ` · факт по ${mLong(lastClosed)}`, en: ` · actual through ${mLong(lastClosed)}` })}
          </div>
        </div>
        {changed && (
          <button type="button" onClick={() => setS(base)} className="rounded-lg border border-accent bg-accent-soft-bg px-3.5 py-2 text-[13px] font-medium text-accent">
            {l({ ru: "Показан сценарий «что если» — вернуть оценку", en: "Showing a what-if — back to the estimate" })}
          </button>
        )}
      </div>

      {/* the four figures */}
      <div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Kpi
            active={open === "ask"}
            onToggle={() => setOpen(open === "ask" ? null : "ask")}
            label={{ ru: "Нужно от акционеров", en: "Needed from shareholders" }}
            value={bnT(ask)}
            d={changed ? delta(ask, baseAsk) : null}
            sub={cap.firstNeeded ? l({ ru: `первый взнос — ${m(cap.firstNeeded)}, всего взносов: ${bringMonths.length}`, en: `first in ${m(cap.firstNeeded)}, ${bringMonths.length} instalment(s)` }) : l({ ru: "новые деньги не нужны", en: "no new money needed" })}
          />
          <Kpi
            active={open === "tight"}
            onToggle={() => setOpen(open === "tight" ? null : "tight")}
            label={{ ru: "Самый узкий месяц", en: "The tightest month" }}
            value={m(cap.worstMonth)}
            sub={l({ ru: `без нового капитала: ${bnT(cap.monthly.cashWithoutNew[worst])}`, en: `without new capital: ${bnT(cap.monthly.cashWithoutNew[worst])}` })}
          />
          <Kpi
            active={open === "revenue"}
            onToggle={() => setOpen(open === "revenue" ? null : "revenue")}
            label={{ ru: "Выручка 2027", en: "2027 revenue" }}
            value={bnT(net27, 1)}
            d={changed ? deltaGood(net27, baseCalc.cap.years.find((y) => y.year === 2027)?.netRevenue ?? 0) : null}
            sub={l({ ru: `${units(units27)} банок`, en: `${units(units27)} tins` })}
          />
          <Kpi
            active={open === "profit"}
            onToggle={() => setOpen(open === "profit" ? null : "profit")}
            label={{ ru: "Чистая прибыль 2027", en: "2027 net profit" }}
            value={bnT(y27?.netProfit ?? 0)}
            d={changed ? deltaGood(y27?.netProfit ?? 0, baseCalc.cap.years.find((y) => y.year === 2027)?.netProfit ?? 0) : null}
            sub={l({ ru: `${pct(net27 ? (y27?.netProfit ?? 0) / net27 : 0)} от выручки · EBITDA ${bnT(y27?.ebitda ?? 0)}`, en: `${pct(net27 ? (y27?.netProfit ?? 0) / net27 : 0)} of revenue · EBITDA ${bnT(y27?.ebitda ?? 0)}` })}
          />
        </div>
        {explain()}
      </div>

      {/* when the money is needed */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[16px] font-semibold">{l({ ru: "Когда нужны деньги", en: "When the money is needed" })}</h2>
          <div className="flex flex-wrap gap-4 text-[12px] text-muted">
            <span><span className="mr-1.5 inline-block h-0.5 w-5 align-middle" style={{ background: "var(--foreground)" }} />{l({ ru: "деньги на конец месяца без нового капитала", en: "cash at month end without new capital" })}</span>
            <span><span className="mr-1.5 inline-block w-5 border-t-2 border-dashed align-middle" style={{ borderColor: "var(--warn)" }} />{l({ ru: "минимальный остаток", en: "minimum cash" })}</span>
            <span><span className="mr-1.5 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: "var(--accent)" }} />{l({ ru: "внести капитал", en: "capital to bring in" })}</span>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <svg viewBox={`0 0 ${W} ${CH}`} className="w-full">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={yv(t)} y2={yv(t)} stroke="var(--border)" strokeWidth={t === 0 ? 1.4 : 1} />
                <text x={padL - 6} y={yv(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--muted)">{bn(t, 1)}</text>
              </g>
            ))}
            {run.months.map((mo, i) => (
              <g key={mo} onMouseEnter={() => setMonth(i)} onClick={() => setMonth(i)} style={{ cursor: "pointer" }}>
                <rect x={padL + colW * i} y={padT} width={colW} height={CH - padT - padB} fill={i === month ? "var(--accent-soft-bg)" : "transparent"} />
                {bars[i] > 1e6 && <rect x={xc(i) - colW * 0.28} y={yv(bars[i])} width={colW * 0.56} height={Math.max(1, yv(0) - yv(bars[i]))} rx={3} fill="var(--accent)" />}
                <text x={xc(i)} y={CH - 9} textAnchor="middle" fontSize="10.5" fill={i === month ? "var(--foreground)" : "var(--muted)"} fontWeight={i === month ? 600 : 400}>{m(mo)}</text>
              </g>
            ))}
            <path d={path(reserveLine)} fill="none" stroke="var(--warn)" strokeWidth={1.6} strokeDasharray="5 4" />
            <path d={path(cashLine)} fill="none" stroke="var(--foreground)" strokeWidth={2} />
            {cashLine.map((v, i) => (
              <circle key={i} cx={xc(i)} cy={yv(v)} r={i === month ? 4.5 : 2.5} fill={v < reserveLine[i] ? "var(--danger)" : "var(--foreground)"} />
            ))}
          </svg>
          <div className="text-[13px]">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="font-semibold capitalize">{mLong(run.months[month])}</span>
              {bars[month] > 1e6 && <span className="rounded bg-accent px-2 py-0.5 text-[12px] font-medium text-white">{l({ ru: `внести ${bnT(bars[month])}`, en: `bring in ${bnT(bars[month])}` })}</span>}
            </div>
            {flow(month).map((r) => (
              <Row key={r.label.en} label={r.label} value={bn(r.v)} strong={r.strong} src={"src" in r ? r.src : undefined} />
            ))}
            {run.stock.trucks[month] > 0 && (
              <div className="mt-1 text-[12px] text-muted">{l({ ru: `в продаже в этом месяце: ${fmtN(run.stock.trucks[month], 0)} фур(ы)`, en: `${fmtN(run.stock.trucks[month], 0)} truck(s) become sellable this month` })}</div>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* where the sum comes from */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-[16px] font-semibold">{l({ ru: "Откуда берётся сумма", en: "Where the sum comes from" })}</h2>
          <p className="mb-4 mt-1 text-[13px] text-muted">{l({ ru: `В самый узкий месяц (${m(cap.worstMonth)}) деньги бизнеса заняты так:`, en: `In the tightest month (${m(cap.worstMonth)}) the business's money sits here:` })}</p>
          {tied.map((t) => (
            <div key={t.label.en} className="mb-2.5 text-[13px]">
              <div className="flex items-baseline justify-between">
                <span>{l(t.label)}<Source {...t.src} /></span>
                <span className="figure-num">{bnT(t.v)}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-surface-low">
                <div className="h-2 rounded-full" style={{ width: `${Math.max(0, (t.v / tiedMax) * 100)}%`, background: "var(--accent)" }} />
              </div>
            </div>
          ))}
          <Row label={{ ru: "Нужно бизнесу", en: "The business needs" }} value={bnT(b.needed)} strong />
          <div className="mt-4 text-[13px] text-muted">{l({ ru: "Это покрывают:", en: "Covered by:" })}</div>
          {covered.map((c) => (
            <Row key={c.label.en} label={c.label} value={c.v >= 0 ? `− ${bnT(c.v)}` : `+ ${bnT(-c.v)}`} src={c.src} indent />
          ))}
          <div className="mt-1 flex items-baseline justify-between rounded-lg bg-accent px-4 py-2.5 text-[14px] font-semibold text-white">
            <span>{l({ ru: "= Капитал от акционеров", en: "= Capital from shareholders" })}</span>
            <span className="figure-num">{bnT(Math.max(0, b.total))}</span>
          </div>
        </section>

        {/* 2027 profit */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-[16px] font-semibold">{l({ ru: "Прибыль 2027", en: "2027 profit" })}</h2>
          <div className="mt-3 text-[13px]">
            <div className="flex justify-between pb-1 text-[11.5px] text-muted">
              <span />
              <span className="flex gap-6"><span className="w-24 text-right">{l({ ru: "млрд сум", en: "bn UZS" })}</span><span className="w-14 text-right">{l({ ru: "% выручки", en: "% of revenue" })}</span></span>
            </div>
            {pnl27.map((r) => (
              <div key={r.label.en} className={`flex items-baseline justify-between py-1.5 ${r.strong ? "border-t border-border font-semibold" : ""}`}>
                <span className={r.indent ? "pl-4 text-muted" : ""}>{l(r.label)}</span>
                <span className="flex gap-6">
                  <span className={`figure-num w-24 text-right ${r.v < 0 ? "text-muted" : ""}`}>{bn(r.v)}</span>
                  <span className="figure-num w-14 text-right text-muted">{net27 ? pct(r.v / net27, 0) : "—"}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-4 gap-3">
            {quarters.map((q) => (
              <div key={q.q} className="text-center text-[12px]">
                <div className="mx-auto flex h-20 w-10 items-end rounded bg-surface-low">
                  <div className="w-full rounded" style={{ height: `${Math.max(2, (Math.abs(q.ebitda) / qMax) * 100)}%`, background: q.ebitda >= 0 ? "var(--ok)" : "var(--danger)" }} />
                </div>
                <div className="mt-1 font-medium">Q{q.q}</div>
                <div className="figure-num text-muted">EBITDA {bn(q.ebitda, 1)}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* what if */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[16px] font-semibold">{l({ ru: "Что если", en: "What if" })}</h2>
          {changed && (
            <button type="button" onClick={() => setS(base)} className="text-[13px] font-medium text-accent hover:underline">
              {l({ ru: "Сбросить", en: "Reset" })}
            </button>
          )}
        </div>
        <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_320px]">
          <div className="grid gap-5 sm:grid-cols-2">
            <Slider active={s.sales !== 0} label={{ ru: "Продажи (и закупки вместе с ними)", en: "Sales (and purchases with them)" }} value={s.sales} min={-0.3} max={0.3} step={0.05} fmt={(v) => signed(v, (x) => pct(x, 0))} onChange={(v) => setS({ ...s, sales: v })} />
            <Slider active={s.price !== 0} label={{ ru: "Цены продажи", en: "Selling prices" }} value={s.price} min={-0.15} max={0.15} step={0.01} fmt={(v) => signed(v, (x) => pct(x, 0))} onChange={(v) => setS({ ...s, price: v })} />
            <Slider active={s.fx !== 0} label={{ ru: "Курс евро", en: "Euro rate" }} value={s.fx} min={-0.1} max={0.2} step={0.01} fmt={(v) => `${signed(v, (x) => pct(x, 0))} · ${units(inputs.eurRate * (1 + v))}`} onChange={(v) => setS({ ...s, fx: v })} />
            <Slider active={s.days !== 0} label={{ ru: "Покупатели платят позже, дней", en: "Customers pay later, days" }} value={s.days} min={-15} max={30} step={5} fmt={(v) => signed(v, (x) => String(x))} onChange={(v) => setS({ ...s, days: v })} />
            <Slider active={s.reserve !== base.reserve} label={{ ru: "Минимальный остаток, месяцев расходов", en: "Minimum cash, months of costs" }} value={s.reserve} min={0} max={2} step={0.5} fmt={(v) => String(v).replace(".", ru ? "," : ".")} onChange={(v) => setS({ ...s, reserve: v })} />
          </div>
          <div className="rounded-lg bg-surface-low px-5 py-4 text-[13.5px]">
            <div className="flex items-baseline justify-between py-1">
              <span>{l({ ru: "Нужно от акционеров", en: "Needed from shareholders" })}</span>
              <span className="figure-num font-semibold">{bnT(ask)}{delta(ask, baseAsk)}</span>
            </div>
            <div className="flex items-baseline justify-between py-1">
              <span>{l({ ru: "Первый взнос", en: "First instalment" })}</span>
              <span className="font-semibold">{cap.firstNeeded ? m(cap.firstNeeded) : "—"}</span>
            </div>
            <div className="flex items-baseline justify-between py-1">
              <span>{l({ ru: "Чистая прибыль 2027", en: "2027 net profit" })}</span>
              <span className="figure-num font-semibold">{bnT(y27?.netProfit ?? 0)}{deltaGood(y27?.netProfit ?? 0, baseCalc.cap.years.find((y) => y.year === 2027)?.netProfit ?? 0)}</span>
            </div>
            <div className="flex items-baseline justify-between py-1">
              <span>{l({ ru: "Самый узкий месяц", en: "Tightest month" })}</span>
              <span className="font-semibold">{m(cap.worstMonth)}</span>
            </div>
            <div className="mt-2 border-t border-border pt-2 text-[12px] text-muted">
              {l({ ru: `Исходный бюджет: капитал ${bnT(original.ask)}, прибыль 2027 ${bnT(original.net2027)}`, en: `Original budget: capital ${bnT(original.ask)}, 2027 profit ${bnT(original.net2027)}` })}
            </div>
          </div>
        </div>
      </section>

      {/* what it rests on */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="mb-4 text-[16px] font-semibold">{l({ ru: "На чём основан расчёт", en: "What the figures rest on" })}</h2>
        <div className="grid gap-x-10 gap-y-3 text-[13px] md:grid-cols-2">
          <Row label={{ ru: "Продажи 2027, банок", en: "2027 sales, tins" }} value={units(units27)} src={SRC.demand} />
          <Row label={{ ru: `Закупки 2027: ${fmtN(trucks27, 0)} фур, оплата HQ`, en: `2027 purchases: ${fmtN(trucks27, 0)} trucks, paid to HQ` }} value={bnT(paidHq27)} src={SRC.orders} />
          <Row label={{ ru: "Средняя цена по прайсу, с НДС", en: "Average list price, incl. VAT" }} value={`${units(units27 ? atList27 / units27 : 0)} ${ru ? "сум" : "UZS"}`} src={SRC.inputs} />
          <Row label={{ ru: "Средняя скидка и ретро-бонус", en: "Average discount and retro bonus" }} value={pct(avgDiscount)} src={SRC.inputs} />
          <Row label={{ ru: "Курс евро", en: "Euro rate" }} value={units(inputs.eurRate * (1 + s.fx))} src={SRC.inputs} />
          <Row label={{ ru: "Операционные расходы в месяц, 2027", en: "Operating costs a month, 2027" }} value={bnT(opex27)} src={SRC.inputs} />
          <Row label={{ ru: "Медицинские инвестиции, % продаж", en: "Medical investment, % of sales" }} value={pct(inputs.medicalPct)} src={SRC.inputs} />
          <Row label={{ ru: "Минимальный остаток денег", en: "Minimum cash to keep" }} value={l({ ru: `${String(s.reserve).replace(".", ",")} мес. расходов`, en: `${s.reserve} month(s) of costs` })} src={SRC.inputs} />
        </div>
        {isAdmin && (
          <div className="mt-5 flex flex-wrap gap-2 text-[13px]">
            <Link href="/budget/statements" className="rounded-lg border border-border px-3.5 py-2 font-medium hover:bg-surface-low">{l({ ru: "Отчёты по месяцам", en: "Statements by month" })}</Link>
            <Link href="/budget/inputs" className="rounded-lg border border-border px-3.5 py-2 font-medium hover:bg-surface-low">{l({ ru: "Изменить допущения", en: "Change the assumptions" })}</Link>
          </div>
        )}
      </section>
    </div>
  );
}
