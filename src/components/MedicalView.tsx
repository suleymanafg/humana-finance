"use client";

// «Медицинский отдел» — for the medical team to see whether a campaign moves
// sales: Humana sales in tins and verified prescriptions (foils), by region,
// medical rep and doctor. A map and regions for the period with the change
// against the period before, regions month by month, prescriptions next to
// Platin 1 for the country or a chosen region, reps and the doctors behind
// them, with the rates and amounts paid for foils, and each rep's own report
// (Excel) to download. Months a product ran out of stock are marked. Sales are
// in tins only.
import { useState } from "react";
import { useT } from "@/lib/locale-context";
import { addMonths } from "@/lib/planning/compute";
import { UZ_REGIONS } from "@/lib/uz-map";
import type { MedGroup, MedicalData } from "@/lib/medical-data";
import UzMap, { type RegionStat } from "./UzMap";

const GROUPS: { value: MedGroup | "ALL"; ru: string; en: string }[] = [
  { value: "ALL", ru: "Все товары", en: "All products" },
  { value: "P1", ru: "Platin 1", en: "Platin 1" },
  { value: "P2", ru: "Platin 2", en: "Platin 2" },
  { value: "P3", ru: "Platin 3", en: "Platin 3" },
  { value: "EXPERT", ru: "Expert", en: "Expert" },
];
const PERIODS = [1, 3, 6, 12];
type Measure = "sales" | "foils";

