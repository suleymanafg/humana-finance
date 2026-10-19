"use client";

// A load's composition, truck by truck, in whole pallets — the owner's own,
// starting from the plan's. Every product can go in any truck; each truck shows
// its places of HQ's 33 and its fill against HQ's band (0.98–0.985), so a mix
// that HQ's form would not show as 0.98 is visible before it is ordered.
import { useT } from "@/lib/locale-context";
import { pn } from "@/lib/planning/ui-format";
import type { SkuHead } from "@/lib/planning/plan-view";
import { SkuName, pct } from "./PlanView";

export type Composition = Record<string, number>[]; // per truck: skuId -> pallets

export const palletsOf = (units: Record<string, number>, skus: SkuHead[]) =>
  Object.fromEntries(skus.filter((s) => (units[s.id] ?? 0) > 0).map((s) => [s.id, Math.round(((units[s.id] ?? 0) / (s.pcsPerPallet || 1)) * 100) / 100]));

export const unitsOf = (pallets: Record<string, number>, skus: SkuHead[]) =>
  Object.fromEntries(skus.filter((s) => (pallets[s.id] ?? 0) > 0).map((s) => [s.id, Math.round((pallets[s.id] ?? 0) * s.pcsPerPallet)]));

export function compositionTotals(c: Composition, skus: SkuHead[]) {
  const units: Record<string, number> = {};
  for (const t of c) for (const s of skus) units[s.id] = (units[s.id] ?? 0) + Math.round((t[s.id] ?? 0) * s.pcsPerPallet);
  return units;
}

