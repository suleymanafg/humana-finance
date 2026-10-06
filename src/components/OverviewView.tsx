"use client";

// The overview: five pulse figures that steer one large chart, then the month's
// biggest changes and the state of stock and supply.
import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { fmtCompact, fmtN } from "@/lib/format";
import { MONTH_COOKIE } from "@/lib/month-cookie";
import type { OverviewMonth, OverviewProps, OverviewSeries } from "@/lib/overview-data";
import FocusChart, { type ChartColumn, type ChartSeries } from "./FocusChart";
import { IconArrowDown, IconArrowUp } from "./icons";

type Measure = "sales" | "units" | "cover";
type SplitBy = "total" | "channel" | "product";
type Locale = "ru" | "en";

/** the key the data layer gives the folded remainder («Прочие») */
const OTHER = "other";
const SERIES_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)"];

const colored = (series: OverviewSeries[]): ChartSeries[] =>
  series.map((s, i) => ({ ...s, color: s.key === OTHER ? "var(--series-other)" : SERIES_COLORS[i] ?? "var(--series-other)" }));

// ── month words ──────────────────────────────────────────────────
const RU = {
  dative: ["январю", "февралю", "марту", "апрелю", "маю", "июню", "июлю", "августу", "сентябрю", "октябрю", "ноябрю", "декабрю"],
  genitive: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
  prepositional: ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"],
};
const EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ym = (id: string) => id.split("-").map(Number) as [number, number];

/** «к августу», «к сентябрю 2025» · "vs August", "vs September 2025" */
function versus(id: string, locale: Locale, withYear: boolean): string {
  const [y, m] = ym(id);
  const year = withYear ? ` ${y}` : "";
  return locale === "ru" ? `к ${RU.dative[m - 1]}${year}` : `vs ${EN[m - 1]}${year}`;
}
/** «20 октября» · "20 October" */
function dayMonth(date: string, locale: Locale): string {
  const [, m, d] = date.split("-").map(Number);
  return locale === "ru" ? `${d} ${RU.genitive[m - 1]}` : `${d} ${EN[m - 1]}`;
}
/** «в феврале 2027» · "in February 2027" */
function inMonth(id: string, locale: Locale): string {
  const [y, m] = ym(id);
  return locale === "ru" ? `в ${RU.prepositional[m - 1]} ${y}` : `in ${EN[m - 1]} ${y}`;
}
function days(n: number, locale: Locale): string {
  if (locale === "en") return `${n} ${n === 1 ? "day" : "days"}`;
  const d10 = n % 10;
  const d100 = n % 100;
  const word = d10 === 1 && d100 !== 11 ? "день" : d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14) ? "дня" : "дней";
  return `${n} ${word}`;
}
const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0)}%`;
const months1 = (v: number) => v.toFixed(1);

// ── pieces ───────────────────────────────────────────────────────
function Change({ now, prev, against }: { now: number; prev: number | null; against: string }) {
  if (prev == null || prev === 0) return null;
  const v = now / prev - 1;
  const Icon = v >= 0 ? IconArrowUp : IconArrowDown;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className={`inline-flex items-center gap-0.5 font-semibold ${v >= 0 ? "text-ok" : "text-danger"}`}>
        <Icon size={12} strokeWidth={2.2} />
        {pct(v)}
      </span>
      <span className="text-muted">{against}</span>
    </span>
  );
}

/** Twelve months as a line, the open month as a dot; breaks where a month has no figure. */
function Trend({ values, active, rule, warn }: { values: Array<number | null>; active: boolean; rule?: number; warn?: boolean }) {
  const H = 28;
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return <span className="block h-7" />;
  const hi = Math.max(...nums, rule ?? -Infinity);
  const lo = Math.min(...nums, rule ?? Infinity);
  const span = hi - lo || 1;
  const yOf = (v: number) => 3 + (1 - (v - lo) / span) * (H - 6);
  const xOf = (k: number) => (values.length === 1 ? 50 : (k / (values.length - 1)) * 100);
  let d = "";
  let pen = false;
  values.forEach((v, k) => {
    if (v == null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${xOf(k).toFixed(2)},${yOf(v).toFixed(2)}`;
    pen = true;
  });
  const last = values[values.length - 1];
  return (
    <span className="relative block h-7" aria-hidden>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        {rule != null && (
          <line x1={0} x2={100} y1={yOf(rule)} y2={yOf(rule)} stroke="var(--warn)" strokeOpacity={0.55} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
        <path
          d={d}
          fill="none"
          stroke={active ? "var(--accent)" : "var(--trend)"}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {last != null && (
        <span
          className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
          style={{ left: "100%", top: `${(yOf(last) / H) * 100}%`, background: warn ? "var(--warn)" : "var(--accent)" }}
        />
      )}
    </span>
  );
}

function Tile({
  label,
  value,
  tone,
  lines,
  foot,
  active,
  onClick,
  className = "",
}: {
  label: string;
  value: string;
  tone?: "warn";
  lines: React.ReactNode[];
  foot?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const body = (
    <>
      <span className="block truncate text-[12px] text-muted">{label}</span>
      <span
        className={`mt-1 block truncate font-semibold leading-[28px] tracking-[-0.02em] ${value.length > 13 ? "text-[18px]" : "text-[22px]"} ${
          tone === "warn" ? "text-warn" : "text-foreground"
        }`}
        title={value.length > 13 ? value : undefined}
      >
        {value}
      </span>
      {lines.filter(Boolean).map((line, k) => (
        <span key={k} className="mt-0.5 block text-[12px] leading-snug">
          {line}
        </span>
      ))}
      {foot && <span className="mt-auto block pt-3">{foot}</span>}
    </>
  );
  const box = `flex min-w-0 flex-col bg-surface px-4 pb-3.5 pt-3.5 text-left ${className}`;
  if (!onClick) return <div className={box}>{body}</div>;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`${box} ov-tile transition-colors duration-150 ${active ? "is-active" : "hover:bg-background"}`}
    >
      {body}
    </button>
  );
}

function Toggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-border bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded px-3 py-1 text-[12.5px] transition-colors ${
            o.value === value ? "bg-accent text-white" : "text-muted hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Swatch({ color, faded }: { color: string; faded?: boolean }) {
  return <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color, opacity: faded ? 0.5 : 1 }} />;
}

// ── the page ─────────────────────────────────────────────────────
export default function OverviewView(props: OverviewProps) {
  const { monthId, months, pulse, coverRule, status, asOf } = props;
  const { l, locale } = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const initialMeasure = params.get("show");
  const initialSplit = params.get("split");
  const [measure, setMeasure] = useState<Measure>(initialMeasure === "units" || initialMeasure === "cover" ? initialMeasure : "sales");
  const [split, setSplit] = useState<SplitBy>(initialSplit === "channel" || initialSplit === "product" ? initialSplit : "total");
  const [asTable, setAsTable] = useState(false);

  // the chart's choice lives in the address too, so it survives a change of month
  function choose(next: Measure, nextSplit: SplitBy = split) {
    setMeasure(next);
    setSplit(nextSplit);
    const p = new URLSearchParams(window.location.search);
    if (next === "sales") p.delete("show");
    else p.set("show", next);
    if (nextSplit === "total") p.delete("split");
    else p.set("split", nextSplit);
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }

  function openMonth(id: string) {
    if (id === monthId) return;
    document.cookie = `${MONTH_COOKIE}=${id};path=/;max-age=${3600 * 24 * 90}`;
    const p = new URLSearchParams(window.location.search);
    p.set("month", id);
    startTransition(() => router.push(`${pathname}?${p.toString()}`, { scroll: false }));
  }

  const channelColors = colored(props.channelSeries);
  const productColors = colored(props.productSeries);
  const series = measure === "cover" || split === "total" ? [] : split === "channel" ? channelColors : productColors;
  const current = months[months.length - 1] as OverviewMonth | undefined;
  const partialNow = asOf != null;

  // ── chart columns ──
  const columns: ChartColumn[] = months.map((m) => {
    const total = measure === "sales" ? m.sales : measure === "units" ? m.units : m.cover;
    return {
      key: m.monthId,
      label: m.short,
      title: m.long,
      total: measure === "cover" ? total : total || null,
      parts: measure === "cover" || split === "total" ? undefined : m.by[measure][split],
      focus: m.monthId === monthId,
      partial: m.partial,
      tone: measure === "cover" && m.cover != null && m.cover < coverRule ? "warn" : undefined,
    };
  });
  const unitsWord = l({ ru: "шт", en: "units" });
  const monthsWord = l({ ru: "мес", en: "mo" });
  const format = (v: number) =>
    measure === "sales" ? fmtN(v) : measure === "units" ? `${fmtN(v)} ${unitsWord}` : `${months1(v)} ${monthsWord}`;
  const tick = (v: number) => (measure === "sales" ? fmtCompact(v, locale) : measure === "units" ? fmtN(v) : String(v));
  const cap = (v: number) => (measure === "sales" ? fmtCompact(v, locale) : measure === "units" ? fmtN(v) : months1(v));
  const byMonth = new Map(months.map((m) => [m.monthId, m]));

  const titles: Record<Measure, string> = {
    sales: l({ ru: "Продажи с НДС", en: "Sales incl. VAT" }),
    units: l({ ru: "Продано, шт", en: "Units sold" }),
    cover: l({ ru: "Запас в месяцах продаж", en: "Stock cover in months of sales" }),
  };
  const first = months[0];
  const range =
    first && current
      ? `${first.long} — ${locale === "ru" ? current.long.charAt(0).toLowerCase() + current.long.slice(1) : current.long}`
      : "";
  const subtitle =
    measure === "cover"
      ? l({
          ru: `Запас на конец месяца, делённый на средние продажи последних трёх месяцев. Норма — ${coverRule} мес.`,
          en: `Month-end stock over the average sales of the last three months. The rule is ${coverRule} months.`,
        })
      : `${range}. ${l({ ru: "Нажмите на месяц, чтобы открыть его.", en: "Click a month to open it." })}`;

  // ── pulse ──
  const vsPrev = pulse.prevId ? versus(pulse.prevId, locale, false) : "";
  const vsYear = pulse.yearAgoId ? versus(pulse.yearAgoId, locale, true) : "";
  const dayNow = asOf ? Number(asOf.slice(8)) : 0;
  const daysInMonth = (() => {
    const [y, m] = ym(monthId);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  })();
  const soFar = l({ ru: `за ${days(dayNow, "ru")} из ${daysInMonth}`, en: `${dayNow} of ${daysInMonth} days so far` });
  const changeLines = (now: number, prev: number | null, yearAgo: number | null) =>
    partialNow
      ? [<span key="p" className="text-muted">{soFar}</span>]
      : [
          <Change key="m" now={now} prev={prev} against={vsPrev} />,
          <Change key="y" now={now} prev={yearAgo} against={vsYear} />,
        ];
  const lead = pulse.channels.find((c) => c.key !== OTHER) ?? null;
  const coverWarn = pulse.cover != null && pulse.cover < coverRule;

  const noSales = (current?.units ?? 0) === 0;

  return (
    <div className={`ov transition-opacity duration-200 ${pending ? "opacity-60" : ""}`}>
      <p className="-mt-3 mb-5 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[12.5px] text-muted">
        <span>
          {partialNow && asOf
            ? l({ ru: `Месяц идёт: данные на ${dayMonth(asOf, "ru")}`, en: `Month in progress: figures to ${dayMonth(asOf, "en")}` })
            : status.closed
              ? l({ ru: "Месяц закрыт", en: "Month closed" })
              : l({ ru: "Месяц открыт: цифры предварительные", en: "Month open: figures are preliminary" })}
        </span>
        <span>
          {status.missing.length === 0 ? (
            l({ ru: "Все данные месяца внесены", en: "All of the month's data is in" })
          ) : (
            <>
              {l({ ru: "Не внесено: ", en: "Not entered: " })}
              {status.missing.map((m, k) => (
                <span key={m.href}>
                  {k > 0 && ", "}
                  <Link href={m.href} className="text-foreground underline decoration-border-strong underline-offset-[3px] hover:text-accent hover:decoration-accent">
                    {m.label}
                  </Link>
                </span>
              ))}
            </>
          )}
        </span>
        {status.warnings > 0 && (
          <Link href="/health" className="text-foreground underline decoration-border-strong underline-offset-[3px] hover:text-accent hover:decoration-accent">
            {l({
              ru: `Проверки: ${status.warnings} ${status.warnings === 1 ? "предупреждение" : status.warnings < 5 ? "предупреждения" : "предупреждений"}`,
              en: `Checks: ${status.warnings} ${status.warnings === 1 ? "warning" : "warnings"}`,
            })}
          </Link>
        )}
      </p>

      {/* the pulse: each figure switches the chart below to its own view */}
      <section
        aria-label={l({ ru: "Главное за месяц", en: "The month at a glance" })}
        className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3 xl:grid-cols-5"
      >
        <Tile
          label={l({ ru: "Продажи с НДС", en: "Sales incl. VAT" })}
          value={noSales ? "—" : fmtCompact(pulse.sales.now, locale)}
          lines={noSales ? [] : changeLines(pulse.sales.now, pulse.sales.prev, pulse.sales.yearAgo)}
          foot={<Trend values={months.map((m) => (m.units > 0 ? m.sales : null))} active={measure === "sales" && split !== "channel"} />}
          active={measure === "sales" && split !== "channel"}
          onClick={() => choose("sales", split === "channel" ? "total" : split)}
        />
        <Tile
          label={l({ ru: "Продано, шт", en: "Units sold" })}
          value={noSales ? "—" : fmtN(pulse.units.now)}
          lines={noSales ? [] : changeLines(pulse.units.now, pulse.units.prev, pulse.units.yearAgo)}
          foot={<Trend values={months.map((m) => (m.units > 0 ? m.units : null))} active={measure === "units"} />}
          active={measure === "units"}
          onClick={() => choose("units")}
        />
        <Tile
          label={l({ ru: "Главный канал", en: "Leading channel" })}
          value={lead?.name ?? "—"}
          lines={lead ? [<span key="s" className="text-muted">{l({ ru: `${(lead.share * 100).toFixed(1)}% продаж`, en: `${(lead.share * 100).toFixed(1)}% of sales` })}</span>] : []}
          foot={
            pulse.channels.length > 0 && (
              <span className="flex h-7 items-center">
                <span className="flex h-2 w-full gap-[2px]">
                  {pulse.channels.map((c) => (
                    <span
                      key={c.key}
                      className="h-full first:rounded-l-full last:rounded-r-full"
                      style={{
                        width: `${c.share * 100}%`,
                        background: channelColors.find((s) => s.key === c.key)?.color ?? "var(--series-other)",
                      }}
                    />
                  ))}
                </span>
              </span>
            )
          }
          active={measure === "sales" && split === "channel"}
          onClick={() => choose("sales", "channel")}
        />
        <Tile
          label={l({ ru: "Запас", en: "Stock cover" })}
          value={pulse.cover == null ? "—" : `${months1(pulse.cover)} ${monthsWord}`}
          tone={coverWarn ? "warn" : undefined}
          lines={[
            pulse.cover != null && (
              <span key="r" className={coverWarn ? "text-warn" : "text-muted"}>
                {coverWarn
                  ? l({ ru: `ниже нормы ${coverRule} мес`, en: `below the ${coverRule}-month rule` })
                  : l({ ru: `норма ${coverRule} мес`, en: `rule: ${coverRule} months` })}
              </span>
            ),
            <span key="u" className="text-muted">
              {`${fmtN(pulse.stockUnits)} ${unitsWord} ${l({ ru: "на складах", en: "in stock" })}`}
            </span>,
          ]}
          foot={<Trend values={months.map((m) => m.cover)} active={measure === "cover"} rule={coverRule} warn={coverWarn} />}
          active={measure === "cover"}
          onClick={() => choose("cover")}
        />
        <Tile
          className="col-span-2 xl:col-span-1"
          label={l({ ru: "Заказ в IBP", en: "IBP order" })}
          value={pulse.order.daysLeft === 0 ? l({ ru: "сегодня", en: "today" }) : days(pulse.order.daysLeft, locale)}
          lines={[
            <span key="d" className="text-muted">
              {l({ ru: `срок ${dayMonth(pulse.order.deadline, "ru")}`, en: `due ${dayMonth(pulse.order.deadline, "en")}` })}
            </span>,
            <span key="a" className="text-muted">
              {l({ ru: `товар придёт ${inMonth(pulse.order.arrivalMonth, "ru")}`, en: `arrives ${inMonth(pulse.order.arrivalMonth, "en")}` })}
            </span>,
          ]}
          foot={
            props.isAdmin && (
              <Link href="/planning" className="text-[12.5px] font-medium text-accent hover:underline">
                {l({ ru: "Открыть план закупок", en: "Open the supply plan" })}
              </Link>
            )
          }
        />
      </section>

      {/* the chart the pulse steers */}
      <section className="mt-4 rounded-lg border border-border bg-surface" aria-label={titles[measure]}>
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pt-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{titles[measure]}</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">{subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Toggle<Measure>
              label={l({ ru: "Показатель", en: "Measure" })}
              value={measure}
              onChange={(v) => choose(v)}
              options={[
                { value: "sales", label: l({ ru: "Продажи", en: "Sales" }) },
                { value: "units", label: l({ ru: "Штуки", en: "Units" }) },
                { value: "cover", label: l({ ru: "Запас", en: "Cover" }) },
              ]}
            />
            {measure !== "cover" && (
              <Toggle<SplitBy>
                label={l({ ru: "Разбивка", en: "Split" })}
                value={split}
                onChange={(v) => choose(measure, v)}
                options={[
                  { value: "total", label: l({ ru: "Всего", en: "Total" }) },
                  { value: "channel", label: l({ ru: "Каналы", en: "Channels" }) },
                  { value: "product", label: l({ ru: "Товары", en: "Products" }) },
                ]}
              />
            )}
          </div>
        </header>

        <div className="px-3 pb-2 pt-3">
          {asTable ? (
            <ChartTable
              columns={columns}
              series={series}
              measure={measure}
              months={byMonth}
              format={format}
            />
          ) : (
            <FocusChart
              columns={columns}
              series={series}
              format={format}
              tick={tick}
              cap={cap}
              rule={measure === "cover" ? { value: coverRule, label: l({ ru: `норма ${coverRule} мес`, en: `${coverRule}-month rule` }) } : undefined}
              change={(cur, prev) => {
                if (cur.total == null || prev.total == null || prev.total === 0) return null;
                if (measure === "cover") {
                  const d = cur.total - prev.total;
                  return (
                    <span className="text-muted">
                      {`${d >= 0 ? "+" : "−"}${months1(Math.abs(d))} ${monthsWord} ${versus(prev.key, locale, false)}`}
                    </span>
                  );
                }
                return <Change now={cur.total} prev={prev.total} against={versus(prev.key, locale, false)} />;
              }}
              detail={
                measure === "cover"
                  ? (c) => {
                      const m = byMonth.get(c.key);
                      if (!m) return null;
                      return (
                        <div className="mt-2 space-y-0.5 border-t border-border pt-2 text-muted">
                          <div>
                            {l({ ru: "Запас: ", en: "Stock: " })}
                            <span className="figure-num font-medium text-foreground">{fmtN(m.stockUnits)}</span> {unitsWord}
                          </div>
                          <div>
                            {l({ ru: "Продажи в среднем: ", en: "Average sales: " })}
                            <span className="figure-num font-medium text-foreground">{fmtN(m.avgUnits)}</span>{" "}
                            {l({ ru: "шт в месяц", en: "units a month" })}
                          </div>
                        </div>
                      );
                    }
                  : undefined
              }
              partialLabel={l({ ru: "месяц идёт", en: "in progress" })}
              pickHint={l({ ru: "Нажмите, чтобы открыть месяц", en: "Click to open the month" })}
              onPick={openMonth}
              label={titles[measure]}
              motionKey={`${measure}-${split}`}
            />
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border px-5 py-2.5">
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-foreground">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <Swatch color={s.color} />
                {s.name}
              </li>
            ))}
            {measure === "cover" && (
              <>
                <li className="flex items-center gap-1.5">
                  <Swatch color="var(--accent)" />
                  {l({ ru: "Запас на норме", en: "At or above the rule" })}
                </li>
                <li className="flex items-center gap-1.5">
                  <Swatch color="var(--warn)" />
                  {l({ ru: `Ниже нормы ${coverRule} мес`, en: `Below the ${coverRule}-month rule` })}
                </li>
              </>
            )}
            {months.some((m) => m.partial) && (
              <li className="flex items-center gap-1.5 text-muted">
                <Swatch color={series.length > 0 ? "var(--muted)" : "var(--accent)"} faded />
                {l({ ru: "Светлее — месяц ещё идёт", en: "Lighter: the month is still running" })}
              </li>
            )}
          </ul>
          <button type="button" onClick={() => setAsTable(!asTable)} className="text-[12.5px] font-medium text-accent hover:underline">
            {asTable ? l({ ru: "Показать графиком", en: "Show as a chart" }) : l({ ru: "Показать таблицей", en: "Show as a table" })}
          </button>
        </footer>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Movers {...props} progress={partialNow ? { day: dayNow, of: daysInMonth } : null} />
        <Supply {...props} />
      </div>
    </div>
  );
}

