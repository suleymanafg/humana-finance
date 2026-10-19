"use client";

// The budget's assumptions — the workbook's yellow cells — as a form, with the
// answer recalculated live as you type. Save keeps them as the working
// forecast; Approve makes the forecast the budget that plan vs actual is
// measured against. A budget workbook (v10 layout) can be loaded instead.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useT, type Bi } from "@/lib/locale-context";
import { fmtN, numberInputText, parseNum } from "@/lib/format";
import { shortMonth } from "@/lib/statement-ui";
import { addMonths } from "@/lib/planning/compute";
import { channelShares, monthRange, type BudgetInputs, type BudgetMonthly, type BudgetOpening } from "@/lib/budget/model";
import { capitalAnswer } from "@/lib/budget/capital";
import { forecastRun } from "@/lib/budget/forecast";
import type { StoredBudget } from "@/lib/budget/store";
import { Button, Card, CardHeader, Modal, NumberInput, Select } from "../ui";

type Kind = "pct" | "num" | "money" | "dec" | "int";
type ScalarKey = { [K in keyof BudgetInputs]: BudgetInputs[K] extends number ? K : never }[keyof BudgetInputs];
interface FieldDef { key: ScalarKey | "hqEurPerUnit"; label: Bi; kind: Kind; hint?: Bi }
// the forecast takes its trucks from the supply plan; these drive only a budget without it
const PLAN_HINT: Bi = { ru: "в оценке не используется: фуры — из плана поставок", en: "not used in the estimate: trucks come from the supply plan" };

