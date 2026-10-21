"use client";

// «Медицинский отдел» — does the medical campaign pay off, territory by
// territory: Tashkent city by its districts, every other region as a whole.
// For each, the period against the one before it: tins sold, prescriptions
// (foils), what was paid for them, tins per prescription and the cost of a tin
// sold, and a plain verdict — good only when sales grow and tins per
// prescription grow. A territory opens to its months and the reps working
// there; below, the reps (each with their own Excel report) and the doctors.
// The period ends with the month chosen at the top (a running month is left
// out). Sales are in tins only.
import { useState } from "react";
import { useT } from "@/lib/locale-context";
import { addMonths } from "@/lib/planning/compute";
import { NO_TERRITORY, territoryName } from "@/lib/territories";
import { effectOf, sumMonths, VERDICTS, type Effect, type Totals } from "@/lib/medical-effect";
import type { MedGroup, MedicalData } from "@/lib/medical-data";

const GROUPS: { value: MedGroup | "ALL"; ru: string; en: string }[] = [
  { value: "ALL", ru: "Все товары", en: "All products" },
  { value: "P1", ru: "Platin 1", en: "Platin 1" },
  { value: "P2", ru: "Platin 2", en: "Platin 2" },
  { value: "P3", ru: "Platin 3", en: "Platin 3" },
  { value: "EXPERT", ru: "Expert", en: "Expert" },
];
const PERIODS = [1, 3, 6, 12];
type SortKey = "tins" | "foils" | "paid" | "perRx" | "cost";

const TONE = { ok: "text-ok", warn: "text-warn", danger: "text-danger", muted: "text-muted" } as const;

interface Fmt {
  ru: boolean;
  n: (v: number) => string;
  mln: (v: number) => string;
  ratio: (v: number | null) => string;
  pct: (v: number | null) => string;
  mon: (id: string, long?: boolean) => string;
}

