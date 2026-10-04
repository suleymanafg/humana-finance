"use client";

// Analysis primitives for the reporting pages.
// Deliberately dense and quiet: the data carries the page, the chrome does not.
import { useMemo, useState } from "react";
import { fmtN, fmtPct } from "@/lib/format";
import { useT } from "@/lib/locale-context";

/** Small inline trend line for use inside table rows and metric tiles. */
export function Spark({
  values,
  w = 92,
  h = 22,
  tone = "accent",
}: {
  values: number[];
  w?: number;
  h?: number;
  tone?: "accent" | "muted";
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (w - 2) + 1;
    const y = h - 2 - ((v - min) / span) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const stroke = tone === "accent" ? "var(--accent)" : "#98a2b3";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="shrink-0 align-middle" aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/** Change vs a comparison figure, as a signed percentage. `pp` renders percentage-point moves. */
export function Delta({
  current,
  previous,
  pp = false,
  invert = false,
  showZero = false,
}: {
  current: number;
  previous: number;
  pp?: boolean;
  /** true when a rise is bad (costs, taxes) */
  invert?: boolean;
  showZero?: boolean;
}) {
  const { locale } = useT();
  if (!Number.isFinite(previous) || (previous === 0 && !pp)) return <span className="text-muted">—</span>;
  const change = pp ? (current - previous) * 100 : ((current - previous) / Math.abs(previous)) * 100;
  if (!Number.isFinite(change)) return <span className="text-muted">—</span>;
  if (Math.abs(change) < 0.05 && !showZero) return <span className="num text-muted">—</span>;
  const up = change >= 0;
  const good = invert ? !up : up;
  return (
    <span className={`num whitespace-nowrap ${good ? "text-ok" : "text-danger"}`}>
      {up ? "+" : "−"}
      {Math.abs(change).toFixed(1)}
      {pp ? (locale === "ru" ? " пп" : " pp") : "%"}
    </span>
  );
}

/** Horizontal proportion bar used inside table cells. */
export function ShareBar({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "warn" }) {
  const pct = max > 0 ? Math.max(0, (value / max) * 100) : 0;
  return (
    <div className="h-1 w-full min-w-10 overflow-hidden rounded-full bg-border">
      <div
        className={`h-full rounded-full ${tone === "warn" ? "bg-warn" : "bg-accent"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export interface Metric {
  label: string;
  value: string;
  /** optional comparison, rendered as a delta chip */
  delta?: { current: number; previous: number; pp?: boolean; invert?: boolean };
  series?: number[];
  hint?: string;
  negative?: boolean;
}

/** Headline figures: label, value, and one line of context with the change. */
export function MetricStrip({ metrics }: { metrics: Metric[] }) {
  const { locale } = useT();
  return (
    <div className="mb-6 grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(190px, 1fr))` }}>
      {metrics.map((m) => (
        <div key={m.label} className="min-w-0 rounded-lg border border-border bg-surface px-4 py-3.5">
          <div className="truncate text-[12px] text-muted" title={m.label}>
            {m.label}
          </div>
          <div
            className={`figure-num mt-1 text-[20px] font-semibold tracking-[-0.02em] ${m.negative ? "text-danger" : ""}`}
          >
            {m.value}
          </div>
          {(m.hint || m.delta) && (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[12px] leading-snug text-muted">
              {m.delta && (
                <span>
                  <Delta {...m.delta} /> {locale === "ru" ? "к прошлому месяцу" : "vs last month"}
                </span>
              )}
              {m.hint && <span className="truncate">{m.hint}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Section wrapper: small heading, optional note and right-hand controls. */
export function Section({
  title,
  note,
  right,
  children,
  className = "",
}: {
  title: string;
  note?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-7 ${className}`}>
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-[14px] font-semibold tracking-[-0.01em]">{title}</h2>
          {note && <span className="text-[12.5px] text-muted">{note}</span>}
        </div>
        {right && <div className="flex items-center gap-2">{right}</div>}
      </div>
      <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">{children}</div>
    </section>
  );
}

/** Collapsed-by-default wrapper for data entry and long reference tables. */
export function Collapsible({
  title,
  note,
  defaultOpen = false,
  children,
}: {
  title: string;
  note?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const { locale } = useT();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-7">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-[14px] font-semibold tracking-[-0.01em]">{title}</h2>
        {note && <span className="text-[12.5px] text-muted">{note}</span>}
        <button onClick={() => setOpen(!open)} className="ml-auto text-[12.5px] text-accent hover:underline">
          {open ? (locale === "ru" ? "Скрыть" : "Hide") : locale === "ru" ? "Показать" : "Show"}
        </button>
      </div>
      {open && <div className="overflow-hidden rounded-lg border border-border bg-surface">{children}</div>}
    </section>
  );
}

export type SortDir = "asc" | "desc";

/** Sortable header cell. */
export function Th({
  children,
  sortKey,
  sort,
  onSort,
  numeric = false,
  className = "",
  title,
}: {
  children: React.ReactNode;
  sortKey?: string;
  sort?: { key: string; dir: SortDir };
  onSort?: (key: string) => void;
  numeric?: boolean;
  className?: string;
  title?: string;
}) {
  const active = sortKey && sort?.key === sortKey;
  return (
    <th
      className={`${numeric ? "text-right" : ""} ${sortKey ? "cursor-pointer select-none hover:text-foreground" : ""} ${className}`}
      onClick={sortKey && onSort ? () => onSort(sortKey) : undefined}
      title={title}
    >
      <span className={`inline-flex items-center gap-1 ${numeric ? "flex-row-reverse" : ""}`}>
        {children}
        {active && <span className="text-[9px] text-accent">{sort!.dir === "desc" ? "▼" : "▲"}</span>}
      </span>
    </th>
  );
}

/** Sorting state helper for the analysis tables. */
export function useSort<T>(rows: T[], initialKey: string, accessors: Record<string, (r: T) => number | string>) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: initialKey, dir: "desc" });
  const sorted = useMemo(() => {
    const get = accessors[sort.key];
    if (!get) return rows;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (typeof va === "string" || typeof vb === "string") {
        const cmp = String(va).localeCompare(String(vb), "ru");
        return sort.dir === "asc" ? cmp : -cmp;
      }
      return sort.dir === "asc" ? va - vb : vb - va;
    });
    // accessors is a stable literal at each call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  const onSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  return { sorted, sort, onSort };
}

/** Right-aligned money cell with an optional muted secondary line. */
export function Money({ v, sub, strong }: { v: number; sub?: string; strong?: boolean }) {
  return (
    <div className="text-right">
      <div className={`num ${v < 0 ? "text-danger" : ""} ${strong ? "font-semibold" : ""}`}>{fmtN(v)}</div>
      {sub && <div className="num text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export { fmtN, fmtPct };