const SECTIONS: { title: Bi; fields: FieldDef[] }[] = [
  {
    title: { ru: "Общие", en: "General" },
    fields: [
      { key: "eurRate", label: { ru: "Курс EUR/UZS", en: "EUR/UZS rate" }, kind: "num" },
      { key: "vatRate", label: { ru: "НДС", en: "VAT rate" }, kind: "pct" },
      { key: "profitTaxRate", label: { ru: "Налог на прибыль", en: "Profit tax" }, kind: "pct" },
      { key: "sellPriceChange", label: { ru: "Изменение наших цен", en: "Change in our prices" }, kind: "pct" },
      { key: "sellPriceChangeMonth", label: { ru: "…с месяца 2027 (1–12)", en: "…from month of 2027 (1–12)" }, kind: "int" },
      { key: "hqPriceChange", label: { ru: "Изменение цен HQ", en: "Change in HQ prices" }, kind: "pct" },
      { key: "hqPriceChangeMonth", label: { ru: "…с месяца 2027 (1–12)", en: "…from month of 2027 (1–12)" }, kind: "int" },
    ],
  },
  {
    title: { ru: "Продажи", en: "Sales volume" },
    fields: [
      { key: "baseUnits", label: { ru: "Обычный спрос, шт. в месяц", en: "Normal demand, units a month" }, kind: "num" },
      { key: "growth", label: { ru: "Рост в месяц", en: "Monthly growth" }, kind: "pct" },
      { key: "allowance", label: { ru: "Возвраты, просрочка, безнадёжные долги", en: "Returns, expiry and bad debt" }, kind: "pct" },
      { key: "spikeReady", label: { ru: "Готовность к всплеску продаж", en: "Be ready for a sales spike of" }, kind: "pct" },
    ],
  },
  {
    title: { ru: "Импорт и запасы", en: "Imports and stock" },
    fields: [
      { key: "coverMonths", label: { ru: "Целевой запас, месяцев продаж", en: "Target stock, months of sales" }, kind: "dec", hint: PLAN_HINT },
      { key: "buildupMonths", label: { ru: "За сколько месяцев выйти на запас", en: "Months to build stock up" }, kind: "int", hint: PLAN_HINT },
      { key: "leadDays", label: { ru: "Дней от оплаты HQ до продажи (0–60)", en: "Days from paying HQ to selling (0–60)" }, kind: "int", hint: PLAN_HINT },
      { key: "truckUnits", label: { ru: "Штук в фуре", en: "Units per truck" }, kind: "num", hint: PLAN_HINT },
      { key: "importCostPct", label: { ru: "Импортные расходы без НДС, % закупки", en: "Import costs excl. VAT, % of purchase" }, kind: "pct" },
      { key: "importVatPct", label: { ru: "Импортный НДС, % закупки", en: "Import VAT, % of purchase" }, kind: "pct" },
      { key: "hqEurPerUnit", label: { ru: "Цена HQ за шт., EUR (пусто = по ассортименту)", en: "HQ price per unit, EUR (blank = product mix)" }, kind: "dec" },
    ],
  },
  {
    title: { ru: "Расходы Turbo Impex (в месяц)", en: "Turbo Impex costs (per month)" },
    fields: [
      { key: "medicalPct", label: { ru: "Медицинские инвестиции, % продаж по прайсу", en: "Medical investment, % of sales at list" }, kind: "pct" },
      { key: "mrPayroll", label: { ru: "Зарплата МП", en: "MR team payroll" }, kind: "money" },
      { key: "officePayroll", label: { ru: "Зарплата офиса TI", en: "TI office payroll" }, kind: "money" },
      { key: "payrollTaxes", label: { ru: "Налоги на ФОТ", en: "Payroll taxes" }, kind: "money" },
      { key: "officeCosts", label: { ru: "Аренда и расходы офиса", en: "Office rent and expenses" }, kind: "money" },
      { key: "marketing", label: { ru: "Маркетинг, реклама, командировки", en: "Marketing, advertising, travel" }, kind: "money" },
      { key: "tradePromo", label: { ru: "Торговые акции", en: "Trade promotions" }, kind: "money" },
      { key: "smartUp", label: { ru: "SmartUp", en: "SmartUp" }, kind: "money" },
      { key: "vehicles", label: { ru: "Доп. топливо и машины", en: "Extra fuel and vehicles" }, kind: "money" },
      { key: "certificates", label: { ru: "Сертификаты (раз в год)", en: "Certificates (once a year)" }, kind: "money" },
      { key: "certificatesMonth", label: { ru: "…в месяце года (1–12)", en: "…in month of the year (1–12)" }, kind: "int" },
      { key: "bankFeePct", label: { ru: "Банковские комиссии, % поступлений", en: "Bank fees, % of money collected" }, kind: "pct" },
      { key: "nutribenSales", label: { ru: "Продажи Nutriben в месяц (для деления)", en: "Nutriben sales a month (for the split)" }, kind: "money" },
      { key: "nutribenGrowth", label: { ru: "Рост Nutriben в месяц", en: "Nutriben monthly growth" }, kind: "pct" },
    ],
  },
  {
    title: { ru: "Fargo и переход", en: "Fargo and the switch" },
    fields: [
      { key: "fargoRemitPct", label: { ru: "Fargo должен TI, % его продаж по прайсу", en: "Fargo owes TI, % of its sales at list" }, kind: "pct" },
      { key: "tiMarkup", label: { ru: "Наценка TI в счетах Fargo", en: "TI markup on its invoices to Fargo" }, kind: "pct" },
      { key: "distStartMonth", label: { ru: "Свои расходы на дистрибуцию с месяца 2027", en: "TI's own distribution costs from month of 2027" }, kind: "int" },
      { key: "fargoOldMonths", label: { ru: "Fargo гасит старый остаток за месяцев", en: "Fargo clears its old balance over months" }, kind: "int" },
    ],
  },
  {
    title: { ru: "Резерв", en: "Cash reserve" },
    fields: [
      { key: "reserveMonths", label: { ru: "Минимальный остаток, месяцев расходов", en: "Minimum cash, months of costs" }, kind: "dec" },
      { key: "spikeBuffer", label: { ru: "Рекомендуемый буфер на рост продаж", en: "Recommended buffer for a sales jump" }, kind: "money" },
    ],
  },
];

