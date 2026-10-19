"use client";

// «Отчёты по месяцам» — the budget's statements, made to read: P&L, cash flow,
// balance sheet and stock by quarter (or by month), amounts in billions, the
// year's four key figures on top. A line opens into what it is and where its
// figure comes from. Once months are closed they show the actual, and the
// difference to the estimate can be switched on.
import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/lib/locale-context";
import type { BudgetView, CompareWith, StatementGrid } from "@/lib/budget/statements";

type Bi = { ru: string; en: string };
type Row = StatementGrid["rows"][number];
type Src = { href: string; label: Bi };

const SRC: Record<string, Src> = {
  demand: { href: "/planning/demand", label: { ru: "Спрос", en: "Demand" } },
  orders: { href: "/planning/orders", label: { ru: "План поставок", en: "Supply plan" } },
  inputs: { href: "/budget/inputs", label: { ru: "Допущения", en: "Assumptions" } },
  books: { href: "/statements/balance", label: { ru: "Учёт", en: "The books" } },
};

/** What a line is and where its figure comes from (lines not listed are self-explanatory). */
const HELP: Record<string, { text: Bi; src?: Src }> = {
  "pnl.tiUnits": { text: { ru: "Банки, которые TI продаёт сам (после перехода от Fargo — все). Из модели спроса: рецепты × банок на ребёнка + база по продажам.", en: "Tins TI sells itself (all of them after the switch from Fargo). From the demand model: prescriptions × tins per baby + a base from sales." }, src: SRC.demand },
  "pnl.fargoUnits": { text: { ru: "Банки, которые продаёт Fargo до перехода к TI.", en: "Tins Fargo sells until the switch to TI." }, src: SRC.inputs },
  "pnl.gross": { text: { ru: "Продажи TI по прайсу, без НДС.", en: "TI's sales at list price, excluding VAT." }, src: SRC.inputs },
  "pnl.disc": { text: { ru: "Скидки и ретро-бонусы по каналам (Корзинка, сети, агенты, дилеры).", en: "Discounts and retro bonuses by channel (Korzinka, chains, agents, dealers)." }, src: SRC.inputs },
  "pnl.fargoRev": { text: { ru: "Что Fargo должен TI за проданный им товар (по договору).", en: "What Fargo owes TI for the goods it sold (by the agreement)." }, src: SRC.inputs },
  "pnl.net": { text: { ru: "Выручка после скидок и без НДС.", en: "Revenue after discounts and excluding VAT." } },
  "pnl.returns": { text: { ru: "Возвраты, просрочка и безнадёжные долги — процент от продаж.", en: "Returns, expiry and bad debt — a share of sales." }, src: SRC.inputs },
  "pnl.tiCogs": { text: { ru: "Себестоимость проданного: цена HQ × курс + доставка и таможня, по средней стоимости запаса.", en: "Cost of what was sold: HQ price × rate + freight and customs, at the stock's average cost." }, src: SRC.orders },
  "pnl.fargoCogs": { text: { ru: "Себестоимость товара, проданного через Fargo.", en: "Cost of the goods sold through Fargo." }, src: SRC.orders },
  "pnl.medical": { text: { ru: "Медицинские представители и медицинские инвестиции (процент от продаж по прайсу).", en: "Medical reps and medical investment (a share of sales at list price)." }, src: SRC.inputs },
  "pnl.sales": { text: { ru: "Склад, торговые агенты, акции, машины — с перехода к своей дистрибуции.", en: "Warehouse, sales agents, promotions, vehicles — from the switch to own distribution." }, src: SRC.inputs },
  "pnl.admin": { text: { ru: "Офис, бэк-офис, налоги на зарплату, сертификаты, банковские комиссии.", en: "Office, back office, payroll taxes, certificates, bank fees." }, src: SRC.inputs },
  "pnl.marketing": { text: { ru: "Маркетинг, реклама, командировки.", en: "Marketing, advertising, travel." }, src: SRC.inputs },
  "pnl.tax": { text: { ru: "Налог на прибыль TI с прибыли с начала года.", en: "TI's profit tax on the year-to-date profit." }, src: SRC.inputs },
  "cash.open": { text: { ru: "Деньги на начало: банк и касса TI. Первый месяц — по учёту на конец последнего закрытого месяца.", en: "Cash at the start: TI's bank and cash. The first month comes from the books at the last closed month-end." }, src: SRC.books },
  "cash.collected": { text: { ru: "Оплаты покупателей по срокам оплаты каналов (Корзинка и сети — 60 дней, агенты и дилеры — 30).", en: "Customer payments by each channel's payment terms (Korzinka and chains 60 days, agents and dealers 30)." }, src: SRC.inputs },
  "cash.paidHq": { text: { ru: "Оплата товара Humana HQ — при отгрузке фуры, по плану поставок.", en: "Goods paid to Humana HQ — when a truck is dispatched, by the supply plan." }, src: SRC.orders },
  "cash.importCosts": { text: { ru: "Доставка, таможенное оформление, сертификаты — процент от закупки.", en: "Freight, customs clearance, certificates — a share of the purchase." }, src: SRC.inputs },
  "cash.importVat": { text: { ru: "НДС на таможне — возвращается зачётом в НДС к уплате.", en: "VAT paid at customs — offset against the VAT due." }, src: SRC.inputs },
  "cash.vat": { text: { ru: "НДС к уплате за прошлый месяц.", en: "VAT due for the previous month." } },
  "cash.fargo": { text: { ru: "Fargo перечисляет TI за проданный товар (до перехода дистрибуции).", en: "Fargo pays TI for the goods it sold (until the switch)." }, src: SRC.inputs },
  "cash.capital": { text: { ru: "Капитал, уже внесённый или запланированный акционерами.", en: "Capital shareholders have put in or planned." }, src: SRC.inputs },
  "cash.other": { text: { ru: "В закрытых месяцах поступления, НДС и налоги пока одной строкой — так месяц сходится с банком.", en: "In closed months, collections, VAT and taxes are one line for now — this closes the month to the bank." }, src: SRC.books },
  "cash.reserve": { text: { ru: "Минимальный остаток денег — месяцев операционных расходов.", en: "Minimum cash to keep — months of operating costs." }, src: SRC.inputs },
  "cash.above": { text: { ru: "Деньги на конец минус минимальный остаток. Ниже нуля — нужен капитал (страница «Капитал»).", en: "Closing cash less the minimum. Below zero — capital is needed (the Capital page)." } },
  "balance.stock": { text: { ru: "Товар на складе TI по себестоимости.", en: "Stock in TI's warehouse at cost." }, src: SRC.orders },
  "balance.transit": { text: { ru: "Оплачено HQ за товар, который ещё не пришёл.", en: "Paid to HQ for goods not yet arrived." }, src: SRC.orders },
  "balance.ar": { text: { ru: "Долг покупателей по срокам оплаты.", en: "What customers owe by their payment terms." }, src: SRC.inputs },
  "balance.fargoStock": { text: { ru: "Товар Humana, который ещё лежит у Fargo, по себестоимости TI.", en: "Humana stock still with Fargo, at TI's cost." }, src: SRC.books },
  "balance.fargoOwes": { text: { ru: "Долг Fargo перед TI по договору.", en: "What Fargo owes TI by the agreement." }, src: SRC.books },
  "balance.equity": { text: { ru: "Активы минус обязательства: собственные средства акционеров, внесённый капитал и прибыль.", en: "Assets less liabilities: shareholders' own funds, capital put in and profit." } },
  "stock.market": { text: { ru: "Продажи рынка в банках (TI и Fargo) — из модели спроса, с учётом нехватки товара.", en: "Market sales in tins (TI and Fargo) — from the demand model, less what runs short." }, src: SRC.demand },
  "stock.arrivals": { text: { ru: "Банки, которые становятся доступны к продаже (через 45 дней после отгрузки фуры).", en: "Tins that become sellable (45 days after a truck's dispatch)." }, src: SRC.orders },
  "stock.trucks": { text: { ru: "Фуры, которые становятся доступны к продаже в этом месяце.", en: "Trucks that become sellable in the month." }, src: SRC.orders },
  "stock.cover": { text: { ru: "Запас на конец месяца в месяцах продаж следующих трёх месяцев.", en: "Month-end stock in months of the next three months' sales." } },
};

