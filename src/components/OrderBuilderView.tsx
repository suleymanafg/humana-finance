"use client";

// «Заказ» — built to the owner's design canvas: the line-by-line order for the
// next IBP deadline with live carton/pallet/weight/cost math, the ≥98 %
// truck-fill rule with one-click top-ups, and the commit card. Saving writes
// the committed закуп (PlanningPurchase) for the slot's ship month.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { dstr, monthLong, pCover, pn, pnSigned, splitPack } from "@/lib/planning/ui-format";
import {
  projectSku,
  truckStats,
  unitsPerPallet,
  type OrderSlot,
  type PlanningSettings,
  type PlanningSkuIn,
  type SkuSituation,
} from "@/lib/planning/compute";

const MIN_FILL = 0.98;
const HORIZON = 14;

export default function OrderBuilderView({
  skus,
  situations,
  slot,
  label,
  startMonth,
  settings,
  eurRate,
  recommended,
  purchases,
}: {
  skus: PlanningSkuIn[];
  situations: Record<string, SkuSituation>;
  slot: OrderSlot;
  label: string;
  startMonth: string;
  settings: PlanningSettings;
  eurRate: number;
  recommended: Record<string, number>;
  /** committed закуп already saved for this slot's ship month, by skuId */
  purchases: Record<string, number>;
}) {
  const { locale } = useT();
  const ru = locale === "ru";
  const router = useRouter();

  const active = useMemo(() => skus.filter((s) => s.active), [skus]);
  const skusById = useMemo(() => Object.fromEntries(skus.map((s) => [s.id, s])), [skus]);

  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(active.map((s) => [s.id, purchases[s.id] ?? recommended[s.id] ?? 0]))
  );
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [force, setForce] = useState(false);

  const lines = active.map((s) => ({ skuId: s.id, qty: qty[s.id] ?? 0 }));
  const stats = truckStats(lines, skusById, settings);

  // the canvas's truck model: whole trucks, and the LAST one must clear 98 %
  const trucksNeeded = Math.max(1, Math.ceil(stats.pallets / settings.truckPallets));
  const lastPallets = stats.pallets - (trucksNeeded - 1) * settings.truckPallets;
  const lastFill = settings.truckPallets > 0 ? lastPallets / settings.truckPallets : 0;
  const fillOk = stats.pallets <= 0 || lastFill >= MIN_FILL;
  const missingPallets = Math.max(0, Math.ceil((MIN_FILL - lastFill) * settings.truckPallets));

  // cover at the arrival month, per SKU, with this order landed — the slot's
  // already-committed закуп is stripped from the baseline so editing a saved
  // purchase is not double-counted
  const cover = useMemo(() => {
    const per: Record<string, number> = {};
    let stockAfter = 0;
    let demand = 0;
    for (const s of active) {
      const sit = situations[s.id];
      const arrivalsExSlot = {
        ...sit.arrivals,
        [slot.arrivalMonth]: Math.max(0, (sit.arrivals[slot.arrivalMonth] ?? 0) - (purchases[s.id] ?? 0)),
      };
      const after = projectSku(
        {
          ...sit,
          arrivals: { ...arrivalsExSlot, [slot.arrivalMonth]: arrivalsExSlot[slot.arrivalMonth] + (qty[s.id] ?? 0) },
        },
        startMonth,
        HORIZON,
        settings
      );
      const cell = after.cells.find((c) => c.monthKey === slot.arrivalMonth);
      per[s.id] = cell?.coverMonths ?? 0;
      stockAfter += Math.max(0, cell?.closing ?? 0);
      demand += after.avgDemandPerMonth;
    }
    return { per, total: demand > 0 ? stockAfter / demand : 0 };
  }, [active, qty, situations, purchases, startMonth, settings, slot.arrivalMonth]);

  // top-up suggestions when the last truck is short: +1 pallet of the
  // lowest-cover SKUs, enough of them to clear the floor
  const suggestions = useMemo(() => {
    if (fillOk) return [];
    return active
      .filter((s) => unitsPerPallet(s) > 0 && s.priceEur > 0)
      .map((s) => {
        const p = projectSku(situations[s.id], startMonth, HORIZON, settings);
        return { sku: s, cover: p.currentCover, units: unitsPerPallet(s) * Math.max(1, missingPallets) };
      })
      .filter((x) => x.cover < 24)
      .sort((a, b) => a.cover - b.cover)
      .slice(0, 2);
  }, [fillOk, active, situations, startMonth, settings, missingPallets]);

  const totals = active.reduce(
    (a, s) => {
      const q = qty[s.id] ?? 0;
      return {
        rec: a.rec + (recommended[s.id] ?? 0),
        qty: a.qty + q,
        cartons: a.cartons + (s.pcsPerCarton > 0 ? q / s.pcsPerCarton : 0),
        pallets: a.pallets + (s.pcsPerPallet > 0 ? q / s.pcsPerPallet : 0),
        kg: a.kg + q * s.grossKgPerUnit,
        eur: a.eur + q * s.priceEur,
      };
    },
    { rec: 0, qty: 0, cartons: 0, pallets: 0, kg: 0, eur: 0 }
  );

  const setQtyOf = (skuId: string, v: string) => {
    const n = Number(v.replace(/[^\d]/g, ""));
    setQty((q) => ({ ...q, [skuId]: Number.isFinite(n) ? n : 0 }));
    setDirty(true);
    setSavedAt(null);
    setError(null);
  };

  const useRecommendation = () => {
    setQty(Object.fromEntries(active.map((s) => [s.id, recommended[s.id] ?? 0])));
    setDirty(true);
    setSavedAt(null);
    setError(null);
  };

  const addUnits = (skuId: string, units: number) => {
    setQty((q) => ({ ...q, [skuId]: (q[skuId] ?? 0) + units }));
    setDirty(true);
    setSavedAt(null);
    setError(null);
  };

  async function save() {
    if (!fillOk && !force) {
      setError(
        ru
          ? `Последняя фура загружена на ${Math.round(lastFill * 100)} %, ниже минимума 98 %. Добавьте ≈${missingPallets} паллет.`
          : `The last truck is ${Math.round(lastFill * 100)} % full, below the 98 % minimum. Add about ${missingPallets} pallets.`
      );
      return;
    }
    setSaving(true);
    setError(null);
    // qty 0 is sent for skus whose saved закуп was cleared — the API deletes those lines
    const payload = lines.filter((l) => l.qty > 0 || purchases[l.skuId] !== undefined);
    const res = await fetch("/api/planning/purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shipMonth: slot.shipMonth, lines: payload }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setSaving(false);
    if (!res.ok || !body.ok) {
      setError(body.error ?? (ru ? "не удалось сохранить" : "save failed"));
      return;
    }
    setDirty(false);
    setForce(false);
    const now = new Date();
    setSavedAt(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
    router.refresh();
  }

  return (
    <div>
      <div className="mb-3.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[22px] font-extrabold tracking-[-0.5px]">{ru ? "Заказ" : "Order"}</h1>
        <p className="text-[13px] font-semibold text-muted">
          {ru
            ? "Что именно я заказываю в этот дедлайн и уедет ли это?"
            : "Exactly what am I ordering in this deadline, and will it ship?"}
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-3.5">
        <div className="pcard min-w-0 flex-[1_1_660px] overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b px-[18px] py-3" style={{ borderColor: "var(--hair)" }}>
            <h2 className="text-[14px] font-extrabold">
              {ru ? "Отгрузка " : "Shipping "}
              {monthLong(slot.shipMonth, ru)}
            </h2>
            <span className="text-[11.5px] font-semibold text-muted">
              {ru ? "заказ в IBP до " : "IBP order by "}
              <span className="pnum">{dstr(slot.deadline)}</span> · {label}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={useRecommendation}
              className="rounded-lg border px-3 py-1.5 text-[12px] font-extrabold transition-colors hover:bg-accent-soft-bg"
              style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
            >
              {ru ? "Подставить рекомендацию" : "Use recommendation"}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="ptable" style={{ minWidth: 880 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 190 }}>{ru ? "Продукт" : "Product"}</th>
                  <th>{ru ? "Рекомендация" : "Recommended"}</th>
                  <th className="col-act">{ru ? "Заказываю" : "Ordering"}</th>
                  <th>{ru ? "Коробки" : "Cartons"}</th>
                  <th>{ru ? "Паллеты" : "Pallets"}</th>
                  <th>{ru ? "Вес, кг" : "Weight, kg"}</th>
                  <th>{ru ? "Сумма, €" : "Cost, €"}</th>
                  <th style={{ paddingRight: 18 }}>{ru ? "Покрытие после" : "Cover after"}</th>
                </tr>
              </thead>
              <tbody>
                {active.map((s) => {
                  const { name, pack } = splitPack(s.name);
                  const q = qty[s.id] ?? 0;
                  const rec = recommended[s.id] ?? 0;
                  const diff = q - rec;
                  const after = cover.per[s.id] ?? 0;
                  const afterOk = after >= settings.minCoverMonths;
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-bold">{name}</span>
                          {pack && <span className="text-[11px] font-bold" style={{ color: "var(--sky)" }}>{pack}</span>}
                        </div>
                        <div className="mt-0.5 text-[10.5px] font-semibold" style={{ color: "var(--faint)" }}>
                          {s.pcsPerPallet > 0 && `${pn(s.pcsPerPallet)} ${ru ? "на паллете" : "per pallet"}`}
                          {s.pcsPerPallet > 0 && s.pcsPerCarton > 0 && " · "}
                          {s.pcsPerCarton > 0 && `${s.pcsPerCarton} ${ru ? "в коробке" : "per carton"}`}
                        </div>
                      </td>
                      <td className="pnum text-[13px] text-muted">{rec > 0 ? pn(rec) : "—"}</td>
                      <td className="col-act" style={{ padding: "5px 10px" }}>
                        <input
                          type="number"
                          step={s.pcsPerCarton > 0 ? s.pcsPerCarton : 1}
                          min={0}
                          value={q === 0 ? "" : q}
                          onChange={(e) => setQtyOf(s.id, e.target.value)}
                          className="pinput font-bold"
                        />
                        <div
                          className="mt-0.5 text-[10.5px] font-bold"
                          style={{
                            color:
                              diff === 0 ? "var(--faint)" : diff > 0 ? "var(--accent)" : "var(--warn)",
                          }}
                        >
                          {diff === 0
                            ? ru ? "по рекомендации" : "as recommended"
                            : pnSigned(diff)}
                        </div>
                      </td>
                      <td className="pnum text-[12.5px] text-muted">
                        {s.pcsPerCarton > 0 ? pn(q / s.pcsPerCarton) : "—"}
                      </td>
                      <td className="pnum text-[12.5px]">
                        {s.pcsPerPallet > 0 ? (q / s.pcsPerPallet).toFixed(1) : "—"}
                      </td>
                      <td className="pnum text-[12.5px] text-muted">{pn(q * s.grossKgPerUnit)}</td>
                      <td className="pnum text-[12.5px]">{pn(q * s.priceEur)}</td>
                      <td style={{ paddingRight: 18 }}>
                        <span
                          className="ppill pnum"
                          style={{
                            background: afterOk ? "var(--ok-soft)" : "var(--warn-soft)",
                            color: afterOk ? "var(--ok)" : "var(--warn-ink)",
                            fontSize: "12.5px",
                          }}
                        >
                          {pCover(after)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>{ru ? "Итого" : "Total"}</td>
                  <td className="pnum text-[13px] text-muted">{pn(totals.rec)}</td>
                  <td className="pnum col-act text-[13.5px]" style={{ color: "var(--accent)" }}>
                    {pn(totals.qty)}
                  </td>
                  <td className="pnum text-[13px]">{pn(totals.cartons)}</td>
                  <td className="pnum text-[13px]">{totals.pallets.toFixed(1)}</td>
                  <td className="pnum text-[13px]">{pn(totals.kg)}</td>
                  <td className="pnum text-[13px]">{pn(totals.eur)}</td>
                  <td style={{ paddingRight: 18 }} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="flex flex-[0_1_340px] flex-col gap-3.5" style={{ minWidth: 290 }}>
          <div className="pcard px-[18px] py-4">
            <h2 className="text-[13.5px] font-extrabold">{ru ? "Загрузка фур" : "Truck loading"}</h2>
            <p className="mt-0.5 text-[12px] font-semibold text-muted">
              {settings.truckPallets} {ru ? "паллет" : "pallets"} / {(settings.truckMaxKg / 1000).toFixed(1)}{" "}
              {ru ? "т · минимум 98 %" : "t · 98 % minimum"}
            </p>

            <div className="mt-3.5 flex flex-wrap gap-1.5">
              {Array.from({ length: trucksNeeded }, (_, i) => {
                const pallets = i < trucksNeeded - 1 ? settings.truckPallets : Math.max(0, lastPallets);
                const pct = (pallets / settings.truckPallets) * 100;
                const ok = pct >= MIN_FILL * 100;
                return (
                  <div key={i} className="w-[38px]">
                    <div
                      className="flex h-[52px] flex-col justify-end overflow-hidden rounded-[7px] border"
                      style={{
                        borderColor: ok ? "var(--border-strong)" : "var(--warn-border)",
                        background: "var(--surface-low)",
                      }}
                    >
                      <div
                        style={{
                          height: `${Math.max(4, Math.min(100, pct))}%`,
                          background: ok ? "var(--accent)" : "var(--warn)",
                        }}
                      />
                    </div>
                    <div
                      className="pnum mt-1 text-center text-[10px] font-bold"
                      style={{ color: ok ? "var(--accent)" : "var(--warn)" }}
                    >
                      {Math.round(pallets)}/{settings.truckPallets}
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              className="mt-3 rounded-[10px] border px-3 py-2.5"
              style={{
                background: fillOk ? "var(--ok-soft)" : "var(--warn-soft)",
                borderColor: fillOk ? "var(--ok-border)" : "var(--warn-border)",
              }}
            >
              <div
                className="text-[12px] font-extrabold leading-snug"
                style={{ color: fillOk ? "var(--ok-ink)" : "var(--warn-ink)" }}
              >
                {stats.pallets <= 0
                  ? ru ? "Заказ пока пустой." : "The order is still empty."
                  : fillOk
                    ? ru
                      ? `Все ${trucksNeeded} фур(ы) проходят минимум 98 % — заказ уедет.`
                      : `All ${trucksNeeded} truck(s) meet the 98 % minimum — this order can ship.`
                    : ru
                      ? `Последняя фура загружена на ${Math.round(lastFill * 100)} %. Так она не уедет — нужно ≈${missingPallets} паллет.`
                      : `Last truck is ${Math.round(lastFill * 100)} % full. It cannot depart — add about ${missingPallets} pallets.`}
              </div>

              {suggestions.length > 0 && (
                <div className="mt-2.5 flex flex-col gap-1.5">
                  {suggestions.map((s) => {
                    const { name, pack } = splitPack(s.sku.name);
                    return (
                      <button
                        key={s.sku.id}
                        type="button"
                        onClick={() => addUnits(s.sku.id, s.units)}
                        className="rounded-lg border bg-surface px-2.5 py-1.5 text-left text-[11.5px] font-bold transition-colors hover:border-accent hover:text-accent"
                        style={{ borderColor: "var(--border-strong)" }}
                      >
                        {ru ? "Добавить " : "Add "}
                        <span className="pnum">{pn(s.units)}</span> × {name} {pack}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-2.5 flex justify-between text-[12px] font-semibold text-muted">
              <span>{ru ? "Вес" : "Weight"}</span>
              <span className="pnum font-bold" style={{ color: "var(--foreground)" }}>
                {(stats.grossKg / 1000).toFixed(1)} / {((trucksNeeded * settings.truckMaxKg) / 1000).toFixed(1)}{" "}
                {ru ? "т" : "t"}
              </span>
            </div>
          </div>

          <div className="pcard px-[18px] py-4">
            <h2 className="text-[13.5px] font-extrabold">{ru ? "Подтверждение заказа" : "Commit order"}</h2>

            <div className="mt-2.5 flex items-baseline justify-between">
              <span className="text-[12.5px] font-bold text-muted">{ru ? "Сумма заказа" : "Order cost"}</span>
              <span className="pnum text-[20px] font-bold tracking-[-0.6px]">€{pn(totals.eur)}</span>
            </div>
            {eurRate > 0 && (
              <div className="pnum mt-0.5 text-right text-[11.5px] font-semibold text-muted">
                ≈ {pn(totals.eur * eurRate)} {ru ? "сум" : "UZS"}
              </div>
            )}

            <div className="mt-1.5 flex items-baseline justify-between">
              <span className="text-[12.5px] font-bold text-muted">
                {ru ? "Покрытие после прихода" : "Cover after arrival"}
              </span>
              <span
                className="pnum text-[14px] font-bold"
                style={{ color: cover.total < settings.minCoverMonths ? "var(--warn)" : "var(--ok)" }}
              >
                {pCover(cover.total)} {ru ? "мес." : "mo."}
              </span>
            </div>

            {dirty && (
              <div className="mt-3 flex items-center gap-2 text-[12px] font-bold" style={{ color: "var(--warn-ink)" }}>
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: "var(--warn)" }} />
                {ru ? "Есть несохранённые изменения" : "Unsaved changes"}
              </div>
            )}
            {savedAt && !dirty && (
              <div className="mt-3 text-[12px] font-bold" style={{ color: "var(--ok)" }}>
                {ru ? `Подтверждено в ${savedAt}` : `Committed at ${savedAt}`}
              </div>
            )}
            {error && (
              <div
                className="mt-3 rounded-[9px] border px-3 py-2.5 text-[11.5px] font-bold leading-snug"
                style={{ background: "var(--danger-soft)", borderColor: "var(--danger-border)", color: "var(--danger)" }}
              >
                {error}
                {!fillOk && (
                  <button
                    type="button"
                    onClick={() => {
                      setForce(true);
                      setError(null);
                    }}
                    className="mt-1.5 block underline"
                  >
                    {ru ? "Всё равно сохранить" : "Save anyway"}
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="mt-3 w-full rounded-[9px] px-4 py-2.5 text-[13px] font-extrabold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: "var(--accent)" }}
            >
              {saving
                ? ru ? "Сохранение…" : "Saving…"
                : force
                  ? ru ? "Подтвердить несмотря на загрузку" : "Commit despite the fill"
                  : ru ? "Подтвердить заказ" : "Commit order"}
            </button>

            <p className="mt-2.5 text-[11.5px] font-semibold leading-snug text-muted">
              {ru ? "После подтверждения заказ попадает в " : "Once committed the order is recorded in "}
              <Link href="/planning/plan" className="font-bold text-accent hover:underline">
                {ru ? "«План (IBP)»" : "Plan (IBP)"}
              </Link>
              {ru ? " как заказ партнёра на отгрузку " : " as the partner order shipping in "}
              {monthLong(slot.shipMonth, ru)}.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