// ── the chart as a table ─────────────────────────────────────────
function ChartTable({
  columns,
  series,
  measure,
  months,
  format,
}: {
  columns: ChartColumn[];
  series: ChartSeries[];
  measure: Measure;
  months: Map<string, OverviewMonth>;
  format: (v: number) => string;
}) {
  const { l } = useT();
  const plain = (v: number | null | undefined) => (v == null ? "—" : fmtN(v));
  return (
    <div className="max-h-[300px] overflow-auto">
      <table className="stmt is-compact">
        <thead>
          <tr>
            <th>{l({ ru: "Месяц", en: "Month" })}</th>
            {measure === "cover" ? (
              <>
                <th>{l({ ru: "Запас, шт", en: "Stock, units" })}</th>
                <th>{l({ ru: "Продажи в среднем, шт", en: "Average sales, units" })}</th>
                <th>{l({ ru: "Запас, мес", en: "Cover, months" })}</th>
              </>
            ) : (
              <>
                {series.map((s) => (
                  <th key={s.key}>{s.name}</th>
                ))}
                <th>{l({ ru: "Итого", en: "Total" })}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {columns.map((c) => {
            const m = months.get(c.key);
            const cls = c.focus ? "is-focus" : "";
            return (
              <tr key={c.key}>
                <td className={cls}>
                  {c.title}
                  {c.partial && <span className="text-muted">{l({ ru: " · месяц идёт", en: " · in progress" })}</span>}
                </td>
                {measure === "cover" ? (
                  <>
                    <td className={cls}>{plain(m?.stockUnits)}</td>
                    <td className={cls}>{plain(m?.avgUnits)}</td>
                    <td className={`${cls} ${c.tone === "warn" ? "text-warn" : ""} font-semibold`}>{c.total == null ? "—" : format(c.total)}</td>
                  </>
                ) : (
                  <>
                    {series.map((s) => (
                      <td key={s.key} className={cls}>
                        {plain(c.parts?.[s.key] ?? 0)}
                      </td>
                    ))}
                    <td className={`${cls} font-semibold`}>{plain(c.total ?? 0)}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── what moved ───────────────────────────────────────────────────
function Movers({
  movers,
  pulse,
  monthId,
  months,
  progress,
}: OverviewProps & { progress: { day: number; of: number } | null }) {
  const { l, locale } = useT();
  const current = months.find((m) => m.monthId === monthId);
  const prev = pulse.prevId ? months.find((m) => m.monthId === pulse.prevId) : undefined;
  const sold = (current?.units ?? 0) > 0;
  const sub = !pulse.prevId
    ? l({ ru: "Нет предыдущего месяца для сравнения", en: "No earlier month to compare with" })
    : progress
      ? l({
          ru: `Продано, шт: месяц идёт, прошло ${days(progress.day, "ru")} из ${progress.of}`,
          en: `Units sold: the month is running, ${progress.day} of ${progress.of} days gone`,
        })
      : l({
          ru: `Продано, шт: товары с самым большим изменением ${versus(pulse.prevId, "ru", false)}`,
          en: `Units sold: the products that changed most ${versus(pulse.prevId, "en", false)}`,
        });
  return (
    <section className="min-w-0 rounded-lg border border-border bg-surface">
      <header className="px-5 pb-3 pt-4">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
          {progress ? l({ ru: "Продажи с начала месяца", en: "Sales so far this month" }) : l({ ru: "Что изменилось", en: "What changed" })}
        </h2>
        <p className="mt-0.5 text-[12.5px] text-muted">{sub}</p>
      </header>
      {!sold || movers.length === 0 ? (
        <p className="border-t border-border px-5 py-4 text-[13px] text-muted">
          {!sold
            ? progress
              ? l({ ru: "Продаж за этот месяц пока нет.", en: "No sales yet this month." })
              : l({ ru: "Продаж за этот месяц нет.", en: "No sales this month." })
            : l({ ru: "Изменений по товарам нет.", en: "No change by product." })}
        </p>
      ) : (
        <table className="stmt is-compact">
          <thead>
            <tr>
              <th>{l({ ru: "Товар", en: "Product" })}</th>
              <th>{prev?.short ?? ""}</th>
              <th>{progress ? l({ ru: `${current?.short ?? ""}, пока`, en: `${current?.short ?? ""} so far` }) : (current?.short ?? "")}</th>
              <th>{progress ? l({ ru: "От прошлого месяца", en: "Of last month" }) : l({ ru: "Изменение", en: "Change" })}</th>
            </tr>
          </thead>
          <tbody>
            {movers.map((r) => {
              const d = r.units - r.prev;
              const rel = r.prev > 0 ? d / r.prev : null;
              return (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td className="text-muted">{fmtN(r.prev)}</td>
                  <td>{fmtN(r.units)}</td>
                  {progress ? (
                    <td className="text-muted">{r.prev > 0 ? `${Math.round((r.units / r.prev) * 100)}%` : locale === "ru" ? "новый" : "new"}</td>
                  ) : (
                    <td>
                      <span className={`font-semibold ${d >= 0 ? "text-ok" : "text-danger"}`}>{`${d >= 0 ? "+" : "−"}${fmtN(Math.abs(d))}`}</span>
                      <span className="ml-2 inline-block w-12 text-muted">{rel == null ? (locale === "ru" ? "новый" : "new") : pct(rel)}</span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── stock and supply ─────────────────────────────────────────────
function Supply({ trucks, lowCover, coverRule, writtenOff, isAdmin }: OverviewProps) {
  const { l, locale } = useT();
  const row = "flex items-baseline justify-between gap-4 border-t border-border px-5 py-2.5 text-[13px]";
  return (
    <section className="min-w-0 rounded-lg border border-border bg-surface">
      <header className="px-5 pb-3 pt-4">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{l({ ru: "Запас и поставки", en: "Stock and supply" })}</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">
          {l({ ru: `Машины в пути и товары с запасом ниже нормы ${coverRule} мес`, en: `Trucks on the way and products below the ${coverRule}-month rule` })}
        </p>
      </header>

      <h3 className="border-t border-border bg-surface-low/50 px-5 py-1.5 text-[12px] font-semibold text-muted">
        {l({ ru: "В пути", en: "On the way" })}
      </h3>
      {trucks.length === 0 ? (
        <p className={`${row} text-muted`}>{l({ ru: "Машин в пути нет", en: "No trucks on the way" })}</p>
      ) : (
        trucks.map((t) => (
          <Link key={t.id} href="/goods/shipments" className={`${row} transition-colors hover:bg-background`}>
            <span className="min-w-0 truncate">{t.code}</span>
            <span className="flex shrink-0 items-baseline gap-4">
              {t.units > 0 ? (
                <span className="figure-num">
                  {fmtN(t.units)} <span className="text-muted">{l({ ru: "шт", en: "units" })}</span>
                </span>
              ) : (
                <span className="text-muted">{l({ ru: "состав не внесён", en: "contents not entered" })}</span>
              )}
              <span className="w-32 text-right text-muted">
                {t.eta
                  ? l({ ru: `прибытие ${dayMonth(t.eta, "ru")}`, en: `arrives ${dayMonth(t.eta, "en")}` })
                  : l({ ru: "срок не указан", en: "no date yet" })}
              </span>
            </span>
          </Link>
        ))
      )}

      <h3 className="border-t border-border bg-surface-low/50 px-5 py-1.5 text-[12px] font-semibold text-muted">
        {l({ ru: `Ниже нормы ${coverRule} мес`, en: `Below the ${coverRule}-month rule` })}
      </h3>
      {lowCover.length === 0 ? (
        <p className={`${row} text-muted`}>{l({ ru: "Все товары на норме", en: "Every product meets the rule" })}</p>
      ) : (
        lowCover.map((p) => (
          <Link key={p.name} href={isAdmin ? "/planning" : "/goods/stock"} className={`${row} transition-colors hover:bg-background`}>
            <span className="min-w-0 truncate">{p.name}</span>
            <span className="flex shrink-0 items-baseline gap-4">
              <span className="figure-num text-muted">
                {fmtN(p.stock)} {l({ ru: "шт", en: "units" })}
              </span>
              <span className="figure-num w-16 text-right font-semibold text-warn">
                {p.cover.toFixed(1)} {locale === "ru" ? "мес" : "mo"}
              </span>
            </span>
          </Link>
        ))
      )}

      {writtenOff > 0 && (
        <Link href="/goods/write-offs" className={`${row} transition-colors hover:bg-background`}>
          <span>{l({ ru: "Списано за месяц", en: "Written off this month" })}</span>
          <span className="figure-num">
            {fmtN(writtenOff)} <span className="text-muted">{l({ ru: "шт", en: "units" })}</span>
          </span>
        </Link>
      )}
    </section>
  );
}
