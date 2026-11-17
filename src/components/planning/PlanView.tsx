"use client";

// «Этот месяц» — the supply plan's working screen, from the facts only (owner,
// 17 Nov 2026): what is in the warehouse and which trucks are in the app, how
// long that lasts, and for each ship month how many trucks are needed —
// counted on its own, never assuming another month's advice was followed.
// A row opens into its trucks (composition, HQ's form) or its IBP numbers.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { dstr, monthLong, monthShort, pn, splitPack } from "@/lib/planning/ui-format";
import type { AdviceView, LoadView, OutlookMonth, PipelineView, SkuHead, StockRow } from "@/lib/planning/plan-view";
import TruckComposer, { compositionTotals, palletsOf, unitsOf, type Composition } from "./TruckComposer";

export interface PlanViewProps {
  today: string;
  thisMonth: string;
  monthDone: number;
  skus: SkuHead[];
  eurRate: number;
  settings: { truckPlaces: number; minFill: number; maxFill: number; dangerLine: number; leadDays: number; dispatchDay: number };
  /** each ship month up to the one whose IBP is due, on its own */
  advice: AdviceView[];
  due: { shipMonth: string; deadline: string; daysLeft: number };
  /** ordered in the IBP and still at DMK today, units */
  waitingAtDmk: number;
  pipeline: PipelineView[];
  stock: StockRow[];
  coverMonths: string[];
  outlook: OutlookMonth[];
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

const EDITABLE = ["PLANNED", "ORDERED"];

const sumOf = (r: Record<string, number>) => Object.values(r).reduce((t, v) => t + v, 0);

/** Fills HQ's uploaded order form with these trucks and downloads it; an error message, or null. */
async function downloadHqForm(file: File, trucks: Record<string, number>[], name: string, ru: boolean): Promise<string | null> {
  if (trucks.length > 3) return ru ? "В форме HQ не больше 3 фур — разделите на две формы." : "HQ's form takes at most 3 trucks — split it in two forms.";
  const fd = new FormData();
  fd.append("file", file);
  fd.append("trucks", JSON.stringify(trucks.map((units) => ({ units }))));
  fd.append("name", name);
  const res = await fetch("/api/planning/hq-form", { method: "POST", body: fd });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return body.error ?? (ru ? "Не удалось заполнить форму" : "Could not fill the form");
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  return null;
}

const formName = (shipMonth: string, trucks: number) => `Order Form ${monthLong(shipMonth, false)} - Turbo Impex - ${trucks} ${trucks === 1 ? "truck" : "trucks"}`;

function HqFormRow({ busy, ru, onFill }: { busy: boolean; ru: boolean; onFill: (f: File) => void }) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: "var(--hair)" }}>
      <span className="text-[12px] font-bold text-muted">{ru ? "Форма заказа HQ:" : "HQ's order form:"}</span>
      <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[12px]" />
      <button type="button" disabled={busy || !file} onClick={() => file && onFill(file)} className="rounded-lg border border-border px-3.5 py-1.5 text-[12.5px] font-bold">
        {busy ? "…" : ru ? "Заполнить фуры" : "Fill in the trucks"}
      </button>
      <span className="text-[11px] font-semibold text-muted">
        {ru ? "последняя форма от HQ; вернётся заполненной этим составом, в приложении не хранится" : "HQ's latest form; it comes back filled with this composition and is not stored"}
      </span>
    </div>
  );
}

