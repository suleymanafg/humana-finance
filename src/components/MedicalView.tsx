"use client";

// «Медицинский отдел» — does the medical campaign pay off, and where. A map
// and a list of regions (Tashkent city opens to its districts); a region —
// chosen on the map, in the list or in the tables — opens its panel: sales by
// product, the reps responsible, the districts (Tashkent) and 12 months of
// history by product next to prescriptions and pay-outs. Below, effectiveness
// for every territory: only Platin 1 and the special formulas are prescribed
// and paid for, so tins per prescription, the cost of a tin and the verdict
// count them alone (good only when their sales grow and tins per prescription
// grow); Platin 2 and 3 are the babies staying on, shown beside. Then the reps
// (each with their own Excel report) and the doctors. Sales follow the month
// chosen at the top (a running month as far as it has got, at its pace in the
// comparisons); prescriptions come after the month, so effectiveness ends with
// the last month whose foil file is loaded. Sales are in tins only.
import { useRef, useState } from "react";
import { useT } from "@/lib/locale-context";
import { addMonths } from "@/lib/planning/compute";
import { NO_TERRITORY, territoryName } from "@/lib/territories";
import { effectOf, sumMonths, VERDICTS, type Effect } from "@/lib/medical-effect";
import type { MedicalData } from "@/lib/medical-data";
import { UZ_REGIONS } from "@/lib/uz-map";
import UzMap, { type RegionStat } from "./UzMap";

const PERIODS = [1, 3, 6, 12];
type SortKey = "tins" | "foils" | "paid" | "perRx" | "cost";
type L = (b: { ru: string; en: string }) => string;
/** the map's Tashkent city — every district together */
const CITY = "UZ-TK";
const isDistrict = (k: string) => k.startsWith("TK-");

const TONE = { ok: "text-ok", warn: "text-warn", danger: "text-danger", muted: "text-muted" } as const;

interface Fmt {
  n: (v: number) => string;
  mln: (v: number) => string;
  ratio: (v: number | null) => string;
  pct: (v: number | null) => string;
  mon: (id: string, long?: boolean) => string;
}

