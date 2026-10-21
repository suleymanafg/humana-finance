"use client";

// «Медицинский отдел» — Humana sales in tins by region, for the medical team to
// see whether a campaign moves sales: a map of the period, regions month by
// month with the change against the period before, and prescriptions next to
// Platin 1. Months a product ran out of stock are marked. No money anywhere.
import { useState } from "react";
import { useT } from "@/lib/locale-context";
import { addMonths } from "@/lib/planning/compute";
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

export default function MedicalView({ data }: { data: MedicalData }) {
  const { locale, l } = useT();
  const ru = locale === "ru";
  const [group, setGroup] = useState<MedGroup | "ALL">("ALL");
  const [product, setProduct] = useState<string>("");
  const [period, setPeriod] = useState(3);
  const [area, setArea] = useState<string | null>(null);

  const tins = (v: number) => Math.round(v).toLocaleString(ru ? "ru-RU" : "en-US");
  const mon = (id: string, year = false) => {
    const [y, m] = id.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(ru ? "ru-RU" : "en-GB", { month: year ? "long" : "short", year: year ? "numeric" : undefined, timeZone: "UTC" }).replace(".", "");
  };

  const inGroup = data.products.filter((p) => group === "ALL" || p.group === group);
  const chosen = product ? inGroup.filter((p) => p.id === product) : inGroup;
  const ids = chosen.map((p) => p.id);
  const of = (areaKey: string, m: string, which: string[] = ids) => which.reduce((t, id) => t + (data.qty[areaKey]?.[id]?.[m] ?? 0), 0);

  // whole months only: the period ends with the last complete month
  const lastWhole = addMonths(data.thisMonth, -1);
  const span = (end: string, n: number) => Array.from({ length: n }, (_, i) => addMonths(end, i - n + 1));
  const now = span(lastWhole, period);
  const before = span(addMonths(lastWhole, -period), period);
  const sumOver = (areaKey: string, ms: string[], which?: string[]) => ms.reduce((t, m) => t + of(areaKey, m, which), 0);

  const rows = data.areas.map((a) => {
    const cur = sumOver(a.key, now);
    const prev = sumOver(a.key, before);
    return { ...a, cur, prev, change: prev > 0 ? cur / prev - 1 : null };
  });
  const totalCur = rows.reduce((t, r) => t + r.cur, 0);
  const totalPrev = rows.reduce((t, r) => t + r.prev, 0);
  const statsByIso: Record<string, RegionStat> = Object.fromEntries(rows.filter((r) => r.iso).map((r) => [r.iso!, { qty: r.cur, revenue: 0, share: totalCur ? r.cur / totalCur : 0 }]));
  const selected = rows.find((r) => r.key === area) ?? null;

  // months the chosen products ran short, for the month headers
  const shortIn = (m: string) => chosen.filter((p) => data.short[p.id]?.includes(m)).map((p) => p.name);
  const p1 = data.products.filter((p) => p.group === "P1").map((p) => p.id);
  const allAreas = data.areas.map((a) => a.key);
  const p1Of = (m: string, keys: string[]) => keys.reduce((t, k) => t + of(k, m, p1), 0);

  const chip = (active: boolean) => `rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${active ? "bg-accent text-white" : "text-muted hover:text-foreground"}`;

  return (
    <div className="space-y-6">
      {/* filters */}
      <div className="flex flex-wrap items-center gap-3">
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
          <div className="text-[12.5px] text-muted">{l({ ru: "Продано, банок", en: "Sold, tins" })} · {now.length === 1 ? mon(now[0], true) : `${mon(now[0])} – ${mon(now[now.length - 1], true)}`}</div>
          <div className="figure-num mt-1.5 text-[26px] font-semibold leading-none">{tins(totalCur)}</div>
          <div className="mt-1.5 text-[12.5px] text-muted">{l({ ru: "к прошлому периоду", en: "vs the period before" })} <Change v={totalPrev ? totalCur / totalPrev - 1 : null} /></div>
        </div>
        <div className="rounded-xl border border-border bg-surface px-5 py-4">
          <div className="text-[12.5px] text-muted">{l({ ru: "Рецептов (фольг) за период", en: "Prescriptions (foils) in the period" })}</div>
          <div className="figure-num mt-1.5 text-[26px] font-semibold leading-none">{tins(now.reduce((t, m) => t + (data.rx[m] ?? 0), 0))}</div>
          <div className="mt-1.5 text-[12.5px] text-muted">{l({ ru: "к прошлому периоду", en: "vs the period before" })} <Change v={(() => { const a = now.reduce((t, m) => t + (data.rx[m] ?? 0), 0); const b = before.reduce((t, m) => t + (data.rx[m] ?? 0), 0); return b ? a / b - 1 : null; })()} /></div>
        </div>
        <div className="rounded-xl border border-border bg-surface px-5 py-4">
          <div className="text-[12.5px] text-muted">{l({ ru: "Сильнее всего выросли", en: "Grew the most" })}</div>
          <div className="mt-2 space-y-1 text-[13px]">
            {rows.filter((r) => r.kind === "region" && r.change != null && r.prev >= 50).sort((a, b) => (b.change ?? 0) - (a.change ?? 0)).slice(0, 3).map((r) => (
              <div key={r.key} className="flex justify-between gap-3">
                <span>{ru ? r.nameRu : r.nameEn}</span>
                <Change v={r.change} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* map + regions in the period */}
      <section className="grid gap-6 rounded-xl border border-border bg-surface p-6 xl:grid-cols-[1.2fr_1fr]">
        <div>
          <h2 className="mb-3 text-[15px] font-semibold">{l({ ru: "Продажи по регионам за период, банок", en: "Sales by region in the period, tins" })}</h2>
          <UzMap statsByIso={statsByIso} selectedIso={selected?.iso ?? null} onSelect={(iso) => setArea(iso)} unitsOnly />
        </div>
        <div className="text-[13px]">
          <div className="flex justify-between border-b border-border pb-2 text-[12px] text-muted">
            <span>{l({ ru: "Регион", en: "Region" })}</span>
            <span className="flex gap-6"><span className="w-20 text-right">{l({ ru: "банок", en: "tins" })}</span><span className="w-12 text-right">{l({ ru: "доля", en: "share" })}</span><span className="w-12 text-right">{l({ ru: "рост", en: "change" })}</span></span>
          </div>
          {[...rows].sort((a, b) => (a.kind === "region" ? 0 : 1) - (b.kind === "region" ? 0 : 1) || b.cur - a.cur).map((r) => (
            <button key={r.key} type="button" onClick={() => setArea(area === r.key ? null : r.key)} className={`flex w-full justify-between rounded px-1 py-1.5 text-left ${area === r.key ? "bg-accent-soft-bg" : "hover:bg-surface-low"}`}>
              <span className={r.kind === "region" ? "" : "text-muted"}>{ru ? r.nameRu : r.nameEn}</span>
              <span className="flex gap-6">
                <span className="figure-num w-20 text-right">{tins(r.cur)}</span>
                <span className="figure-num w-12 text-right text-muted">{totalCur ? `${Math.round((r.cur / totalCur) * 100)}%` : "—"}</span>
                <span className="w-12 text-right"><Change v={r.change} /></span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* month by month */}
      <section className="overflow-x-auto rounded-xl border border-border bg-surface">
        <div className="px-6 pt-5 text-[15px] font-semibold">{l({ ru: "По месяцам, банок", en: "Month by month, tins" })}</div>
        <table className="mt-3 w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 z-10 min-w-[200px] bg-surface px-6 py-2.5 text-left text-[12px] font-normal text-muted">{l({ ru: "Регион", en: "Region" })}</th>
              {data.months.map((m) => {
                const s = shortIn(m);
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
            {data.areas.map((a) => (
              <tr key={a.key} onClick={() => setArea(area === a.key ? null : a.key)} className={`cursor-pointer border-b border-border/60 ${area === a.key ? "bg-accent-soft-bg" : "hover:bg-surface-low/60"}`}>
                <td className={`sticky left-0 z-10 px-6 py-1.5 ${a.kind === "region" ? "" : "text-muted"}`} style={{ background: area === a.key ? "var(--accent-soft-bg)" : "var(--surface)" }}>{ru ? a.nameRu : a.nameEn}</td>
                {data.months.map((m) => (
                  <td key={m} className={`figure-num px-2 py-1.5 text-right ${m === data.thisMonth ? "text-muted" : ""}`}>{tins(of(a.key, m)) === "0" ? "–" : tins(of(a.key, m))}</td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-foreground/70 font-semibold">
              <td className="sticky left-0 z-10 bg-surface px-6 py-2">{l({ ru: "Вся страна", en: "The whole country" })}</td>
              {data.months.map((m) => (
                <td key={m} className="figure-num px-2 py-2 text-right">{tins(allAreas.reduce((t, k) => t + of(k, m), 0))}</td>
              ))}
            </tr>
          </tfoot>
        </table>
        <div className="h-4" />
      </section>

      {/* prescriptions and Platin 1 */}
      <section className="overflow-x-auto rounded-xl border border-border bg-surface">
        <div className="px-6 pt-5 text-[15px] font-semibold">{l({ ru: "Рецепты и продажи Platin 1", en: "Prescriptions and Platin 1 sales" })}</div>
        <table className="mt-3 w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 z-10 min-w-[260px] bg-surface px-6 py-2.5 text-left" />
              {data.months.map((m) => (
                <th key={m} className="whitespace-nowrap px-2 py-2.5 text-right font-semibold">{mon(m)} {m.slice(2, 4)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/60">
              <td className="sticky left-0 z-10 bg-surface px-6 py-1.5">{l({ ru: "Рецепты (фольги), вся страна", en: "Prescriptions (foils), whole country" })}</td>
              {data.months.map((m) => <td key={m} className="figure-num px-2 py-1.5 text-right">{data.rx[m] ? tins(data.rx[m]) : "–"}</td>)}
            </tr>
            <tr className="border-b border-border/60">
              <td className="sticky left-0 z-10 bg-surface px-6 py-1.5">{l({ ru: "Platin 1, банок — вся страна", en: "Platin 1, tins — whole country" })}</td>
              {data.months.map((m) => <td key={m} className="figure-num px-2 py-1.5 text-right">{tins(p1Of(m, allAreas))}</td>)}
            </tr>
            {selected && (
              <tr>
                <td className="sticky left-0 z-10 bg-surface px-6 py-1.5 font-medium">{l({ ru: `Platin 1, банок — ${selected.nameRu}`, en: `Platin 1, tins — ${selected.nameEn}` })}</td>
                {data.months.map((m) => <td key={m} className="figure-num px-2 py-1.5 text-right font-medium">{tins(p1Of(m, [selected.key]))}</td>)}
              </tr>
            )}
          </tbody>
        </table>
        <div className="h-4" />
      </section>
    </div>
  );
}