function PickupBody({ load, skus, eurRate, settings, isAdmin, ru, thisMonth }: { load: LoadView; skus: SkuHead[]; eurRate: number; settings: PlanViewProps["settings"]; isAdmin: boolean; ru: boolean; thisMonth: string }) {
  const router = useRouter();
  const defaultDay = `${load.shipMonth}-${String(settings.dispatchDay).padStart(2, "0")}`;
  const [dispatch, setDispatch] = useState(load.shipMonth === thisMonth ? new Date().toISOString().slice(0, 10) : defaultDay);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // no truck advised: an empty one to fill by hand
  const planComp = (): Composition => (load.split.length > 0 ? load.split.map((t) => palletsOf(t.units, skus)) : [{}]);
  const [comp, setComp] = useState<Composition>(planComp);
  const edited = JSON.stringify(comp) !== JSON.stringify(planComp());
  const trucksUnits = comp.map((t) => unitsOf(t, skus)).filter((u) => Object.keys(u).length > 0);
  const totalUnits = compositionTotals(comp, skus);
  const lines = skus.filter((s) => totalUnits[s.id] > 0).map((s) => `${s.id}:${totalUnits[s.id]}`).join(",");
  const extraUnits = sumOf(load.extra);

  async function createTrucks() {
    if (busy || trucksUnits.length === 0) return;
    const n = trucksUnits.length;
    const ok = confirm(
      ru
        ? `Завести ${n} ${trucksWord(n, true)} как «Запланирована» с отгрузкой ${dstr(dispatch)}${edited ? " (ваш состав)" : ""}? В продаже ≈ через ${settings.leadDays} дн. В остатки и себестоимость они попадут только после прибытия. Состав можно менять и потом.`
        : `Create ${n} ${trucksWord(n, false)} as Planned, dispatched ${dstr(dispatch)}${edited ? " (your composition)" : ""}? Sellable ≈ ${settings.leadDays} days later. They enter stock and COGS only on arrival. The composition can still be changed later.`
    );
    if (!ok) return;
    setBusy(true);
    const res = await fetch("/api/planning/trucks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dispatchDate: dispatch, trucks: trucksUnits.map((units) => ({ units })) }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMsg(ru ? `Заведены: ${body.created.join(", ")}` : `Created: ${body.created.join(", ")}`);
      router.refresh();
    } else setMsg(body.error ?? (ru ? "Не удалось" : "Failed"));
  }

  async function fill(file: File) {
    setBusy(true);
    setMsg(null);
    const err = await downloadHqForm(file, trucksUnits, formName(load.shipMonth, trucksUnits.length), ru);
    setBusy(false);
    setMsg(err ?? (ru ? "Форма HQ заполнена — проверьте D43 (0,98) и отправьте HQ." : "HQ's form filled — check D43 (0.98) and send it to HQ."));
  }

  return (
    <div>
      {load.trucks > 0 && (
        <div className="text-[13px] font-semibold text-muted">
          <span className="pnum">{pn(sumOf(load.units))}</span> {ru ? "шт" : "units"} · <span className="pnum">{load.pallets}</span> {ru ? "паллет" : "pallets"} · {ru ? "загрузка" : "fill"} {pct(load.fill, ru)} · <span className="pnum">€{pn(load.eur)}</span> {uzs(load.eur, eurRate, ru)}
        </div>
      )}
      {load.underFilled && (
        <p className="mt-1 text-[12px] font-bold" style={{ color: "var(--warn-ink)" }}>
          {ru ? `Загрузка ниже ${pct(settings.minFill, true)} — перевозка на риске покупателя.` : `Under ${pct(settings.minFill, false)} full — transport at the buyer's risk.`}
        </p>
      )}
      {load.trucks > 0 && (
        <p className="mt-1 text-[12px] font-semibold text-muted">
          {extraUnits > 0
            ? ru
              ? `Из них ${pn(sumOf(load.fromOpen))} шт уже заказано в IBP и ждёт у DMK, ${pn(extraUnits)} шт — сверх заказанного: подтвердите с HQ, что они могут добавить.`
              : `${pn(sumOf(load.fromOpen))} units are already ordered in the IBP and wait at DMK; ${pn(extraUnits)} are on top of that — confirm with HQ they can add them.`
            : ru
              ? "Всё это уже заказано в IBP и ждёт у DMK."
              : "All of it is already ordered in the IBP and waits at DMK."}
        </p>
      )}
      <div className="mt-3">
        <TruckComposer
          skus={skus}
          value={comp}
          onChange={setComp}
          truckPlaces={settings.truckPlaces}
          minFill={settings.minFill}
          maxFill={settings.maxFill}
          eurRate={eurRate}
          baseline={palletsOf(load.units, skus)}
          readOnly={!isAdmin}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a href={`/api/export/planning-order?ship=pickup&lines=${encodeURIComponent(lines)}`} className="rounded-lg px-3.5 py-2 text-[12.5px] font-extrabold text-white" style={{ background: "var(--accent)" }}>
          {ru ? "Скачать заявку" : "Download the request"}
        </a>
        {isAdmin && (
          <>
            <label className="flex items-center gap-1.5 text-[12px] font-bold text-muted">
              {ru ? "отгрузка" : "dispatch"}
              <input type="date" value={dispatch} onChange={(e) => setDispatch(e.target.value)} className="rounded-md border border-border bg-surface px-2 py-1 text-[12.5px]" />
            </label>
            <button type="button" disabled={busy || !dispatch || trucksUnits.length === 0} onClick={() => void createTrucks()} className="rounded-lg border border-border px-3.5 py-2 text-[12.5px] font-bold">
              {busy ? "…" : ru ? "Завести как запланированные" : "Create as planned trucks"}
            </button>
            {edited && (
              <button type="button" onClick={() => setComp(planComp())} className="rounded-lg border border-border px-3.5 py-2 text-[12.5px] font-bold text-muted">
                {ru ? "Вернуть состав совета" : "Back to the advised mix"}
              </button>
            )}
          </>
        )}
        {msg && <span className="text-[12px] font-bold text-muted">{msg}</span>}
      </div>
      {isAdmin && <HqFormRow busy={busy} ru={ru} onFill={(f) => void fill(f)} />}
    </div>
  );
}

