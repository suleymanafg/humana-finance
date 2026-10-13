"use client";

// «Что делать» — supply planning's one working screen. Two decisions, each
// stated in trucks, money and a date: what to pick up from DMK now (already
// ordered, paid this week) and what to enter in IBP by the deadline (the
// production order four months out). Below them, month by month, whether the
// stock lasts with both done, and only the checks that change the answer.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { dstr, monthLong, monthShort, pn, splitPack } from "@/lib/planning/ui-format";
import type { DemandBasis, SupplyCheck, SupplyPlan, TruckPlan } from "@/lib/planning/supply";

export interface SupplyViewProps {
  plans: Record<DemandBasis, SupplyPlan>;
  names: Record<string, string>; // skuId -> short name
  checks: SupplyCheck[];
  eurRate: number;
  today: string;
  summary: { onHand: number; transit: number; atDmk: number; salesPerMonth: number };
  isAdmin: boolean;
}

function trucksWord(n: number, ru: boolean): string {
  if (!ru) return n === 1 ? "truck" : "trucks";
  const k = n % 100;
  const last = n % 10;
  if (k > 10 && k < 20) return "фур";
  return last === 1 ? "фура" : last >= 2 && last <= 4 ? "фуры" : "фур";
}

const uzs = (eur: number, rate: number, ru: boolean) =>
  rate > 0 ? `≈ ${(eur * rate / 1e9).toFixed(1).replace(".", ru ? "," : ".")} ${ru ? "млрд сум" : "bn UZS"}` : "";

