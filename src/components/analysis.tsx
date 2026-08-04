"use client";

// Analysis primitives for the reporting pages.
// Deliberately dense and quiet: the data carries the page, the chrome does not.
import { useMemo, useState } from "react";
import { fmtN, fmtPct } from "@/lib/format";
import { useT } from "@/lib/locale-context";
import { IconArrowDown, IconArrowUp, IconChevronDown, IconChevronRight } from "./icons";

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

/** Change vs a comparison figure. `pp` renders percentage-point moves. */
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
    <span
      className={`num inline-flex items-center gap-0.5 font-medium ${good ? "text-ok" : "text-danger"}`}
    >
      {up ? <IconArrowUp size={10} /> : <IconArrowDown size={10} />}
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

/** Compact headline row — a few numbers only, no oversized cards. */
export function MetricStrip({ metrics }: { metrics: Metric[] }) {
  return (
    <div
      className="mb-5 grid overflow-hidden rounded-xl border border-border bg-surface"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(178px, 1fr))` }}
    >
      {metrics.map((m) => (
        <div key={m.label} className="min-w-0 border-b border-r border-border px-4 py-3 last:border-r-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[11px] font-medium uppercase tracking-[0.05em] text-muted" title={m.label}>
              {m.label}
            </span>
            {m.delta && <Delta {...m.delta} />}
          </div>
          <div
            className={`num mt-1 text-left text-[19px] font-semibold leading-tight tracking-[-0.02em] ${m.negative ? "text-danger" : ""}`}
          >
            {m.value}
          </div>
          <div className="mt-1 flex items-end justify-between gap-2">
            {m.hint ? <span className="truncate text-[11px] text-muted">{m.hint}</span> : <span />}
            {m.series && <Spark values={m.series} w={72} h={18} tone="muted" />}
          </div>
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
    <section className={`mb-5 ${className}`}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.07em] text-accent/80">{title}</h2>
          {note && <p className="mt-0.5 text-[12px] text-muted">{note}</p>}
        </div>
        {right && <div className="flex items-center gap-2">{right}</div>}
      </div>
      <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface">{children}</div>
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
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-5">
      <button
        onClick={() => setOpen(!open)}
        className="mb-2 flex w-full items-center gap-1.5 text-left transition-colors hover:text-accent"
      >
        <span className="text-muted">{open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}</span>
        <span className="text-[12px] font-semibold uppercase tracking-[0.07em] text-accent/80">{title}</span>
        {note && <span className="ml-1 text-[12px] normal-case text-muted">· {note}</span>}
      </button>
      {open && <div className="overflow-hidden rounded-xl border border-border bg-surface">{children}</div>}
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
