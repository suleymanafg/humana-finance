"use client";

// «Оценка и факт» — the supply plan against the books. A closed month, product
// by product: sales, month-end stock, trucks arrived and collected from DMK,
// each next to what the plan expected at the month's start. Below, sales month
// by month: closed months actual over their estimate, then the latest estimate.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { dstr, monthLong, monthShort, monthTag, pn } from "@/lib/planning/ui-format";
import type { SkuHead } from "@/lib/planning/plan-view";
import type { PlanMeasure, ReviewCell } from "@/lib/planning/plan-review";
import { SkuName } from "./PlanView";

type SourceKind = "start" | "earlier" | "hindsight";

export interface ReviewViewProps {
  skus: SkuHead[];
  closed: string[];
  review: { month: string; source: SourceKind; sourceMonth: string | null; takenAt: string | null; rows: { id: string; cells: Record<PlanMeasure, ReviewCell> }[] };
  trendMonths: string[];
  trendSources: Record<string, { kind: SourceKind; month: string | null }>;
  trend: { id: string; cells: { v: number | null; ref?: number | null; soFar?: number }[] }[];
  thisMonth: string;
  lastClosed: string;
  monthDone: number;
  keptAt: string | null;
  isAdmin: boolean;
}

const pctDiff = (act: number | null, est: number | null) => (act == null || est == null || est === 0 ? null : act / est - 1);

function Diff({ act, est, pct }: { act: number | null; est: number | null; pct?: boolean }) {
  if (act == null || est == null) return <span className="text-muted">—</span>;
  if (pct) {
    const d = pctDiff(act, est);
    if (d == null) return <span className="text-muted">—</span>;
    const off = Math.abs(d) > 0.1;
    return (
      <span className="pnum font-bold" style={{ color: off ? (d > 0 ? "var(--info)" : "var(--warn-ink)") : "var(--muted)" }}>
        {d > 0 ? "+" : "−"}
        {Math.abs(d * 100).toFixed(0)}%
      </span>
    );
  }
  const d = act - est;
  if (Math.abs(d) < 0.5) return <span className="text-muted">—</span>;
  return (
    <span className="pnum" style={{ color: d > 0 ? "var(--info)" : "var(--warn-ink)" }}>
      {d > 0 ? "+" : "−"}
      {pn(Math.abs(d))}
    </span>
  );
}