type MonthlyKey = keyof BudgetMonthly;
const MONTHLY: { key: MonthlyKey; label: Bi; kind: Kind; blank?: Bi }[] = [
  { key: "spikePct", label: { ru: "Всплеск продаж сверх плана", en: "Extra sales on top of the plan" }, kind: "pct" },
  { key: "expectedUnits", label: { ru: "Ожидаемые продажи рынка, шт. (вместо плана)", en: "Expected market sales, units (replaces the plan)" }, kind: "num", blank: { ru: "план", en: "plan" } },
  { key: "tiShare", label: { ru: "Доля рынка, которую TI продаёт сам", en: "Share TI sells directly" }, kind: "pct" },
  { key: "fixedTrucks", label: { ru: "Фур приходит (пусто = решает модель)", en: "Trucks arriving (blank = the model decides)" }, kind: "dec", blank: { ru: "модель", en: "model" } },
  { key: "stockToFargo", label: { ru: "Товар TI → Fargo, шт. (не меньше)", en: "TI stock handed to Fargo, units (at least)" }, kind: "num" },
  { key: "fargoPaid", label: { ru: "Fargo платит TI (пусто = правило)", en: "Fargo pays TI (blank = the rule)" }, kind: "money", blank: { ru: "правило", en: "rule" } },
  { key: "fargoReturns", label: { ru: "Fargo возвращает, шт. («все» = весь остаток)", en: "Fargo returns, units («all» = everything left)" }, kind: "num" },
  { key: "loans", label: { ru: "Займы получены (+) / погашены (−)", en: "Loans received (+) / repaid (−)" }, kind: "money" },
  { key: "priorOwnerPaid", label: { ru: "Выплаты предыдущему владельцу", en: "Paid to the previous owner" }, kind: "money" },
  { key: "plannedCapital", label: { ru: "Капитал акционеров (запланирован)", en: "Shareholder capital (planned)" }, kind: "money" },
];

const shown = (v: number | null, kind: Kind) => (v == null ? "" : numberInputText(kind === "pct" ? Math.round(v * 1e8) / 1e6 : v));
const read = (text: string, kind: Kind): number | null => {
  const n = parseNum(text);
  return n == null ? null : kind === "pct" ? n / 100 : n;
};

/** A number box keeping its own text while typing; percentages are typed as 12 for 12%. */
function NumField({ value, kind, onChange, blank, className = "", disabled }: { value: number | null; kind: Kind; onChange: (v: number | null) => void; blank?: string; className?: string; disabled?: boolean }) {
  const [text, setText] = useState(shown(value, kind));
  return (
    <span className="inline-flex items-center gap-1">
      <NumberInput
        fraction={kind !== "money" && kind !== "num"}
        value={text}
        placeholder={blank}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          onChange(read(e.target.value, kind));
        }}
        className={`h-7 w-32 rounded-md border border-border bg-surface px-2 text-right text-[12.5px] tabular-nums outline-none focus:border-accent disabled:bg-background disabled:text-muted ${className}`}
      />
      {kind === "pct" && <span className="text-[11px] text-muted">%</span>}
    </span>
  );
}

