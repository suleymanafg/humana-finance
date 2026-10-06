"use client";

// The overview's large chart: one column per month, a single series or a stack
// of up to six, the month's breakdown on hover or keyboard focus, a click to
// open the month. Drawn at its measured width so the text keeps its size.
import { useLayoutEffect, useRef, useState } from "react";

export interface ChartSeries {
  key: string;
  name: string;
  color: string;
}

export interface ChartColumn {
  key: string;
  /** under the column: «окт 25» */
  label: string;
  /** in the tooltip: «Октябрь 2025» */
  title: string;
  total: number | null;
  parts?: Record<string, number>;
  /** the month the page shows */
  focus?: boolean;
  /** the month still running */
  partial?: boolean;
  tone?: "warn";
}

const HEIGHT = 300;
const PAD_TOP = 26;
const PAD_BOTTOM = 30;
const GAP = 2;
const RADIUS = 4;

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5]) if (m * p >= raw) return m * p;
  return 10 * p;
}

function ticksFor(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const step = niceStep(max / 4);
  const count = Math.ceil(max / step - 1e-9);
  return Array.from({ length: count + 1 }, (_, k) => k * step);
}

/** A column rounded at its data end and square at the baseline. */
function columnPath(x: number, top: number, w: number, h: number): string {
  const r = Math.min(RADIUS, h, w / 2);
  const b = top + h;
  return `M${x},${b}V${top + r}A${r},${r} 0 0 1 ${x + r},${top}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${top + r}V${b}Z`;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.floor(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export default function FocusChart({
  columns,
  series,
  single = "var(--accent)",
  format,
  tick,
  cap,
  rule,
  change,
  detail,
  partialLabel,
  pickHint,
  onPick,
  label,
  motionKey,
}: {
  columns: ChartColumn[];
  /** the stack, bottom first; empty for a single series */
  series: ChartSeries[];
  single?: string;
  /** exact value, for the tooltip */
  format: (v: number) => string;
  /** axis label */
  tick: (v: number) => string;
  /** label on the open month's column */
  cap: (v: number) => string;
  rule?: { value: number; label: string };
  change?: (cur: ChartColumn, prev: ChartColumn) => React.ReactNode;
  detail?: (c: ChartColumn) => React.ReactNode;
  partialLabel: string;
  pickHint: string;
  onPick: (key: string) => void;
  label: string;
  /** a new key replays the grow-in, when the measure or the split changes */
  motionKey: string;
}) {
  const [ref, width] = useWidth();
  // the grow-in plays when the reader switches the view, never on arrival
  const [shownKey, setShownKey] = useState(motionKey);
  const [moving, setMoving] = useState(false);
  if (motionKey !== shownKey) {
    setShownKey(motionKey);
    setMoving(true);
  }
  const [hover, setHover] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const hits = useRef<Array<SVGRectElement | null>>([]);

  const focusIdx = Math.max(0, columns.findIndex((c) => c.focus));
  const ticks = ticksFor(Math.max(0, ...columns.map((c) => c.total ?? 0), rule ? rule.value * 1.2 : 0));
  const top = ticks[ticks.length - 1];
  const axisW = Math.max(...ticks.map((t) => tick(t).length), rule ? rule.label.length : 0) * 6.3 + 16;
  const plotL = axisW;
  const plotW = Math.max(0, width - plotL - 4);
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const y = (v: number) => PAD_TOP + plotH - (Math.max(0, v) / top) * plotH;
  const n = Math.max(1, columns.length);
  const slot = plotW / n;
  const bw = Math.min(24, Math.max(8, slot * 0.46));
  const base = y(0);

  const stackOf = (c: ChartColumn) => {
    const parts =
      series.length > 0 && c.parts
        ? series.map((s) => ({ key: s.key, color: s.color, v: Math.max(0, c.parts?.[s.key] ?? 0) }))
        : [{ key: "total", color: c.tone === "warn" ? "var(--warn)" : single, v: Math.max(0, c.total ?? 0) }];
    let acc = 0;
    const segs: Array<{ key: string; color: string; top: number; bottom: number }> = [];
    for (const p of parts) {
      if (p.v <= 0) continue;
      const bottom = y(acc);
      acc += p.v;
      // a 2px surface gap separates each segment from the one below it
      const lifted = segs.length > 0 ? bottom - GAP : bottom;
      if (lifted - y(acc) >= 1) segs.push({ key: p.key, color: p.color, top: y(acc), bottom: lifted });
    }
    return segs;
  };

  const shown = hover ?? cursor;
  const active = shown != null ? columns[shown] : null;
  const cx = (i: number) => plotL + i * slot + slot / 2;

  function onKey(e: React.KeyboardEvent, i: number) {
    let next = i;
    if (e.key === "ArrowRight") next = Math.min(columns.length - 1, i + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, i - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = columns.length - 1;
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick(columns[i].key);
      return;
    } else return;
    e.preventDefault();
    setCursor(next);
    hits.current[next]?.focus();
  }

  const tip = (() => {
    if (!active || shown == null || width === 0) return null;
    const x = cx(shown);
    const right = x > width * 0.62;
    const prev = shown > 0 ? columns[shown - 1] : null;
    const rows =
      series.length > 0 && active.parts
        ? [...series].reverse().filter((s) => (active.parts?.[s.key] ?? 0) !== 0)
        : [];
    return (
      <div
        role="status"
        className="pointer-events-none absolute z-10 w-max min-w-44 max-w-72 rounded-md border border-border bg-surface px-3 py-2.5 text-[12px] shadow-[0_6px_20px_-6px_rgba(11,28,48,0.18)]"
        style={{
          top: PAD_TOP - 6,
          left: right ? x - bw / 2 - 12 : x + bw / 2 + 12,
          transform: right ? "translateX(-100%)" : undefined,
        }}
      >
        <div className="text-muted">
          {active.title}
          {active.partial && ` · ${partialLabel}`}
        </div>
        <div className="figure-num mt-0.5 text-[15px] font-semibold text-foreground">
          {active.total == null ? "—" : format(active.total)}
        </div>
        {prev && change && <div className="mt-0.5">{change(active, prev)}</div>}
        {rows.length > 0 && (
          <div className="mt-2 grid grid-cols-[auto_auto_1fr] items-center gap-x-2 gap-y-1 border-t border-border pt-2">
            {rows.map((s) => (
              <div key={s.key} className="contents">
                <span aria-hidden className="h-[3px] w-2.5 rounded-full" style={{ background: s.color }} />
                <span className="figure-num text-right font-medium text-foreground">{format(active.parts?.[s.key] ?? 0)}</span>
                <span className="truncate text-muted">{s.name}</span>
              </div>
            ))}
          </div>
        )}
        {detail?.(active)}
        {!active.focus && <div className="mt-2 text-[11px] text-muted">{pickHint}</div>}
      </div>
    );
  })();

  return (
    <div ref={ref} className="relative select-none" style={{ height: HEIGHT }}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="group" aria-label={label} className="block overflow-visible">
          {/* the open month, banded */}
          <rect
            x={plotL + focusIdx * slot + 3}
            y={PAD_TOP - 22}
            width={Math.max(0, slot - 6)}
            height={HEIGHT - PAD_TOP + 20}
            rx={6}
            fill="var(--accent-soft-bg)"
          />
          {shown != null && shown !== focusIdx && (
            <rect
              x={plotL + shown * slot + 3}
              y={PAD_TOP - 22}
              width={Math.max(0, slot - 6)}
              height={HEIGHT - PAD_TOP + 20}
              rx={6}
              fill="var(--background)"
            />
          )}
          {cursor != null && hover == null && (
            <rect
              x={plotL + cursor * slot + 3.75}
              y={PAD_TOP - 21.25}
              width={Math.max(0, slot - 7.5)}
              height={HEIGHT - PAD_TOP + 18.5}
              rx={5.5}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1.5}
            />
          )}

          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={plotL}
                x2={plotL + plotW}
                y1={Math.round(y(t)) + 0.5}
                y2={Math.round(y(t)) + 0.5}
                stroke={t === 0 ? "var(--border-strong)" : "var(--border)"}
                strokeWidth={1}
              />
              {!(rule && Math.abs(y(t) - y(rule.value)) < 14) && (
                <text
                  x={plotL - 10}
                  y={y(t)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={11}
                  fill="var(--muted)"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {tick(t)}
                </text>
              )}
            </g>
          ))}

          <g key={motionKey} className={moving ? "ov-grow" : undefined} style={{ transformOrigin: `0px ${base}px` }}>
            {columns.map((c, i) => {
              const segs = stackOf(c);
              const x = cx(i) - bw / 2;
              return (
                <g key={c.key} opacity={c.partial ? 0.5 : 1}>
                  {segs.map((s, j) =>
                    j === segs.length - 1 ? (
                      <path key={s.key} d={columnPath(x, s.top, bw, s.bottom - s.top)} fill={s.color} />
                    ) : (
                      <rect key={s.key} x={x} y={s.top} width={bw} height={s.bottom - s.top} fill={s.color} />
                    )
                  )}
                </g>
              );
            })}
          </g>

          {rule && (
            <g>
              <line
                x1={plotL}
                x2={plotL + plotW}
                y1={Math.round(y(rule.value)) + 0.5}
                y2={Math.round(y(rule.value)) + 0.5}
                stroke="var(--warn)"
                strokeWidth={1.5}
              />
              <text x={plotL - 10} y={y(rule.value)} textAnchor="end" dominantBaseline="middle" fontSize={11} fontWeight={600} fill="var(--warn)">
                {rule.label}
              </text>
            </g>
          )}

          {columns.map((c, i) => {
            const segs = stackOf(c);
            const tipY = segs.length ? segs[segs.length - 1].top : base;
            return (
              <g key={c.key}>
                {c.focus && c.total != null && c.total !== 0 && (
                  <text x={cx(i)} y={tipY - 8} textAnchor="middle" fontSize={11.5} fontWeight={650} fill="var(--foreground)">
                    {cap(c.total)}
                  </text>
                )}
                {c.partial && !c.focus && (
                  <text x={cx(i)} y={tipY - 8} textAnchor="middle" fontSize={10.5} fill="var(--muted)">
                    {partialLabel}
                  </text>
                )}
                <text
                  x={cx(i)}
                  y={HEIGHT - 10}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={c.focus ? 650 : 400}
                  fill={c.focus ? "var(--foreground)" : "var(--muted)"}
                >
                  {c.label}
                </text>
              </g>
            );
          })}

          {columns.map((c, i) => (
            <rect
              key={c.key}
              ref={(el) => {
                hits.current[i] = el;
              }}
              x={plotL + i * slot}
              y={0}
              width={Math.max(0, slot)}
              height={HEIGHT}
              fill="transparent"
              className="cursor-pointer outline-none"
              role="button"
              tabIndex={i === (cursor ?? focusIdx) ? 0 : -1}
              aria-label={`${c.title}: ${c.total == null ? "—" : format(c.total)}`}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setCursor(i)}
              onBlur={() => setCursor(null)}
              onClick={() => onPick(c.key)}
              onKeyDown={(e) => onKey(e, i)}
            />
          ))}
        </svg>
      )}
      {tip}
    </div>
  );
}