/** Short line names for reading. */
const NAMES: Record<string, Bi> = {
  "pnl.tiUnits": { ru: "Продано TI, банок", en: "Sold by TI, tins" },
  "pnl.fargoUnits": { ru: "Продано через Fargo, банок", en: "Sold through Fargo, tins" },
  "pnl.gross": { ru: "Продажи TI по прайсу", en: "TI sales at list price" },
  "pnl.disc": { ru: "Скидки и ретро-бонусы", en: "Discounts and retro bonuses" },
  "pnl.fargoRev": { ru: "Продажи через Fargo", en: "Sales through Fargo" },
  "pnl.net": { ru: "Чистая выручка", en: "Net revenue" },
  "pnl.returns": { ru: "Возвраты и потери", en: "Returns and losses" },
  "pnl.tiCogs": { ru: "Себестоимость продаж TI", en: "Cost of TI's sales" },
  "pnl.fargoCogs": { ru: "Себестоимость продаж через Fargo", en: "Cost of sales through Fargo" },
  "pnl.gp": { ru: "Валовая прибыль", en: "Gross profit" },
  "pnl.medical": { ru: "Медицина", en: "Medical" },
  "pnl.sales": { ru: "Продажи и дистрибуция", en: "Sales and distribution" },
  "pnl.admin": { ru: "Администрация", en: "Administration" },
  "pnl.marketing": { ru: "Маркетинг", en: "Marketing" },
  "pnl.opexTotal": { ru: "Операционные расходы", en: "Operating costs" },
  "pnl.ebitda": { ru: "EBITDA", en: "EBITDA" },
  "pnl.tax": { ru: "Налог на прибыль", en: "Profit tax" },
  "pnl.np": { ru: "Чистая прибыль", en: "Net profit" },
  "cash.open": { ru: "Деньги на начало", en: "Cash at the start" },
  "cash.collected": { ru: "Получено от покупателей", en: "Collected from customers" },
  "cash.paidHq": { ru: "Оплата Humana HQ", en: "Paid to Humana HQ" },
  "cash.importCosts": { ru: "Доставка и таможня", en: "Freight and customs" },
  "cash.importVat": { ru: "НДС на таможне", en: "VAT at customs" },
  "cash.opex": { ru: "Операционные расходы", en: "Operating costs" },
  "cash.vat": { ru: "НДС", en: "VAT" },
  "cash.ptax": { ru: "Налог на прибыль", en: "Profit tax" },
  "cash.fargo": { ru: "Fargo платит TI", en: "Fargo pays TI" },
  "cash.prior": { ru: "Предыдущему владельцу TI", en: "Previous owner of TI" },
  "cash.loans": { ru: "Займы", en: "Loans" },
  "cash.capital": { ru: "Капитал акционеров", en: "Shareholder capital" },
  "cash.other": { ru: "Прочее по банку (факт)", en: "Other through the bank (actual)" },
  "cash.close": { ru: "Деньги на конец", en: "Cash at the end" },
  "cash.reserve": { ru: "Минимальный остаток", en: "Minimum cash" },
  "cash.above": { ru: "Сверх минимума", en: "Above the minimum" },
  "stock.market": { ru: "Продажи, банок", en: "Sales, tins" },
  "stock.arrivals": { ru: "Приход, банок", en: "Arrivals, tins" },
  "stock.trucks": { ru: "Фур в продаже", en: "Trucks becoming sellable" },
  "stock.tiStock": { ru: "Запас TI на конец, банок", en: "TI stock at the end, tins" },
  "stock.cover": { ru: "Запас, месяцев продаж", en: "Stock, months of sales" },
  "stock.fargoStock": { ru: "Товар у Fargo, банок", en: "Stock at Fargo, tins" },
};