export default function TruckComposer({
  skus,
  value,
  onChange,
  truckPlaces,
  minFill,
  maxFill,
  eurRate,
  names,
  baseline,
  canAddTrucks = true,
  readOnly = false,
}: {
  skus: SkuHead[];
  value: Composition;
  onChange: (next: Composition) => void;
  truckPlaces: number;
  minFill: number;
  maxFill: number;
  eurRate: number;
  /** column names (truck codes); default «Фура 1 …» */
  names?: string[];
  /** the plan's pallets per product for the whole load — shows the change */
  baseline?: Record<string, number>;
  canAddTrucks?: boolean;
  readOnly?: boolean;
}) {
  const { locale } = useT();
  const ru = locale === "ru";
  const set = (t: number, id: string, raw: string) => {
    const n = Number(raw.replace(",", ".").replace(/[^\d.]/g, ""));
    const next = value.map((x, i) => (i === t ? { ...x, [id]: Number.isFinite(n) ? n : 0 } : x));
    onChange(next);
  };
  const placesOf = (t: Record<string, number>) => skus.reduce((a, s) => a + (t[s.id] ?? 0) * s.placesPerPallet, 0);
  const palletsIn = (t: Record<string, number>) => skus.reduce((a, s) => a + (t[s.id] ?? 0), 0);
  const unitsIn = (t: Record<string, number>) => skus.reduce((a, s) => a + Math.round((t[s.id] ?? 0) * s.pcsPerPallet), 0);
  const eurIn = (t: Record<string, number>) => skus.reduce((a, s) => a + Math.round((t[s.id] ?? 0) * s.pcsPerPallet) * s.priceEur, 0);
  const rowPallets = (id: string) => value.reduce((a, t) => a + (t[id] ?? 0), 0);
  const whole = (x: number) => Math.abs(x - Math.round(x)) < 1e-6;
  const fmt = (x: number) => (whole(x) ? String(Math.round(x)) : x.toFixed(2).replace(/0+$/, ""));

  return (
    <div className="overflow-x-auto">
      <table className="ptable text-[12.5px]">
        <thead>
          <tr>
            <th>{ru ? "Товар (паллет)" : "Product (pallets)"}</th>
            {value.map((_, i) => (
              <th key={i} className="!text-center">
                {names?.[i] ?? (ru ? `Фура ${i + 1}` : `Truck ${i + 1}`)}
              </th>
            ))}
            <th className="!text-center">{ru ? "Всего" : "Total"}</th>
            <th>{ru ? "шт" : "units"}</th>
            {baseline && <th>{ru ? "к плану" : "vs plan"}</th>}
          </tr>
        </thead>
        <tbody>
          {skus.map((s) => {
            const total = rowPallets(s.id);
            const diff = baseline ? total - (baseline[s.id] ?? 0) : 0;
            return (
              <tr key={s.id}>
                <td>
                  <SkuName name={s.name} />
                  <span className="ml-1 text-[10.5px] text-muted">{pn(s.pcsPerPallet)}/{ru ? "пал" : "pal"}</span>
                </td>
                {value.map((t, i) => (
                  <td key={i} className="!px-1 !text-center">
                    {readOnly ? (
                      <span className="pnum">{t[s.id] ? fmt(t[s.id]) : "—"}</span>
                    ) : (
                      <input
                        inputMode="decimal"
                        value={t[s.id] ? fmt(t[s.id]) : ""}
                        placeholder="0"
                        onChange={(e) => set(i, s.id, e.target.value)}
                        className="pnum w-[54px] rounded-md border border-border bg-surface px-1.5 py-1 text-right text-[12.5px]"
                        style={t[s.id] && !whole(t[s.id]) ? { borderColor: "var(--warn)" } : undefined}
                      />
                    )}
                  </td>
                ))}
                <td className="pnum !text-center font-bold">{total ? fmt(total) : "—"}</td>
                <td className="pnum text-muted">{total ? pn(total * s.pcsPerPallet) : "—"}</td>
                {baseline && (
                  <td className="pnum" style={{ color: Math.abs(diff) < 1e-6 ? "var(--muted)" : diff > 0 ? "var(--info)" : "var(--warn-ink)" }}>
                    {Math.abs(diff) < 1e-6 ? "—" : `${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))}`}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>{ru ? "Паллет" : "Pallets"}</td>
            {value.map((t, i) => (
              <td key={i} className="pnum !text-center">{fmt(palletsIn(t))}</td>
            ))}
            <td className="pnum !text-center">{fmt(value.reduce((a, t) => a + palletsIn(t), 0))}</td>
            <td />
            {baseline && <td />}
          </tr>
          <tr>
            <td>{ru ? `Мест из ${truckPlaces} · загрузка` : `Places of ${truckPlaces} · fill`}</td>
            {value.map((t, i) => {
              const places = placesOf(t);
              const fill = places / truckPlaces;
              const ok = fill >= minFill - 1e-9 && fill <= maxFill + 1e-9;
              return (
                <td key={i} className="pnum !text-center font-bold" style={{ color: ok ? "var(--ok-ink)" : "var(--warn-ink)", background: ok ? "var(--ok-soft)" : "var(--warn-soft)" }}>
                  {places.toFixed(1)}
                  <div className="text-[10.5px]">{pct(fill, ru)}</div>
                </td>
              );
            })}
            <td />
            <td />
            {baseline && <td />}
          </tr>
          <tr>
            <td>{ru ? "Штук" : "Units"}</td>
            {value.map((t, i) => (
              <td key={i} className="pnum !text-center text-muted">{pn(unitsIn(t))}</td>
            ))}
            <td className="pnum !text-center">{pn(value.reduce((a, t) => a + unitsIn(t), 0))}</td>
            <td />
            {baseline && <td />}
          </tr>
          <tr>
            <td>€</td>
            {value.map((t, i) => (
              <td key={i} className="pnum !text-center text-muted" title={eurRate ? `≈ ${((eurIn(t) * eurRate) / 1e9).toFixed(2)} ${ru ? "млрд сум" : "bn UZS"}` : undefined}>
                {pn(eurIn(t))}
              </td>
            ))}
            <td className="pnum !text-center">{pn(value.reduce((a, t) => a + eurIn(t), 0))}</td>
            <td />
            {baseline && <td />}
          </tr>
        </tfoot>
      </table>
      {!readOnly && canAddTrucks && (
        <div className="mt-1.5 flex gap-2">
          <button type="button" onClick={() => onChange([...value, {}])} className="rounded-md border border-border px-2.5 py-1 text-[12px] font-bold">
            {ru ? "+ фура" : "+ truck"}
          </button>
          {value.length > 1 && (
            <button type="button" onClick={() => onChange(value.slice(0, -1))} className="rounded-md border border-border px-2.5 py-1 text-[12px] font-bold">
              {ru ? "− последняя фура" : "− last truck"}
            </button>
          )}
        </div>
      )}
      <p className="mt-1.5 text-[11.5px] font-semibold text-muted">
        {ru
          ? `Зелёным — фура в пределах HQ (${pct(minFill, true)}–${pct(maxFill, true)}); AC/AR занимают 1,2 места, остальные 0,8 — для 32,4 мест нужно нечётное число паллет AC/AR. Дробные паллеты подсвечены.`
          : `Green — a truck within HQ's band (${pct(minFill, false)}–${pct(maxFill, false)}); AC/AR take 1.2 places, the rest 0.8 — 32.4 places need an odd number of AC/AR pallets. Part pallets are highlighted.`}
      </p>
    </div>
  );
}