export default function ReviewView(props: ReviewViewProps) {
  const { skus, closed, review, trendMonths, trendSources, trend, thisMonth, lastClosed, monthDone, keptAt, isAdmin } = props;
  const { locale } = useT();
  const ru = locale === "ru";
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const name = (id: string) => skus.find((s) => s.id === id)?.name ?? id;
  const total = (k: PlanMeasure, f: "est" | "act") => {
    const vals = review.rows.map((r) => r.cells[k][f]);
    return vals.every((v) => v == null) ? null : vals.reduce((t: number, v) => t + (v ?? 0), 0);
  };
  const hindsight = review.source === "hindsight";

  const sourceText = (kind: SourceKind, month: string | null, takenAt: string | null) =>
    kind === "start"
      ? ru ? `оценка на начало месяца${takenAt ? ` (сохранена ${dstr(takenAt.slice(0, 10))})` : ""}` : `estimate at the month's start${takenAt ? ` (kept ${dstr(takenAt.slice(0, 10))})` : ""}`
      : kind === "earlier"
        ? ru ? `оценка на начало ${monthShort(month!, true).toLowerCase()}` : `estimate at the start of ${monthShort(month!, false)}`
        : ru ? "модель задним числом" : "the model in hindsight";

  async function keep() {
    const ok = confirm(
      keptAt
        ? ru ? `Оценка на начало ${monthLong(thisMonth, true).toLowerCase()} уже сохранена ${dstr(keptAt.slice(0, 10))}. Заменить текущей?` : `The estimate at the start of ${monthLong(thisMonth, false)} was kept on ${dstr(keptAt.slice(0, 10))}. Replace it with the current one?`
        : ru ? `Сохранить текущий план как оценку на начало ${monthLong(thisMonth, true).toLowerCase()}?` : `Keep the current plan as the estimate at the start of ${monthLong(thisMonth, false)}?`
    );
    if (!ok) return;
    setBusy(true);
    await fetch("/api/planning/estimate", { method: "POST" });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-muted">{ru ? "Закрытый месяц" : "Closed month"}</span>
        {closed.map((m) => (
          <Link
            key={m}
            href={`/planning/review?m=${m}`}
            className="rounded-md border px-2.5 py-1 text-[12.5px] font-bold"
            style={{ borderColor: m === review.month ? "var(--accent)" : "var(--border)", background: m === review.month ? "var(--accent)" : "var(--surface)", color: m === review.month ? "#fff" : undefined }}
          >
            {monthTag(m, ru)}
          </Link>
        ))}
        <span className="ml-auto flex items-center gap-2 text-[12px] font-semibold text-muted">
          {keptAt
            ? ru ? `Оценка на начало ${monthShort(thisMonth, true).toLowerCase()}: сохранена ${dstr(keptAt.slice(0, 10))}` : `Estimate at the start of ${monthShort(thisMonth, false)}: kept ${dstr(keptAt.slice(0, 10))}`
            : ru ? `Оценка на начало ${monthShort(thisMonth, true).toLowerCase()} сохранится при закрытии ${monthShort(lastClosed, true).toLowerCase()}` : `The estimate at the start of ${monthShort(thisMonth, false)} is kept when ${monthShort(lastClosed, false)} closes`}
          {isAdmin && (
            <button type="button" disabled={busy} onClick={() => void keep()} className="rounded-md border border-border px-2.5 py-1 font-bold">
              {busy ? "…" : keptAt ? (ru ? "Сохранить заново" : "Keep again") : ru ? "Сохранить сейчас" : "Keep now"}
            </button>
          )}
        </span>
      </div>

      <section className="pcard overflow-hidden">
        <div className="flex flex-wrap items-baseline gap-3 border-b px-5 py-3" style={{ borderColor: "var(--hair)" }}>
          <h2 className="text-[14px] font-extrabold">{monthLong(review.month, ru)}</h2>
          <span className="text-[11.5px] font-semibold text-muted">
            {ru ? "оценка — " : "estimate — "}
            {sourceText(review.source, review.sourceMonth, review.takenAt)}
            {hindsight && (ru ? "; запас и фуры сравнятся с месяцев, для которых сохранена оценка на начало" : "; stock and trucks compare from the months whose start estimate was kept")}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="ptable text-[12.5px]">
            <thead>
              <tr>
                <th rowSpan={2}>{ru ? "Товар" : "Product"}</th>
                <th colSpan={3} className="!text-center">{ru ? "Продажи, шт" : "Sales, units"}</th>
                <th colSpan={3} className="!text-center">{ru ? "Запас на конец" : "Month-end stock"}</th>
                <th colSpan={2} className="!text-center">{ru ? "Пришло фурами" : "Arrived by truck"}</th>
                <th colSpan={2} className="!text-center">{ru ? "Забрано у DMK" : "Collected from DMK"}</th>
              </tr>
              <tr>
                <th>{ru ? "оценка" : "est."}</th>
                <th>{ru ? "факт" : "actual"}</th>
                <th>Δ</th>
                <th>{ru ? "оценка" : "est."}</th>
                <th>{ru ? "факт" : "actual"}</th>
                <th>Δ</th>
                <th>{ru ? "оценка" : "est."}</th>
                <th>{ru ? "факт" : "actual"}</th>
                <th>{ru ? "оценка" : "est."}</th>
                <th>{ru ? "факт" : "actual"}</th>
              </tr>
            </thead>
            <tbody>
              {review.rows.map((r) => (
                <tr key={r.id}>
                  <td><SkuName name={name(r.id)} /></td>
                  <td className="pnum text-muted">{pn(r.cells.sold.est)}</td>
                  <td className="pnum font-bold">{pn(r.cells.sold.act)}</td>
                  <td><Diff act={r.cells.sold.act} est={r.cells.sold.est} pct /></td>
                  <td className="pnum text-muted">{pn(r.cells.stockEnd.est)}</td>
                  <td className="pnum font-bold">{pn(r.cells.stockEnd.act)}</td>
                  <td><Diff act={r.cells.stockEnd.act} est={r.cells.stockEnd.est} /></td>
                  <td className="pnum text-muted">{pn(r.cells.arrivals.est)}</td>
                  <td className="pnum">{pn(r.cells.arrivals.act)}</td>
                  <td className="pnum text-muted">{pn(r.cells.pickups.est)}</td>
                  <td className="pnum">{pn(r.cells.pickups.act)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{ru ? "Итого" : "Total"}</td>
                <td className="pnum">{pn(total("sold", "est"))}</td>
                <td className="pnum">{pn(total("sold", "act"))}</td>
                <td><Diff act={total("sold", "act")} est={total("sold", "est")} pct /></td>
                <td className="pnum">{pn(total("stockEnd", "est"))}</td>
                <td className="pnum">{pn(total("stockEnd", "act"))}</td>
                <td><Diff act={total("stockEnd", "act")} est={total("stockEnd", "est")} /></td>
                <td className="pnum">{pn(total("arrivals", "est"))}</td>
                <td className="pnum">{pn(total("arrivals", "act"))}</td>
                <td className="pnum">{pn(total("pickups", "est"))}</td>
                <td className="pnum">{pn(total("pickups", "act"))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="px-5 py-3 text-[11.5px] font-semibold text-muted">
          {ru
            ? "Продажи — по 1С (продажи дилерам, не потребителям); запас — по учёту на конец месяца (TI + Fargo); фуры — по странице поставок. Отклонение продаж больше 10% выделено."
            : "Sales from 1C (sell-in, not consumer sell-out); stock from the books at month-end (TI + Fargo); trucks from Shipments. A sales gap over 10% is highlighted."}
        </p>
      </section>

      <section className="pcard overflow-hidden">
        <div className="flex flex-wrap items-baseline gap-3 border-b px-5 py-3" style={{ borderColor: "var(--hair)" }}>
          <h2 className="text-[14px] font-extrabold">{ru ? "Продажи по месяцам" : "Sales by month"}</h2>
          <span className="text-[11.5px] font-semibold text-muted">
            {ru ? "закрытые месяцы — факт, под ним оценка и отклонение; дальше — последняя оценка" : "closed months — actual, below it the estimate and the gap; then the latest estimate"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="ptable text-[12.5px]">
            <thead>
              <tr>
                <th>{ru ? "Товар" : "Product"}</th>
                {trendMonths.map((m) => {
                  const s = trendSources[m];
                  const kind = m <= lastClosed ? (ru ? "факт" : "actual") : m === thisMonth ? (ru ? `идёт · ${Math.round(monthDone * 100)}%` : `running · ${Math.round(monthDone * 100)}%`) : ru ? "оценка" : "estimate";
                  return (
                    <th key={m} className="!text-center" title={m <= thisMonth ? `${ru ? "оценка" : "estimate"}: ${sourceText(s.kind, s.month, null)}` : undefined} style={m === thisMonth ? { background: "var(--info-soft)" } : undefined}>
                      <div>{monthShort(m, ru)}</div>
                      <div className="text-[10px] font-bold opacity-80">{kind}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {trend.map((r) => (
                <tr key={r.id}>
                  <td><SkuName name={name(r.id)} /></td>
                  {r.cells.map((c, i) => {
                    const m = trendMonths[i];
                    return (
                      <td key={m} className="pnum !text-center" style={m === thisMonth ? { background: "var(--info-soft)" } : undefined}>
                        <div className={m <= lastClosed ? "font-bold" : undefined}>{pn(c.v)}</div>
                        {m <= lastClosed && c.ref != null && (
                          <div className="text-[10.5px] text-muted">
                            {pn(c.ref)} <Diff act={c.v} est={c.ref} pct />
                          </div>
                        )}
                        {m === thisMonth && c.soFar != null && (
                          <div className="text-[10.5px] text-muted">{ru ? "продано" : "sold"} {pn(c.soFar)}</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 text-[11.5px] font-semibold text-muted">
          {ru
            ? "Пока оценка на начало месяца не сохранялась, прошлые месяцы сравниваются с моделью задним числом (сегодняшняя модель на рецептах того месяца) — это проверка модели, а не план того времени."
            : "Until a start-of-month estimate is kept, past months are compared with the model in hindsight (today's model on that month's prescriptions) — a check of the model, not the plan of the time."}
        </p>
      </section>
    </div>
  );
}