const KPIS: Record<BudgetView, { key: string; label: Bi; margin?: boolean; abs?: boolean }[]> = {
  pnl: [
    { key: "net", label: { ru: "Чистая выручка", en: "Net revenue" } },
    { key: "gp", label: { ru: "Валовая прибыль", en: "Gross profit" }, margin: true },
    { key: "ebitda", label: { ru: "EBITDA", en: "EBITDA" }, margin: true },
    { key: "np", label: { ru: "Чистая прибыль", en: "Net profit" }, margin: true },
  ],
  cash: [
    { key: "collected", label: { ru: "Получено от покупателей", en: "Collected from customers" } },
    { key: "paidHq", label: { ru: "Оплачено Humana HQ", en: "Paid to Humana HQ" }, abs: true },
    { key: "opex", label: { ru: "Операционные расходы", en: "Operating costs" }, abs: true },
    { key: "close", label: { ru: "Деньги на конец года", en: "Cash at year end" } },
  ],
  balance: [
    { key: "assetsTotal", label: { ru: "Активы", en: "Assets" } },
    { key: "stock", label: { ru: "из них товар", en: "of which stock" } },
    { key: "liabTotal", label: { ru: "Обязательства", en: "Liabilities" } },
    { key: "equity", label: { ru: "Собственные средства", en: "Own funds" } },
  ],
  stock: [
    { key: "market", label: { ru: "Продажи, банок", en: "Sales, tins" } },
    { key: "arrivals", label: { ru: "Приход, банок", en: "Arrivals, tins" } },
    { key: "trucks", label: { ru: "Фур", en: "Trucks" } },
    { key: "tiStock", label: { ru: "Запас на конец года, банок", en: "Stock at year end, tins" } },
  ],
};

