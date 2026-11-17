"use client";

// «Заказы» — the IBP by ship month, 15 months out, as it is entered: nothing
// here is a proposal except the one month whose IBP is due, which shows the
// advice (counted on top of the orders already made) next to what is entered.
// Under each month: the trucks the app has for it, and the stock its sell
// month would end with if everything ordered is taken in its month.
import { useT } from "@/lib/locale-context";
import { dstr, monthShort, monthTag, pn } from "@/lib/planning/ui-format";
import type { PipelineView, SkuHead } from "@/lib/planning/plan-view";
import { SkuName, trucksWord, uzs } from "./PlanView";

export interface PlanOrdersViewProps {
  shipMonths: string[];
  skus: SkuHead[];
  pipeline: PipelineView[];
  ibpEntered: Record<string, Record<string, number>>; // ship month -> sku -> qty
  dueShip: string;
  dueDeadline: string;
  /** the advice for the due month: units to have in the IBP, and the trucks they make */
  dueAdvice: Record<string, number>;
  dueTrucks: number;
  frozenThrough: string;
  /** by ship month: its sell month, the stock (months of sales) at that month's end with everything ordered taken, the target */
  cover: Record<string, { sellMonth: string; cover: number; target: number }>;
  eurRate: number;
  dangerLine: number;
}

