"use client";

// «Этот месяц» — the supply plan's working screen. Three things to do, each in
// whole trucks, money and a date: the pick-ups (this month and next, from what
// waits at DMK plus what HQ can add), the IBP numbers due by the 20th, and the
// trucks on their way. Below them, month by month, whether the stock lasts.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { dstr, monthLong, monthShort, pn, splitPack } from "@/lib/planning/ui-format";
import type { LoadView, PipelineView, SkuHead, StockRow } from "@/lib/planning/plan-view";

export interface PlanViewProps {
  today: string;
  thisMonth: string;
  monthDone: number;
  skus: SkuHead[];
  eurRate: number;
  settings: { truckPlaces: number; minFill: number; maxFill: number; dangerLine: number; leadDays: number; dispatchDay: number };
  pickups: LoadView[];
  due: { shipMonth: string; deadline: string; daysLeft: number; load: LoadView | null; entered: Record<string, number> };
  pipeline: PipelineView[];
  stock: StockRow[];
  coverMonths: string[];
  isAdmin: boolean;
}

export function trucksWord(n: number, ru: boolean): string {
  if (!ru) return n === 1 ? "truck" : "trucks";
  const k = n % 100;
  const last = n % 10;
  if (k > 10 && k < 20) return "фур";
  return last === 1 ? "фура" : last >= 2 && last <= 4 ? "фуры" : "фур";
}

export const uzs = (eur: number, rate: number, ru: boolean) =>
  rate > 0 ? `≈ ${((eur * rate) / 1e9).toFixed(2).replace(".", ru ? "," : ".")} ${ru ? "млрд сум" : "bn UZS"}` : "";

export const pct = (x: number, ru: boolean) => `${(x * 100).toFixed(1).replace(".", ru ? "," : ".")}%`;

export const STATUS_RU: Record<string, [string, string]> = {
  PLANNED: ["Запланирована", "Planned"],
  ORDERED: ["Заказана", "Ordered"],
  TRANSIT: ["В пути", "In transit"],
  CUSTOMS: ["На таможне", "At customs"],
  ARRIVED: ["Прибыла", "Arrived"],
};

export function SkuName({ name }: { name: string }) {
  const { name: n, pack } = splitPack(name);
  return (
    <span className="whitespace-nowrap">
      <span className="font-bold">{n}</span> <span className="text-[11px] font-bold" style={{ color: "var(--sky)" }}>{pack}</span>
    </span>
  );
}

const sumOf = (r: Record<string, number>) => Object.values(r).reduce((t, v) => t + v, 0);

