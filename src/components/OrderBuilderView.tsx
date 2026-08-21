"use client";

// Order builder: recommended quantities for the next order slot, live carton/
// pallet/weight math, the ≥98% truck-fill rule with top-up suggestions, the
// money card, and cover impact — per the approved Stitch mock. Saving writes
// the committed закуп (PlanningPurchase) for the slot's ship month.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, PageTitle } from "./ui";
import PlanningTabs from "./PlanningTabs";
import { IconAlert, IconCheck, IconDownload, IconPlus, IconTruck } from "./icons";
import { useT } from "@/lib/locale-context";
import { fmtN } from "@/lib/format";
import {
  projectSku,
  truckStats,
  unitsPerPallet,
  type OrderSlot,
  type PlanningSettings,
  type PlanningSkuIn,
  type SkuSituation,
} from "@/lib/planning/compute";
import { stageOf } from "@/lib/planning/model";

// indigo ramp for the truck-fill segments, one shade per product group
const GROUP_META: Array<{ key: string; label: string; color: string }> = [
  { key: "P1", label: "Platin 1", color: "#1f108e" },
  { key: "P2", label: "Platin 2", color: "#4f46b8" },
  { key: "P3", label: "Platin 3", color: "#8079d1" },
  { key: "Expert", label: "Expert", color: "#c7c3f0" },
];

const MONTH_RU = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTH_RU_N = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTH_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const monthName = (key: string, ru: boolean, genitive = false) => {
  const [y, m] = key.split("-").map(Number);
  const names = ru ? (genitive ? MONTH_RU : MONTH_RU_N) : MONTH_EN;
  return `${names[m - 1]} ${y}`;
};