const VIEWS: { value: BudgetView; label: Bi }[] = [
  { value: "pnl", label: { ru: "Прибыли и убытки", en: "Profit and loss" } },
  { value: "cash", label: { ru: "Движение денег", en: "Cash flow" } },
  { value: "balance", label: { ru: "Баланс", en: "Balance sheet" } },
  { value: "stock", label: { ru: "Запасы", en: "Stock" } },
];

type Col = { key: string; label: string; tag: "actual" | "mixed" | "estimate"; idx: number[]; year?: boolean };

function aggregate(row: Row, idx: number[], pick: (i: number) => number | null | undefined): number | null {
  const vals = idx.map(pick);
  if (row.period === "none" || vals.length === 0) return null;
  if (vals.some((v) => v == null)) return null;
  if (row.period === "first") return vals[0] as number;
  if (row.period === "last") return vals[vals.length - 1] as number;
  return (vals as number[]).reduce((t, v) => t + v, 0);
}

export default function StatementsView({
  view,
  grid,
  compareWith,
  hasActuals,
  asOf,
  lastClosed,
}: {
  view: BudgetView;
  grid: StatementGrid;
  compareWith: CompareWith;
  hasActuals: boolean;
  asOf: string;
  lastClosed: string | null;
}) {
  const { locale, l } = useT();
  const ru = locale === "ru";
  const router = useRouter();
  const params = useSearchParams();
  const [byMonth, setByMonth] = useState(false);
  const [showDiff, setShowDiff] = useState(hasActuals);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const go = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) p.delete(k);
      else p.set(k, v);
    }
    router.push(`/budget/statements?${p.toString()}`);
  };

  // columns: the grid's months (and its year totals) as quarters or months
  const monthCols = grid.columns.map((c, i) => ({ c, i })).filter((x) => x.c.kind !== "period");
  const yearCol = grid.columns.findIndex((c) => c.key === "y2027");
  const tagOf = (idx: number[]): Col["tag"] => {
    const kinds = idx.map((i) => grid.columns[i].kind);
    return kinds.every((k) => k === "actual") ? "actual" : kinds.some((k) => k === "actual") ? "mixed" : "estimate";
  };
  const mon = (id: string) => {
    const [y, m] = id.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(ru ? "ru-RU" : "en-GB", { month: "short", timeZone: "UTC" }).replace(".", "");
  };
  const cols: Col[] = byMonth
    ? monthCols.map(({ c, i }) => ({ key: c.key, label: `${mon(c.key)} ${c.key.slice(2, 4)}`, tag: tagOf([i]), idx: [i] }))
    : [...new Set(monthCols.map(({ c }) => `${c.key.slice(0, 4)}-Q${Math.ceil(Number(c.key.slice(5)) / 3)}`))].map((q) => {
        const idx = monthCols.filter(({ c }) => `${c.key.slice(0, 4)}-Q${Math.ceil(Number(c.key.slice(5)) / 3)}` === q).map((x) => x.i);
        const [y, qq] = q.split("-");
        return { key: q, label: `${qq.replace("Q", ru ? "" : "Q")}${ru ? " кв." : ""} ${y}`, tag: tagOf(idx), idx };
      });
  if (yearCol >= 0) cols.push({ key: "y2027", label: ru ? "2027 год" : "Year 2027", tag: tagOf(grid.columns[yearCol].months.map((m) => grid.columns.findIndex((c) => c.key === m))), idx: [yearCol], year: true });

  const value = (row: Row, col: Col) => (col.year ? row.cells[col.idx[0]].v : aggregate(row, col.idx, (i) => row.cells[i].v));
  const ref = (row: Row, col: Col) => {
    if (col.year) return compareWith === "original" ? row.cells[col.idx[0]].ref ?? null : null;
    if (col.tag !== "actual" && compareWith !== "original") return null;
    return aggregate(row, col.idx, (i) => row.cells[i].ref);
  };

  // formatting: money in billions, tins as whole numbers
  const bn = (v: number) => {
    const s = Math.abs(v / 1e9).toFixed(2).replace(".", ru ? "," : ".");
    return v < -5e6 ? `−${s}` : s;
  };
  const num = (v: number, d: number) => {
    const s = Math.abs(v).toLocaleString(ru ? "ru-RU" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
    return v < 0 && Math.abs(v) >= (d ? 0.05 : 0.5) ? `−${s}` : s;
  };
  const fmt = (row: Row, v: number | null) => {
    if (v == null) return "";
    if (row.units) return Math.abs(v) < (row.decimals ? 0.05 : 0.5) ? "–" : num(v, row.decimals);
    return Math.abs(v) < 5e6 ? "–" : bn(v);
  };
  const rowOf = (key: string) => grid.rows.find((r) => r.key === key);
  const yearOf = (key: string) => {
    const r = rowOf(key);
    return r && yearCol >= 0 ? r.cells[yearCol].v : null;
  };
  const netRev = view === "pnl" ? yearOf("net") : null;
  const dstr = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
  const mLong = (id: string) => {
    const [y, m] = id.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(ru ? "ru-RU" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  };
  // per-tin prices do not add up by period; the closed months' bank line only once there are some
  const rows = grid.rows.filter((r) => (r.key !== "other" || hasActuals) && !(view === "stock" && (r.key === "hqUnit" || r.key === "landed")));
  const name = (r: Row) => l(NAMES[`${view}.${r.key}`] ?? r.label).replace(/^[−+]\s*/, "");
  const tag = (t: Col["tag"]) => (t === "actual" ? l({ ru: "факт", en: "actual" }) : t === "mixed" ? l({ ru: "факт + оценка", en: "actual + estimate" }) : l({ ru: "оценка", en: "estimate" }));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap rounded-lg border border-border bg-surface p-1">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => go({ view: v.value === "pnl" ? null : v.value })}
              className={`rounded-md px-4 py-1.5 text-[13.5px] font-medium transition-colors ${view === v.value ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
            >
              {l(v.label)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
          <span className="text-muted">
            {l({ ru: `Оценка на ${dstr(asOf)}`, en: `Estimate as of ${dstr(asOf)}` })}
            {lastClosed && l({ ru: ` · факт по ${mLong(lastClosed)}`, en: ` · actual through ${mLong(lastClosed)}` })}
          </span>
          <div className="flex rounded-lg border border-border bg-surface p-0.5">
            {[false, true].map((m) => (
              <button key={String(m)} type="button" onClick={() => setByMonth(m)} className={`rounded-md px-3 py-1 font-medium ${byMonth === m ? "bg-surface-low text-foreground" : "text-muted"}`}>
                {m ? l({ ru: "Месяцы", en: "Months" }) : l({ ru: "Кварталы", en: "Quarters" })}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* the year's key figures */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS[view].map((k) => {
          const r = rowOf(k.key);
          const raw = yearOf(k.key);
          const v = raw != null && k.abs ? Math.abs(raw) : raw;
          return (
            <div key={k.key} className="rounded-xl border border-border bg-surface px-5 py-4">
              <div className="text-[12.5px] text-muted">{l(k.label)} · 2027</div>
              <div className="figure-num mt-1.5 text-[24px] font-semibold leading-none tracking-[-0.02em]">
                {r && v != null ? (k.key === "trucks" ? num(v, 0) : fmt(r, v)) : "–"}
                {r && !r.units && <span className="ml-1 text-[14px] font-medium text-muted">{l({ ru: "млрд", en: "bn" })}</span>}
              </div>
              {k.margin && netRev ? <div className="mt-1.5 text-[12.5px] text-muted">{((((v ?? 0) / netRev) * 100).toFixed(1)).replace(".", ru ? "," : ".")}% {l({ ru: "от выручки", en: "of revenue" })}</div> : null}
            </div>
          );
        })}
      </div>

      {hasActuals && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-[12.5px]">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} />
            {l({ ru: "Показать отклонение факта", en: "Show how the actual differs" })}
          </label>
          {showDiff && (
            <div className="flex rounded-lg border border-border bg-surface p-0.5">
              {(["start", "original"] as const).map((c) => (
                <button key={c} type="button" onClick={() => go({ compare: c === "start" ? null : c })} className={`rounded-md px-3 py-1 font-medium ${compareWith === c ? "bg-surface-low text-foreground" : "text-muted"}`}>
                  {c === "start" ? l({ ru: "от оценки на начало месяца", en: "from the estimate at the month's start" }) : l({ ru: "от исходного бюджета", en: "from the original budget" })}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 z-10 min-w-[300px] bg-surface px-5 py-3 text-left text-[12px] font-normal text-muted">
                {rows.some((r) => !r.units) ? l({ ru: "млрд сум", en: "bn UZS" }) : l({ ru: "банок", en: "tins" })}
              </th>
              {cols.map((c) => (
                <th key={c.key} className={`whitespace-nowrap px-3 py-3 text-right ${c.year ? "border-l border-border bg-surface-low" : ""}`}>
                  <div className="text-[13px] font-semibold">{c.label}</div>
                  <div className={`text-[11px] font-normal ${c.tag === "actual" ? "text-ok" : "text-muted"}`}>{tag(c.tag)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const help = HELP[`${view}.${r.key}`];
              if (r.kind === "header") {
                return (
                  <tr key={r.key}>
                    <td colSpan={cols.length + 1} className="bg-surface px-5 pb-1.5 pt-5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted">
                      {l(r.label)}
                    </td>
                  </tr>
                );
              }
              const strong = r.kind === "subtotal" || r.kind === "total";
              const isOpen = openRow === r.key;
              return (
                <Fragment key={r.key}>
                  <tr
                    onClick={() => help && setOpenRow(isOpen ? null : r.key)}
                    className={`${r.kind === "total" ? "border-t-2 border-foreground/70" : strong ? "border-t border-border" : ""} ${help ? "cursor-pointer hover:bg-surface-low/60" : ""} ${isOpen ? "bg-surface-low/60" : ""}`}
                  >
                    <td className={`sticky left-0 z-10 bg-inherit px-5 py-2 ${strong ? "font-semibold" : ""} ${r.kind === "line" && !r.units && view !== "stock" ? "pl-8" : ""}`} style={{ background: isOpen ? undefined : "var(--surface)" }}>
                      {name(r)}
                      {help && <span className="ml-1.5 text-[11px] text-muted">{isOpen ? "▾" : "ⓘ"}</span>}
                    </td>
                    {cols.map((c) => {
                      const v = value(r, c);
                      const d = showDiff ? ref(r, c) : null;
                      const diff = v != null && d != null ? v - d : null;
                      return (
                        <td key={c.key} className={`figure-num whitespace-nowrap px-3 py-2 text-right ${strong ? "font-semibold" : ""} ${c.year ? "border-l border-border bg-surface-low" : ""} ${strong && v != null && v < -5e6 && !r.units ? "text-danger" : ""}`}>
                          {fmt(r, v)}
                          {diff != null && Math.abs(diff) >= (r.units ? 0.5 : 5e6) && (
                            <div className={`text-[11px] font-normal ${diff > 0 ? "text-ok" : "text-danger"}`}>
                              {diff > 0 ? "+" : "−"}
                              {r.units ? num(Math.abs(diff), r.decimals) : bn(Math.abs(diff))}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {isOpen && help && (
                    <tr className="bg-surface-low/60">
                      <td colSpan={cols.length + 1} className="px-8 pb-3 text-[12.5px] text-muted">
                        {l(help.text)}
                        {help.src && (
                          <Link href={help.src.href} className="ml-2 font-medium text-accent hover:underline">
                            {l(help.src.label)} →
                          </Link>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