/** Trucks already in the app for a ship month, not yet dispatched: change their composition, fill HQ's form, or remove them so the month is planned again. */
function PlannedMonthCard({ month, trucks, skus, eurRate, settings, isAdmin, ru }: { month: string; trucks: PipelineView[]; skus: SkuHead[]; eurRate: number; settings: PlanViewProps["settings"]; isAdmin: boolean; ru: boolean }) {
  const router = useRouter();
  const saved = () => trucks.map((t) => palletsOf(t.units, skus));
  const [comp, setComp] = useState<Composition>(saved);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const edited = JSON.stringify(comp) !== JSON.stringify(saved());
  const planned = trucks.filter((t) => t.status === "PLANNED");
  const sell = trucks.map((t) => t.sellDate).sort()[0];

  async function save() {
    const units = comp.map((t) => unitsOf(t, skus));
    if (units.some((u) => Object.keys(u).length === 0)) {
      setMsg(ru ? "В каждой фуре должен быть товар — пустую фуру уберите." : "Every truck needs products — remove an empty truck instead.");
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/planning/trucks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trucks: trucks.map((t, i) => ({ id: t.id, units: units[i] })) }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMsg(ru ? "Состав сохранён — советы пересчитаны." : "Composition saved — the advice is counted again.");
      router.refresh();
    } else setMsg(body.error ?? (ru ? "Не удалось" : "Failed"));
  }

  async function remove(ids: string[]) {
    const codes = trucks.filter((t) => ids.includes(t.id)).map((t) => t.code).join(", ");
    const all = ids.length === trucks.length;
    const ok = confirm(
      ru
        ? `Убрать ${codes}? Совет по месяцам пересчитается без ${all ? "этих фур" : "неё"}.`
        : `Remove ${codes}? The advice by month is counted again without ${all ? "them" : "it"}.`
    );
    if (!ok) return;
    setBusy(true);
    const res = await fetch("/api/planning/trucks", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) router.refresh();
    else setMsg(body.error ?? (ru ? "Не удалось" : "Failed"));
  }

  async function fill(file: File) {
    setBusy(true);
    setMsg(null);
    const units = comp.map((t) => unitsOf(t, skus));
    const err = await downloadHqForm(file, units, formName(month, units.length), ru);
    setBusy(false);
    setMsg(err ?? (ru ? "Форма HQ заполнена — проверьте D43 (0,98) и отправьте HQ." : "HQ's form filled — check D43 (0.98) and send it to HQ."));
  }

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted">
        <span>{ru ? `Заведены на ${monthLong(month, true).toLowerCase()}` : `In the app for ${monthLong(month, false)}`}</span>
        {trucks.map((t) => (
          <span key={t.id} className="ppill normal-case tracking-normal" style={{ background: t.status === "PLANNED" ? "var(--surface-low)" : "var(--info-soft)", color: t.status === "PLANNED" ? "var(--muted)" : "var(--info)" }}>
            {t.code} · {(STATUS_RU[t.status] ?? STATUS_RU.TRANSIT)[ru ? 0 : 1]}
          </span>
        ))}
      </div>
      <div className="mt-1 text-[13px] font-semibold text-muted">
        {ru ? "отгрузка" : "dispatch"} {trucks[0]?.dispatchDate ? dstr(trucks[0].dispatchDate) : "—"} · {ru ? "в продаже ≈" : "sellable ≈"} {sell ? dstr(sell) : "—"}
      </div>
      <div className="mt-3">
        <TruckComposer
          skus={skus}
          value={comp}
          onChange={setComp}
          truckPlaces={settings.truckPlaces}
          minFill={settings.minFill}
          maxFill={settings.maxFill}
          eurRate={eurRate}
          names={trucks.map((t) => t.code)}
          canAddTrucks={false}
          readOnly={!isAdmin}
        />
      </div>
      {isAdmin && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy || !edited} onClick={() => void save()} className="rounded-lg px-3.5 py-2 text-[12.5px] font-extrabold text-white disabled:opacity-50" style={{ background: "var(--accent)" }}>
            {busy ? "…" : ru ? "Сохранить состав" : "Save the composition"}
          </button>
          {edited && (
            <button type="button" onClick={() => setComp(saved())} className="rounded-lg border border-border px-3.5 py-2 text-[12.5px] font-bold text-muted">
              {ru ? "Отменить изменения" : "Undo changes"}
            </button>
          )}
          {planned.length > 0 && (
            <button type="button" disabled={busy} onClick={() => void remove(planned.map((t) => t.id))} className="rounded-lg border px-3.5 py-2 text-[12.5px] font-bold" style={{ borderColor: "var(--warn-border)", color: "var(--warn-ink)" }}>
              {planned.length === trucks.length
                ? ru ? "Убрать фуры" : "Remove the trucks"
                : ru ? `Убрать запланированные (${planned.length})` : `Remove the planned ones (${planned.length})`}
            </button>
          )}
          {msg && <span className="text-[12px] font-bold text-muted">{msg}</span>}
        </div>
      )}
      {isAdmin && <HqFormRow busy={busy} ru={ru} onFill={(f) => void fill(f)} />}
    </section>
  );
}

