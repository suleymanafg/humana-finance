// «Капитал» — the budget section's answer for shareholders: how much money to
// bring in and when, where it is tied up, how the number is reached and what
// could change it. The forecast (closed months actual, the rest plan from the
// real balances) next to the approved budget.
import { pageContext, type SearchParams } from "@/lib/page-context";
import { loadBudget, statusInfo } from "@/lib/budget/data";
import { BUDGET_STATEMENTS, statementGrid } from "@/lib/budget/statements";
import { fmtN } from "@/lib/format";
import { shortMonth } from "@/lib/statement-ui";
import { Figure, SectionTitle } from "@/components/statement";
import { BudgetEmpty, BudgetStatus } from "@/components/budget/BudgetStatus";

export const dynamic = "force-dynamic";

export default async function BudgetCapitalPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const data = await loadBudget();
  if (data.empty) return <BudgetEmpty />;
  const { l, locale } = ctx;
  const m = (id: string | null) => (id ? shortMonth(id, locale) : "—");
  const f = (v: number | null | undefined) => (v == null || Math.abs(v) < 0.5 ? "—" : fmtN(v));
  const fc = data.planCapital;
  const bc = data.budgetCapital;
  const alreadyIn = data.actuals.reduce((t, a) => t + a.cash.capital, 0);
  const still = fc ? Math.max(0, fc.ask - alreadyIn) : 0;

  // bring-in schedule: the forecast's months, net of what shareholders already put in
  const schedule = fc && data.plan
    ? data.plan.months.map((month, i) => {
        const cum = Math.max(0, fc.monthly.neededBy[i] - alreadyIn);
        const prev = i === 0 ? 0 : Math.max(0, fc.monthly.neededBy[i - 1] - alreadyIn);
        const bi = data.budget.months.indexOf(month);
        return { month, bring: cum - prev, cum, budgetBring: bi >= 0 ? bc.monthly.bringIn[bi] : null };
      }).filter((r) => Math.abs(r.bring) >= 0.5 || (r.budgetBring ?? 0) >= 0.5)
    : [];

  // the year at a glance: forecast totals include the closed months' actuals
  const pnl = (basis: "forecast" | "budget") => statementGrid(BUDGET_STATEMENTS.pnl, data.months, data, basis);
  const grids = { forecast: pnl("forecast"), budget: pnl("budget") };
  const yearValue = (basis: "forecast" | "budget", key: string, year: string) => {
    const g = grids[basis];
    const col = g.columns.findIndex((c) => c.key === `y${year}`);
    return g.rows.find((r) => r.key === key)?.values[col] ?? null;
  };
  const years = ["2026", "2027"];
  const glance = [
    { key: "tiUnits", label: { ru: "Продано TI напрямую, шт.", en: "Units sold directly by TI" } },
    { key: "fargoUnits", label: { ru: "Продано через Fargo, шт.", en: "Units sold through Fargo" } },
    { key: "net", label: { ru: "Чистая выручка", en: "Net revenue" } },
    { key: "gp", label: { ru: "Валовая прибыль", en: "Gross profit" } },
    { key: "ebitda", label: { ru: "Операционная прибыль (EBITDA)", en: "Operating profit (EBITDA)" } },
    { key: "np", label: { ru: "Чистая прибыль", en: "Net profit" } },
  ];

  const tied = [
    { label: { ru: "Товар на складе", en: "Stock in warehouse" }, f: fc?.tiedAtPeak.stock, b: bc.tiedAtPeak.stock },
    { label: { ru: "Оплачено HQ, в пути", en: "Paid to Humana HQ, on the way" }, f: fc?.tiedAtPeak.transit, b: bc.tiedAtPeak.transit },
    { label: { ru: "Долг покупателей", en: "Customers owe us" }, f: fc?.tiedAtPeak.customersOwe, b: bc.tiedAtPeak.customersOwe },
    { label: { ru: "У Fargo, пока не заплатит", en: "With Fargo until it pays" }, f: fc?.tiedAtPeak.withFargo, b: bc.tiedAtPeak.withFargo },
    { label: { ru: "Резерв денег", en: "Cash reserve" }, f: fc?.tiedAtPeak.reserve, b: bc.tiedAtPeak.reserve },
  ];
  const whatIf = fc
    ? [
        { label: { ru: "Если Fargo больше ничего не заплатит", en: "If Fargo pays nothing more" }, v: fc.whatIf.fargoStops, note: { ru: "нужно было бы", en: "we would need" } },
        { label: { ru: "Если Fargo пропустит следующий месяц и заплатит позже", en: "If Fargo skips next month and pays later" }, v: fc.whatIf.fargoSkipsSecondMonth, note: { ru: "нужно было бы", en: "we would need" } },
        { label: { ru: "Держать на 1 месяц запаса меньше", en: "Hold 1 month less stock" }, v: fc.whatIf.oneMonthLessStock, note: { ru: "освобождает", en: "frees about" } },
        { label: { ru: "Покупатели платят на 10 дней быстрее", en: "Customers pay 10 days sooner" }, v: fc.whatIf.tenFewerDays, note: { ru: "освобождает", en: "frees about" } },
        { label: { ru: "Продажи +10%", en: "Sell 10% more" }, v: fc.whatIf.tenPctMoreSales, note: { ru: "связывает ещё", en: "ties up about" } },
      ]
    : [];
  const checks = fc
    ? [
        { ok: fc.checks.balances, label: { ru: "Баланс сходится в каждом месяце", en: "The balance sheet balances every month" } },
        { ok: fc.checks.noStockOut, label: { ru: "Товар не заканчивается (TI и Fargo)", en: "Stock never runs out (TI and Fargo)" } },
        { ok: fc.checks.channelsAddUp, label: { ru: "Доли каналов = 100%", en: "Channel shares add up to 100%" } },
        { ok: fc.checks.timingAddsUp, label: { ru: "Оплата HQ = 100%", en: "HQ payment timing adds up to 100%" } },
        { ok: fc.checks.bridgeTies, label: { ru: "Расчёт сходится с ответом", en: "The bridge equals the answer" } },
      ]
    : [];

  return (
    <>
      <BudgetStatus info={statusInfo(data)} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Figure
          label={l({ ru: "Просим у акционеров", en: "Ask shareholders for" })}
          value={fmtN(still)}
          sub={still > 0.5 ? l({ ru: `впервые нужно в ${m(fc?.firstNeeded ?? null)}`, en: `first needed in ${m(fc?.firstNeeded ?? null)}` }) : l({ ru: "новые деньги не нужны", en: "no new money needed" })}
        />
        <Figure
          label={l({ ru: "В утверждённом бюджете", en: "In the approved budget" })}
          value={fmtN(bc.ask)}
          sub={bc.firstNeeded ? l({ ru: `с ${m(bc.firstNeeded)}`, en: `from ${m(bc.firstNeeded)}` }) : l({ ru: "не нужно", en: "not needed" })}
        />
        <Figure
          label={l({ ru: "Самый узкий месяц", en: "Tightest month" })}
          value={m(fc?.worstMonth ?? null)}
          tone={(fc?.headroom ?? 0) < 0 ? "neg" : undefined}
          sub={
            (fc?.headroom ?? 0) >= 0
              ? l({ ru: `${fmtN(fc?.headroom)} сверх резерва`, en: `${fmtN(fc?.headroom)} above the reserve` })
              : l({ ru: `${fmtN(-(fc?.headroom ?? 0))} ниже резерва`, en: `${fmtN(-(fc?.headroom ?? 0))} below the reserve` })
          }
        />
        <Figure
          label={l({ ru: "Уже внесено с окт 2026", en: "Already put in since Oct 2026" })}
          value={fmtN(alreadyIn)}
          sub={l({ ru: "по закрытым месяцам", en: "in the closed months" })}
        />
        <Figure
          label={l({ ru: "Деньги в обороте на пике", en: "Money tied up at the peak" })}
          value={fmtN(fc?.tiedAtPeak.total)}
          sub={m(fc?.peakMonth ?? null)}
        />
        <Figure
          label={l({ ru: "Буфер на рост продаж (рекомендуем)", en: "Buffer for a sales jump (recommended)" })}
          value={fmtN(bc.spikeBuffer)}
          sub={l({ ru: "по желанию, из бюджета", en: "optional, from the budget" })}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div>
          <SectionTitle>{l({ ru: "Когда вносить деньги", en: "When to bring the money in" })}</SectionTitle>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <table className="stmt">
              <thead>
                <tr>
                  <th className="sticky-col">{l({ ru: "Месяц", en: "Month" })}</th>
                  <th>{l({ ru: "Прогноз: внести", en: "Forecast: bring in" })}</th>
                  <th>{l({ ru: "Всего к этому месяцу", en: "Total by then" })}</th>
                  <th>{l({ ru: "Бюджет: внести", en: "Budget: bring in" })}</th>
                </tr>
              </thead>
              <tbody>
                {schedule.length === 0 ? (
                  <tr className="is-line">
                    <td className="sticky-col" colSpan={4}>{l({ ru: "Деньги не нужны ни в одном месяце", en: "No money is needed in any month" })}</td>
                  </tr>
                ) : (
                  schedule.map((r) => (
                    <tr key={r.month} className="is-line">
                      <td className="sticky-col">{m(r.month)}</td>
                      <td>{f(r.bring)}</td>
                      <td>{f(r.cum)}</td>
                      <td className="text-muted">{f(r.budgetBring)}</td>
                    </tr>
                  ))
                )}
                <tr className="is-total">
                  <td className="sticky-col">{l({ ru: "Итого", en: "Total" })}</td>
                  <td>{f(still)}</td>
                  <td />
                  <td>{f(bc.ask)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <SectionTitle>{l({ ru: `Где деньги на пике (${m(fc?.peakMonth ?? null)})`, en: `Where the money is tied up at the peak (${m(fc?.peakMonth ?? null)})` })}</SectionTitle>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <table className="stmt">
              <thead>
                <tr>
                  <th className="sticky-col" />
                  <th>{l({ ru: "Прогноз", en: "Forecast" })}</th>
                  <th>{l({ ru: `Бюджет (${m(bc.peakMonth)})`, en: `Budget (${m(bc.peakMonth)})` })}</th>
                </tr>
              </thead>
              <tbody>
                {tied.map((r) => (
                  <tr key={r.label.en} className="is-line">
                    <td className="sticky-col">{l(r.label)}</td>
                    <td>{f(r.f)}</td>
                    <td className="text-muted">{f(r.b)}</td>
                  </tr>
                ))}
                <tr className="is-total">
                  <td className="sticky-col">{l({ ru: "Нужно бизнесу", en: "Money the business needs" })}</td>
                  <td>{f(fc?.tiedAtPeak.total)}</td>
                  <td>{f(bc.tiedAtPeak.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          {fc && (
            <>
              <SectionTitle>{l({ ru: `Как получается ответ (${m(data.plan!.months[fc.bridge.month])})`, en: `How we get to the number (${m(data.plan!.months[fc.bridge.month])})` })}</SectionTitle>
              <div className="overflow-hidden rounded-lg border border-border bg-surface">
                <table className="stmt">
                  <tbody>
                    <tr className="is-line"><td className="sticky-col">{l({ ru: "Деньги, нужные бизнесу в этом месяце", en: "Money the business needs that month" })}</td><td>{f(fc.bridge.needed)}</td></tr>
                    <tr className="is-line"><td className="sticky-col">{l({ ru: "− Собственные средства на 30 сен 2026", en: "− Own funds on 30 Sep 2026" })}</td><td>{f(fc.bridge.ownFunds)}</td></tr>
                    <tr className="is-line"><td className="sticky-col">{l({ ru: "− Прибыль (+ убыток) с окт 2026", en: "− Profit (+ loss) since Oct 2026" })}</td><td>{f(fc.bridge.profit)}</td></tr>
                    <tr className="is-line"><td className="sticky-col">{l({ ru: "− Неоплаченные налоги, займы и счета", en: "− Taxes, loans and bills not yet paid" })}</td><td>{f(fc.bridge.unpaid)}</td></tr>
                    <tr className="is-total"><td className="sticky-col">{l({ ru: "= Капитал от акционеров (всего с окт 2026)", en: "= Shareholder capital (in all since Oct 2026)" })}</td><td>{f(Math.max(0, fc.bridge.total))}</td></tr>
                  </tbody>
                </table>
              </div>

              <SectionTitle>{l({ ru: "Что может изменить ответ", en: "What could change the answer" })}</SectionTitle>
              <div className="overflow-hidden rounded-lg border border-border bg-surface">
                <table className="stmt">
                  <tbody>
                    {whatIf.map((w) => (
                      <tr key={w.label.en} className="is-line">
                        <td className="sticky-col">{l(w.label)} <span className="text-muted">— {l(w.note)}</span></td>
                        <td>{f(w.v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <SectionTitle>{l({ ru: "Бизнес в целом", en: "The business at a glance" })}</SectionTitle>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <table className="stmt">
              <thead>
                <tr>
                  <th className="sticky-col" />
                  {years.map((y) => (
                    <th key={y}>{y === "2026" ? l({ ru: "Окт–дек 2026", en: "Oct–Dec 2026" }) : y}</th>
                  ))}
                  {years.map((y) => (
                    <th key={`b${y}`} className="text-muted">{l({ ru: `Бюджет ${y === "2026" ? "окт–дек 26" : y}`, en: `Budget ${y === "2026" ? "Oct–Dec 26" : y}` })}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {glance.map((g) => (
                  <tr key={g.key} className="is-line">
                    <td className="sticky-col">{l(g.label)}</td>
                    {years.map((y) => <td key={y}>{f(yearValue("forecast", g.key, y))}</td>)}
                    {years.map((y) => <td key={`b${y}`} className="text-muted">{f(yearValue("budget", g.key, y))}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SectionTitle>{l({ ru: "Проверки", en: "Checks" })}</SectionTitle>
          <ul className="space-y-1 text-[13px]">
            {checks.map((c) => (
              <li key={c.label.en} className={c.ok ? "text-ok" : "text-danger"}>
                {c.ok ? "✓" : "✗"} {l(c.label)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