function PickupCard({ load, skus, eurRate, settings, isAdmin, ru, thisMonth }: { load: LoadView; skus: SkuHead[]; eurRate: number; settings: PlanViewProps["settings"]; isAdmin: boolean; ru: boolean; thisMonth: string }) {
  const router = useRouter();
  const defaultDay = `${load.shipMonth}-${String(settings.dispatchDay).padStart(2, "0")}`;
  const [dispatch, setDispatch] = useState(load.shipMonth === thisMonth ? new Date().toISOString().slice(0, 10) : defaultDay);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const rows = skus.filter((s) => (load.units[s.id] ?? 0) > 0);
  const extraUnits = sumOf(load.extra);
  const lines = rows.map((s) => `${s.id}:${Math.round(load.units[s.id])}`).join(",");

  const [hqFile, setHqFile] = useState<File | null>(null);
  async function fillHqForm() {
    if (!hqFile || busy) return;
    if (load.split.length > 3) {
      setMsg(ru ? "В форме HQ не больше 3 фур — разделите на две формы." : "HQ's form takes at most 3 trucks — split it in two forms.");
      return;
    }
    setBusy(true);
    setMsg(null);
    const name = `Order Form ${monthLong(load.shipMonth, false)} - Turbo Impex - ${load.trucks} ${load.trucks === 1 ? "truck" : "trucks"}`;
    const fd = new FormData();
    fd.append("file", hqFile);
    fd.append("trucks", JSON.stringify(load.split.map((t) => ({ units: t.units }))));
    fd.append("name", name);
    const res = await fetch("/api/planning/hq-form", { method: "POST", body: fd });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMsg(body.error ?? (ru ? "Не удалось заполнить форму" : "Could not fill the form"));
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg(ru ? "Форма HQ заполнена — проверьте D43 (0,98) и отправьте HQ." : "HQ's form filled — check D43 (0.98) and send it to HQ.");
  }

  async function createTrucks() {
    if (busy) return;
    const ok = confirm(
      ru
        ? `Завести ${load.trucks} ${trucksWord(load.trucks, true)} как «Запланирована» с отгрузкой ${dstr(dispatch)}? В продаже ≈ через ${settings.leadDays} дн. В остатки и себестоимость они попадут только после прибытия.`
        : `Create ${load.trucks} ${trucksWord(load.trucks, false)} as Planned, dispatched ${dstr(dispatch)}? Sellable ≈ ${settings.leadDays} days later. They enter stock and COGS only on arrival.`
    );
    if (!ok) return;
    setBusy(true);
    const res = await fetch("/api/planning/trucks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dispatchDate: dispatch, trucks: load.split.map((t) => ({ units: t.units })) }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMsg(ru ? `Заведены: ${body.created.join(", ")}` : `Created: ${body.created.join(", ")}`);
      router.refresh();
    } else setMsg(body.error ?? (ru ? "Не удалось" : "Failed"));
  }

  return (
    <section className="pcard p-5" style={{ borderColor: "var(--accent)", borderWidth: 2 }}>
      <div className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted">
        {ru ? `Забрать у DMK · ${monthLong(load.shipMonth, true).toLowerCase()}` : `Pick up from DMK · ${monthLong(load.shipMonth, false)}`}
      </div>
      <div className="mt-1 text-[30px] font-extrabold leading-tight">
        <span className="pnum">{load.trucks}</span> {trucksWord(load.trucks, ru)}
        <span className="ml-2 text-[16px] font-bold text-muted">· {pct(load.fill, ru)}</span>
      </div>
      <div className="mt-1 text-[13px] font-semibold text-muted">
        <span className="pnum">{pn(sumOf(load.units))}</span> {ru ? "шт" : "units"} · <span className="pnum">{load.pallets}</span> {ru ? "паллет" : "pallets"} · <span className="pnum">€{pn(load.eur)}</span> {uzs(load.eur, eurRate, ru)} ·{" "}
        {ru ? "в продаже с" : "on the shelf from"} {monthLong(load.sellMonth, ru).toLowerCase()}
      </div>
      {load.underFilled && (
        <p className="mt-1 text-[12px] font-bold" style={{ color: "var(--warn-ink)" }}>
          {ru ? `Загрузка ниже ${pct(settings.minFill, true)} — перевозка на риске покупателя.` : `Under ${pct(settings.minFill, false)} full — transport at the buyer's risk.`}
        </p>
      )}
      <table className="ptable mt-3 text-[12.5px]">
        <thead>
          <tr>
            <th>{ru ? "Товар" : "Product"}</th>
            <th>{ru ? "шт" : "units"}</th>
            <th>{ru ? "паллет" : "pallets"}</th>
            <th>{ru ? "из ждущего у DMK" : "from open at DMK"}</th>
            <th>{ru ? "сверх (просить HQ)" : "on top (ask HQ)"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td><SkuName name={s.name} /></td>
              <td className="pnum">{pn(load.units[s.id])}</td>
              <td className="pnum">{pn(load.units[s.id] / (s.pcsPerPallet || 1))}</td>
              <td className="pnum text-muted">{load.fromOpen[s.id] ? pn(load.fromOpen[s.id]) : "—"}</td>
              <td className="pnum" style={{ color: load.extra[s.id] ? "var(--info)" : undefined }}>{load.extra[s.id] ? pn(load.extra[s.id]) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {extraUnits > 0 && (
        <p className="mt-2 text-[12px] font-semibold text-muted">
          {ru
            ? `${pn(extraUnits)} шт сверх ждущего у DMK — подтвердите с HQ, что они могут добавить.`
            : `${pn(extraUnits)} units beyond what waits at DMK — confirm with HQ they can add them.`}
        </p>
      )}
      {load.split.length > 1 && (
        <div className="mt-3 text-[12px] font-semibold text-muted">
          {load.split.map((t, i) => {
            const pal = skus.reduce((a, s) => a + (t.units[s.id] ?? 0) / (s.pcsPerPallet || 1), 0);
            return (
              <div key={i}>
                {ru ? "Фура" : "Truck"} {i + 1}: <span className="pnum">{pn(pal)}</span> {ru ? "паллет" : "pallets"}, <span className="pnum">{t.places.toFixed(1)}</span> {ru ? "мест" : "places"} ({pct(t.places / settings.truckPlaces, ru)})
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a href={`/api/export/planning-order?ship=pickup&lines=${encodeURIComponent(lines)}`} className="rounded-lg px-3.5 py-2 text-[12.5px] font-extrabold text-white" style={{ background: "var(--accent)" }}>
          {ru ? "Скачать заявку" : "Download the request"}
        </a>
        {isAdmin && (
          <>
            <label className="flex items-center gap-1.5 text-[12px] font-bold text-muted">
              {ru ? "отгрузка" : "dispatch"}
              <input type="date" value={dispatch} onChange={(e) => setDispatch(e.target.value)} className="rounded-md border border-border bg-surface px-2 py-1 text-[12.5px]" />
            </label>
            <button type="button" disabled={busy || !dispatch} onClick={() => void createTrucks()} className="rounded-lg border border-border px-3.5 py-2 text-[12.5px] font-bold">
              {busy ? "…" : ru ? "Завести как запланированные" : "Create as planned trucks"}
            </button>
          </>
        )}
        {msg && <span className="text-[12px] font-bold text-muted">{msg}</span>}
      </div>
      {isAdmin && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: "var(--hair)" }}>
          <span className="text-[12px] font-bold text-muted">{ru ? "Форма заказа HQ:" : "HQ's order form:"}</span>
          <input type="file" accept=".xlsx" onChange={(e) => setHqFile(e.target.files?.[0] ?? null)} className="text-[12px]" />
          <button type="button" disabled={busy || !hqFile} onClick={() => void fillHqForm()} className="rounded-lg border border-border px-3.5 py-1.5 text-[12.5px] font-bold">
            {busy ? "…" : ru ? "Заполнить фуры" : "Fill in the trucks"}
          </button>
          <span className="text-[11px] font-semibold text-muted">
            {ru ? "последняя форма от HQ; вернётся заполненной, в приложении не хранится" : "HQ's latest form; it comes back filled and is not stored"}
          </span>
        </div>
      )}
    </section>
  );
}

export default function PlanView(props: PlanViewProps) {
  const { today, thisMonth, monthDone, skus, eurRate, settings, pickups, due, pipeline, stock, coverMonths, isAdmin } = props;
  const { locale } = useT();
  const ru = locale === "ru";
  const name = (id: string) => skus.find((s) => s.id === id)?.name ?? id;
  const urgent = due.daysLeft <= 7;

  const onHand = stock.reduce((t, r) => t + r.onHand, 0);
  const sold = stock.reduce((t, r) => t + r.soldThisMonth, 0);
  const running = stock.reduce((t, r) => t + r.runningAt, 0);
  const onWay = pipeline.reduce((t, x) => t + sumOf(x.units), 0);

  // products that run out (lost sales) or fall under the danger line in the months shown
  const warnings = stock
    .map((r) => {
      const lostMonths = coverMonths.filter((m) => (r.lost[m] ?? 0) > 0.5);
      const lowMonths = coverMonths.filter((m) => (r.lost[m] ?? 0) <= 0.5 && (r.cover[m] ?? 0) < settings.dangerLine);
      return { id: r.id, lostMonths, lost: lostMonths.reduce((t, m) => t + r.lost[m], 0), lowMonths };
    })
    .filter((w) => w.lostMonths.length > 0 || w.lowMonths.length > 0);

  const dueRows = skus.filter((s) => (due.load?.ibpToEnter[s.id] ?? 0) > 0 || (due.entered[s.id] ?? 0) > 0);
  const toEnter = (id: string) => due.load?.ibpToEnter[id] ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] font-semibold text-muted">
        <span>{ru ? "На складе сейчас" : "In stock now"} <b className="pnum text-foreground">{pn(onHand)}</b></span>
        <span>
          {ru ? "продано в этом месяце" : "sold this month"} <b className="pnum text-foreground">{pn(sold)}</b> ({ru ? "темп" : "pace"} <b className="pnum text-foreground">{pn(running)}</b>/{ru ? "мес" : "mo"}, {ru ? "прошло" : "done"} {Math.round(monthDone * 100)}%)
        </span>
        <span>{ru ? "не прибыло" : "on the way"} <b className="pnum text-foreground">{pn(onWay)}</b> · {pipeline.length} {trucksWord(pipeline.length, ru)}</span>
      </div>

      <div className="grid gap-3.5 lg:grid-cols-2">
        {pickups.length === 0 ? (
          <section className="pcard p-5">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted">{ru ? "Забрать у DMK" : "Pick up from DMK"}</div>
            <div className="mt-1 text-[24px] font-extrabold leading-tight">{ru ? "Забирать не нужно" : "Nothing to pick up"}</div>
            <p className="mt-1 text-[12px] font-semibold text-muted">{ru ? "На ближайшие месяцы фуры уже заведены или не нужны." : "The coming months' trucks are already in or not needed."}</p>
          </section>
        ) : (
          pickups.map((l) => <PickupCard key={l.shipMonth} load={l} skus={skus} eurRate={eurRate} settings={settings} isAdmin={isAdmin} ru={ru} thisMonth={thisMonth} />)
        )}

        <section className="pcard p-5">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted">
            <span>{ru ? `Ввести в IBP до ${dstr(due.deadline)}` : `Enter in IBP by ${dstr(due.deadline)}`}</span>
            <span className="rounded-full px-2 py-0.5 text-[11px] font-extrabold normal-case tracking-normal text-white" style={{ background: urgent ? "var(--warn)" : "var(--accent)" }}>
              {ru ? `${due.daysLeft} дн.` : `${due.daysLeft}d`}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <div className="text-[30px] font-extrabold leading-tight">
              {due.load ? (
                <>
                  <span className="pnum">{due.load.trucks}</span> {trucksWord(due.load.trucks, ru)}
                </>
              ) : ru ? "Заказ не нужен" : "No order needed"}
            </div>
            <span className="text-[16px] font-bold text-muted">{ru ? `на ${monthLong(due.shipMonth, true).toLowerCase()}` : `for ${monthLong(due.shipMonth, false)}`}</span>
          </div>
          {due.load && (
            <div className="mt-1 text-[13px] font-semibold text-muted">
              <span className="pnum">{due.load.pallets}</span> {ru ? "паллет" : "pallets"} · {pct(due.load.fill, ru)} · <span className="pnum">€{pn(due.load.eur)}</span> {uzs(due.load.eur, eurRate, ru)} · {ru ? "в продаже с" : "on the shelf from"} {monthLong(due.load.sellMonth, ru).toLowerCase()}
            </div>
          )}
          {dueRows.length > 0 && (
            <table className="ptable mt-3 text-[12.5px]">
              <thead>
                <tr>
                  <th>{ru ? "Товар" : "Product"}</th>
                  <th>{ru ? "ввести" : "enter"}</th>
                  <th>{ru ? "сейчас в IBP" : "in IBP now"}</th>
                  <th>{ru ? "изменить на" : "change by"}</th>
                </tr>
              </thead>
              <tbody>
                {dueRows.map((s) => {
                  const d = toEnter(s.id) - (due.entered[s.id] ?? 0);
                  return (
                    <tr key={s.id}>
                      <td><SkuName name={s.name} /></td>
                      <td className="pnum font-bold">{pn(toEnter(s.id))}</td>
                      <td className="pnum text-muted">{due.entered[s.id] ? pn(due.entered[s.id]) : "—"}</td>
                      <td className="pnum" style={{ color: Math.abs(d) < 0.5 ? "var(--muted)" : d > 0 ? "var(--info)" : "var(--warn-ink)" }}>
                        {Math.abs(d) < 0.5 ? "—" : `${d > 0 ? "+" : "−"}${pn(Math.abs(d))}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>{ru ? "Итого" : "Total"}</td>
                  <td className="pnum">{pn(due.load ? sumOf(due.load.ibpToEnter) : 0)}</td>
                  <td className="pnum">{pn(sumOf(due.entered))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
          <p className="mt-2 text-[12px] font-semibold text-muted">
            {ru
              ? "Введите эти числа в портал DMK, затем загрузите свежую выгрузку IBP на вкладке «Заказы» — план пересчитается."
              : "Type these into DMK's portal, then upload a fresh IBP export on the Orders tab — the plan recalculates."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/planning/orders" className="rounded-lg border border-border px-3.5 py-2 text-[12.5px] font-bold">
              {ru ? "Заказы по месяцам" : "Orders by month"}
            </Link>
          </div>
        </section>
      </div>

      {warnings.length > 0 && (
        <section className="rounded-[10px] border px-4 py-3 text-[12.5px]" style={{ borderColor: "var(--warn-border)", background: "var(--warn-soft)", color: "var(--warn-ink)" }}>
          <div className="font-extrabold">{ru ? "Не хватит товара" : "Stock runs short"}</div>
          <ul className="mt-1 space-y-0.5 font-semibold">
            {warnings.map((w) => (
              <li key={w.id}>
                {splitPack(name(w.id)).name} {splitPack(name(w.id)).pack}:{" "}
                {w.lostMonths.length > 0 &&
                  (ru
                    ? `нет в ${w.lostMonths.map((m) => monthShort(m, true).toLowerCase()).join(", ")} — ≈${pn(w.lost)} шт недопродаж`
                    : `out in ${w.lostMonths.map((m) => monthShort(m, false)).join(", ")} — ≈${pn(w.lost)} units lost`)}
                {w.lostMonths.length > 0 && w.lowMonths.length > 0 && "; "}
                {w.lowMonths.length > 0 &&
                  (ru
                    ? `меньше ${settings.dangerLine} мес. запаса в ${w.lowMonths.map((m) => monthShort(m, true).toLowerCase()).join(", ")}`
                    : `under ${settings.dangerLine} month of cover in ${w.lowMonths.map((m) => monthShort(m, false)).join(", ")}`)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {pipeline.length > 0 && (
        <section className="pcard overflow-hidden">
          <div className="flex flex-wrap items-baseline gap-3 border-b px-5 py-3" style={{ borderColor: "var(--hair)" }}>
            <h2 className="text-[14px] font-extrabold">{ru ? "Фуры, которые ещё не прибыли" : "Trucks not arrived yet"}</h2>
            <span className="text-[11.5px] font-semibold text-muted">
              {ru ? `в продаже — по дате на странице поставок, иначе отгрузка + ${settings.leadDays} дн.` : `sellable — the date on Shipments, else dispatch + ${settings.leadDays} days`}
            </span>
            <Link href="/goods/shipments" className="ml-auto text-[12px] font-bold" style={{ color: "var(--accent)" }}>
              {ru ? "Сменить статус →" : "Change status →"}
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="ptable text-[12.5px]">
              <thead>
                <tr>
                  <th>{ru ? "Фура" : "Truck"}</th>
                  <th>{ru ? "Статус" : "Status"}</th>
                  <th>{ru ? "Отгрузка" : "Dispatch"}</th>
                  <th>{ru ? "В продаже ≈" : "Sellable ≈"}</th>
                  <th>{ru ? "шт" : "units"}</th>
                  <th>{ru ? "паллет" : "pallets"}</th>
                  <th>{ru ? "мест" : "places"}</th>
                </tr>
              </thead>
              <tbody>
                {pipeline.map((t) => (
                  <tr key={t.id}>
                    <td className="font-bold">{t.code}</td>
                    <td>
                      <span className="ppill" style={{ background: t.status === "PLANNED" ? "var(--surface-low)" : "var(--info-soft)", color: t.status === "PLANNED" ? "var(--muted)" : "var(--info)" }}>
                        {(STATUS_RU[t.status] ?? STATUS_RU.TRANSIT)[ru ? 0 : 1]}
                      </span>
                    </td>
                    <td className="pnum">{t.dispatchDate ? dstr(t.dispatchDate) : "—"}</td>
                    <td className="pnum">{dstr(t.sellDate)} <span className="text-muted">({monthShort(t.sellMonth, ru).toLowerCase()})</span></td>
                    <td className="pnum">{pn(sumOf(t.units))}</td>
                    <td className="pnum">{pn(t.pallets)}</td>
                    <td className="pnum text-muted">{t.places.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="pcard overflow-hidden">
        <div className="flex flex-wrap items-baseline gap-3 border-b px-5 py-3" style={{ borderColor: "var(--hair)" }}>
          <h2 className="text-[14px] font-extrabold">{ru ? "Хватит ли товара" : "Will stock last"}</h2>
          <span className="text-[11.5px] font-semibold text-muted">
            {ru ? "запас на конец месяца в месяцах продаж следующего месяца — со всеми фурами плана" : "month-end stock in months of the next month's sales — with every truck in the plan"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="ptable text-[12.5px]">
            <thead>
              <tr>
                <th>{ru ? "Товар" : "Product"}</th>
                <th>{ru ? "Сейчас" : "Now"}</th>
                <th>{ru ? "Темп/мес" : "Pace/mo"}</th>
                <th>{ru ? `Конец ${monthShort(thisMonth, true).toLowerCase()}` : `End ${monthShort(thisMonth, false)}`}</th>
                {coverMonths.map((m) => (
                  <th key={m} className="!text-center">{monthShort(m, ru)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stock.map((r) => (
                <tr key={r.id}>
                  <td><SkuName name={name(r.id)} /></td>
                  <td className="pnum">{pn(r.onHand)}</td>
                  <td className="pnum text-muted">{pn(r.runningAt)}</td>
                  <td className="pnum">{pn(r.endOfMonth)}</td>
                  {coverMonths.map((m) => {
                    const lost = r.lost[m] ?? 0;
                    const cover = r.cover[m] ?? 0;
                    const tone = lost > 0.5 ? "out" : cover < settings.dangerLine ? "low" : "ok";
                    const bg = tone === "out" ? "var(--danger-soft)" : tone === "low" ? "var(--warn-soft)" : "var(--ok-soft)";
                    const fg = tone === "out" ? "var(--danger)" : tone === "low" ? "var(--warn-ink)" : "var(--ok-ink)";
                    const tip = `${monthLong(m, ru)}: ${lost > 0.5 ? (ru ? `не хватит ≈${pn(lost)} шт` : `short ≈${pn(lost)}`) : `${cover.toFixed(1)} ${ru ? "мес." : "mo"}`}`;
                    return (
                      <td key={m} className="!px-1 !py-1">
                        <div title={tip} className="pnum flex h-8 min-w-[52px] items-center justify-center rounded-md text-[12px] font-bold" style={{ background: bg, color: fg }}>
                          {tone === "out" ? (ru ? "нет" : "out") : cover >= 24 ? "24+" : cover.toFixed(1)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 px-5 py-3 text-[11.5px] font-semibold text-muted">
          <span><span className="inline-block h-3 w-3 rounded-sm align-[-2px]" style={{ background: "var(--ok-soft)" }} /> {ru ? `${settings.dangerLine} мес. и больше` : `${settings.dangerLine} month or more`}</span>
          <span><span className="inline-block h-3 w-3 rounded-sm align-[-2px]" style={{ background: "var(--warn-soft)" }} /> {ru ? "ниже опасной черты" : "under the danger line"}</span>
          <span><span className="inline-block h-3 w-3 rounded-sm align-[-2px]" style={{ background: "var(--danger-soft)" }} /> {ru ? "не хватит (недопродажи)" : "runs out (lost sales)"}</span>
        </div>
      </section>

      <p className="text-[11px] font-semibold text-muted">
        {ru
          ? `Данные на ${dstr(today)}: остатки — по учёту, спрос — модель по стадиям (вкладка «Спрос»), заказы — из выгрузки IBP, фуры — со страницы поставок.`
          : `As of ${dstr(today)}: stock from the books, demand from the stage model (Demand tab), orders from the IBP export, trucks from Shipments.`}
      </p>
    </div>
  );
}