export default function PlanOrdersView(props: PlanOrdersViewProps) {
  const { shipMonths, skus, pipeline, ibpEntered, dueShip, dueDeadline, dueAdvice, dueTrucks, frozenThrough, cover, eurRate, dangerLine } = props;
  const { locale } = useT();
  const ru = locale === "ru";
  const trucksIn = (m: string) => pipeline.filter((t) => t.shipMonth === m);
  const entered = (m: string, id: string) => ibpEntered[m]?.[id] ?? 0;
  const shown = (m: string, id: string) => (m === dueShip ? dueAdvice[id] ?? 0 : entered(m, id));
  const totalOf = (m: string, pick: (m: string, id: string) => number) => skus.reduce((t, s) => t + pick(m, s.id), 0);
  const eurOf = (m: string) => skus.reduce((t, s) => t + shown(m, s.id) * s.priceEur, 0);
  const kindOf = (m: string) => (m <= frozenThrough ? "closed" : m === dueShip ? "due" : "open");
  const KIND: Record<string, [string, string]> = {
    closed: ["IBP закрыт", "IBP closed"],
    due: [`ввести до ${dstr(dueDeadline).slice(0, 5)}`, `enter by ${dstr(dueDeadline).slice(0, 5)}`],
    open: ["IBP открыт", "IBP open"],
  };
  const dueStyle = { background: "var(--info-soft)" };

  return (
    <section className="pcard overflow-hidden">
      <div className="px-5 py-3.5">
        <h2 className="text-[15px] font-extrabold">{ru ? "IBP по месяцам отгрузки" : "The IBP by ship month"}</h2>
        <p className="mt-0.5 max-w-[86ch] text-[12px] font-semibold text-muted">
          {ru
            ? `Числа — то, что введено в IBP сейчас. Совет показан только для ${monthTag(dueShip, true)} (ввести до ${dstr(dueDeadline)}): он посчитан поверх уже заказанного и не зависит от советов по другим месяцам.`
            : `The numbers are what the IBP holds now. Advice is shown only for ${monthTag(dueShip, false)} (enter by ${dstr(dueDeadline)}): it is counted on top of what is already ordered and does not depend on advice for other months.`}
        </p>
      </div>
      <div className="overflow-x-auto border-t" style={{ borderColor: "var(--hair)" }}>
        <table className="ptable text-[12.5px]">
          <thead>
            <tr>
              <th>{ru ? "Товар" : "Product"}</th>
              {shipMonths.map((m) => (
                <th key={m} className="!text-center" style={m === dueShip ? { background: "var(--accent)", color: "#fff" } : undefined}>
                  <div>{monthShort(m, ru)} {m.slice(2, 4)}</div>
                  <div className="text-[10px] font-bold opacity-80">{KIND[kindOf(m)][ru ? 0 : 1]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skus.map((s) => (
              <tr key={s.id}>
                <td><SkuName name={s.name} /></td>
                {shipMonths.map((m) => {
                  const v = shown(m, s.id);
                  const now = entered(m, s.id);
                  const changed = m === dueShip && Math.abs(v - now) >= 0.5;
                  return (
                    <td key={m} className="pnum !text-center" style={m === dueShip ? dueStyle : m <= frozenThrough ? { color: "var(--muted)" } : undefined}>
                      <div className={changed ? "font-extrabold" : undefined}>{v ? pn(v) : "—"}</div>
                      {changed && (
                        <div className="text-[10.5px] font-bold" style={{ color: v > now ? "var(--info)" : "var(--warn-ink)" }}>
                          {ru ? "сейчас" : "now"} {now ? pn(now) : "0"}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>{ru ? "Итого, шт" : "Total, units"}</td>
              {shipMonths.map((m) => {
                const now = totalOf(m, entered);
                const v = totalOf(m, shown);
                return (
                  <td key={m} className="pnum !text-center" style={m === dueShip ? dueStyle : undefined}>
                    {v ? pn(v) : "—"}
                    {m === dueShip && Math.abs(v - now) >= 0.5 && (
                      <div className="text-[10.5px] font-bold text-muted">
                        {ru ? "сейчас" : "now"} {pn(now)}
                      </div>
                    )}
                    {m === dueShip && dueTrucks > 0 && (
                      <div className="text-[10.5px] font-bold text-muted">
                        {dueTrucks} {trucksWord(dueTrucks, ru)}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
            <tr>
              <td>{ru ? "Фуры заведены" : "Trucks in the app"}</td>
              {shipMonths.map((m) => {
                const known = trucksIn(m);
                return (
                  <td key={m} className="!text-center text-muted" style={m === dueShip ? dueStyle : undefined}>
                    {known.length > 0 ? known.map((t) => t.code.replace(/^Truck\s*/i, "#")).join(" ") : "—"}
                  </td>
                );
              })}
            </tr>
            <tr>
              <td>{ru ? "В продаже с" : "On the shelf from"}</td>
              {shipMonths.map((m) => (
                <td key={m} className="!text-center text-muted" style={m === dueShip ? dueStyle : undefined}>
                  {cover[m] ? monthShort(cover[m].sellMonth, ru) : "—"}
                </td>
              ))}
            </tr>
            <tr>
              <td>{ru ? "Запас на конец того месяца, мес." : "Stock at that month's end, months"}</td>
              {shipMonths.map((m) => {
                const c = cover[m];
                if (!c) return <td key={m} className="!text-center text-muted">—</td>;
                const tone = c.cover < dangerLine ? "out" : c.cover < c.target - 0.25 ? "low" : "ok";
                const bg = tone === "out" ? "var(--danger-soft)" : tone === "low" ? "var(--warn-soft)" : "var(--ok-soft)";
                const fg = tone === "out" ? "var(--danger)" : tone === "low" ? "var(--warn-ink)" : "var(--ok-ink)";
                return (
                  <td key={m} className="!px-1 !py-1.5">
                    <div
                      title={ru ? `цель ${c.target} мес.` : `target ${c.target} mo`}
                      className="pnum flex h-8 min-w-[52px] items-center justify-center rounded-md text-[12px] font-bold"
                      style={{ background: bg, color: fg }}
                    >
                      {c.cover >= 24 ? "24+" : c.cover.toFixed(1)}
                    </div>
                  </td>
                );
              })}
            </tr>
            <tr>
              <td>{ru ? "Стоимость, € тыс." : "Value, € k"}</td>
              {shipMonths.map((m) => {
                const eur = eurOf(m);
                return (
                  <td key={m} className="pnum !text-center text-muted" style={m === dueShip ? dueStyle : undefined} title={eur ? uzs(eur, eurRate, ru) : undefined}>
                    {eur ? pn(eur / 1000) : "—"}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-5 py-3 text-[11.5px] font-semibold text-muted">
        {ru
          ? "«Запас на конец того месяца» — сколько месяцев продаж останется на складе в конце месяца, когда груз поступит в продажу, если всё заказанное в IBP забрать в свой месяц (цель — в подсказке). Зелёный — у цели, жёлтый — ниже цели, красный — ниже опасной черты: такой месяц стоит увеличить, пока его IBP открыт."
          : "“Stock at that month's end” — months of sales left in the warehouse at the end of the month the load becomes sellable, if everything ordered in the IBP is taken in its month (the target is in the tooltip). Green — at the target, amber — under it, red — under the danger line: such a month is worth raising while its IBP is open."}
      </p>
    </section>
  );
}