const dec = (x: number, digits: number, ru: boolean) => x.toFixed(digits).replace(".", ru ? "," : ".");
const monthOnly = (m: string, ru: boolean) => monthLong(m, ru).replace(/ \d{4}$/, "");

/** The IBP numbers for a ship month still open: what to have there, next to what is there now. */
function IbpBody({ load, skus, ru }: { load: LoadView; skus: SkuHead[]; ru: boolean }) {
  const rows = skus.filter((s) => (load.ibpToEnter[s.id] ?? 0) > 0 || (load.ibpNow[s.id] ?? 0) > 0);
  return (
    <div>
      <p className="max-w-[78ch] text-[12px] font-semibold text-muted">
        {ru
          ? "Посчитано поверх того, что уже заказано в IBP на месяцы до этого (считается, что заказанное забирают в свой месяц). Введите числа в портал DMK и загрузите свежую выгрузку IBP на вкладке «Заказы»."
          : "Counted on top of what is already ordered in the IBP for the months before it (taken in their own months). Type the numbers into DMK's portal, then upload a fresh IBP export on the Orders tab."}
      </p>
      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="ptable text-[12.5px]">
            <thead>
              <tr>
                <th>{ru ? "Товар" : "Product"}</th>
                <th>{ru ? "ввести" : "enter"}</th>
                <th>{ru ? "сейчас в IBP" : "in IBP now"}</th>
                <th>{ru ? "изменить на" : "change by"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const d = (load.ibpToEnter[s.id] ?? 0) - (load.ibpNow[s.id] ?? 0);
                return (
                  <tr key={s.id}>
                    <td><SkuName name={s.name} /></td>
                    <td className="pnum font-bold">{pn(load.ibpToEnter[s.id] ?? 0)}</td>
                    <td className="pnum text-muted">{load.ibpNow[s.id] ? pn(load.ibpNow[s.id]) : "—"}</td>
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
                <td className="pnum">{pn(sumOf(load.ibpToEnter))}</td>
                <td className="pnum">{pn(sumOf(load.ibpNow))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <div className="mt-3">
        <Link href="/planning/orders" className="rounded-lg border border-border px-3.5 py-2 text-[12.5px] font-bold">
          {ru ? "Заказы по месяцам" : "Orders by month"}
        </Link>
      </div>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted">{label}</div>
      <div className="mt-0.5 text-[13px] font-bold">{children}</div>
    </div>
  );
}

/** One ship month: what is in the app for it, what is ordered, and the advice — counted on its own. */
function AdviceRow({ a, open, onToggle, props, ru }: { a: AdviceView; open: boolean; onToggle: () => void; props: PlanViewProps; ru: boolean }) {
  const { thisMonth, due, skus, eurRate, settings, isAdmin } = props;
  const isDue = a.kind === "ibp" && a.shipMonth === due.shipMonth;
  const now = a.shipMonth === thisMonth;
  const n = a.load.trucks;
  const units = sumOf(a.load.units);
  const entered = sumOf(a.load.ibpNow);
  const diff = units - entered;
  const more = a.trucksIn.length > 0;
  const orderedShown = a.kind === "pickup" ? a.orderedUnits : entered;

  return (
    <div className="border-t" style={{ borderColor: "var(--hair)", background: now || isDue ? "var(--accent-soft-bg)" : undefined }}>
      <div className="grid items-center gap-x-5 gap-y-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-[minmax(160px,1.1fr)_minmax(110px,0.8fr)_minmax(130px,0.9fr)_minmax(210px,1.5fr)_minmax(120px,auto)]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-extrabold">{monthLong(a.shipMonth, ru)}</span>
            {now && <span className="ppill text-white" style={{ background: "var(--accent)" }}>{ru ? "сейчас" : "now"}</span>}
            {isDue && (
              <span className="ppill text-white" style={{ background: due.daysLeft <= 7 ? "var(--warn)" : "var(--accent)" }}>
                {ru ? `IBP до ${dstr(due.deadline).slice(0, 5)} · ${due.daysLeft} дн.` : `IBP by ${dstr(due.deadline).slice(0, 5)} · ${due.daysLeft}d`}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[12px] font-semibold text-muted">
            {ru ? "отгрузка · в продаже с" : "ship month · on the shelf from"} {ru ? monthOnly(a.sellMonth, true).toLowerCase() : monthOnly(a.sellMonth, false)}
          </div>
        </div>

        <Cell label={ru ? "Фуры заведены" : "Trucks in the app"}>
          {more ? (
            <span title={a.trucksIn.map((t) => `${t.code} · ${(STATUS_RU[t.status] ?? STATUS_RU.TRANSIT)[ru ? 0 : 1]}`).join("\n")}>
              <span className="pnum">{a.trucksIn.length}</span> {trucksWord(a.trucksIn.length, ru)}
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </Cell>

        <Cell label={a.kind === "pickup" ? (ru ? "Заказано в IBP, не в фурах" : "Ordered in the IBP, not on trucks") : ru ? "Сейчас в IBP" : "In the IBP now"}>
          {orderedShown > 0 ? (
            <>
              <span className="pnum">{pn(orderedShown)}</span> <span className="font-semibold text-muted">{ru ? "шт" : "units"}</span>
            </>
          ) : (
            <span className="text-muted">—</span>
          )}
        </Cell>

        <div>
          <div className="text-[10.5px] font-extrabold uppercase tracking-[0.06em]" style={{ color: "var(--accent)" }}>
            {a.kind === "pickup" ? (ru ? "Совет: забрать" : "Advice: pick up") : ru ? "Совет: ввести в IBP" : "Advice: enter in the IBP"}
          </div>
          {n > 0 ? (
            <>
              <div className="text-[22px] font-extrabold leading-tight">
                {a.kind === "pickup" ? (
                  <>
                    {more && ru && "ещё "}
                    <span className="pnum">{n}</span> {trucksWord(n, ru)}
                    {more && !ru && " more"}
                  </>
                ) : (
                  <>
                    <span className="pnum">{pn(units)}</span> <span className="text-[14px]">{ru ? "шт" : "units"}</span>
                    <span className="ml-2 text-[14px] font-bold text-muted">· {n} {trucksWord(n, ru)}</span>
                  </>
                )}
              </div>
              <div className="text-[12px] font-semibold text-muted">
                {a.kind === "pickup" ? (
                  <>
                    {ru ? "по расчёту" : "by the count"} <span className="pnum">{dec(a.needTrucks, 1, ru)}</span> · {ru ? "запас до" : "stock up to"} <span className="pnum">{dec(a.target, 2, ru).replace(/[.,]?0+$/, "")}</span> {ru ? "мес." : "mo"} · <span className="pnum">€{pn(a.load.eur)}</span>
                  </>
                ) : Math.abs(diff) < 0.5 ? (
                  ru ? "совпадает с введённым" : "as entered"
                ) : (
                  <span style={{ color: diff > 0 ? "var(--info)" : "var(--warn-ink)" }}>
                    {ru ? "изменить на" : "change by"} <span className="pnum">{diff > 0 ? "+" : "−"}{pn(Math.abs(diff))}</span>
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="text-[18px] font-extrabold leading-tight" style={{ color: "var(--ok-ink)" }}>
                {a.kind === "pickup" ? (ru ? "Не нужно" : "Nothing needed") : ru ? "Заказ не нужен" : "No order needed"}
              </div>
              <div className="text-[12px] font-semibold text-muted">
                {a.kind === "ibp" && entered > 0
                  ? ru ? `введено ${pn(entered)} шт — можно убрать` : `${pn(entered)} units entered — can be removed`
                  : more
                    ? ru ? "заведённых фур хватает" : "the trucks in the app are enough"
                    : ru ? "запаса хватает до цели" : "stock reaches the target"}
              </div>
            </>
          )}
        </div>

        <button type="button" onClick={onToggle} aria-expanded={open} className="justify-self-start rounded-lg border border-border bg-surface px-3.5 py-2 text-[12.5px] font-bold lg:justify-self-end">
          {open ? (ru ? "Свернуть" : "Close") : a.kind === "pickup" ? (ru ? "Собрать фуры" : "Build the trucks") : ru ? "По товарам" : "By product"}
        </button>
      </div>
      {open && (
        <div className="border-t bg-surface px-5 py-4" style={{ borderColor: "var(--hair)" }}>
          {a.kind === "pickup" ? (
            <PickupBody load={a.load} skus={skus} eurRate={eurRate} settings={settings} isAdmin={isAdmin} ru={ru} thisMonth={thisMonth} />
          ) : (
            <IbpBody load={a.load} skus={skus} ru={ru} />
          )}
        </div>
      )}
    </div>
  );
}

export default function PlanView(props: PlanViewProps) {
  const { today, thisMonth, monthDone, skus, eurRate, settings, advice, waitingAtDmk, pipeline, stock, coverMonths, outlook, isAdmin } = props;
  const { locale } = useT();
  const ru = locale === "ru";
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  const name = (id: string) => skus.find((s) => s.id === id)?.name ?? id;
  // ship months with trucks in the app that have not left DMK yet
  const plannedMonths = [...new Set(pipeline.filter((t) => EDITABLE.includes(t.status)).map((t) => t.shipMonth))].sort();

  const onHand = stock.reduce((t, r) => t + r.onHand, 0);
  const sold = stock.reduce((t, r) => t + r.soldThisMonth, 0);
  const running = stock.reduce((t, r) => t + r.runningAt, 0);
  const onWay = pipeline.reduce((t, x) => t + sumOf(x.units), 0);

  // the first month something runs out with what is in the app today
  const firstOut = outlook.find((o) => o.out > 0);
  const firstOutNames = firstOut ? stock.filter((r) => (r.lost[firstOut.month] ?? 0) > 0.5).map((r) => `${splitPack(name(r.id)).name} ${splitPack(name(r.id)).pack}`.trim()) : [];

  const facts = [
    { label: ru ? "На складе сейчас" : "In stock now", value: pn(onHand), sub: ru ? "шт, TI + Fargo" : "units, TI + Fargo" },
    {
      label: ru ? "Продано в этом месяце" : "Sold this month",
      value: pn(sold),
      sub: ru ? `темп ${pn(running)}/мес · прошло ${Math.round(monthDone * 100)}%` : `pace ${pn(running)}/mo · ${Math.round(monthDone * 100)}% done`,
    },
    {
      label: ru ? "Фуры заведены, не прибыли" : "Trucks in the app, not arrived",
      value: String(pipeline.length),
      sub: ru ? `${trucksWord(pipeline.length, true)} · ${pn(onWay)} шт` : `${trucksWord(pipeline.length, false)} · ${pn(onWay)} units`,
    },
    { label: ru ? "Заказано в IBP, ждёт у DMK" : "Ordered in the IBP, waiting at DMK", value: pn(waitingAtDmk), sub: ru ? "шт, ещё не в фурах" : "units, not on a truck yet" },
  ];

  return (
    <div className="space-y-4">
      {/* the facts */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map((f) => (
          <div key={f.label} className="pcard px-4 py-3">
            <div className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted">{f.label}</div>
            <div className="pnum mt-0.5 text-[22px] font-extrabold leading-tight">{f.value}</div>
            <div className="text-[11.5px] font-semibold text-muted">{f.sub}</div>
          </div>
        ))}
      </div>

      {/* the advice, month by month */}
      <section className="pcard overflow-hidden">
        <div className="px-5 py-3.5">
          <h2 className="text-[15px] font-extrabold">{ru ? "Сколько фур нужно" : "How many trucks are needed"}</h2>
          <p className="mt-0.5 max-w-[82ch] text-[12px] font-semibold text-muted">
            {ru
              ? "Каждый месяц посчитан отдельно — только от склада и фур, которые уже заведены. Совет другого месяца не считается выполненным: пока фура не заведена, её нет. Заведёте фуру — все месяцы пересчитаются."
              : "Each month is counted on its own — from the stock and the trucks already in the app, nothing else. Another month's advice is never taken as done: until a truck is in the app, it does not exist. Add a truck and every month is counted again."}
          </p>
        </div>
        {advice.map((a) => (
          <AdviceRow
            key={`${a.shipMonth}:${sumOf(a.load.units)}:${a.trucksIn.length}`}
            a={a}
            open={openMonth === a.shipMonth}
            onToggle={() => setOpenMonth(openMonth === a.shipMonth ? null : a.shipMonth)}
            props={props}
            ru={ru}
          />
        ))}
      </section>

      {/* how long the facts last */}
      <section className="pcard overflow-hidden">
        <div className="px-5 py-3.5">
          <h2 className="text-[15px] font-extrabold">{ru ? "Хватит ли товара без новых фур" : "Will stock last without new trucks"}</h2>
          <p className="mt-0.5 text-[12px] font-semibold text-muted">
            {ru
              ? "склад и заведённые фуры; советы выше сюда не входят · запас на конец месяца в месяцах продаж"
              : "the stock and the trucks in the app; the advice above is not counted · month-end stock in months of sales"}
          </p>
          {firstOut && (
            <p className="mt-2 rounded-lg border px-3 py-2 text-[12.5px] font-bold" style={{ borderColor: "var(--warn-border)", background: "var(--warn-soft)", color: "var(--warn-ink)" }}>
              {ru
                ? `Первыми закончатся (${monthOnly(firstOut.month, true).toLowerCase()}): ${firstOutNames.join(", ")}.`
                : `First to run out (${monthOnly(firstOut.month, false)}): ${firstOutNames.join(", ")}.`}
            </p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {outlook.map((o) => {
              const tone = o.out > 0 ? "out" : o.low > 0 ? "low" : "ok";
              const bg = tone === "out" ? "var(--danger-soft)" : tone === "low" ? "var(--warn-soft)" : "var(--ok-soft)";
              const fg = tone === "out" ? "var(--danger)" : tone === "low" ? "var(--warn-ink)" : "var(--ok-ink)";
              return (
                <div key={o.month} className="rounded-[10px] px-3 py-2.5" style={{ background: bg, color: fg }}>
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.06em]">{monthShort(o.month, ru)}</div>
                  <div className="mt-0.5 text-[20px] font-extrabold leading-tight">
                    <span className="pnum">{o.cover >= 24 ? "24+" : dec(o.cover, 1, ru)}</span> <span className="text-[11px]">{ru ? "мес." : "mo"}</span>
                  </div>
                  <div className="text-[11.5px] font-bold">
                    {tone === "out"
                      ? ru ? `нет: ${o.out} из ${stock.length}` : `out: ${o.out} of ${stock.length}`
                      : tone === "low"
                        ? ru ? `мало: ${o.low} из ${stock.length}` : `low: ${o.low} of ${stock.length}`
                        : ru ? "хватает" : "enough"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <details className="border-t" style={{ borderColor: "var(--hair)" }}>
          <summary className="cursor-pointer px-5 py-3 text-[12.5px] font-bold" style={{ color: "var(--accent)" }}>
            {ru ? "По товарам" : "By product"}
          </summary>
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
        </details>
      </section>

      {/* the trucks in the app */}
      {pipeline.length > 0 && (
        <section className="pcard overflow-hidden">
          <div className="flex flex-wrap items-baseline gap-3 px-5 py-3.5">
            <h2 className="text-[15px] font-extrabold">{ru ? "Заведённые фуры, которые ещё не прибыли" : "Trucks in the app, not arrived yet"}</h2>
            <span className="text-[11.5px] font-semibold text-muted">
              {ru ? `в продаже — по дате на странице поставок, иначе отгрузка + ${settings.leadDays} дн.` : `sellable — the date on Shipments, else dispatch + ${settings.leadDays} days`}
            </span>
            <Link href="/goods/shipments" className="ml-auto text-[12px] font-bold" style={{ color: "var(--accent)" }}>
              {ru ? "Сменить статус →" : "Change status →"}
            </Link>
          </div>
          <div className="overflow-x-auto border-t" style={{ borderColor: "var(--hair)" }}>
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
          {/* not dispatched yet: the composition stays editable */}
          {plannedMonths.map((m) => {
            const trucks = pipeline.filter((t) => t.shipMonth === m && EDITABLE.includes(t.status));
            return (
              <details key={m} className="border-t" style={{ borderColor: "var(--hair)" }}>
                <summary className="cursor-pointer px-5 py-3 text-[12.5px] font-bold" style={{ color: "var(--accent)" }}>
                  {ru ? `Состав и форма HQ — ${trucks.map((t) => t.code).join(", ")}` : `Composition and HQ's form — ${trucks.map((t) => t.code).join(", ")}`}
                </summary>
                <div className="px-5 pb-4">
                  <PlannedMonthCard key={`${m}:${trucks.map((t) => t.id + sumOf(t.units)).join()}`} month={m} trucks={trucks} skus={skus} eurRate={eurRate} settings={settings} isAdmin={isAdmin} ru={ru} />
                </div>
              </details>
            );
          })}
        </section>
      )}

      <p className="text-[11px] font-semibold text-muted">
        {ru
          ? `Данные на ${dstr(today)}: остатки — по учёту, спрос — модель по стадиям (вкладка «Спрос»), заказы — из выгрузки IBP, фуры — со страницы поставок.`
          : `As of ${dstr(today)}: stock from the books, demand from the stage model (Demand tab), orders from the IBP export, trucks from Shipments.`}
      </p>
    </div>
  );
}
