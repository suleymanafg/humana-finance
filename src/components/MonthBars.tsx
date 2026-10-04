"use client";

import { useState } from "react";
import { fmtN } from "@/lib/format";

/**
 * One series by month: thin bars from a zero baseline, rounded at the data end,
 * exact value on hover. Negative months extend below the baseline.
 */
export default function MonthBars({
  points,
  height = 168,
  width = 640,
  label,
}: {
  points: Array<{ key: string; short: string; long: string; value: number; focus?: boolean }>;
  height?: number;
  /** drawing width; match it roughly to the space the chart gets so the text keeps its size */
  width?: number;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const padTop = 10;
  const padBottom = 22;
  const plotH = height - padTop - padBottom;
  const max = Math.max(0, ...points.map((p) => p.value));
  const min = Math.min(0, ...points.map((p) => p.value));
  const span = max - min || 1;
  const y = (v: number) => padTop + ((max - v) / span) * plotH;
  const zero = y(0);
  const slot = width / Math.max(1, points.length);
  const barW = Math.max(6, Math.min(28, slot * 0.56));
  const r = Math.min(4, barW / 2);

  const barPath = (x: number, v: number) => {
    const top = y(Math.max(v, 0));
    const bottom = y(Math.min(v, 0));
    const h = bottom - top;
    if (h < 0.5) return "";
    const rr = Math.min(r, h);
    if (v >= 0) {
      return `M${x},${bottom} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + barW - rr} Q${x + barW},${top} ${x + barW},${top + rr} V${bottom} Z`;
    }
    return `M${x},${top} V${bottom - rr} Q${x},${bottom} ${x + rr},${bottom} H${x + barW - rr} Q${x + barW},${bottom} ${x + barW},${bottom - rr} V${top} Z`;
  };

  const active = hover != null ? points[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={label}>
        <line x1={0} x2={width} y1={zero} y2={zero} stroke="var(--border-strong)" strokeWidth={1} />
        {points.map((p, i) => {
          const x = i * slot + (slot - barW) / 2;
          return (
            <g key={p.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={i * slot} y={0} width={slot} height={height} fill="transparent" />
              <path
                d={barPath(x, p.value)}
                fill="var(--accent)"
                opacity={hover == null ? (p.focus ? 1 : 0.55) : hover === i ? 1 : 0.35}
              />
              <text
                x={i * slot + slot / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize={10.5}
                fill={p.focus ? "var(--foreground)" : "var(--muted)"}
                fontWeight={p.focus ? 600 : 400}
              >
                {p.short}
              </text>
            </g>
          );
        })}
      </svg>
      {active && (
        <div
          className="pointer-events-none absolute top-0 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] shadow-sm"
          style={{ left: `${(((hover ?? 0) + 0.5) / points.length) * 100}%`, transform: "translateX(-50%)" }}
        >
          <div className="text-muted">{active.long}</div>
          <div className="figure-num font-semibold">{fmtN(active.value)}</div>
        </div>
      )}
    </div>
  );
}