const MIN_FILL = 0.98;

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

  const active = skus.filter((s) => s.active);
  const skusById = useMemo(() => Object.fromEntries(skus.map((s) => [s.id, s])), [skus]);

  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(active.map((s) => [s.id, purchases[s.id] ?? recommended[s.id] ?? 0]))
  );
  const [saved, setSaved] = useState(Object.keys(purchases).length > 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = active.map((s) => ({ skuId: s.id, qty: qty[s.id] ?? 0 }));
  const stats = truckStats(lines, skusById, settings);

  // cover impact: with vs without this order, at the arrival month; the
  // slot's already-committed закуп is stripped from the baseline so an edit
  // of a saved purchase is not double-counted
  const HORIZON = 14;
  const impact = useMemo(() => {
    return active
      .filter((s) => (qty[s.id] ?? 0) > 0)
      .map((s) => {
        const sit = situations[s.id];
        const arrivalsExSlot = {
          ...sit.arrivals,
          [slot.arrivalMonth]: Math.max(0, (sit.arrivals[slot.arrivalMonth] ?? 0) - (purchases[s.id] ?? 0)),
        };
        const before = projectSku({ ...sit, arrivals: arrivalsExSlot }, startMonth, HORIZON, settings);
        const withOrder: SkuSituation = {
          ...sit,
          arrivals: { ...arrivalsExSlot, [slot.arrivalMonth]: arrivalsExSlot[slot.arrivalMonth] + qty[s.id] },
        };
        const after = projectSku(withOrder, startMonth, HORIZON, settings);
        const at = slot.arrivalMonth;
        const coverBefore = before.cells.find((c) => c.monthKey === at)?.coverMonths ?? 0;
        const coverAfter = after.cells.find((c) => c.monthKey === at)?.coverMonths ?? 0;
        return { sku: s, coverBefore, coverAfter };
      })
      .filter((x) => Math.abs(x.coverAfter - x.coverBefore) > 0.05)
      .sort((a, b) => a.coverBefore - b.coverBefore)
      .slice(0, 6);
  }, [active, qty, situations, purchases, startMonth, settings, slot.arrivalMonth]);

  // top-up suggestions when below the 98% floor: +1 pallet of the lowest-cover SKUs
  const suggestions = useMemo(() => {
    if (stats.utilization >= MIN_FILL) return [];
    return active
      .filter((s) => unitsPerPallet(s) > 0 && s.priceEur > 0)
      .map((s) => {
        const sit = situations[s.id];
        const p = projectSku(sit, startMonth, HORIZON, settings);
        return { sku: s, cover: p.currentCover, units: unitsPerPallet(s) };
      })
      .filter((x) => x.cover < 24)
      .sort((a, b) => a.cover - b.cover)
      .slice(0, 3);
  }, [stats.utilization, active, situations, startMonth, settings]);

  const missingPallets = Math.max(0, Math.ceil((MIN_FILL - stats.utilization) * settings.truckPallets));
  const overPallets = Math.max(0, Math.ceil((stats.utilization - 1) * settings.truckPallets));

  async function save() {
    setSaving(true);
    setError(null);
    // qty 0 is sent for skus whose saved закуп was cleared — the API deletes those lines
    const payload = lines.filter((l) => l.qty > 0 || purchases[l.skuId] !== undefined);
    const res = await fetch("/api/planning/purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shipMonth: slot.shipMonth, lines: payload }),
    });
    const body = (await res.json()) as { ok?: boolean; error?: string };
    setSaving(false);
    if (!res.ok || !body.ok) {
      setError(body.error ?? "error");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  const setQtyOf = (skuId: string, v: string) => {
    const n = Number(v.replace(/[^\d]/g, ""));
    setQty((q) => ({ ...q, [skuId]: Number.isFinite(n) ? n : 0 }));
  };

  const fillPct = stats.utilization * 100;
  const fillTone = stats.utilization >= MIN_FILL && stats.utilization <= 1.001 ? "ok" : "warn";

  // pallets per product group — the truck bar's segments
  const segments = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const s of active) {
      const q = qty[s.id] ?? 0;
      if (q <= 0 || s.pcsPerPallet <= 0) continue;
      const g = stageOf(s.name) ?? "Expert";
      acc[g] = (acc[g] ?? 0) + q / s.pcsPerPallet;
    }
    return GROUP_META.filter((g) => (acc[g.key] ?? 0) > 0.05).map((g) => ({
      ...g,
      pallets: acc[g.key],
      pct: (acc[g.key] / Math.max(1, settings.truckPallets)) * 100,
    }));
  }, [active, qty, settings.truckPallets]);

  return (
    <div className="pb-16">
      <PageTitle
        title={`${ru ? "Заказ" : "Order"} ${label} · ${ru ? "дедлайн" : "deadline"} ${new Date(
          slot.deadline + "T00:00:00"
        ).toLocaleDateString(ru ? "ru-RU" : "en-GB", { day: "numeric", month: "long" })}`}
        subtitle={
          ru
            ? `заказ → производство (${settings.productionLeadMonths} мес) → транзит (~5 недель) → продажа с ${monthName(slot.arrivalMonth, true, true)}`
            : `order → production (${settings.productionLeadMonths} mo) → transit (~5 weeks) → selling from ${monthName(slot.arrivalMonth, false)}`
        }
        right={
          <Link href="/planning">
            <Button variant="secondary">← {ru ? "К планированию" : "Back to planning"}</Button>
          </Link>
        }
      />
      <PlanningTabs />

      {/* truck-fill hero — the load is the page's headline */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-8 px-6 py-5">
          <div className="min-w-40">
            <div className="label-caps">{ru ? "Загрузка фуры" : "Truck fill"}</div>
            <div className={`num font-display text-[32px] font-extrabold leading-tight ${fillTone === "ok" ? "text-ok" : "text-warn"}`}>
              {fillPct.toFixed(1)}%
            </div>
            <div className="num text-[11.5px] text-muted">
              {stats.pallets.toFixed(1)} / {settings.truckPallets} {ru ? "паллет" : "pallets"} · {fmtN(stats.grossKg)} /{" "}
              {fmtN(settings.truckMaxKg)} {ru ? "кг" : "kg"}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative h-[26px] w-full rounded-lg bg-surface-low">
              <div className="absolute inset-0 flex overflow-hidden rounded-lg">
                {segments.map((seg) => (
                  <div
                    key={seg.key}
                    title={`${seg.label}: ${seg.pallets.toFixed(1)} ${ru ? "паллет" : "pallets"}`}
                    style={{ width: `${Math.min(100, seg.pct)}%`, background: seg.color }}
                  />
                ))}
              </div>
              <div className="absolute -top-1.5 h-[38px] w-0.5 bg-danger" style={{ left: `${MIN_FILL * 100}%` }} />
              <div
                className="absolute -top-5 text-[9.5px] font-bold text-danger"
                style={{ left: `${MIN_FILL * 100 - 4}%` }}
              >
                {ru ? "мин 98%" : "min 98%"}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {segments.map((seg) => (
                <span key={seg.key} className="flex items-center gap-1.5 text-[10.5px] text-muted">
                  <span className="h-2 w-2 rounded-sm" style={{ background: seg.color }} />
                  {seg.label} · <span className="num">{seg.pallets.toFixed(1)}</span> {ru ? "пал" : "pal"}
                </span>
              ))}
            </div>
          </div>
          <div className="flex min-w-72 flex-col gap-2.5">
            {stats.utilization < MIN_FILL && (
              <div className="flex items-start gap-1.5 text-[12px] font-medium text-warn">
                <IconAlert size={14} className="mt-0.5 shrink-0" />
                <span>
                  {ru
                    ? `Минимум 98% — иначе перевозчик не гарантирует сохранность. Не хватает ~${missingPallets} паллет.`
                    : `Minimum 98% — below that transport safety is the buyer's risk. ~${missingPallets} pallets short.`}
                </span>
              </div>
            )}
            {stats.utilization > 1.001 && (
              <div className="flex items-start gap-1.5 text-[12px] font-medium text-danger">
                <IconAlert size={14} className="mt-0.5 shrink-0" />
                <span>
                  {ru
                    ? `Не влезает в фуру — уберите ~${overPallets} паллет (лимит: ${stats.binding === "weight" ? "вес" : "паллеты"}).`
                    : `Over capacity — remove ~${overPallets} pallets (limit: ${stats.binding}).`}
                </span>
              </div>
            )}
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {suggestions.map(({ sku, units }) => (
                  <button
                    key={sku.id}
                    onClick={() => setQty((prev) => ({ ...prev, [sku.id]: (prev[sku.id] ?? 0) + units }))}
                    className="flex items-center gap-1 rounded-full border border-accent-soft bg-accent-soft-bg px-3 py-1.5 text-[12px] font-semibold text-accent transition-colors hover:border-accent"
                  >
                    <IconPlus size={11} /> {sku.name}, 1 {ru ? "паллета" : "pallet"}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        {/* order table */}
        <Card className="overflow-hidden self-start">
          <table className="tbl w-full">
            <thead>
              <tr>
                <th>{ru ? "Товар" : "Product"}</th>
                <th className="text-right">{ru ? "Рекомендовано" : "Recommended"}</th>
                <th className="text-right">{ru ? "Заказ, шт" : "Order, pcs"}</th>
                <th className="text-right">{ru ? "Коробов" : "Cartons"}</th>
                <th className="text-right">{ru ? "Паллет" : "Pallets"}</th>
                <th className="text-right">{ru ? "Вес брутто, кг" : "Gross, kg"}</th>
                <th className="text-right">{ru ? "Сумма €" : "Value €"}</th>
              </tr>
            </thead>
            <tbody>
              {active.map((s) => {
                const q = qty[s.id] ?? 0;
                const rec = recommended[s.id] ?? 0;
                if (rec === 0 && q === 0 && !s.productId && s.priceEur === 0) return null;
                return (
                  <tr key={s.id} className={q > 0 ? "" : "opacity-55"}>
                    <td>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-[11px] text-muted">
                        {ru ? "Арт" : "Art"}: {s.article}
                        {s.priceEur > 0 && ` · €${s.priceEur}`}
                      </div>
                    </td>
                    <td className="num cursor-pointer text-right text-muted" title={ru ? "Подставить" : "Apply"}
                        onClick={() => setQty((prev) => ({ ...prev, [s.id]: rec }))}>
                      {fmtN(rec)}
                    </td>
                    <td className="text-right">
                      <input
                        className="num w-24 rounded border border-border bg-surface px-2 py-1.5 text-right text-[13px] focus:border-accent focus:outline-none"
                        value={q === 0 ? "" : fmtN(q)}
                        onChange={(e) => setQtyOf(s.id, e.target.value)}
                        placeholder="0"
                      />
                    </td>
                    <td className="num text-right">{s.pcsPerCarton > 0 ? fmtN(q / s.pcsPerCarton) : "—"}</td>
                    <td className="num text-right">{s.pcsPerPallet > 0 ? (q / s.pcsPerPallet).toFixed(1) : "—"}</td>
                    <td className="num text-right">{fmtN(q * s.grossKgPerUnit)}</td>
                    <td className="num text-right">{fmtN(q * s.priceEur)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-accent-soft-bg font-semibold">
                <td>{ru ? "Итого" : "Total"}</td>
                <td />
                <td className="num text-right">{fmtN(stats.totalUnits)}</td>
                <td className="num text-right">{fmtN(stats.cartons)}</td>
                <td className="num text-right">{stats.pallets.toFixed(1)}</td>
                <td className="num text-right">{fmtN(stats.grossKg)}</td>
                <td className="num text-right text-accent">€ {fmtN(stats.eurTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </Card>

        {/* side cards */}
        <div className="space-y-4">
          <Card>
            <CardHeader title={ru ? "Деньги" : "Money"} />
            <div className="grid grid-cols-2 gap-4 px-5 pb-5">
              <div>
                <div className="label-caps mb-1">{ru ? "Сумма заказа" : "Order value"}</div>
                <div className="num font-display text-[22px] font-bold">€{fmtN(stats.eurTotal)}</div>
              </div>
              <div>
                <div className="label-caps mb-1">{ru ? "Эквивалент" : "Equivalent"}</div>
                <div className="num text-[15px] font-semibold text-muted">
                  {eurRate > 0 ? `≈ ${fmtN(stats.eurTotal * eurRate)} ${ru ? "сум" : "UZS"}` : "—"}
                </div>
              </div>
              <div className="col-span-2 border-t border-border pt-3">
                <div className="label-caps mb-1">{ru ? "Предоплата" : "Prepayment"}</div>
                <div className="text-[14px] font-medium">{monthName(slot.shipMonth, ru)}</div>
              </div>
            </div>
          </Card>

          {impact.length > 0 && (
            <Card>
              <CardHeader
                title={ru ? "Влияние на покрытие" : "Cover impact"}
                desc={ru ? `Покрытие в ${monthName(slot.arrivalMonth, true, true).split(" ")[0]}е после прихода` : "Cover at arrival month"}
              />
              <div className="space-y-2 px-5 pb-5">
                {impact.map(({ sku, coverBefore, coverAfter }) => (
                  <div key={sku.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[13px]">
                    <span className="font-medium">{sku.name}</span>
                    <span className="num">
                      <span className={coverBefore < 4 ? "text-danger" : "text-muted"}>{coverBefore.toFixed(1)}</span>
                      <span className="mx-1.5 text-muted">→</span>
                      <span className={coverAfter >= 4 ? "text-ok" : "text-warn"}>
                        {coverAfter.toFixed(1)} {ru ? "мес" : "mo"}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="flex items-center gap-2">
            {saved && (
              <a href={`/api/export/planning-order?ship=${slot.shipMonth}`} className="flex-1">
                <Button variant="secondary" className="w-full">
                  <IconDownload size={14} /> {ru ? "Экспорт для Humana" : "Export for Humana"}
                </Button>
              </a>
            )}
            <Button
              className="flex-1"
              disabled={saving || stats.totalUnits === 0}
              onClick={() => {
                if (
                  stats.utilization < MIN_FILL &&
                  !confirm(
                    ru
                      ? `Фура заполнена на ${fillPct.toFixed(1)}% (ниже 98%). Всё равно сохранить?`
                      : `Truck is ${fillPct.toFixed(1)}% full (below 98%). Save anyway?`
                  )
                )
                  return;
                void save();
              }}
            >
              {saving
                ? ru ? "Сохранение…" : "Saving…"
                : `${ru ? "Сохранить закуп" : "Save purchase"} (${ru ? "слот" : "slot"} ${slot.shipMonth.slice(5)}-${slot.shipMonth.slice(0, 4)})`}
            </Button>
          </div>
          {saved && !saving && (
            <div className="flex items-center gap-1.5 text-[12.5px] text-ok">
              <IconCheck size={13} /> {ru ? "Закуп сохранён — учтён в прогнозе покрытия" : "Purchase saved — reflected in the cover projection"}
            </div>
          )}
          {error && <div className="text-[12.5px] text-danger">{error}</div>}
          <div className="flex items-start gap-1.5 text-[11.5px] leading-snug text-muted">
            <IconTruck size={12} className="mt-0.5 shrink-0" />
            {ru
              ? `Рекомендации: спрос на горизонте прихода + страховой запас ${settings.minCoverMonths} мес − прогнозный остаток − уже оформленный закуп; округлено до коробов.`
              : `Recommendations: demand over the arrival horizon + ${settings.minCoverMonths}-month safety floor − projected stock − committed purchases; rounded to cartons.`}
          </div>
        </div>
      </div>
    </div>
  );
}