export default function BudgetInputsEditor({
  approved,
  working,
  realOpening,
  alreadyIn,
  closed,
}: {
  approved: StoredBudget;
  working: StoredBudget;
  realOpening: BudgetOpening | null;
  alreadyIn: number;
  closed: string[];
}) {
  const { locale, l } = useT();
  const router = useRouter();
  const [inputs, setInputs] = useState<BudgetInputs>(working.inputs);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<"approve" | "reset" | null>(null);
  const dirty = JSON.stringify(inputs) !== JSON.stringify(working.inputs);
  const months = monthRange(addMonths(inputs.opening.monthId, 1), "2027-12");
  const closedSet = new Set(closed);

  const answer = (i: BudgetInputs) => {
    try {
      const cap = capitalAnswer(forecastRun(i, realOpening), i);
      return { ask: Math.max(0, cap.ask - alreadyIn), first: cap.firstNeeded, worst: cap.worstMonth, headroom: cap.headroom, ok: Object.values(cap.checks).every(Boolean) };
    } catch {
      return null;
    }
  };
  const live = useMemo(() => answer(inputs), [inputs]); // eslint-disable-line react-hooks/exhaustive-deps
  const saved = useMemo(() => answer(working.inputs), [working]); // eslint-disable-line react-hooks/exhaustive-deps
  const budget = useMemo(() => answer(approved.inputs), [approved]); // eslint-disable-line react-hooks/exhaustive-deps
  const shares = channelShares(inputs);

  const set = <K extends keyof BudgetInputs>(key: K, v: BudgetInputs[K]) => setInputs((x) => ({ ...x, [key]: v }));
  const setMonthly = (key: MonthlyKey, i: number, v: number | null | "all") =>
    setInputs((x) => ({ ...x, monthly: { ...x.monthly, [key]: (x.monthly[key] as unknown[]).map((old, j) => (j === i ? v : old)) } as BudgetMonthly }));

  async function post(body: unknown, done: { ru: string; en: string }) {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/budget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    setConfirm(null);
    if (!res.ok) return setMessage({ ok: false, text: json.error ?? res.statusText });
    setMessage({ ok: true, text: l(done) });
    router.refresh();
  }

  const fmtAnswer = (a: ReturnType<typeof answer>) =>
    a ? `${fmtN(a.ask)}${a.first ? ` · ${l({ ru: "с", en: "from" })} ${shortMonth(a.first, locale)}` : ""}` : "—";
  const approvedOf = (key: FieldDef["key"]) => approved.inputs[key] as number | null;

  return (
    <div key={version}>
      <div className="sticky top-16 z-20 mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3 shadow-sm">
        <div>
          <div className="text-[11.5px] text-muted">{l({ ru: "Просим у акционеров — с этими допущениями", en: "Ask shareholders — with these assumptions" })}</div>
          <div className="text-[18px] font-semibold tabular-nums">{fmtAnswer(live)}</div>
        </div>
        <div className="text-[12.5px]">
          <div className="text-muted">{l({ ru: "Сохранённая оценка", en: "Saved estimate" })}: <b className="tabular-nums">{fmtAnswer(saved)}</b></div>
          <div className="text-muted">{l({ ru: "Исходный бюджет", en: "Original budget" })}: <b className="tabular-nums">{fmtAnswer(budget)}</b></div>
        </div>
        {live && (
          <div className={`text-[12.5px] ${live.headroom < 0 ? "text-danger" : "text-muted"}`}>
            {l({ ru: "Самый узкий месяц", en: "Tightest month" })}: {shortMonth(live.worst, locale)} · {fmtN(live.headroom)}
            {!live.ok && <span className="ml-2 text-danger">{l({ ru: "проверки не прошли", en: "checks fail" })}</span>}
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {message && <span className={`text-[12px] ${message.ok ? "text-ok" : "text-danger"}`}>{message.text}</span>}
          {dirty && (
            <Button variant="ghost" onClick={() => { setInputs(working.inputs); setVersion((v) => v + 1); }}>
              {l({ ru: "Отменить правки", en: "Undo edits" })}
            </Button>
          )}
          <Button variant="secondary" onClick={() => setConfirm("reset")} disabled={busy}>{l({ ru: "Вернуть к исходному бюджету", en: "Back to the original budget" })}</Button>
          <Button variant="secondary" onClick={() => setConfirm("approve")} disabled={busy || dirty}>{l({ ru: "Сделать исходным бюджетом", en: "Make it the original budget" })}</Button>
          <Button onClick={() => post({ action: "save", inputs }, { ru: "Оценка сохранена", en: "Estimate saved" })} disabled={busy || !dirty}>
            {l({ ru: "Сохранить оценку", en: "Save the estimate" })}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {SECTIONS.map((s) => (
          <Card key={s.title.en}>
            <CardHeader title={l(s.title)} />
            <table className="w-full text-[12.5px]">
              <tbody>
                {s.fields.map((fd) => {
                  const v = inputs[fd.key] as number | null;
                  const a = approvedOf(fd.key);
                  return (
                    <tr key={fd.key} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-1.5">
                        {l(fd.label)}
                        {fd.hint && <div className="text-[11px] text-muted">{l(fd.hint)}</div>}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <NumField value={v} kind={fd.kind} blank={fd.key === "hqEurPerUnit" ? l({ ru: "по ассортименту", en: "product mix" }) : undefined}
                          onChange={(n) => set(fd.key, (fd.key === "hqEurPerUnit" ? n : n ?? 0) as never)} />
                      </td>
                      <td className="w-28 px-3 py-1.5 text-right text-[11.5px] text-muted tabular-nums">
                        {a !== v ? `${l({ ru: "бюджет", en: "budget" })} ${a == null ? "—" : fd.kind === "pct" ? `${shown(a, "pct")}%` : fmtN(a, fd.kind === "dec" ? 2 : 0)}` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        ))}

        <Card>
          <CardHeader title={l({ ru: "Каналы продаж", en: "Sales channels" })} desc={l({ ru: "Доля Корзинки — ваша; остальные каналы сохраняют структуру и заполняют остаток", en: "Korzinka's share is yours; the other channels keep their mix and fill the rest" })} />
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-[11.5px] text-muted">
                <th className="px-4 py-1.5 text-left font-normal">{l({ ru: "Канал", en: "Channel" })}</th>
                <th className="px-2 text-right font-normal">{l({ ru: "Доля", en: "Share" })}</th>
                <th className="px-2 text-right font-normal">{l({ ru: "Скидка / ретро", en: "Discount / retro" })}</th>
                <th className="px-3 text-right font-normal">{l({ ru: "Дней оплаты", en: "Days to pay" })}</th>
              </tr>
            </thead>
            <tbody>
              {inputs.channels.map((ch, i) => (
                <tr key={ch.key} className="border-t border-border/60">
                  <td className="px-4 py-1.5">{ch.name}</td>
                  <td className="px-2 text-right">
                    {ch.key === "korzinka"
                      ? <NumField value={inputs.korzinkaShare} kind="pct" onChange={(n) => set("korzinkaShare", n ?? 0)} />
                      : <span className="tabular-nums text-muted">{(shares[ch.key] * 100).toFixed(1)}%</span>}
                  </td>
                  <td className="px-2 text-right">
                    <NumField value={ch.discount} kind="pct" onChange={(n) => set("channels", inputs.channels.map((c, j) => (j === i ? { ...c, discount: n ?? 0 } : c)))} />
                  </td>
                  <td className="px-3 text-right">
                    <NumField value={ch.days} kind="int" className="w-16" onChange={(n) => set("channels", inputs.channels.map((c, j) => (j === i ? { ...c, days: n ?? 0 } : c)))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHeader title={l({ ru: "Продукты", en: "Products" })} desc={l({ ru: "Прайс с НДС, цена HQ и продажи в базовом периоде (структура продаж)", en: "List price incl. VAT, HQ price and units in the base period (the sales mix)" })} />
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-[11.5px] text-muted">
                <th className="px-4 py-1.5 text-left font-normal">{l({ ru: "Продукт", en: "Product" })}</th>
                <th className="px-2 text-right font-normal">{l({ ru: "Прайс", en: "List price" })}</th>
                <th className="px-2 text-right font-normal">EUR</th>
                <th className="px-3 text-right font-normal">{l({ ru: "Шт.", en: "Units" })}</th>
              </tr>
            </thead>
            <tbody>
              {inputs.products.map((p, i) => {
                const setP = (patch: Partial<typeof p>) => set("products", inputs.products.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-4 py-1.5">{p.name}</td>
                    <td className="px-2 text-right"><NumField value={p.listPrice} kind="money" className="w-24" onChange={(n) => setP({ listPrice: n ?? 0 })} /></td>
                    <td className="px-2 text-right"><NumField value={p.hqEur} kind="dec" className="w-20" onChange={(n) => setP({ hqEur: n ?? 0 })} /></td>
                    <td className="px-3 text-right"><NumField value={p.units} kind="num" className="w-20" onChange={(n) => setP({ units: n ?? 0 })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHeader title={l({ ru: "Общие расходы с Union Invest (в месяц, на оба бренда)", en: "Costs shared with Union Invest (per month, both brands)" })} desc={l({ ru: "50/50 — поровну; SALES — по доле продаж брендов", en: "50/50 — half each; SALES — by each brand's share of sales" })} />
          <table className="w-full text-[12.5px]">
            <tbody>
              {inputs.shared.map((s, i) => (
                <tr key={i} className="border-t border-border/60 first:border-0">
                  <td className="px-4 py-1.5">{s.name}</td>
                  <td className="px-2 text-right"><NumField value={s.amount} kind="money" onChange={(n) => set("shared", inputs.shared.map((x, j) => (j === i ? { ...x, amount: n ?? 0 } : x)))} /></td>
                  <td className="px-3 text-right">
                    <Select value={s.split} onChange={(e) => set("shared", inputs.shared.map((x, j) => (j === i ? { ...x, split: e.target.value as "50/50" | "SALES" } : x)))}>
                      <option value="50/50">50/50</option>
                      <option value="SALES">SALES</option>
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title={l({ ru: "По месяцам", en: "Month by month" })}
          desc={l({ ru: "Закрытые месяцы — факт из учёта; их значения здесь не используются", en: "Closed months are actual from the books; their values here are not used" })}
        />
        <div className="overflow-x-auto">
          <table className="text-[12px]">
            <thead>
              <tr className="text-[11.5px] text-muted">
                <th className="sticky left-0 z-10 min-w-[280px] bg-surface px-4 py-1.5 text-left font-normal" />
                {months.map((m) => (
                  <th key={m} className="px-1.5 py-1.5 text-right font-normal">
                    {shortMonth(m, locale)}
                    {closedSet.has(m) && <div className="text-ok">{l({ ru: "факт", en: "actual" })}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MONTHLY.map((row) => (
                <tr key={row.key} className="border-t border-border/60">
                  <td className="sticky left-0 z-10 bg-surface px-4 py-1">{l(row.label)}</td>
                  {months.map((m, i) => {
                    const v = inputs.monthly[row.key][i];
                    const disabled = closedSet.has(m);
                    if (row.key === "fargoReturns") {
                      return (
                        <td key={m} className="px-1 py-1">
                          <input
                            defaultValue={v === "all" ? l({ ru: "все", en: "all" }) : v ? numberInputText(v as number) : ""}
                            disabled={disabled}
                            onChange={(e) => {
                              const t = e.target.value.trim().toLowerCase();
                              setMonthly("fargoReturns", i, t === "all" || t === "все" ? "all" : parseNum(t) ?? 0);
                            }}
                            className="h-7 w-24 rounded-md border border-border bg-surface px-2 text-right text-[12px] outline-none focus:border-accent disabled:bg-background disabled:text-muted"
                          />
                        </td>
                      );
                    }
                    return (
                      <td key={m} className="px-1 py-1">
                        <NumField
                          value={v as number | null}
                          kind={row.kind}
                          blank={row.blank ? l(row.blank) : undefined}
                          disabled={disabled}
                          className="w-24"
                          onChange={(n) => setMonthly(row.key, i, row.blank ? n : n ?? 0)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {confirm && (
        <Modal title={confirm === "approve" ? l({ ru: "Сделать эту оценку исходным бюджетом?", en: "Make this estimate the original budget?" }) : l({ ru: "Вернуть оценку к исходному бюджету?", en: "Reset the estimate to the original budget?" })} onClose={() => setConfirm(null)}>
          <p className="mb-4 text-[13px] text-muted">
            {confirm === "approve"
              ? l({ ru: "Исходный бюджет — для итогов года; месяцы сравниваются с оценкой на их начало. Вместе с допущениями сохраняется сегодняшний план поставок. Текущий исходный бюджет сохранится на шаг назад.", en: "The original budget is for the year review; months are compared with the estimate at their start. Today's supply plan is kept with the assumptions. The current original budget is kept one step back." })
              : l({ ru: "Сохранённые допущения оценки заменятся допущениями исходного бюджета.", en: "The estimate's saved assumptions are replaced by the original budget's." })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirm(null)}>{l({ ru: "Отмена", en: "Cancel" })}</Button>
            <Button onClick={() => post({ action: confirm }, confirm === "approve" ? { ru: "Исходный бюджет обновлён", en: "Original budget updated" } : { ru: "Оценка = исходный бюджет", en: "Estimate reset to the original budget" })} disabled={busy}>
              {confirm === "approve" ? l({ ru: "Сделать исходным", en: "Make it the original" }) : l({ ru: "Вернуть", en: "Reset" })}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