function makeFmt(ru: boolean): Fmt {
  const loc = ru ? "ru-RU" : "en-US";
  return {
    ru,
    n: (v) => Math.round(v).toLocaleString(loc),
    mln: (v) => (v / 1e6).toLocaleString(loc, { maximumFractionDigits: v >= 1e7 ? 0 : 1 }),
    ratio: (v) => (v == null ? "—" : v.toLocaleString(loc, { maximumFractionDigits: 1, minimumFractionDigits: 1 })),
    pct: (v) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v * 100))}%`),
    mon: (id, long = false) => {
      const [y, m] = id.split("-").map(Number);
      const s = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(ru ? "ru-RU" : "en-GB", { month: "short", timeZone: "UTC" }).replace(".", "");
      return long ? `${s} ${y}` : `${s} ${String(y).slice(2)}`;
    },
  };
}

const span = (last: string, n: number) => Array.from({ length: n }, (_, i) => addMonths(last, i - n + 1));

/** tins per prescription, before → now; the arrow's end coloured by which way it went */
function PerRx({ e, f }: { e: Effect; f: Fmt }) {
  if (e.perRx == null && e.perRxBefore == null) return <span className="text-muted">—</span>;
  const up = e.perRx != null && e.perRxBefore != null && e.perRx > e.perRxBefore;
  const down = e.perRx != null && e.perRxBefore != null && e.perRx < e.perRxBefore;
  return (
    <span className="whitespace-nowrap">
      <span className="text-muted">{f.ratio(e.perRxBefore)} → </span>
      <span className={`font-medium ${up ? "text-ok" : down ? "text-danger" : ""}`}>{f.ratio(e.perRx)}</span>
    </span>
  );
}

function Verdict({ e, l }: { e: Effect; l: (b: { ru: string; en: string }) => string }) {
  const v = VERDICTS[e.verdict];
  return <span className={`whitespace-nowrap font-medium ${TONE[v.tone]}`}>{l({ ru: v.ru, en: v.en })}</span>;
}

/** one row of the territories table */
function Row({ name, e, f, l, strong, muted, open, onClick }: { name: string; e: Effect; f: Fmt; l: (b: { ru: string; en: string }) => string; strong?: boolean; muted?: boolean; open?: boolean; onClick?: () => void }) {
  const cell = "figure-num px-3 py-2 text-right";
  return (
    <tr onClick={onClick} className={`border-b border-border/60 ${onClick ? "cursor-pointer hover:bg-surface-low/60" : ""} ${open ? "bg-accent-soft-bg" : ""} ${strong ? "font-semibold" : ""}`}>
      <td className={`px-4 py-2 ${muted ? "text-muted" : ""}`}>{name}</td>
      <td className={cell}>{f.n(e.now.tins)}</td>
      <td className={`${cell} ${e.salesChange == null ? "text-muted" : e.salesChange > 0.05 ? "text-ok" : e.salesChange < -0.05 ? "text-danger" : "text-muted"}`}>{f.pct(e.salesChange)}</td>
      <td className={cell}>{e.now.foils ? f.n(e.now.foils) : "—"}</td>
      <td className={cell}>{e.now.paid ? f.mln(e.now.paid) : "—"}</td>
      <td className={cell}><PerRx e={e} f={f} /></td>
      <td className={cell}>{e.costPerTin ? f.n(e.costPerTin) : "—"}</td>
      <td className="px-4 py-2">{muted && !e.now.foils ? null : <Verdict e={e} l={l} />}</td>
    </tr>
  );
}

function Tile({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-5 py-4">
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className="figure-num mt-1.5 text-[24px] font-semibold leading-none">{value}</div>
      {note && <div className="mt-1.5 text-[12.5px] text-muted">{note}</div>}
    </div>
  );
}

export default function MedicalView({ data }: { data: MedicalData }) {
  const { locale, l } = useT();
  const ru = locale === "ru";
  const f = makeFmt(ru);
  const [group, setGroup] = useState<MedGroup | "ALL">("ALL");
  const [period, setPeriod] = useState(3);
  const [sort, setSort] = useState<SortKey>("tins");
  const [open, setOpen] = useState<string | null>(null);
  const [terrFilter, setTerrFilter] = useState("");
  const [repFilter, setRepFilter] = useState("");
  const [allDoctors, setAllDoctors] = useState(false);

  // the period: complete months only — a running month is left out
  const running = data.endMonth === data.thisMonth;
  const last = running ? addMonths(data.endMonth, -1) : data.endMonth;
  const now = span(last, period);
  const before = span(addMonths(last, -period), period);
  const trend = span(data.endMonth, 12);
  const label = (ms: string[]) => (ms.length === 1 ? f.mon(ms[0], true) : `${f.mon(ms[0])} – ${f.mon(ms[ms.length - 1], true)}`);

  const ids = data.products.filter((p) => group === "ALL" || p.group === group).map((p) => p.id);
  const tinsOf = (key: string, ms: string[]) => ids.reduce((t, id) => t + sumMonths(data.sales[key]?.[id], ms), 0);
  const totals = (keys: string[], ms: string[]): Totals => ({
    tins: keys.reduce((t, k) => t + tinsOf(k, ms), 0),
    foils: keys.reduce((t, k) => t + sumMonths(data.foils[k], ms), 0),
    paid: keys.reduce((t, k) => t + sumMonths(data.paid[k], ms), 0),
  });
  const effect = (keys: string[]) => effectOf(totals(keys, now), totals(keys, before));

  // the whole country: every sale (chains too) against every prescription
  const allSaleKeys = Object.keys(data.sales);
  const repTotals = (ms: string[]) => ({ foils: data.reps.reduce((t, r) => t + sumMonths(r.foils, ms), 0), paid: data.reps.reduce((t, r) => t + sumMonths(r.paid, ms), 0) });
  const country = effectOf(
    { tins: allSaleKeys.reduce((t, k) => t + tinsOf(k, now), 0), ...repTotals(now) },
    { tins: allSaleKeys.reduce((t, k) => t + tinsOf(k, before), 0), ...repTotals(before) }
  );

  const sortValue = (e: Effect) => (sort === "tins" ? e.now.tins : sort === "foils" ? e.now.foils : sort === "paid" ? e.now.paid : sort === "perRx" ? e.perRx ?? -1 : e.costPerTin ?? -1);
  const rowsOf = (kind: "district" | "region") =>
    data.territories
      .filter((t) => t.kind === kind)
      .map((t) => ({ key: t.key, name: ru ? t.nameRu : t.nameEn, e: effect([t.key]) }))
      .filter((r) => r.e.now.tins || r.e.now.foils || r.e.before.tins || r.e.before.foils)
      .sort((a, b) => sortValue(b.e) - sortValue(a.e));
  const districts = rowsOf("district");
  const regions = rowsOf("region");
  const chains = effect([NO_TERRITORY]);

  // the two lists that answer "where does it work, where not"
  const named = [...districts, ...regions].filter((r) => r.e.now.foils > 0 && r.e.now.tins > 0);
  const works = named.filter((r) => r.e.verdict === "good").sort((a, b) => (b.e.perRx ?? 0) - (a.e.perRx ?? 0)).slice(0, 5);
  const fails = named.filter((r) => r.e.verdict === "noReturn").sort((a, b) => b.e.now.paid - a.e.now.paid).slice(0, 5);

  const shortNote = data.products
    .filter((p) => ids.includes(p.id))
    .map((p) => ({ name: p.name, ms: (data.short[p.id] ?? []).filter((m) => now.includes(m) || before.includes(m)) }))
    .filter((x) => x.ms.length);

  // who works in the opened territory: the doctors' lines there, by rep
  const repsIn = (key: string) => {
    const by = new Map<string, { foils: number; doctors: number }>();
    for (const d of data.doctors) {
      if (d.territory !== key) continue;
      const v = sumMonths(d.foils, now);
      if (!v) continue;
      const r = by.get(d.rep || "—") ?? { foils: 0, doctors: 0 };
      r.foils += v;
      r.doctors += 1;
      by.set(d.rep || "—", r);
    }
    return [...by.entries()].sort((a, b) => b[1].foils - a[1].foils);
  };

  const report = (q: string) => `/api/medical/rep-report?${q}&to=${last}&lang=${locale}`;
  const repRows = data.reps
    .map((r) => {
      const terr = effectOf(totals(r.territories, now), totals(r.territories, before));
      return {
        ...r,
        foilsNow: sumMonths(r.foils, now),
        paidNow: sumMonths(r.paid, now),
        doctors: data.doctors.filter((d) => d.rep === r.name && sumMonths(d.foils, now) > 0).length,
        terrSales: terr.salesChange,
      };
    })
    .filter((r) => r.foilsNow > 0 || sumMonths(r.foils, before) > 0);

  const docRows = data.doctors
    .filter((d) => (!terrFilter || d.territory === terrFilter) && (!repFilter || d.rep === repFilter))
    .map((d) => ({ ...d, foilsNow: sumMonths(d.foils, now), paidNow: sumMonths(d.paid, now) }))
    .filter((d) => d.foilsNow > 0)
    .sort((a, b) => b.foilsNow - a.foilsNow);
  const docShown = allDoctors ? docRows : docRows.slice(0, 30);

  const chip = (active: boolean) => `rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${active ? "bg-accent text-white" : "text-muted hover:text-foreground"}`;
  const th = (key: SortKey | null, text: string, left = false) => (
    <th className={`whitespace-nowrap px-3 py-2.5 font-medium ${left ? "text-left" : "text-right"}`}>
      {key ? (
        <button type="button" onClick={() => setSort(key)} className={sort === key ? "text-foreground underline underline-offset-4" : "hover:text-foreground"}>
          {text}
        </button>
      ) : (
        text
      )}
    </th>
  );

  const territoryRow = (r: { key: string; name: string; e: Effect }) => (
    <Row key={r.key} name={r.name} e={r.e} f={f} l={l} open={open === r.key} onClick={() => { setOpen(open === r.key ? null : r.key); setTerrFilter(open === r.key ? "" : r.key); }} />
  );
  const detail = (key: string) => {
    const reps = repsIn(key);
    return (
      <tr key={`${key}-detail`} className="border-b border-border bg-surface-low/40">
        <td colSpan={8} className="px-4 py-4">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="text-muted">
                  <th className="px-2 py-1 text-left font-medium" />
                  {trend.map((m) => (
                    <th key={m} className="whitespace-nowrap px-2 py-1 text-right font-medium">
                      {f.mon(m)}
                      {m === data.thisMonth && <span className="font-normal">{l({ ru: " (идёт)", en: " (running)" })}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { name: l({ ru: "Продано, банок", en: "Sold, tins" }), v: (m: string) => tinsOf(key, [m]), fmt: f.n },
                  { name: l({ ru: "Рецептов", en: "Prescriptions" }), v: (m: string) => data.foils[key]?.[m] ?? 0, fmt: f.n },
                  { name: l({ ru: "Вложено, млн сум", en: "Paid, mln UZS" }), v: (m: string) => data.paid[key]?.[m] ?? 0, fmt: f.mln },
                  { name: l({ ru: "Банок на рецепт", en: "Tins per prescription" }), v: (m: string) => { const x = data.foils[key]?.[m] ?? 0; return x ? tinsOf(key, [m]) / x : 0; }, fmt: (v: number) => f.ratio(v) },
                ].map((line) => (
                  <tr key={line.name}>
                    <td className="whitespace-nowrap px-2 py-1">{line.name}</td>
                    {trend.map((m) => {
                      const v = line.v(m);
                      return <td key={m} className={`figure-num px-2 py-1 text-right ${m === data.thisMonth ? "text-muted" : ""}`}>{v ? line.fmt(v) : "–"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-[12.5px]">
            <span className="text-muted">{l({ ru: "Работают здесь за период: ", en: "Working here in the period: " })}</span>
            {reps.length
              ? reps.map(([name, r], i) => (
                  <span key={name}>
                    {i > 0 && ", "}
                    {name} — {f.n(r.foils)} {l({ ru: "рец.", en: "Rx" })}, {r.doctors} {l({ ru: "врач.", en: "doctors" })}
                  </span>
                ))
              : l({ ru: "никто", en: "nobody" })}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-6">
      {/* what to look at */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap rounded-lg border border-border bg-surface p-1">
          {GROUPS.map((g) => (
            <button key={g.value} type="button" onClick={() => setGroup(g.value)} className={chip(group === g.value)}>
              {ru ? g.ru : g.en}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-border bg-surface p-1">
          {PERIODS.map((n) => (
            <button key={n} type="button" onClick={() => setPeriod(n)} className={chip(period === n)}>
              {n === 1 ? l({ ru: "1 месяц", en: "1 month" }) : l({ ru: `${n} мес.`, en: `${n} months` })}
            </button>
          ))}
        </div>
      </div>
      <p className="-mt-3 text-[13px] text-muted">
        {l({ ru: "Период", en: "Period" })} <span className="font-medium text-foreground">{label(now)}</span> {l({ ru: "в сравнении с", en: "compared with" })} {label(before)}.
        {running && l({ ru: ` ${f.mon(data.endMonth, true)} ещё идёт и в период не входит.`, en: ` ${f.mon(data.endMonth, true)} is still running and is left out.` })}
      </p>

      {/* the country at a glance */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label={l({ ru: "Продано, банок", en: "Sold, tins" })} value={f.n(country.now.tins)} note={<>{l({ ru: "к прошлому периоду", en: "vs the period before" })} {f.pct(country.salesChange)}</>} />
        <Tile label={l({ ru: "Рецептов", en: "Prescriptions" })} value={f.n(country.now.foils)} note={<>{l({ ru: "было", en: "before" })} {f.n(country.before.foils)}</>} />
        <Tile label={l({ ru: "Вложено в рецепты, млн сум", en: "Paid for prescriptions, mln UZS" })} value={f.mln(country.now.paid)} note={<>{l({ ru: "сум на проданную банку", en: "UZS per tin sold" })}: {country.costPerTin ? f.n(country.costPerTin) : "—"}</>} />
        <Tile label={l({ ru: "Банок на рецепт", en: "Tins per prescription" })} value={f.ratio(country.perRx)} note={<>{l({ ru: "было", en: "before" })} {f.ratio(country.perRxBefore)} · <Verdict e={country} l={l} /></>} />
      </div>

      {/* where it works and where it does not */}
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface px-5 py-4">
          <h2 className="text-[14px] font-semibold">{l({ ru: "Работает: продажи растут быстрее рецептов", en: "Working: sales grow faster than prescriptions" })}</h2>
          <div className="mt-2 space-y-1 text-[13px]">
            {works.length === 0 && <div className="text-muted">{l({ ru: "За этот период таких нет", en: "None in this period" })}</div>}
            {works.map((r) => (
              <div key={r.key} className="flex justify-between gap-3">
                <span>{r.name}</span>
                <span className="text-muted">
                  {l({ ru: "продажи", en: "sales" })} <span className="text-ok">{f.pct(r.e.salesChange)}</span> · {f.ratio(r.e.perRx)} {l({ ru: "банки на рецепт", en: "tins per Rx" })}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-xl border border-border bg-surface px-5 py-4">
          <h2 className="text-[14px] font-semibold">{l({ ru: "Не окупается: вложения есть, отдачи нет", en: "Not paying off: money in, no return" })}</h2>
          <div className="mt-2 space-y-1 text-[13px]">
            {fails.length === 0 && <div className="text-muted">{l({ ru: "За этот период таких нет", en: "None in this period" })}</div>}
            {fails.map((r) => (
              <div key={r.key} className="flex justify-between gap-3">
                <span>{r.name}</span>
                <span className="text-muted">
                  {f.mln(r.e.now.paid)} {l({ ru: "млн сум", en: "mln UZS" })} · {l({ ru: "продажи", en: "sales" })} <span className={r.e.salesChange != null && r.e.salesChange < -0.05 ? "text-danger" : ""}>{f.pct(r.e.salesChange)}</span> · {f.n(r.e.costPerTin ?? 0)} {l({ ru: "сум на банку", en: "UZS per tin" })}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* territories */}
      <section className="overflow-x-auto rounded-xl border border-border bg-surface">
        <div className="px-4 pt-5">
          <h2 className="text-[15px] font-semibold">{l({ ru: "Эффективность по территориям", en: "Effectiveness by territory" })}</h2>
          <p className="mt-1 text-[12.5px] text-muted">
            {l({
              ru: "«Эффективно» — продажи выросли и банок на один рецепт стало больше. «Рост дорогой» — продажи растут медленнее рецептов. «Нет отдачи» — за рецепты платят, а продажи не растут. Нажмите на территорию — откроются месяцы и представители.",
              en: "«Effective» — sales grew and there are more tins per prescription. «Costly growth» — sales grow slower than prescriptions. «No return» — prescriptions paid for, sales not growing. Click a territory for its months and reps.",
            })}
          </p>
        </div>
        <table className="mt-3 w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-[12px] text-muted">
              {th(null, l({ ru: "Территория", en: "Territory" }), true)}
              {th("tins", l({ ru: "Продано, банок", en: "Sold, tins" }))}
              {th(null, l({ ru: "к прошлому", en: "vs before" }))}
              {th("foils", l({ ru: "Рецептов", en: "Prescriptions" }))}
              {th("paid", l({ ru: "Вложено, млн", en: "Paid, mln" }))}
              {th("perRx", l({ ru: "Банок на рецепт", en: "Tins per Rx" }))}
              {th("cost", l({ ru: "Сум на банку", en: "UZS per tin" }))}
              {th(null, l({ ru: "Итог", en: "Verdict" }), true)}
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={8} className="px-4 pb-1 pt-4 text-[12px] font-semibold uppercase tracking-wide text-muted">{l({ ru: "Ташкент по районам", en: "Tashkent by district" })}</td></tr>
            {districts.flatMap((r) => (open === r.key ? [territoryRow(r), detail(r.key)] : [territoryRow(r)]))}
            <Row name={l({ ru: "Ташкент, всего", en: "Tashkent, total" })} e={effect(districts.map((r) => r.key))} f={f} l={l} strong />
            <tr><td colSpan={8} className="px-4 pb-1 pt-5 text-[12px] font-semibold uppercase tracking-wide text-muted">{l({ ru: "Регионы", en: "Regions" })}</td></tr>
            {regions.flatMap((r) => (open === r.key ? [territoryRow(r), detail(r.key)] : [territoryRow(r)]))}
            <Row name={l({ ru: "Регионы, всего", en: "Regions, total" })} e={effect(regions.map((r) => r.key))} f={f} l={l} strong />
            <tr><td colSpan={8} className="pt-3" /></tr>
            <Row name={l({ ru: "Сети и другие каналы (без территории)", en: "Chains and other channels (no territory)" })} e={chains} f={f} l={l} muted />
            <Row name={l({ ru: "Вся страна", en: "The whole country" })} e={country} f={f} l={l} strong />
          </tbody>
        </table>
        <div className="space-y-1 px-4 py-4 text-[12.5px] text-muted">
          <p>
            {l({
              ru: "Сети (Korzinka и другие) не делятся по территориям, а продают в основном в Ташкенте — поэтому у районов Ташкента банок на рецепт на самом деле больше, чем видно здесь. Сравнивайте районы между собой.",
              en: "Chains (Korzinka and others) are not split by territory and sell mostly in Tashkent — so Tashkent's districts really have more tins per prescription than shown here. Compare the districts with each other.",
            })}
          </p>
          {shortNote.length > 0 && (
            <p>
              {l({ ru: "Не хватало товара (продажи в эти месяцы ограничены наличием): ", en: "Out of stock (sales in these months were held back by stock): " })}
              {shortNote.map((x) => `${x.name} — ${x.ms.map((m) => f.mon(m)).join(", ")}`).join("; ")}.
            </p>
          )}
        </div>
      </section>

      {data.reps.length > 0 && (
        <>
          {/* medical reps */}
          <section className="overflow-x-auto rounded-xl border border-border bg-surface">
            <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 pt-5">
              <h2 className="text-[15px] font-semibold">{l({ ru: "Медицинские представители", en: "Medical reps" })}</h2>
              <a href={report("all=1")} className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-medium hover:bg-surface-low">
                {l({ ru: "Скачать отчёты всех (ZIP)", en: "Download everyone's reports (ZIP)" })}
              </a>
            </div>
            <p className="mt-1 px-4 text-[12.5px] text-muted">
              {l({ ru: `Отчёт представителя — Excel за 12 месяцев до ${f.mon(last, true)}: его рецепты, врачи по территориям и продажи этих территорий.`, en: `A rep's report — Excel for the 12 months to ${f.mon(last, true)}: their prescriptions, doctors by territory and those territories' sales.` })}
            </p>
            <table className="mt-3 w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-[12px] text-muted">
                  <th className="px-4 py-2.5 text-left font-medium">{l({ ru: "Представитель", en: "Rep" })}</th>
                  <th className="px-3 py-2.5 text-left font-medium">{l({ ru: "Территории", en: "Territories" })}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{l({ ru: "Рецептов", en: "Prescriptions" })}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{l({ ru: "Врачей", en: "Doctors" })}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{l({ ru: "Вложено, млн", en: "Paid, mln" })}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{l({ ru: "Продажи территорий", en: "Territory sales" })}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{l({ ru: "Отчёт", en: "Report" })}</th>
                </tr>
              </thead>
              <tbody>
                {repRows.map((r) => (
                  <tr key={r.name} onClick={() => setRepFilter(repFilter === r.name ? "" : r.name)} className={`cursor-pointer border-b border-border/60 ${repFilter === r.name ? "bg-accent-soft-bg" : "hover:bg-surface-low/60"}`}>
                    <td className="px-4 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-muted">{r.territories.map((k) => territoryName(k, ru)).join(", ") || "—"}</td>
                    <td className="figure-num px-3 py-2 text-right">{f.n(r.foilsNow)}</td>
                    <td className="figure-num px-3 py-2 text-right">{r.doctors}</td>
                    <td className="figure-num px-3 py-2 text-right">{f.mln(r.paidNow)}</td>
                    <td className={`figure-num px-3 py-2 text-right ${r.terrSales == null ? "text-muted" : r.terrSales > 0.05 ? "text-ok" : r.terrSales < -0.05 ? "text-danger" : "text-muted"}`}>{f.pct(r.terrSales)}</td>
                    <td className="px-4 py-2 text-right">
                      <a href={report(`rep=${encodeURIComponent(r.name)}`)} onClick={(e) => e.stopPropagation()} className="text-[12.5px] font-medium text-accent hover:underline">
                        Excel
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="h-3" />
          </section>

          {/* doctors */}
          <section className="overflow-x-auto rounded-xl border border-border bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-5">
              <h2 className="text-[15px] font-semibold">{l({ ru: "Врачи за период", en: "Doctors in the period" })}</h2>
              <div className="flex flex-wrap gap-2 text-[13px]">
                <select value={terrFilter} onChange={(e) => setTerrFilter(e.target.value)} className="h-9 rounded-lg border border-border bg-surface px-3">
                  <option value="">{l({ ru: "все территории", en: "every territory" })}</option>
                  {data.territories.filter((t) => data.foils[t.key]).map((t) => (
                    <option key={t.key} value={t.key}>{ru ? t.nameRu : t.nameEn}</option>
                  ))}
                </select>
                <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)} className="h-9 rounded-lg border border-border bg-surface px-3">
                  <option value="">{l({ ru: "все представители", en: "every rep" })}</option>
                  {data.reps.map((r) => (
                    <option key={r.name} value={r.name}>{r.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <table className="mt-3 w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-[12px] text-muted">
                  <th className="px-4 py-2.5 text-left font-medium">{l({ ru: "Врач", en: "Doctor" })}</th>
                  <th className="px-3 py-2.5 text-left font-medium">{l({ ru: "Учреждение", en: "Clinic" })}</th>
                  <th className="px-3 py-2.5 text-left font-medium">{l({ ru: "Территория", en: "Territory" })}</th>
                  <th className="px-3 py-2.5 text-left font-medium">{l({ ru: "Представитель", en: "Rep" })}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{l({ ru: "Ставка, сум", en: "Rate, UZS" })}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{l({ ru: "Рецептов", en: "Prescriptions" })}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{l({ ru: "Вложено, млн", en: "Paid, mln" })}</th>
                </tr>
              </thead>
              <tbody>
                {docShown.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-3 text-muted">{l({ ru: "За период рецептов нет", en: "No prescriptions in the period" })}</td></tr>
                )}
                {docShown.map((d) => (
                  <tr key={`${d.doctor}|${d.clinic}`} className="border-b border-border/60">
                    <td className="px-4 py-1.5 font-medium">{d.doctor}</td>
                    <td className="px-3 py-1.5 text-muted">{d.clinic || "—"}</td>
                    <td className="px-3 py-1.5 text-muted">{d.territory ? territoryName(d.territory, ru) : d.district || "—"}</td>
                    <td className="px-3 py-1.5 text-muted">{d.rep || "—"}</td>
                    <td className="figure-num px-3 py-1.5 text-right">{d.rate ? f.n(d.rate) : "—"}</td>
                    <td className="figure-num px-3 py-1.5 text-right">{f.n(d.foilsNow)}</td>
                    <td className="figure-num px-4 py-1.5 text-right">{f.mln(d.paidNow)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {docRows.length > 30 && (
              <button type="button" onClick={() => setAllDoctors(!allDoctors)} className="mx-4 my-3 text-[12.5px] font-medium text-accent hover:underline">
                {allDoctors ? l({ ru: "Показать первые 30", en: "Show the first 30" }) : l({ ru: `Показать всех (${docRows.length})`, en: `Show all (${docRows.length})` })}
              </button>
            )}
            <div className="h-2" />
          </section>
        </>
      )}
    </div>
  );
}