function makeFmt(ru: boolean): Fmt {
  const loc = ru ? "ru-RU" : "en-US";
  return {
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

/** a change, coloured only when it is more than noise */
function Pct({ v, f }: { v: number | null; f: Fmt }) {
  return <span className={v == null ? "text-muted" : v > 0.05 ? "text-ok" : v < -0.05 ? "text-danger" : "text-muted"}>{f.pct(v)}</span>;
}

/** tins per prescription, before → now; the end coloured by which way it went */
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

function Verdict({ e, l }: { e: Effect; l: L }) {
  const v = VERDICTS[e.verdict];
  return <span className={`whitespace-nowrap font-medium ${TONE[v.tone]}`}>{l({ ru: v.ru, en: v.en })}</span>;
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

interface EffRow {
  key: string;
  name: string;
  e: Effect;
  /** Platin 2 and 3: tins and the change */
  follow: { tins: number; change: number | null };
}

/** one row of the effectiveness table */
function Row({ r, f, l, strong, muted, selected, onClick }: { r: EffRow; f: Fmt; l: L; strong?: boolean; muted?: boolean; selected?: boolean; onClick?: () => void }) {
  const cell = "figure-num px-3 py-2 text-right";
  return (
    <tr onClick={onClick} className={`border-b border-border/60 ${onClick ? "cursor-pointer hover:bg-surface-low/60" : ""} ${selected ? "bg-accent-soft-bg" : ""} ${strong ? "font-semibold" : ""}`}>
      <td className={`px-4 py-2 ${muted ? "text-muted" : ""}`}>{r.name}</td>
      <td className={cell}>{f.n(r.e.now.tins)}</td>
      <td className={cell}><Pct v={r.e.salesChange} f={f} /></td>
      <td className={cell}>{r.e.now.foils ? f.n(r.e.now.foils) : "—"}</td>
      <td className={cell}>{r.e.now.paid ? f.mln(r.e.now.paid) : "—"}</td>
      <td className={cell}><PerRx e={r.e} f={f} /></td>
      <td className={cell}>{r.e.costPerTin ? f.n(r.e.costPerTin) : "—"}</td>
      <td className="px-3 py-2">{r.e.now.foils ? <Verdict e={r.e} l={l} /> : <span className="text-muted">—</span>}</td>
      <td className={`${cell} border-l border-border/60`}>{f.n(r.follow.tins)}</td>
      <td className={cell}><Pct v={r.follow.change} f={f} /></td>
    </tr>
  );
}

export default function MedicalView({ data }: { data: MedicalData }) {
  const { locale, l } = useT();
  const ru = locale === "ru";
  const f = makeFmt(ru);
  const [period, setPeriod] = useState(3);
  /** the territory looked at: a key, the city (all districts) or null — the whole country */
  const [sel, setSel] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("tins");
  const [repFilter, setRepFilter] = useState("");
  const [allDoctors, setAllDoctors] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // sales: the period ends with the chosen month; a running month counts at its pace in comparisons
  const end = data.endMonth;
  const running = end === data.thisMonth;
  const daysIn = new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)), 0)).getUTCDate();
  const dayNow = Number(data.today.slice(8, 10));
  const pace = running ? Math.max(1, dayNow) / daysIn : 1;
  const salesNow = span(end, period);
  const salesBefore = span(addMonths(end, -period), period);
  // prescriptions: complete months with the foil file loaded
  const lastComplete = running ? addMonths(end, -1) : end;
  const lastRx = [...data.foilMonths].reverse().find((m) => m <= lastComplete) ?? lastComplete;
  const rxNow = span(lastRx, period);
  const rxBefore = span(addMonths(lastRx, -period), period);
  const trend = span(end, 12);
  const label = (ms: string[]) => (ms.length === 1 ? f.mon(ms[0], true) : `${f.mon(ms[0])} – ${f.mon(ms[ms.length - 1], true)}`);

  const allIds = data.products.map((p) => p.id);
  const presIds = data.products.filter((p) => p.prescribed).map((p) => p.id);
  const followIds = data.products.filter((p) => !p.prescribed).map((p) => p.id);
  const cityKeys = data.territories.filter((t) => isDistrict(t.key)).map((t) => t.key);
  /** a selection's territory keys; null — the whole country */
  const keysOf = (s: string | null) => (s == null ? null : s === CITY ? cityKeys : [s]);
  const saleKeys = (keys: string[] | null) => keys ?? Object.keys(data.sales);
  const tins = (keys: string[] | null, ms: string[], ids = allIds, paced = false) =>
    saleKeys(keys).reduce((t, k) => t + ids.reduce((u, id) => u + ms.reduce((w, m) => w + (data.sales[k]?.[id]?.[m] ?? 0) / (paced && m === data.thisMonth ? pace : 1), 0), 0), 0);
  const change = (keys: string[] | null, ids: string[]) => {
    const b = tins(keys, salesBefore, ids);
    return b > 0 ? tins(keys, salesNow, ids, true) / b - 1 : null;
  };
  const foilsIn = (keys: string[] | null, ms: string[]) => (keys ? keys.reduce((t, k) => t + sumMonths(data.foils[k], ms), 0) : data.reps.reduce((t, r) => t + sumMonths(r.foils, ms), 0));
  const paidIn = (keys: string[] | null, ms: string[]) => (keys ? keys.reduce((t, k) => t + sumMonths(data.paid[k], ms), 0) : data.reps.reduce((t, r) => t + sumMonths(r.paid, ms), 0));
  /** effectiveness: prescribed products against prescriptions, over complete months */
  const effFor = (keys: string[] | null) =>
    effectOf(
      { tins: tins(keys, rxNow, presIds), foils: foilsIn(keys, rxNow), paid: paidIn(keys, rxNow) },
      { tins: tins(keys, rxBefore, presIds), foils: foilsIn(keys, rxBefore), paid: paidIn(keys, rxBefore) }
    );
  const rowFor = (key: string, name: string, keys: string[] | null): EffRow => {
    const fb = tins(keys, rxBefore, followIds);
    const fn = tins(keys, rxNow, followIds);
    return { key, name, e: effFor(keys), follow: { tins: fn, change: fb > 0 ? fn / fb - 1 : null } };
  };
  const choose = (s: string | null, scroll = false) => {
    setSel(s);
    if (scroll) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // the country at a glance
  const country = effFor(null);

  // the map and its list: Tashkent city is one region there
  const mapRegions = UZ_REGIONS.filter((r) => r.channels.length > 0 || data.foils[r.iso]).map((r) => {
    const keys = r.iso === CITY ? cityKeys : [r.iso];
    return { iso: r.iso, name: ru ? r.nameRu : r.nameEn, keys, tins: tins(keys, salesNow), change: change(keys, allIds), e: effFor(keys) };
  });
  const countryTins = tins(null, salesNow);
  const statsByIso: Record<string, RegionStat> = Object.fromEntries(mapRegions.map((r) => [r.iso, { qty: r.tins, revenue: 0, share: countryTins ? r.tins / countryTins : 0 }]));
  const mapSel = sel == null ? null : isDistrict(sel) ? CITY : sel;

  // the panel of the chosen territory
  const selKeys = keysOf(sel);
  const selName = sel == null ? l({ ru: "Вся страна", en: "The whole country" }) : sel === CITY ? l({ ru: "Ташкент (город)", en: "Tashkent (city)" }) : territoryName(sel, ru);
  const selEff = effFor(selKeys);
  const selTins = tins(selKeys, salesNow);
  const shortIn = (id: string, ms: string[]) => (data.short[id] ?? []).filter((m) => ms.includes(m));
  const productGroups = [
    { name: l({ ru: "С оплатой рецептов: Platin 1 и лечебные", en: "Paid prescriptions: Platin 1 and special formulas" }), total: l({ ru: "Итого Platin 1 и лечебные", en: "Platin 1 and special, total" }), ids: presIds },
    { name: l({ ru: "Без оплаты рецептов: Platin 2 и 3", en: "No paid prescriptions: Platin 2 and 3" }), total: l({ ru: "Итого Platin 2 и 3", en: "Platin 2 and 3, total" }), ids: followIds },
  ];
  const repsHere = data.reps
    .map((r) => {
      const byT = selKeys ? selKeys.map((k) => r.byTerritory[k]).filter(Boolean) : [{ foils: r.foils, paid: r.paid }];
      return {
        name: r.name,
        foils: byT.reduce((t, x) => t + sumMonths(x.foils, rxNow), 0),
        paid: byT.reduce((t, x) => t + sumMonths(x.paid, rxNow), 0),
        doctors: data.doctors.filter((d) => d.rep === r.name && (!selKeys || (d.territory && selKeys.includes(d.territory))) && sumMonths(d.foils, rxNow) > 0).length,
      };
    })
    .filter((r) => r.foils > 0)
    .sort((a, b) => b.foils - a.foils);
  const showDistricts = sel === CITY || (sel != null && isDistrict(sel));
  const districtRows = data.territories.filter((t) => isDistrict(t.key)).map((t) => rowFor(t.key, ru ? t.nameRu : t.nameEn, [t.key]));

  // effectiveness for every territory
  const sortValue = (e: Effect) => (sort === "tins" ? e.now.tins : sort === "foils" ? e.now.foils : sort === "paid" ? e.now.paid : sort === "perRx" ? e.perRx ?? -1 : e.costPerTin ?? -1);
  const visible = (r: EffRow) => r.e.now.tins || r.e.now.foils || r.e.before.tins || r.e.before.foils;
  const districts = districtRows.filter(visible).sort((a, b) => sortValue(b.e) - sortValue(a.e));
  const regions = data.territories
    .filter((t) => t.kind === "region")
    .map((t) => rowFor(t.key, ru ? t.nameRu : t.nameEn, [t.key]))
    .filter(visible)
    .sort((a, b) => sortValue(b.e) - sortValue(a.e));

  // reps and doctors (prescription months)
  const report = (q: string) => `/api/medical/rep-report?${q}&to=${lastRx}&lang=${locale}`;
  const repRows = data.reps
    .map((r) => ({
      ...r,
      foilsNow: sumMonths(r.foils, rxNow),
      paidNow: sumMonths(r.paid, rxNow),
      doctors: data.doctors.filter((d) => d.rep === r.name && sumMonths(d.foils, rxNow) > 0).length,
      terrChange: r.territories.length ? effFor(r.territories).salesChange : null,
    }))
    .filter((r) => r.foilsNow > 0 || sumMonths(r.foils, rxBefore) > 0);
  const docRows = data.doctors
    .filter((d) => (!selKeys || (d.territory && selKeys.includes(d.territory))) && (!repFilter || d.rep === repFilter))
    .map((d) => ({ ...d, foilsNow: sumMonths(d.foils, rxNow), paidNow: sumMonths(d.paid, rxNow) }))
    .filter((d) => d.foilsNow > 0)
    .sort((a, b) => b.foilsNow - a.foilsNow);
  const docShown = allDoctors ? docRows : docRows.slice(0, 30);

  const chip = (active: boolean) => `rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${active ? "bg-accent text-white" : "text-muted hover:text-foreground"}`;
  const th = (key: SortKey | null, text: string, left = false, extra = "") => (
    <th className={`whitespace-nowrap px-3 py-2.5 font-medium ${left ? "text-left" : "text-right"} ${extra}`}>
      {key ? (
        <button type="button" onClick={() => setSort(key)} className={sort === key ? "text-foreground underline underline-offset-4" : "hover:text-foreground"}>
          {text}
        </button>
      ) : (
        text
      )}
    </th>
  );
  const runningNote = running ? l({ ru: ` (по ${dayNow}-е)`, en: ` (to the ${dayNow}th)` }) : "";
  const rxMissing = data.foilMonths.length > 0 && !data.foilMonths.includes(end);

  // the panel's month table
  const hist = (ids: string[], m: string) => tins(selKeys, [m], ids);
  const histRow = (name: string, value: (m: string) => number, fmt: (v: number) => string, opts: { bold?: boolean; shortOf?: string; rx?: boolean } = {}) => (
    <tr key={name} className={opts.bold ? "border-t border-border font-semibold" : ""}>
      <td className={`sticky left-0 z-10 whitespace-nowrap bg-surface py-1 pr-3 ${opts.bold ? "" : "pl-3"}`}>{name}</td>
      {trend.map((m) => {
        const v = value(m);
        const short = opts.shortOf ? data.short[opts.shortOf]?.includes(m) : false;
        const noRx = opts.rx && !data.foilMonths.includes(m);
        return (
          <td key={m} className={`figure-num px-2 py-1 text-right ${short ? "bg-warn-soft" : ""} ${m === data.thisMonth ? "text-muted" : ""}`}>
            {noRx ? <span className="text-muted">·</span> : v ? fmt(v) : "–"}
          </td>
        );
      })}
    </tr>
  );

  return (
    <div className="space-y-6">
      {/* what to look at */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border bg-surface p-1">
          {PERIODS.map((n) => (
            <button key={n} type="button" onClick={() => setPeriod(n)} className={chip(period === n)}>
              {n === 1 ? l({ ru: "1 месяц", en: "1 month" }) : l({ ru: `${n} мес.`, en: `${n} months` })}
            </button>
          ))}
        </div>
        <div className="text-[13px] text-muted">
          <div>
            {l({ ru: "Продажи", en: "Sales" })}: <span className="font-medium text-foreground">{label(salesNow)}{runningNote}</span> {l({ ru: "в сравнении с", en: "compared with" })} {label(salesBefore)}
            {running && l({ ru: `; ${f.mon(end, true)} в сравнении — по темпу за полный месяц`, en: `; ${f.mon(end, true)} compared at its full-month pace` })}.
          </div>
          <div>
            {l({ ru: "Рецепты и эффективность", en: "Prescriptions and effectiveness" })}: <span className="font-medium text-foreground">{label(rxNow)}</span> {l({ ru: "в сравнении с", en: "compared with" })} {label(rxBefore)}
            {rxMissing && l({ ru: ` — рецепты за ${f.mon(end, true)} ещё не загружены`, en: ` — prescriptions for ${f.mon(end, true)} are not loaded yet` })}.
          </div>
        </div>
      </div>

      {/* the country at a glance */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label={`${l({ ru: "Продано, банок", en: "Sold, tins" })} · ${label(salesNow)}`} value={f.n(countryTins)} note={<>{l({ ru: "к прошлому периоду", en: "vs the period before" })} <Pct v={change(null, allIds)} f={f} /></>} />
        <Tile label={`${l({ ru: "Platin 1 и лечебные, банок", en: "Platin 1 and special, tins" })} · ${label(salesNow)}`} value={f.n(tins(null, salesNow, presIds))} note={<>{l({ ru: "к прошлому периоду", en: "vs the period before" })} <Pct v={change(null, presIds)} f={f} /></>} />
        <Tile label={`${l({ ru: "Рецептов", en: "Prescriptions" })} · ${label(rxNow)}`} value={f.n(country.now.foils)} note={<>{l({ ru: "вложено", en: "paid" })} {f.mln(country.now.paid)} {l({ ru: "млн сум", en: "mln UZS" })}</>} />
        <Tile label={l({ ru: "Банок Platin 1 и лечебных на рецепт", en: "Platin 1 and special tins per prescription" })} value={f.ratio(country.perRx)} note={<>{l({ ru: "было", en: "before" })} {f.ratio(country.perRxBefore)} · <Verdict e={country} l={l} /></>} />
      </div>

      {/* map and regions */}
      <section className="grid gap-6 rounded-xl border border-border bg-surface p-6 xl:grid-cols-[1.15fr_1fr]">
        <div>
          <h2 className="mb-1 text-[15px] font-semibold">{l({ ru: "Продажи по регионам, банок", en: "Sales by region, tins" })} · {label(salesNow)}</h2>
          <p className="mb-3 text-[12.5px] text-muted">{l({ ru: "Нажмите на регион — ниже откроются его товары, представители и история.", en: "Click a region to open its products, reps and history below." })}</p>
          <UzMap statsByIso={statsByIso} selectedIso={mapSel} onSelect={(iso) => choose(iso)} unitsOnly />
        </div>
        <div className="text-[13px]">
          <div className="grid grid-cols-[1fr_70px_56px_100px] gap-2 border-b border-border pb-2 text-[12px] text-muted">
            <span>{l({ ru: "Регион", en: "Region" })}</span>
            <span className="text-right">{l({ ru: "банок", en: "tins" })}</span>
            <span className="text-right">{l({ ru: "рост", en: "change" })}</span>
            <span className="text-right">{l({ ru: "итог", en: "verdict" })}</span>
          </div>
          {[...mapRegions].sort((a, b) => b.tins - a.tins).map((r) => (
            <button key={r.iso} type="button" onClick={() => choose(mapSel === r.iso ? null : r.iso)} className={`grid w-full grid-cols-[1fr_70px_56px_100px] gap-2 rounded px-1 py-1.5 text-left ${mapSel === r.iso ? "bg-accent-soft-bg" : "hover:bg-surface-low"}`}>
              <span>{r.name}</span>
              <span className="figure-num text-right">{f.n(r.tins)}</span>
              <span className="figure-num text-right"><Pct v={r.change} f={f} /></span>
              <span className="text-right text-[12px]">{r.e.now.foils ? <Verdict e={r.e} l={l} /> : <span className="text-muted">—</span>}</span>
            </button>
          ))}
          <button type="button" onClick={() => choose(null)} className={`mt-1 grid w-full grid-cols-[1fr_70px_56px_100px] gap-2 rounded border-t border-border px-1 pt-2 text-left font-semibold ${sel == null ? "bg-accent-soft-bg" : "hover:bg-surface-low"}`}>
            <span>{l({ ru: "Вся страна", en: "The whole country" })}</span>
            <span className="figure-num text-right">{f.n(countryTins)}</span>
            <span className="figure-num text-right"><Pct v={change(null, allIds)} f={f} /></span>
            <span className="text-right text-[12px]"><Verdict e={country} l={l} /></span>
          </button>
          <p className="mt-2 text-[12px] text-muted">
            {l({ ru: "«Рост» — продажи всех товаров к прошлому периоду; «итог» — по Platin 1 и лечебным за месяцы с рецептами. В «Вся страна» входят и сети (Korzinka и др.) — по регионам они не делятся.", en: "«Change» — every product's sales against the period before; «verdict» — Platin 1 and special formulas over the months with prescriptions. «The whole country» includes chains (Korzinka and others) — they are not split by region." })}
          </p>
        </div>
      </section>

      {/* the chosen territory */}
      <section ref={panelRef} className="scroll-mt-4 rounded-xl border border-border bg-surface p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[17px] font-semibold">
            {selName}
            {sel != null && isDistrict(sel) && <span className="font-normal text-muted"> · {l({ ru: "Ташкент", en: "Tashkent" })}</span>}
          </h2>
          <div className="flex gap-2 text-[12.5px]">
            {sel != null && isDistrict(sel) && (
              <button type="button" onClick={() => choose(CITY)} className="rounded-lg border border-border px-3 py-1.5 font-medium hover:bg-surface-low">{l({ ru: "Весь Ташкент", en: "All of Tashkent" })}</button>
            )}
            {sel != null && (
              <button type="button" onClick={() => choose(null)} className="rounded-lg border border-border px-3 py-1.5 font-medium hover:bg-surface-low">{l({ ru: "Вся страна", en: "The whole country" })}</button>
            )}
          </div>
        </div>
        <p className="mt-1 text-[13px]">
          <span className="text-muted">{label(rxNow)} {l({ ru: "против", en: "against" })} {label(rxBefore)}: </span>
          {l({ ru: "Platin 1 и лечебные", en: "Platin 1 and special" })} <Pct v={selEff.salesChange} f={f} />, {l({ ru: "банок на рецепт", en: "tins per prescription" })} <PerRx e={selEff} f={f} />
          {selEff.costPerTin ? <>, {f.n(selEff.costPerTin)} {l({ ru: "сум на банку", en: "UZS per tin" })}</> : null} — <Verdict e={selEff} l={l} />
        </p>

        <div className="mt-5 grid gap-6 xl:grid-cols-2">
          {/* products */}
          <div>
            <h3 className="text-[14px] font-semibold">{l({ ru: "Товары, банок", en: "Products, tins" })} · {label(salesNow)}{runningNote}</h3>
            <table className="mt-2 w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-[12px] text-muted">
                  <th className="py-2 text-left font-medium">{l({ ru: "Товар", en: "Product" })}</th>
                  <th className="px-2 py-2 text-right font-medium">{l({ ru: "банок", en: "tins" })}</th>
                  <th className="px-2 py-2 text-right font-medium">{l({ ru: "к прошлому", en: "vs before" })}</th>
                  <th className="py-2 text-right font-medium">{l({ ru: "доля", en: "share" })}</th>
                </tr>
              </thead>
              <tbody>
                {productGroups.flatMap((g) => [
                  <tr key={g.name}><td colSpan={4} className="pb-1 pt-3 text-[12px] font-semibold text-muted">{g.name}</td></tr>,
                  ...data.products.filter((p) => g.ids.includes(p.id)).map((p) => {
                    const v = tins(selKeys, salesNow, [p.id]);
                    const s = shortIn(p.id, salesNow);
                    return (
                      <tr key={p.id} className="border-b border-border/50">
                        <td className="py-1.5 pl-3">
                          {p.name}
                          {s.length > 0 && <span className="ml-2 text-[11.5px] text-warn">{l({ ru: "нехватка", en: "short" })}: {s.map((m) => f.mon(m)).join(", ")}</span>}
                        </td>
                        <td className="figure-num px-2 py-1.5 text-right">{f.n(v)}</td>
                        <td className="figure-num px-2 py-1.5 text-right"><Pct v={change(selKeys, [p.id])} f={f} /></td>
                        <td className="figure-num py-1.5 text-right text-muted">{selTins ? `${Math.round((v / selTins) * 100)}%` : "—"}</td>
                      </tr>
                    );
                  }),
                  <tr key={`${g.name}-total`} className="font-semibold">
                    <td className="py-1.5 pl-3">{g.total}</td>
                    <td className="figure-num px-2 py-1.5 text-right">{f.n(tins(selKeys, salesNow, g.ids))}</td>
                    <td className="figure-num px-2 py-1.5 text-right"><Pct v={change(selKeys, g.ids)} f={f} /></td>
                    <td className="figure-num py-1.5 text-right text-muted">{selTins ? `${Math.round((tins(selKeys, salesNow, g.ids) / selTins) * 100)}%` : "—"}</td>
                  </tr>,
                ])}
              </tbody>
            </table>
          </div>

          <div className="space-y-6">
            {/* reps responsible */}
            <div>
              <h3 className="text-[14px] font-semibold">{l({ ru: "Медпредставители", en: "Medical reps" })} · {label(rxNow)}</h3>
              {repsHere.length === 0 ? (
                <p className="mt-2 text-[13px] text-muted">{l({ ru: "Рецептов за период нет — здесь никто не работает.", en: "No prescriptions in the period — nobody works here." })}</p>
              ) : (
                <table className="mt-2 w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-[12px] text-muted">
                      <th className="py-2 text-left font-medium">{l({ ru: "Представитель", en: "Rep" })}</th>
                      <th className="px-2 py-2 text-right font-medium">{l({ ru: "рецептов", en: "prescriptions" })}</th>
                      <th className="px-2 py-2 text-right font-medium">{l({ ru: "врачей", en: "doctors" })}</th>
                      <th className="py-2 text-right font-medium">{l({ ru: "вложено, млн", en: "paid, mln" })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sel == null ? repsHere.slice(0, 8) : repsHere).map((r) => (
                      <tr key={r.name} className="border-b border-border/50">
                        <td className="py-1.5">{r.name}</td>
                        <td className="figure-num px-2 py-1.5 text-right">{f.n(r.foils)}</td>
                        <td className="figure-num px-2 py-1.5 text-right">{r.doctors}</td>
                        <td className="figure-num py-1.5 text-right">{f.mln(r.paid)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {sel == null && repsHere.length > 8 && <p className="mt-1 text-[12px] text-muted">{l({ ru: "Первые 8 — все представители в таблице ниже.", en: "The first 8 — every rep is in the table below." })}</p>}
            </div>

            {/* Tashkent's districts */}
            {showDistricts && (
              <div>
                <h3 className="text-[14px] font-semibold">{l({ ru: "Районы Ташкента", en: "Tashkent's districts" })} · {label(rxNow)}</h3>
                <table className="mt-2 w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-[12px] text-muted">
                      <th className="py-2 text-left font-medium">{l({ ru: "Район", en: "District" })}</th>
                      <th className="px-2 py-2 text-right font-medium">{l({ ru: "P1 и леч., банок", en: "P1 & special, tins" })}</th>
                      <th className="px-2 py-2 text-right font-medium">{l({ ru: "рост", en: "change" })}</th>
                      <th className="px-2 py-2 text-right font-medium">{l({ ru: "рецептов", en: "Rx" })}</th>
                      <th className="px-2 py-2 text-right font-medium">{l({ ru: "банок на рецепт", en: "tins per Rx" })}</th>
                      <th className="py-2 text-right font-medium">{l({ ru: "итог", en: "verdict" })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {districtRows.filter(visible).sort((a, b) => b.e.now.tins - a.e.now.tins).map((r) => (
                      <tr key={r.key} onClick={() => choose(sel === r.key ? CITY : r.key)} className={`cursor-pointer border-b border-border/50 ${sel === r.key ? "bg-accent-soft-bg" : "hover:bg-surface-low/60"}`}>
                        <td className="py-1.5">{r.name}</td>
                        <td className="figure-num px-2 py-1.5 text-right">{f.n(r.e.now.tins)}</td>
                        <td className="figure-num px-2 py-1.5 text-right"><Pct v={r.e.salesChange} f={f} /></td>
                        <td className="figure-num px-2 py-1.5 text-right">{r.e.now.foils ? f.n(r.e.now.foils) : "—"}</td>
                        <td className="figure-num px-2 py-1.5 text-right"><PerRx e={r.e} f={f} /></td>
                        <td className="py-1.5 text-right text-[12px]">{r.e.now.foils ? <Verdict e={r.e} l={l} /> : <span className="text-muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* 12 months by product */}
        <div className="mt-6 overflow-x-auto">
          <h3 className="text-[14px] font-semibold">{l({ ru: "По месяцам", en: "Month by month" })}</h3>
          <table className="mt-2 w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="sticky left-0 z-10 min-w-[230px] bg-surface py-1.5 text-left font-medium" />
                {trend.map((m) => (
                  <th key={m} className="whitespace-nowrap px-2 py-1.5 text-right font-medium">
                    {f.mon(m)}
                    {m === data.thisMonth && <div className="text-[10.5px] font-normal">{l({ ru: `по ${dayNow}-е`, en: `to the ${dayNow}th` })}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {productGroups.flatMap((g) => [
                <tr key={`h-${g.name}`}><td colSpan={13} className="sticky left-0 bg-surface pb-1 pt-3 text-[12px] font-semibold text-muted">{g.name}</td></tr>,
                ...data.products.filter((p) => g.ids.includes(p.id)).map((p) => histRow(p.name, (m) => hist([p.id], m), f.n, { shortOf: p.id })),
                histRow(g.total, (m) => hist(g.ids, m), f.n, { bold: true }),
              ])}
              <tr><td colSpan={13} className="pt-3" /></tr>
              {histRow(l({ ru: "Всего продано, банок", en: "Sold in all, tins" }), (m) => hist(allIds, m), f.n, { bold: true })}
              {histRow(l({ ru: "Рецептов", en: "Prescriptions" }), (m) => foilsIn(selKeys, [m]), f.n, { rx: true })}
              {histRow(l({ ru: "Вложено, млн сум", en: "Paid, mln UZS" }), (m) => paidIn(selKeys, [m]), f.mln, { rx: true })}
              {histRow(l({ ru: "Банок Platin 1 и лечебных на рецепт", en: "Platin 1 and special tins per prescription" }), (m) => { const x = foilsIn(selKeys, [m]); return x ? hist(presIds, m) / x : 0; }, (v) => f.ratio(v), { rx: true })}
            </tbody>
          </table>
          <p className="mt-2 text-[12px] text-muted">
            {l({ ru: "Жёлтым — месяцы, когда товара не хватало (продажи ограничены наличием). Точка — рецепты за месяц ещё не загружены.", en: "Yellow — months the product ran short (sales held back by stock). A dot — the month's prescriptions are not loaded yet." })}
            {sel === CITY || (sel != null && isDistrict(sel)) ? l({ ru: " Сети не делятся по районам и в Ташкент здесь не входят.", en: " Chains are not split by district and are not in Tashkent here." }) : ""}
          </p>
        </div>
      </section>

      {/* effectiveness by territory */}
      <section className="overflow-x-auto rounded-xl border border-border bg-surface">
        <div className="px-4 pt-5">
          <h2 className="text-[15px] font-semibold">{l({ ru: "Эффективность по территориям", en: "Effectiveness by territory" })} · {label(rxNow)}</h2>
          <p className="mt-1 max-w-[980px] text-[12.5px] text-muted">
            {l({
              ru: "Рецепты оплачиваются только за Platin 1 и лечебные смеси, поэтому эффективность считается по ним. «Эффективно» — их продажи выросли и банок на один рецепт стало больше. «Рост дорогой» — продажи растут медленнее рецептов. «Нет отдачи» — за рецепты платят, а продажи не растут. Platin 2 и 3 справа — это дети, оставшиеся на смеси: результат прошлых месяцев, а не оплаты. Нажмите на территорию — она откроется выше.",
              en: "Prescriptions are paid for Platin 1 and the special formulas only, so effectiveness counts them alone. «Effective» — their sales grew and there are more tins per prescription. «Costly growth» — sales grow slower than prescriptions. «No return» — prescriptions paid for, sales not growing. Platin 2 and 3 on the right are the babies staying on: the result of earlier months, not of pay-outs. Click a territory to open it above.",
            })}
          </p>
        </div>
        <table className="mt-3 w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-[11.5px] text-muted">
              <th colSpan={8} className="px-4 pt-1 text-left font-medium">{l({ ru: "Platin 1 и лечебные (с оплатой рецептов)", en: "Platin 1 and special formulas (paid prescriptions)" })}</th>
              <th colSpan={2} className="border-l border-border/60 px-3 pt-1 text-right font-medium">Platin 2–3</th>
            </tr>
            <tr className="border-b border-border text-[12px] text-muted">
              {th(null, l({ ru: "Территория", en: "Territory" }), true)}
              {th("tins", l({ ru: "Продано, банок", en: "Sold, tins" }))}
              {th(null, l({ ru: "к прошлому", en: "vs before" }))}
              {th("foils", l({ ru: "Рецептов", en: "Prescriptions" }))}
              {th("paid", l({ ru: "Вложено, млн", en: "Paid, mln" }))}
              {th("perRx", l({ ru: "Банок на рецепт", en: "Tins per Rx" }))}
              {th("cost", l({ ru: "Сум на банку", en: "UZS per tin" }))}
              {th(null, l({ ru: "Итог", en: "Verdict" }), true)}
              {th(null, l({ ru: "банок", en: "tins" }), false, "border-l border-border/60")}
              {th(null, l({ ru: "к прошлому", en: "vs before" }))}
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={10} className="px-4 pb-1 pt-4 text-[12px] font-semibold uppercase tracking-wide text-muted">{l({ ru: "Ташкент по районам", en: "Tashkent by district" })}</td></tr>
            {districts.map((r) => <Row key={r.key} r={r} f={f} l={l} selected={sel === r.key} onClick={() => choose(r.key, true)} />)}
            <Row r={rowFor(CITY, l({ ru: "Ташкент, всего", en: "Tashkent, total" }), cityKeys)} f={f} l={l} strong selected={sel === CITY} onClick={() => choose(CITY, true)} />
            <tr><td colSpan={10} className="px-4 pb-1 pt-5 text-[12px] font-semibold uppercase tracking-wide text-muted">{l({ ru: "Регионы", en: "Regions" })}</td></tr>
            {regions.map((r) => <Row key={r.key} r={r} f={f} l={l} selected={sel === r.key} onClick={() => choose(r.key, true)} />)}
            <Row r={rowFor("regions", l({ ru: "Регионы, всего", en: "Regions, total" }), regions.map((r) => r.key))} f={f} l={l} strong />
            <tr><td colSpan={10} className="pt-3" /></tr>
            <Row r={rowFor(NO_TERRITORY, l({ ru: "Сети и другие каналы (без территории)", en: "Chains and other channels (no territory)" }), [NO_TERRITORY])} f={f} l={l} muted />
            <Row r={rowFor("country", l({ ru: "Вся страна", en: "The whole country" }), null)} f={f} l={l} strong />
          </tbody>
        </table>
        <p className="px-4 py-4 text-[12.5px] text-muted">
          {l({
            ru: "Сети (Korzinka и другие) не делятся по территориям, а продают в основном в Ташкенте — поэтому у районов Ташкента банок на рецепт на самом деле больше, чем видно здесь. Сравнивайте районы между собой.",
            en: "Chains (Korzinka and others) are not split by territory and sell mostly in Tashkent — so Tashkent's districts really have more tins per prescription than shown here. Compare the districts with each other.",
          })}
        </p>
      </section>

      {data.reps.length > 0 && (
        <>
          {/* medical reps */}
          <section className="overflow-x-auto rounded-xl border border-border bg-surface">
            <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 pt-5">
              <h2 className="text-[15px] font-semibold">{l({ ru: "Медицинские представители", en: "Medical reps" })} · {label(rxNow)}</h2>
              <a href={report("all=1")} className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-medium hover:bg-surface-low">
                {l({ ru: "Скачать отчёты всех (ZIP)", en: "Download everyone's reports (ZIP)" })}
              </a>
            </div>
            <p className="mt-1 px-4 text-[12.5px] text-muted">
              {l({ ru: `Отчёт представителя — Excel за 12 месяцев до ${f.mon(lastRx, true)}: его рецепты, врачи по территориям и продажи этих территорий по товарам.`, en: `A rep's report — Excel for the 12 months to ${f.mon(lastRx, true)}: their prescriptions, doctors by territory and those territories' sales by product.` })}
            </p>
            <table className="mt-3 w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-[12px] text-muted">
                  <th className="px-4 py-2.5 text-left font-medium">{l({ ru: "Представитель", en: "Rep" })}</th>
                  <th className="px-3 py-2.5 text-left font-medium">{l({ ru: "Территории", en: "Territories" })}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{l({ ru: "Рецептов", en: "Prescriptions" })}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{l({ ru: "Врачей", en: "Doctors" })}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{l({ ru: "Вложено, млн", en: "Paid, mln" })}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{l({ ru: "P1 и лечебные на их территориях", en: "P1 and special in their territories" })}</th>
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
                    <td className="figure-num px-3 py-2 text-right"><Pct v={r.terrChange} f={f} /></td>
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
              <h2 className="text-[15px] font-semibold">
                {l({ ru: "Врачи", en: "Doctors" })} · {label(rxNow)}
                <span className="font-normal text-muted"> — {[selName, repFilter].filter(Boolean).join(", ")}</span>
              </h2>
              <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)} className="h-9 rounded-lg border border-border bg-surface px-3 text-[13px]">
                <option value="">{l({ ru: "все представители", en: "every rep" })}</option>
                {data.reps.map((r) => (
                  <option key={r.name} value={r.name}>{r.name}</option>
                ))}
              </select>
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