function dayMonth(iso: string, ru: boolean): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(ru ? "ru-RU" : "en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}

function Headline({ plan, ru, empty }: { plan: TruckPlan; ru: boolean; empty: string }) {
  if (plan.shape === "none") return <div className="text-[30px] font-extrabold leading-tight">{empty}</div>;
  if (plan.shape === "partial")
    return (
      <div className="text-[30px] font-extrabold leading-tight">
        {ru ? "Меньше фуры" : "Under a truck"}{" "}
        <span className="text-[16px] font-bold text-muted">· {plan.pallets.toFixed(0)} {ru ? "паллет" : "pallets"}</span>
      </div>
    );
  return (
    <div className="text-[30px] font-extrabold leading-tight">
      <span className="pnum">{plan.trucks}</span> {trucksWord(plan.trucks, ru)}
    </div>
  );
}

function Lines({
  plan,
  names,
  ru,
  extra,
}: {
  plan: TruckPlan;
  names: Record<string, string>;
  ru: boolean;
  extra?: { header: string; value: (skuId: string) => number | null };
}) {
  if (plan.lines.length === 0) return null;
  return (
    <table className="ptable mt-3 text-[12.5px]">
      <thead>
        <tr>
          <th>{ru ? "Товар" : "Product"}</th>
          <th>{ru ? "шт" : "units"}</th>
          <th>{ru ? "паллет" : "pallets"}</th>
          {extra && <th>{extra.header}</th>}
        </tr>
      </thead>
      <tbody>
        {plan.lines
          .slice()
          .sort((a, b) => b.units - a.units)
          .map((l) => {
            const { name, pack } = splitPack(names[l.skuId] ?? l.skuId);
            const x = extra?.value(l.skuId);
            return (
              <tr key={l.skuId}>
                <td>
                  <span className="font-bold">{name}</span> <span className="text-[11px] font-bold" style={{ color: "var(--sky)" }}>{pack}</span>
                  {l.topUp > 0 && (
                    <span className="ppill ml-2" style={{ background: "var(--info-soft)", color: "var(--info)" }}>
                      {ru ? `+${pn(l.topUp)} дозагрузка` : `+${pn(l.topUp)} to fill`}
                    </span>
                  )}
                </td>
                <td className="pnum">{pn(l.units)}</td>
                <td className="pnum">{l.pallets.toFixed(1)}</td>
                {extra && <td className="pnum text-muted">{x == null ? "—" : pn(x)}</td>}
              </tr>
            );
          })}
      </tbody>
      <tfoot>
        <tr>
          <td>{ru ? "Итого" : "Total"}</td>
          <td className="pnum">{pn(plan.units)}</td>
          <td className="pnum">{plan.pallets.toFixed(1)}</td>
          {extra && <td className="pnum text-muted">{pn(plan.lines.reduce((t, l) => t + (extra.value(l.skuId) ?? 0), 0))}</td>}
        </tr>
      </tfoot>
    </table>
  );
}

function ShapeNote({ plan, ru }: { plan: TruckPlan; ru: boolean }) {
  const pct = `${Math.round(plan.fill * 100)}%`;
  const text =
    plan.shape === "trimmed"
      ? ru
        ? `Срезано до целых фур (загрузка ${pct}) — урезан товар с самым большим запасом.`
        : `Cut to whole trucks (${pct} full) — from the product with the most cover.`
      : plan.shape === "topped"
        ? ru
          ? `Дозагружено до ${pct}: последняя фура заполнена товаром, которому запас нужнее всего.`
          : `Filled to ${pct}: the last truck topped up with what needs cover most.`
        : plan.shape === "partial"
          ? ru
            ? "Не набирается полная фура (нужно ≥98%). Подождите и заберите вместе со следующей поставкой — или дозагрузите."
            : "Not enough for a full truck (≥98% needed). Wait and combine with the next one — or fill it up."
          : plan.shape === "full"
            ? ru
              ? `Загрузка ${pct}.`
              : `${pct} full.`
            : "";
  return text ? <p className="mt-2 text-[12px] font-semibold text-muted">{text}</p> : null;
}

export default function SupplyView({ plans, names, checks, eurRate, today, summary, isAdmin }: SupplyViewProps) {
  const { locale } = useT();
  const ru = locale === "ru";
  const router = useRouter();
  const [basis, setBasis] = useState<DemandBasis>("sales");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const plan = plans[basis];
  const { pickup, ibp } = plan;
  const nm = (id: string) => names[id] ?? id;

  const linesParam = (p: TruckPlan) => p.lines.map((l) => `${l.skuId}:${Math.round(l.units)}`).join(",");

  async function saveIbp() {
    if (saving || ibp.lines.length === 0) return;
    const msg = ru
      ? `Записать в план заказ на ${monthLong(ibp.shipMonth, true)}: ${pn(ibp.units)} шт? Сейчас в плане ${pn(ibp.entered)} шт.`
      : `Save the ${monthLong(ibp.shipMonth, false)} order to the plan: ${pn(ibp.units)} units? The plan now has ${pn(ibp.entered)}.`;
    if (!confirm(msg)) return;
    setSaving(true);
    const ids = new Set([...ibp.lines.map((l) => l.skuId), ...Object.keys(ibp.enteredBySku)]);
    const lines = [...ids].map((skuId) => ({ skuId, qty: Math.round(ibp.lines.find((l) => l.skuId === skuId)?.units ?? 0) }));
    const res = await fetch("/api/planning/purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shipMonth: ibp.shipMonth, lines }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(ru ? "Сохранено в план" : "Saved to the plan");
      router.refresh();
    } else {
      setSaved(ru ? "Не удалось сохранить" : "Could not save");
    }
  }

  const urgent = ibp.daysLeft <= 7;

  return (
    <div className="space-y-4">
      {/* the facts and the demand basis */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] font-semibold text-muted">
        <span>
          {ru ? "Сейчас на складе" : "In stock now"} <b className="pnum text-foreground">{pn(summary.onHand)}</b>
        </span>
        <span>
          {ru ? "в пути" : "on the road"} <b className="pnum text-foreground">{pn(summary.transit)}</b>
        </span>
        <span>
          {ru ? "ждёт у DMK" : "waiting at DMK"} <b className="pnum text-foreground">{pn(summary.atDmk)}</b>
        </span>
        <span>
          {ru ? "продажи" : "sales"} <b className="pnum text-foreground">≈{pn(summary.salesPerMonth)}</b> {ru ? "в мес." : "a month"}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.06em]">{ru ? "Спрос" : "Demand"}</span>
          <span className="flex rounded-lg border border-border bg-surface p-0.5">
            {(["sales", "model"] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBasis(b)}
                className="rounded-md px-3 py-1 text-[12px] font-bold"
                style={{ background: basis === b ? "var(--accent)" : "transparent", color: basis === b ? "#fff" : "var(--muted)" }}
              >
                {b === "sales" ? (ru ? "по продажам" : "actual sales") : ru ? "по модели" : "cohort model"}
              </button>
            ))}
          </span>
        </span>
      </div>

      <div className="grid gap-3.5 lg:grid-cols-2">
        {/* 1. pick up now */}
        <section className="pcard p-5" style={{ borderColor: pickup.trucks > 0 ? "var(--accent)" : "var(--border)", borderWidth: pickup.trucks > 0 ? 2 : 1 }}>
          <div className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted">
            {ru ? "Забрать у DMK сейчас · оплата на этой неделе" : "Pick up from DMK now · pay this week"}
          </div>
          <div className="mt-1">
            <Headline plan={pickup} ru={ru} empty={ru ? "Забирать не нужно" : "Nothing to pick up"} />
          </div>
          {pickup.lines.length > 0 && (
            <div className="mt-1 text-[13px] font-semibold text-muted">
              <span className="pnum">{pn(pickup.units)}</span> {ru ? "шт" : "units"} · <span className="pnum">{pickup.pallets.toFixed(0)}</span> {ru ? "паллет" : "pallets"} ·{" "}
              <span className="pnum">€{pn(pickup.eur)}</span> {uzs(pickup.eur, eurRate, ru)} · {ru ? "в продаже ≈" : "on the shelf ≈"} {dayMonth(pickup.sellableDate, ru)}
            </div>
          )}
          <div className="mt-1 text-[12px] font-semibold text-muted">
            {ru ? "Из того, что уже заказано и ждёт у DMK" : "From what is already ordered and waiting at DMK"}:{" "}
            <span className="pnum">{pn(pickup.available.units)}</span> {ru ? "шт" : "units"} ({pickup.available.pallets.toFixed(0)} {ru ? "паллет" : "pallets"})
          </div>
          <Lines plan={pickup} names={names} ru={ru} />
          <ShapeNote plan={pickup} ru={ru} />
          {Object.keys(pickup.leftAtDmk).length > 0 && (
            <p className="mt-1 text-[12px] font-semibold text-muted">
              {ru ? "Остаётся у DMK до следующей фуры: " : "Stays at DMK for the next truck: "}
              {Object.entries(pickup.leftAtDmk)
                .map(([id, u]) => `${nm(id)} ${pn(u)}`)
                .join(" · ")}
            </p>
          )}
          {pickup.stillShort.length > 0 && (
            <div className="mt-3 rounded-[10px] border px-3 py-2.5 text-[12.5px]" style={{ borderColor: "var(--warn-border)", background: "var(--warn-soft)", color: "var(--warn-ink)" }}>
              <div className="font-extrabold">
                {ru
                  ? `Всё равно не хватит до ${monthLong(ibp.arrivalMonth, true).toLowerCase()} — ≈${pn(pickup.stillShort.reduce((t, s) => t + s.units, 0))} шт:`
                  : `Still short before ${monthLong(ibp.arrivalMonth, false)} — ≈${pn(pickup.stillShort.reduce((t, s) => t + s.units, 0))} units:`}
              </div>
              <div className="mt-0.5 font-semibold">
                {pickup.stillShort.map((s) => `${nm(s.skuId)} ${pn(s.units)} (${ru ? "с" : "from"} ${monthShort(s.fromMonth, ru).toLowerCase()})`).join(" · ")}
              </div>
              <div className="mt-1 font-semibold">
                {ru
                  ? "Новым заказом в IBP это не закрыть — попросите DMK добавить к этой отгрузке или отдать раньше заказанное на ближайшие месяцы."
                  : "No new IBP order lands in time — ask DMK to add these to this shipment or release the coming months' orders early."}
              </div>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {pickup.lines.length > 0 && (
              <a
                href={`/api/export/planning-order?ship=pickup&lines=${encodeURIComponent(linesParam(pickup))}`}
                className="rounded-lg px-3.5 py-2 text-[12.5px] font-extrabold text-white"
                style={{ background: "var(--accent)" }}
              >
                {ru ? "Скачать заявку для DMK" : "Download the request for DMK"}
              </a>
            )}
            <Link href="/goods/shipments" className="rounded-lg border border-border px-3.5 py-2 text-[12.5px] font-bold">
              {ru ? "Поставки: завести фуры после оплаты" : "Shipments: add the trucks once paid"}
            </Link>
          </div>
        </section>

        {/* 2. the IBP order */}
        <section className="pcard p-5">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted">
            <span>
              {ru ? `Ввести в IBP до ${dstr(ibp.deadline)}` : `Enter in IBP by ${dstr(ibp.deadline)}`}
            </span>
            <span className="rounded-full px-2 py-0.5 text-[11px] font-extrabold normal-case tracking-normal text-white" style={{ background: urgent ? "var(--warn)" : "var(--accent)" }}>
              {ru ? `${ibp.daysLeft} дн.` : `${ibp.daysLeft}d`}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <Headline plan={ibp} ru={ru} empty={ru ? "Заказ не нужен" : "No order needed"} />
            <span className="text-[16px] font-bold text-muted">
              {ru ? `на ${monthLong(ibp.shipMonth, true).toLowerCase()}` : `for ${monthLong(ibp.shipMonth, false)}`}
            </span>
          </div>
          {ibp.lines.length > 0 && (
            <div className="mt-1 text-[13px] font-semibold text-muted">
              <span className="pnum">{pn(ibp.units)}</span> {ru ? "шт" : "units"} · <span className="pnum">{ibp.pallets.toFixed(0)}</span> {ru ? "паллет" : "pallets"} ·{" "}
              <span className="pnum">€{pn(ibp.eur)}</span> {uzs(ibp.eur, eurRate, ru)} · {ru ? "в продаже с" : "on the shelf from"} {monthLong(ibp.arrivalMonth, ru).toLowerCase()}
            </div>
          )}
          <div className="mt-1 text-[12px] font-semibold text-muted">
            {ru ? "Сейчас в IBP на этот месяц" : "In IBP for this month now"}: <span className="pnum">{pn(ibp.entered)}</span> {ru ? "шт" : "units"}
            {ibp.laterEntered > 0 &&
              (ru
                ? ` · на следующие 4 месяца уже введено ${pn(ibp.laterEntered)} шт — они ещё не окончательные и здесь не учтены`
                : ` · ${pn(ibp.laterEntered)} units already entered for the next 4 months — not final yet, so not counted here`)}
          </div>
          <Lines plan={ibp} names={names} ru={ru} extra={{ header: ru ? "в IBP сейчас" : "in IBP now", value: (id) => ibp.enteredBySku[id] ?? null }} />
          <ShapeNote plan={ibp} ru={ru} />
          <p className="mt-1 text-[12px] font-semibold text-muted">
            {ru
              ? "После месяца прихода на складе остаётся запас на 4 месяца продаж (правило запаса). Оплата — при отгрузке."
              : "After the arrival month, 4 months of sales stay in stock (the cover rule). Paid when it ships."}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {ibp.lines.length > 0 && (
              <a
                href={`/api/export/planning-order?ship=${ibp.shipMonth}&lines=${encodeURIComponent(linesParam(ibp))}`}
                className="rounded-lg px-3.5 py-2 text-[12.5px] font-extrabold text-white"
                style={{ background: "var(--accent)" }}
              >
                {ru ? "Скачать для IBP" : "Download for IBP"}
              </a>
            )}
            {isAdmin && ibp.lines.length > 0 && (
              <button type="button" onClick={() => void saveIbp()} disabled={saving} className="rounded-lg border border-border px-3.5 py-2 text-[12.5px] font-bold">
                {saving ? "…" : ru ? "Записать в план" : "Save to the plan"}
              </button>
            )}
            <Link href="/planning/orders" className="rounded-lg border border-border px-3.5 py-2 text-[12.5px] font-bold">
              {ru ? "Заказы IBP" : "IBP orders"}
            </Link>
            {saved && <span className="text-[12px] font-bold text-muted">{saved}</span>}
          </div>
        </section>
      </div>

      {/* 3. does the stock last */}
      <section className="pcard overflow-hidden">
        <div className="flex flex-wrap items-baseline gap-3 border-b px-5 py-3" style={{ borderColor: "var(--hair)" }}>
          <h2 className="text-[14px] font-extrabold">{ru ? "Хватит ли товара" : "Will stock last"}</h2>
          <span className="text-[11.5px] font-semibold text-muted">
            {ru
              ? "запас на конец месяца, в месяцах продаж — с забором сейчас и заказом в IBP"
              : "month-end stock in months of sales — with the pickup and the IBP order"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="ptable text-[12.5px]">
            <thead>
              <tr>
                <th>{ru ? "Товар" : "Product"}</th>
                <th>{ru ? "Сейчас" : "Now"}</th>
                <th>{ru ? "Продажи/мес" : "Sales/mo"}</th>
                {plan.months.map((m) => (
                  <th key={m} className="!text-center">
                    {monthShort(m, ru)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plan.rows.map((r) => {
                const { name, pack } = splitPack(r.name);
                return (
                  <tr key={r.skuId}>
                    <td className="whitespace-nowrap">
                      <span className="font-bold">{name}</span> <span className="text-[11px] font-bold" style={{ color: "var(--sky)" }}>{pack}</span>
                    </td>
                    <td className="pnum">{pn(r.onHand)}</td>
                    <td className="pnum text-muted">{pn(r.demand)}</td>
                    {r.cells.map((c) => {
                      const tone = c.short > 0.5 ? "out" : c.cover < 1 ? "low" : "ok";
                      const bg = tone === "out" ? "var(--danger-soft)" : tone === "low" ? "var(--warn-soft)" : "var(--ok-soft)";
                      const fg = tone === "out" ? "var(--danger)" : tone === "low" ? "var(--warn-ink)" : "var(--ok-ink)";
                      const tip = [
                        `${monthLong(c.month, ru)}: ${ru ? "на конец" : "month-end"} ${pn(c.closing)} ${ru ? "шт" : "units"}`,
                        c.short > 0.5 ? `${ru ? "не хватит" : "short"} ${pn(c.short)}` : "",
                        ...c.arrivals.map((a) => {
                          const what =
                            a.kind === "truck"
                              ? a.label
                              : a.kind === "pickup"
                                ? ru ? "забор сейчас" : "pickup now"
                                : a.kind === "dmk"
                                  ? ru ? "остаток у DMK" : "rest at DMK"
                                  : a.kind === "new"
                                    ? ru ? `новый заказ ${monthShort(a.label, true).toLowerCase()}` : `new order ${monthShort(a.label, false)}`
                                    : `IBP ${monthShort(a.label, ru).toLowerCase()}`;
                          return `+${pn(a.units)} ${what}`;
                        }),
                      ]
                        .filter(Boolean)
                        .join("\n");
                      return (
                        <td key={c.month} className="!px-1 !py-1">
                          <div
                            title={tip}
                            className="pnum flex h-8 min-w-[52px] items-center justify-center gap-1 rounded-md text-[12px] font-bold"
                            style={{ background: bg, color: fg }}
                          >
                            {c.arrivals.length > 0 && <span aria-hidden="true">▲</span>}
                            {tone === "out" ? (ru ? "нет" : "out") : c.cover >= 24 ? "24+" : c.cover.toFixed(1)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 px-5 py-3 text-[11.5px] font-semibold text-muted">
          <span><span className="inline-block h-3 w-3 rounded-sm align-[-2px]" style={{ background: "var(--ok-soft)" }} /> {ru ? "месяц и больше" : "a month or more"}</span>
          <span><span className="inline-block h-3 w-3 rounded-sm align-[-2px]" style={{ background: "var(--warn-soft)" }} /> {ru ? "меньше месяца" : "under a month"}</span>
          <span><span className="inline-block h-3 w-3 rounded-sm align-[-2px]" style={{ background: "var(--danger-soft)" }} /> {ru ? "не хватит" : "runs out"}</span>
          <span>▲ {ru ? "приход (наведите — что именно)" : "arrival (hover for what)"}</span>
        </div>
      </section>

      {/* 4. checks */}
      {checks.length > 0 && (
        <section className="pcard px-5 py-4">
          <h2 className="text-[14px] font-extrabold">{ru ? "Проверьте" : "Check"}</h2>
          <ul className="mt-2 space-y-1.5 text-[12.5px] font-semibold" style={{ color: "#3f4e63" }}>
            {checks.map((c, i) => (
              <li key={i}>
                {c.kind === "truck-overdue" &&
                  (ru
                    ? `${c.code} ожидалась ${dayMonth(c.etaDate, true)} — считается приходом в этом месяце. Когда товар будет на складе, нажмите «Отметить прибытие» на странице поставок (не переключатель «Прибыла» — он оставит фуру в старом месяце).`
                    : `${c.code} was due ${dayMonth(c.etaDate, false)} — counted as arriving this month. Once it is in the warehouse, use «Mark arrived» on Shipments (not the Arrived switch — it keeps the truck in its old month).`)}
                {c.kind === "ibp-stale" &&
                  (ru
                    ? `Заказы IBP ${c.syncedAt ? `загружены ${dstr(c.syncedAt.slice(0, 10))}` : "ещё не загружались"} — загрузите свежую выгрузку на вкладке «Заказы IBP».`
                    : `IBP orders ${c.syncedAt ? `last loaded ${dstr(c.syncedAt.slice(0, 10))}` : "never loaded"} — upload a fresh export on the IBP orders tab.`)}
                {c.kind === "orders-vs-sales" &&
                  (ru
                    ? `${nm(c.skuId)}: в IBP в среднем ${pn(c.ordersPerMonth)} шт/мес на ближайшие 6 месяцев отгрузки при продажах ${pn(c.salesPerMonth)} шт/мес.`
                    : `${nm(c.skuId)}: IBP orders average ${pn(c.ordersPerMonth)}/mo over the next 6 ship months against sales of ${pn(c.salesPerMonth)}/mo.`)}
                {c.kind === "weights" &&
                  (ru
                    ? `Вес единицы выглядит неверным: ${c.skuIds.map(nm).join(", ")} — фуры считаются по паллетам, проверка веса неточна.`
                    : `Unit weight looks wrong: ${c.skuIds.map(nm).join(", ")} — trucks are sized by pallets; the weight check is off.`)}
                {c.kind === "unlinked" &&
                  (ru
                    ? `Не привязаны к товару (нет остатков и продаж): ${c.names.join(", ")}.`
                    : `Not linked to a product (no stock or sales): ${c.names.join(", ")}.`)}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-[11px] font-semibold text-muted">
        {ru
          ? `Данные на ${dstr(today)}: остатки — по учёту (страница «Остатки»), у DMK — заказано минус забрано, заказы — из выгрузки IBP.`
          : `As of ${dstr(today)}: stock from the books (Stock page), at DMK = ordered less collected, orders from the IBP export.`}
      </p>
    </div>
  );
}
