"use client";

// «Заказы» — the plan by ship month, 15 months out: what each load carries
// (whole pallets, full trucks), and what to have in the IBP for it next to
// what is there now. Months whose deadline has passed take only what is in
// the IBP; trucks already in the app (planned … at customs) stand for their
// ship month.
import { useState } from "react";
import { useT } from "@/lib/locale-context";
import { dstr, monthShort, monthTag, pn } from "@/lib/planning/ui-format";
import type { LoadView, PipelineView, SkuHead } from "@/lib/planning/plan-view";
import { SkuName, pct, trucksWord, uzs } from "./PlanView";

export interface PlanOrdersViewProps {
  shipMonths: string[];
  skus: SkuHead[];
  loads: LoadView[];
  pipeline: PipelineView[];
  ibpEntered: Record<string, Record<string, number>>; // ship month -> sku -> qty
  dueShip: string;
  frozenThrough: string;
  extraThrough: string;
  eurRate: number;
  minFill: number;
}

type Mode = "ibp" | "load";

export default function PlanOrdersView(props: PlanOrdersViewProps) {
  const { shipMonths, skus, loads, pipeline, ibpEntered, dueShip, frozenThrough, extraThrough, eurRate, minFill } = props;
  const { locale } = useT();
  const ru = locale === "ru";
  const [mode, setMode] = useState<Mode>("ibp");
  const loadOf = (m: string) => loads.find((l) => l.shipMonth === m);
  const trucksIn = (m: string) => pipeline.filter((t) => t.shipMonth === m);
  const entered = (m: string, id: string) => ibpEntered[m]?.[id] ?? 0;

  const cell = (m: string, id: string): { main: number | null; now?: number; known?: boolean } => {
    const l = loadOf(m);
    const known = trucksIn(m);
    if (known.length > 0) {
      const u = known.reduce((t, x) => t + (x.units[id] ?? 0), 0);
      return { main: mode === "load" ? u : entered(m, id), known: true };
    }
    if (mode === "load") return { main: l?.units[id] ?? 0 };
    return { main: l?.ibpToEnter[id] ?? 0, now: entered(m, id) };
  };

  const kindOf = (m: string) => (trucksIn(m).length > 0 ? "known" : m <= extraThrough ? "pickup" : m <= frozenThrough ? "frozen" : "open");
  const KIND: Record<string, [string, string]> = {
    known: ["фуры заведены", "trucks in"],
    pickup: ["забор", "pick-up"],
    frozen: ["IBP закрыт", "IBP closed"],
    open: ["IBP открыт", "IBP open"],
  };

  const totalOf = (m: string, pick: (id: string) => number) => skus.reduce((t, s) => t + pick(s.id), 0);

  return (
    <section className="pcard overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3" style={{ borderColor: "var(--hair)" }}>
        <h2 className="text-[14px] font-extrabold">{ru ? "План по месяцам отгрузки" : "Plan by ship month"}</h2>
        <span className="text-[11.5px] font-semibold text-muted">
          {ru
            ? `до ${monthTag(frozenThrough, true)} — берём только то, что в IBP; ${monthTag(dueShip, true)} — ввести до ${dstr(`${dueShipDeadline(dueShip)}`)}`
            : `through ${monthTag(frozenThrough, false)} — only what is in the IBP; ${monthTag(dueShip, false)} — enter by ${dstr(dueShipDeadline(dueShip))}`}
        </span>
        <span className="ml-auto flex rounded-lg border border-border bg-surface p-0.5">
          {(["ibp", "load"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setMode(k)}
              className="rounded-md px-3 py-1 text-[12px] font-bold"
              style={{ background: mode === k ? "var(--accent)" : "transparent", color: mode === k ? "#fff" : "var(--muted)" }}
            >
              {k === "ibp" ? (ru ? "IBP: ввести / сейчас" : "IBP: enter / now") : ru ? "Состав фур" : "Truck loads"}
            </button>
          ))}
        </span>
      </div>
      <div className="overflow-x-auto">
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
                  const c = cell(m, s.id);
                  const diff = c.now !== undefined && c.main !== null ? c.main - c.now : 0;
                  const changed = mode === "ibp" && kindOf(m) !== "known" && kindOf(m) !== "pickup" && Math.abs(diff) >= 0.5;
                  return (
                    <td key={m} className="pnum !text-center" style={{ color: c.known ? "var(--muted)" : undefined, background: m === dueShip ? "var(--info-soft)" : undefined }}>
                      <div className={changed ? "font-extrabold" : undefined}>{c.main ? pn(c.main) : "—"}</div>
                      {changed && (
                        <div className="text-[10.5px] font-bold" style={{ color: diff > 0 ? "var(--info)" : "var(--warn-ink)" }}>
                          {ru ? "сейчас" : "now"} {pn(c.now)}
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
              <td>{mode === "ibp" ? (ru ? "Итого в IBP, шт" : "IBP total, units") : ru ? "Итого, шт" : "Total, units"}</td>
              {shipMonths.map((m) => (
                <td key={m} className="pnum !text-center">{pn(totalOf(m, (id) => cell(m, id).main ?? 0))}</td>
              ))}
            </tr>
            <tr>
              <td>{ru ? "Фуры · загрузка" : "Trucks · fill"}</td>
              {shipMonths.map((m) => {
                const known = trucksIn(m);
                const l = loadOf(m);
                if (known.length > 0) return <td key={m} className="!text-center text-muted">{known.map((t) => t.code.replace(/^Truck\s*/i, "#")).join(" ")}</td>;
                if (!l) return <td key={m} className="!text-center text-muted">—</td>;
                return (
                  <td key={m} className="pnum !text-center" style={{ color: l.underFilled || l.fill < minFill ? "var(--warn-ink)" : undefined }}>
                    {l.trucks} {trucksWord(l.trucks, ru)}
                    <div className="text-[10.5px] text-muted">{pct(l.fill, ru)}</div>
                  </td>
                );
              })}
            </tr>
            <tr>
              <td>{ru ? "Паллет" : "Pallets"}</td>
              {shipMonths.map((m) => {
                const known = trucksIn(m);
                const v = known.length > 0 ? known.reduce((t, x) => t + x.pallets, 0) : loadOf(m)?.pallets ?? 0;
                return <td key={m} className="pnum !text-center text-muted">{v ? pn(v) : "—"}</td>;
              })}
            </tr>
            <tr>
              <td>{ru ? "В продаже с" : "On the shelf"}</td>
              {shipMonths.map((m) => {
                const known = trucksIn(m);
                const sm = known.length > 0 ? known[0].sellMonth : loadOf(m)?.sellMonth;
                return <td key={m} className="!text-center text-muted">{sm ? monthShort(sm, ru) : "—"}</td>;
              })}
            </tr>
            <tr>
              <td>{ru ? "Оплата, € тыс." : "Payment, € k"}</td>
              {shipMonths.map((m) => {
                const l = loadOf(m);
                return (
                  <td key={m} className="pnum !text-center text-muted" title={l ? uzs(l.eur, eurRate, ru) : undefined}>
                    {l ? pn(l.eur / 1000) : "—"}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-5 py-3 text-[11.5px] font-semibold text-muted">
        {ru
          ? "«IBP: ввести / сейчас» — число, которое должно стоять в IBP на месяц отгрузки (загрузка фуры минус то, что уже ждёт у DMK); жирным — где оно отличается от введённого. Месяцы забора: можно просить HQ добавить сверх IBP."
          : "«IBP: enter / now» — the number the IBP should hold for the ship month (the load less what already waits at DMK); bold where it differs from what is entered. Pick-up months: HQ can be asked to add on top of the IBP."}
      </p>
    </section>
  );
}

/** the 20th of the ship month − 4 */
function dueShipDeadline(shipMonth: string): string {
  const [y, m] = shipMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - 4, 20));
  return d.toISOString().slice(0, 10);
}