/** A change against the period before, as a coloured percentage. */
function Change({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted">—</span>;
  return (
    <span className={`font-medium ${Math.abs(v) < 0.05 ? "text-muted" : v > 0 ? "text-ok" : "text-danger"}`}>
      {v > 0 ? "+" : "−"}
      {Math.abs(v * 100).toFixed(0)}%
    </span>
  );
}

const sumIn = (by: Record<string, number> | undefined, ms: string[]) => ms.reduce((t, m) => t + (by?.[m] ?? 0), 0);
const change = (cur: number, prev: number) => (prev > 0 ? cur / prev - 1 : null);

export default function MedicalView({ data }: { data: MedicalData }) {
  const { locale, l } = useT();
  const ru = locale === "ru";
  const [measure, setMeasure] = useState<Measure>("sales");
  const [group, setGroup] = useState<MedGroup | "ALL">("ALL");
  const [product, setProduct] = useState<string>("");
  const [period, setPeriod] = useState(3);
  const [area, setArea] = useState<string | null>(null);
  const [rep, setRep] = useState<string | null>(null);

  const tins = (v: number) => Math.round(v).toLocaleString(ru ? "ru-RU" : "en-US");
  const mln = (v: number) => (v / 1e6).toFixed(1).replace(".", ru ? "," : ".");
  const mon = (id: string, long = false) => {
    const [y, m] = id.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(ru ? "ru-RU" : "en-GB", { month: long ? "long" : "short", year: long ? "numeric" : undefined, timeZone: "UTC" }).replace(".", "");
  };
  const regionName = (iso: string) => {
    if (iso === "none") return l({ ru: "Регион не указан", en: "Region not given" });
    const r = UZ_REGIONS.find((x) => x.iso === iso);
    return r ? (ru ? r.nameRu : r.nameEn) : iso;
  };

  const foilsLoaded = data.reps.length > 0;
  const inGroup = data.products.filter((p) => group === "ALL" || p.group === group);
  const chosen = product ? inGroup.filter((p) => p.id === product) : inGroup;
  const ids = chosen.map((p) => p.id);
  const sold = (areaKey: string, m: string, which: string[] = ids) => which.reduce((t, id) => t + (data.qty[areaKey]?.[id]?.[m] ?? 0), 0);
  const foilsOf = (areaKey: string, m: string) => data.foilsByRegion[areaKey]?.[m] ?? 0;
  const valueOf = (areaKey: string, m: string) => (measure === "sales" ? sold(areaKey, m) : foilsOf(areaKey, m));

  // the period ends with the month chosen at the top
  const end = data.endMonth;
  const span = (last: string, n: number) => Array.from({ length: n }, (_, i) => addMonths(last, i - n + 1));
  const now = span(end, period);
  const before = span(addMonths(end, -period), period);
  const over = (areaKey: string, ms: string[]) => ms.reduce((t, m) => t + valueOf(areaKey, m), 0);

  // the rows of this measure: sales — regions, chains, other; foils — regions (and lines without one)
  const areaRows =
    measure === "sales"
      ? data.areas.map((a) => ({ key: a.key, name: ru ? a.nameRu : a.nameEn, iso: a.iso, region: a.kind === "region" }))
      : [...new Set([...data.areas.filter((a) => a.iso).map((a) => a.iso!), ...Object.keys(data.foilsByRegion)])].map((iso) => ({ key: iso, name: regionName(iso), iso: iso === "none" ? null : iso, region: iso !== "none" }));
  const rows = areaRows.map((a) => {
    const cur = over(a.key, now);
    const prev = over(a.key, before);
    return { ...a, cur, prev, change: change(cur, prev) };
  });
  const totalCur = rows.reduce((t, r) => t + r.cur, 0);
  const totalPrev = rows.reduce((t, r) => t + r.prev, 0);
  const statsByIso: Record<string, RegionStat> = Object.fromEntries(rows.filter((r) => r.iso).map((r) => [r.iso!, { qty: r.cur, revenue: 0, share: totalCur ? r.cur / totalCur : 0 }]));
  const selected = area ? areaRows.find((r) => r.key === area) ?? null : null;

  const shortIn = (m: string) => chosen.filter((p) => data.short[p.id]?.includes(m)).map((p) => p.name);
  const p1 = data.products.filter((p) => p.group === "P1").map((p) => p.id);
  const salesAreas = data.areas.map((a) => a.key);
  const rxNow = sumIn(data.rx, now);
  const rxPrev = sumIn(data.rx, before);
  const paidNow = sumIn(data.paid, now);
  const report = (q: string) => `/api/medical/rep-report?${q}&from=${now[0]}&to=${now[now.length - 1]}`;

  // reps and doctors, narrowed by the chosen region and rep
  const repRows = data.reps
    .filter((r) => !selected?.iso || r.regions.includes(selected.iso))
    .map((r) => ({ ...r, cur: sumIn(r.byMonth, now), prev: sumIn(r.byMonth, before), paidCur: sumIn(r.paidByMonth, now) }));
  const doctorsActive = (name: string) => data.doctors.filter((d) => d.rep === name && sumIn(d.byMonth, now) > 0).length;
  const docRows = data.doctors
    .filter((d) => (!selected?.iso || d.regionIso === selected.iso) && (!rep || d.rep === rep))
    .map((d) => ({ ...d, cur: sumIn(d.byMonth, now), prev: sumIn(d.byMonth, before), paidCur: sumIn(d.paidByMonth, now) }))
    .filter((d) => d.cur > 0 || d.prev > 0)
    .sort((a, b) => b.cur - a.cur || b.prev - a.prev)
    .slice(0, 30);

  const chip = (active: boolean) => `rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${active ? "bg-accent text-white" : "text-muted hover:text-foreground"}`;
  const periodLabel =
    (now.length === 1 ? mon(now[0], true) : `${mon(now[0])} – ${mon(now[now.length - 1], true)}`) +
    (end === data.thisMonth ? l({ ru: " (месяц идёт)", en: " (month running)" }) : "");
  const unit = measure === "sales" ? l({ ru: "банок", en: "tins" }) : l({ ru: "фольг", en: "foils" });

  return (
    <div className="space-y-6">
      {/* what to look at */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border bg-surface p-1">
          <button type="button" onClick={() => setMeasure("sales")} className={chip(measure === "sales")}>{l({ ru: "Продажи, банки", en: "Sales, tins" })}</button>
          <button type="button" onClick={() => setMeasure("foils")} className={chip(measure === "foils")}>{l({ ru: "Рецепты, фольги", en: "Prescriptions, foils" })}</button>
        </div>
        {measure === "sales" && (
          <>
            <div className="flex flex-wrap rounded-lg border border-border bg-surface p-1">
              {GROUPS.map((g) => (
                <button key={g.value} type="button" onClick={() => { setGroup(g.value); setProduct(""); }} className={chip(group === g.value)}>
                  {ru ? g.ru : g.en}
                </button>
              ))}
            </div>
            <select value={product} onChange={(e) => setProduct(e.target.value)} className="h-9 rounded-lg border border-border bg-surface px-3 text-[13px]">
              <option value="">{l({ ru: "все товары группы", en: "every product of the group" })}</option>
              {inGroup.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </>
        )}
        <div className="ml-auto flex items-center gap-2 text-[13px]">
          <span className="text-muted">{l({ ru: "Период:", en: "Period:" })}</span>
          <div className="flex rounded-lg border border-border bg-surface p-1">
            {PERIODS.map((n) => (
              <button key={n} type="button" onClick={() => setPeriod(n)} className={chip(period === n)}>
                {n === 1 ? l({ ru: "месяц", en: "month" }) : l({ ru: `${n} мес.`, en: `${n} mo` })}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* the period at a glance */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface px-5 py-4">
          <div className="text-[12.5px] text-muted">{l({ ru: "Продано, банок", en: "Sold, tins" })} · {periodLabel}</div>
          <div className="figure-num mt-1.5 text-[26px] font-semibold leading-none">{tins(salesAreas.reduce((t, k) => t + now.reduce((u, m) => u + sold(k, m), 0), 0))}</div>
          <div className="mt-1.5 text-[12.5px] text-muted">
            {l({ ru: "к прошлому периоду", en: "vs the period before" })}{" "}
            <Change v={change(salesAreas.reduce((t, k) => t + now.reduce((u, m) => u + sold(k, m), 0), 0), salesAreas.reduce((t, k) => t + before.reduce((u, m) => u + sold(k, m), 0), 0))} />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface px-5 py-4">
          <div className="text-[12.5px] text-muted">{l({ ru: "Рецептов (фольг)", en: "Prescriptions (foils)" })} · {periodLabel}</div>
          <div className="figure-num mt-1.5 text-[26px] font-semibold leading-none">{tins(rxNow)}</div>
          <div className="mt-1.5 text-[12.5px] text-muted">
            {l({ ru: "к прошлому периоду", en: "vs the period before" })} <Change v={change(rxNow, rxPrev)} />
            {paidNow > 0 && <span> · {l({ ru: `выплачено ${mln(paidNow)} млн сум`, en: `paid ${mln(paidNow)} mln UZS` })}</span>}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface px-5 py-4">
          <div className="text-[12.5px] text-muted">{measure === "sales" ? l({ ru: "Продажи выросли сильнее всего", en: "Sales grew the most" }) : l({ ru: "Рецепты выросли сильнее всего", en: "Prescriptions grew the most" })}</div>
          <div className="mt-2 space-y-1 text-[13px]">
            {rows.filter((r) => r.region && r.change != null && r.prev >= (measure === "sales" ? 50 : 10)).sort((a, b) => (b.change ?? 0) - (a.change ?? 0)).slice(0, 3).map((r) => (
              <div key={r.key} className="flex justify-between gap-3">
                <span>{r.name}</span>
                <Change v={r.change} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* map + regions in the period */}
      <section className="grid gap-6 rounded-xl border border-border bg-surface p-6 xl:grid-cols-[1.2fr_1fr]">
        <div>
          <h2 className="mb-3 text-[15px] font-semibold">
            {measure === "sales" ? l({ ru: "Продажи по регионам за период, банок", en: "Sales by region in the period, tins" }) : l({ ru: "Рецепты по регионам за период, фольг", en: "Prescriptions by region in the period, foils" })}
          </h2>
          <UzMap statsByIso={statsByIso} selectedIso={selected?.iso ?? null} onSelect={(iso) => { setArea(iso); setRep(null); }} unitsOnly />
        </div>
        <div className="text-[13px]">
          <div className="flex justify-between border-b border-border pb-2 text-[12px] text-muted">
            <span>{l({ ru: "Регион", en: "Region" })}</span>
            <span className="flex gap-6"><span className="w-20 text-right">{unit}</span><span className="w-12 text-right">{l({ ru: "доля", en: "share" })}</span><span className="w-12 text-right">{l({ ru: "рост", en: "change" })}</span></span>
          </div>
          {[...rows].sort((a, b) => (a.region ? 0 : 1) - (b.region ? 0 : 1) || b.cur - a.cur).map((r) => (
            <button key={r.key} type="button" onClick={() => { setArea(area === r.key ? null : r.key); setRep(null); }} className={`flex w-full justify-between rounded px-1 py-1.5 text-left ${area === r.key ? "bg-accent-soft-bg" : "hover:bg-surface-low"}`}>
              <span className={r.region ? "" : "text-muted"}>{r.name}</span>
              <span className="flex gap-6">
                <span className="figure-num w-20 text-right">{tins(r.cur)}</span>
                <span className="figure-num w-12 text-right text-muted">{totalCur ? `${Math.round((r.cur / totalCur) * 100)}%` : "—"}</span>
                <span className="w-12 text-right"><Change v={r.change} /></span>
              </span>
            </button>
          ))}
          <div className="mt-1 flex justify-between border-t border-border px-1 pt-2 font-semibold">
            <span>{l({ ru: "Вся страна", en: "The whole country" })}</span>
            <span className="flex gap-6"><span className="figure-num w-20 text-right">{tins(totalCur)}</span><span className="w-12" /><span className="w-12 text-right"><Change v={change(totalCur, totalPrev)} /></span></span>
          </div>
        </div>
      </section>

      {/* prescriptions and Platin 1, for the country or the chosen region */}
      <section className="overflow-x-auto rounded-xl border border-border bg-surface">
        <div className="px-6 pt-5 text-[15px] font-semibold">
          {l({ ru: "Рецепты и продажи Platin 1", en: "Prescriptions and Platin 1 sales" })} — {selected?.iso ? selected.name : l({ ru: "вся страна", en: "the whole country" })}
        </div>
        <table className="mt-3 w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 z-10 min-w-[200px] bg-surface px-6 py-2.5 text-left" />
              {data.months.map((m) => (
                <th key={m} className="whitespace-nowrap px-2 py-2.5 text-right font-semibold">
                  {mon(m)} {m.slice(2, 4)}
                  {m === data.thisMonth && <div className="text-[10.5px] font-normal text-muted">{l({ ru: "идёт", en: "running" })}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/60">
              <td className="sticky left-0 z-10 bg-surface px-6 py-1.5">{l({ ru: "Рецепты, фольг", en: "Prescriptions, foils" })}</td>
              {data.months.map((m) => {
                const v = selected?.iso ? foilsOf(selected.iso, m) : data.rx[m] ?? 0;
                return <td key={m} className="figure-num px-2 py-1.5 text-right">{v ? tins(v) : "–"}</td>;
              })}
            </tr>
            <tr>
              <td className="sticky left-0 z-10 bg-surface px-6 py-1.5">{l({ ru: "Platin 1, банок", en: "Platin 1, tins" })}</td>
              {data.months.map((m) => {
                const v = selected?.iso ? sold(selected.iso, m, p1) : salesAreas.reduce((t, k) => t + sold(k, m, p1), 0);
                return <td key={m} className="figure-num px-2 py-1.5 text-right">{v ? tins(v) : "–"}</td>;
              })}
            </tr>
          </tbody>
        </table>
        <div className="h-4" />
      </section>

      {/* month by month */}
      <section className="overflow-x-auto rounded-xl border border-border bg-surface">
        <div className="px-6 pt-5 text-[15px] font-semibold">{l({ ru: `По месяцам, ${unit}`, en: `Month by month, ${unit}` })}</div>
        <table className="mt-3 w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 z-10 min-w-[200px] bg-surface px-6 py-2.5 text-left text-[12px] font-normal text-muted">{l({ ru: "Регион", en: "Region" })}</th>
              {data.months.map((m) => {
                const s = measure === "sales" ? shortIn(m) : [];
                return (
                  <th key={m} className="whitespace-nowrap px-2 py-2.5 text-right" title={s.length ? `${l({ ru: "не хватало товара", en: "ran short" })}: ${s.join(", ")}` : undefined}>
                    <div className="font-semibold">{mon(m)} {m.slice(2, 4)}</div>
                    <div className="text-[10.5px] font-normal text-muted">
                      {m === data.thisMonth ? l({ ru: "идёт", en: "running" }) : s.length ? <span className="text-danger">● {l({ ru: "нехватка", en: "short" })}</span> : " "}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {areaRows.map((a) => (
              <tr key={a.key} onClick={() => { setArea(area === a.key ? null : a.key); setRep(null); }} className={`cursor-pointer border-b border-border/60 ${area === a.key ? "bg-accent-soft-bg" : "hover:bg-surface-low/60"}`}>
                <td className={`sticky left-0 z-10 px-6 py-1.5 ${a.region ? "" : "text-muted"}`} style={{ background: area === a.key ? "var(--accent-soft-bg)" : "var(--surface)" }}>{a.name}</td>
                {data.months.map((m) => {
                  const v = valueOf(a.key, m);
                  return <td key={m} className={`figure-num px-2 py-1.5 text-right ${m === data.thisMonth ? "text-muted" : ""}`}>{v ? tins(v) : "–"}</td>;
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-foreground/70 font-semibold">
              <td className="sticky left-0 z-10 bg-surface px-6 py-2">{l({ ru: "Вся страна", en: "The whole country" })}</td>
              {data.months.map((m) => (
                <td key={m} className="figure-num px-2 py-2 text-right">{tins(areaRows.reduce((t, a) => t + valueOf(a.key, m), 0))}</td>
              ))}
            </tr>
          </tfoot>
        </table>
        <div className="h-4" />
      </section>

      {foilsLoaded && (
        <div className="grid gap-6 xl:grid-cols-2">
          {/* medical reps */}
          <section className="rounded-xl border border-border bg-surface p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-[15px] font-semibold">
                {l({ ru: "Медицинские представители", en: "Medical reps" })}
                {selected?.iso && <span className="font-normal text-muted"> — {selected.name}</span>}
              </h2>
              <a href={report("all=1")} className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-medium hover:bg-surface-low">
                {l({ ru: `Отчёты всех представителей · ${periodLabel} (ZIP)`, en: `Every rep's report · ${periodLabel} (ZIP)` })}
              </a>
            </div>
            <div className="mt-3 text-[13px]">
              <div className="flex justify-between border-b border-border pb-2 text-[12px] text-muted">
                <span>{l({ ru: "Представитель · регионы", en: "Rep · regions" })}</span>
                <span className="flex gap-4"><span className="w-14 text-right">{l({ ru: "фольг", en: "foils" })}</span><span className="w-11 text-right">{l({ ru: "рост", en: "change" })}</span><span className="w-12 text-right">{l({ ru: "врачей", en: "doctors" })}</span><span className="w-16 text-right">{l({ ru: "млн сум", en: "mln UZS" })}</span><span className="w-12" /></span>
              </div>
              {repRows.map((r) => (
                <div key={r.name} className={`flex w-full items-baseline justify-between gap-3 rounded px-1 py-1.5 ${rep === r.name ? "bg-accent-soft-bg" : "hover:bg-surface-low"}`}>
                  <button type="button" onClick={() => setRep(rep === r.name ? null : r.name)} className="min-w-0 flex-1 text-left">
                    <span className="font-medium">{r.name}</span>
                    <span className="ml-2 text-[12px] text-muted">{r.regions.slice(0, 2).map(regionName).join(", ")}{r.regions.length > 2 ? "…" : ""}</span>
                  </button>
                  <span className="flex items-baseline gap-4">
                    <span className="figure-num w-14 text-right">{tins(r.cur)}</span>
                    <span className="w-11 text-right"><Change v={change(r.cur, r.prev)} /></span>
                    <span className="figure-num w-12 text-right text-muted">{doctorsActive(r.name)}</span>
                    <span className="figure-num w-16 text-right text-muted">{mln(r.paidCur)}</span>
                    <a href={report(`rep=${encodeURIComponent(r.name)}`)} title={l({ ru: `Отчёт ${r.name} за ${periodLabel}`, en: `${r.name}'s report, ${periodLabel}` })} className="w-12 text-right text-[12px] font-medium text-accent hover:underline">
                      Excel
                    </a>
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* doctors */}
          <section className="rounded-xl border border-border bg-surface p-6">
            <h2 className="text-[15px] font-semibold">
              {l({ ru: "Врачи", en: "Doctors" })}
              <span className="font-normal text-muted">
                {" — "}
                {[selected?.iso ? selected.name : null, rep].filter(Boolean).join(", ") || l({ ru: "вся страна", en: "the whole country" })}
              </span>
            </h2>
            <div className="mt-3 text-[13px]">
              <div className="flex justify-between border-b border-border pb-2 text-[12px] text-muted">
                <span>{l({ ru: "Врач · учреждение", en: "Doctor · clinic" })}</span>
                <span className="flex gap-4"><span className="w-16 text-right">{l({ ru: "ставка", en: "rate" })}</span><span className="w-12 text-right">{l({ ru: "фольг", en: "foils" })}</span><span className="w-11 text-right">{l({ ru: "рост", en: "change" })}</span><span className="w-14 text-right">{l({ ru: "млн сум", en: "mln UZS" })}</span></span>
              </div>
              {docRows.length === 0 && <div className="py-3 text-muted">{l({ ru: "За период рецептов нет", en: "No prescriptions in the period" })}</div>}
              {docRows.map((d) => (
                <div key={`${d.doctor}|${d.clinic}`} className="flex items-baseline justify-between gap-3 px-1 py-1.5">
                  <span className="min-w-0">
                    <span className="font-medium">{d.doctor}</span>
                    <span className="ml-2 text-[12px] text-muted">{[d.clinic, d.district].filter(Boolean).join(", ")}{!rep && d.rep ? ` · ${d.rep}` : ""}</span>
                  </span>
                  <span className="flex shrink-0 gap-4">
                    <span className="figure-num w-16 text-right text-muted">{d.rate ? tins(d.rate) : "—"}</span>
                    <span className="figure-num w-12 text-right">{tins(d.cur)}</span>
                    <span className="w-11 text-right"><Change v={change(d.cur, d.prev)} /></span>
                    <span className="figure-num w-14 text-right text-muted">{mln(d.paidCur)}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
