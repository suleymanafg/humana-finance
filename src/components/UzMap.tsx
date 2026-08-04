"use client";

// Interactive choropleth of Uzbekistan (ADM1) colored by monthly revenue.
// Sequential single-hue ramp (dataviz reference palette); hover tooltip;
// click selects a region (toggles off on second click).
import { useRef, useState } from "react";
import { UZ_MAP_VIEWBOX, UZ_REGIONS, type UzRegion } from "@/lib/uz-map";
import { fmtN, fmtPct } from "@/lib/format";
import { useT } from "@/lib/locale-context";

// sequential blue ramp, light -> dark (reference palette steps 100–700)
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#1c5cab", "#104281"];
const NO_CHANNEL_FILL = "#eceef2";
// larger regions that can carry a permanent label without clutter
const LABELED = new Set(["UZ-QR", "UZ-NW", "UZ-BU", "UZ-QA", "UZ-SU", "UZ-SA", "UZ-JI", "UZ-TO", "UZ-XO", "UZ-FA", "UZ-NG"]);

export interface RegionStat {
  revenue: number;
  qty: number;
  share: number; // of month revenue
}

export default function UzMap({
  statsByIso,
  selectedIso,
  onSelect,
}: {
  statsByIso: Record<string, RegionStat>;
  selectedIso: string | null;
  onSelect: (iso: string | null) => void;
}) {
  const { t, locale } = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ iso: string; x: number; y: number; width: number } | null>(null);

  const maxRevenue = Math.max(1, ...Object.values(statsByIso).map((s) => s.revenue));
  const fillOf = (r: UzRegion) => {
    if (r.channels.length === 0) return NO_CHANNEL_FILL;
    const v = statsByIso[r.iso]?.revenue ?? 0;
    if (v <= 0) return RAMP[0];
    const idx = Math.min(RAMP.length - 1, Math.floor((v / maxRevenue) * (RAMP.length - 0.001)));
    return RAMP[idx];
  };
  // labels must stay readable on dark ramp steps
  const labelColorOf = (r: UzRegion) => {
    if (r.channels.length === 0) return "#98a2b3";
    const v = statsByIso[r.iso]?.revenue ?? 0;
    return v / maxRevenue > 0.42 ? "rgba(255,255,255,0.92)" : "#3f4a5c";
  };

  // the container width is captured on hover, not read during render, so the
  // tooltip can be clamped without touching a ref while rendering
  function onMove(e: React.MouseEvent, iso: string) {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setHover({ iso, x: e.clientX - rect.left, y: e.clientY - rect.top, width: rect.width });
  }

  const hoverRegion = hover ? UZ_REGIONS.find((r) => r.iso === hover.iso) : null;
  const hoverStat = hover ? statsByIso[hover.iso] : null;

  return (
    <div ref={containerRef} className="relative">
      <svg
        viewBox={`0 0 ${UZ_MAP_VIEWBOX.width} ${UZ_MAP_VIEWBOX.height}`}
        className="w-full"
        role="img"
        aria-label="Uzbekistan sales map"
      >
        {UZ_REGIONS.map((r) => {
          const selected = selectedIso === r.iso;
          const clickable = r.channels.length > 0;
          return (
            <path
              key={r.iso}
              d={r.path}
              fill={fillOf(r)}
              stroke={selected ? "var(--accent)" : "#ffffff"}
              strokeWidth={selected ? 2.5 : 1.2}
              strokeLinejoin="round"
              className={clickable ? "cursor-pointer transition-[filter,opacity]" : ""}
              style={{
                filter:
                  hover?.iso === r.iso && clickable
                    ? "brightness(0.94) drop-shadow(0 2px 6px rgba(16,24,40,0.25))"
                    : undefined,
                opacity: selectedIso && !selected ? 0.55 : 1,
              }}
              onMouseMove={(e) => onMove(e, r.iso)}
              onMouseLeave={() => setHover(null)}
              onClick={() => clickable && onSelect(selected ? null : r.iso)}
            />
          );
        })}
        {UZ_REGIONS.filter((r) => LABELED.has(r.iso)).map((r) => (
          <text
            key={`label-${r.iso}`}
            x={r.cx}
            y={r.cy}
            textAnchor="middle"
            className="pointer-events-none select-none"
            style={{ fontSize: 15, fontWeight: 500, fill: labelColorOf(r) }}
          >
            {locale === "ru" ? r.nameRu : r.nameEn}
          </text>
        ))}
      </svg>

      {/* legend */}
      <div className="mt-2 flex items-center gap-2 px-1">
        <span className="text-[11px] text-muted">0</span>
        <div
          className="h-2 flex-1 rounded-full"
          style={{ background: `linear-gradient(to right, ${RAMP.join(",")})`, maxWidth: 180 }}
        />
        <span className="text-[11px] text-muted">{fmtN(maxRevenue)}</span>
        <span className="ml-3 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: NO_CHANNEL_FILL }} />
        <span className="text-[11px] text-muted">{t("mapNoChannel")}</span>
      </div>

      {/* tooltip */}
      {hover && hoverRegion && (
        <div
          className="pointer-events-none absolute z-20 min-w-44 rounded-lg border border-border bg-surface px-3 py-2 shadow-[0_4px_16px_rgba(16,24,40,0.14)]"
          style={{
            left: Math.max(0, Math.min(hover.x + 14, hover.width - 190)),
            top: hover.y + 14,
          }}
        >
          <div className="text-[12.5px] font-semibold">
            {locale === "ru" ? hoverRegion.nameRu : hoverRegion.nameEn}
          </div>
          {hoverRegion.channels.length === 0 ? (
            <div className="mt-0.5 text-[12px] text-muted">{t("mapNoChannel")}</div>
          ) : (
            <div className="mt-1 space-y-0.5 text-[12px]">
              <div className="flex justify-between gap-4">
                <span className="text-muted">{t("revenue")}</span>
                <span className="num font-medium">{fmtN(hoverStat?.revenue ?? 0)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted">{t("qty")}</span>
                <span className="num font-medium">{fmtN(hoverStat?.qty ?? 0)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted">{t("share")}</span>
                <span className="num font-medium">{fmtPct(hoverStat?.share ?? 0)}</span>
              </div>
              <div className="pt-0.5 text-[11px] text-muted">{hoverRegion.channels.join(" · ")}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
