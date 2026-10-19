"use client";

// «Настройки» — the supply plan's few numbers: how demand grows per baby,
// the road time, HQ's truck, the pick-up horizon, the danger line, and the
// months of stock to hold by ship month (the ramp).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { monthTag } from "@/lib/planning/ui-format";
import type { PlanSettings } from "@/lib/planning/plan-data";

export interface PlanSettingsViewProps {
  settings: PlanSettings;
  shipMonths: string[];
  targets: Record<string, number>;
  isAdmin: boolean;
}

type Field = { key: keyof PlanSettings; ru: string; en: string; hintRu: string; hintEn: string; percent?: boolean };

const FIELDS: Field[] = [
  { key: "leadDays", ru: "Дней от отгрузки до продажи", en: "Days from dispatch to sellable", hintRu: "DMK → склад, растаможка", hintEn: "DMK → warehouse, customs" },
  { key: "dispatchDay", ru: "День отгрузки (для будущих фур)", en: "Dispatch day (future trucks)", hintRu: "после 15-го — в продаже с месяца после", hintEn: "after the 15th — sellable from the month after" },
  { key: "truckPlaces", ru: "Мест в фуре (HQ)", en: "Places in a truck (HQ)", hintRu: "по форме заказа HQ", hintEn: "per HQ's order form" },
  { key: "minFill", ru: "Загрузка не меньше", en: "Fill at least", hintRu: "HQ: < 98% — перевозка на риске покупателя", hintEn: "HQ: < 98% — transport at the buyer's risk", percent: true },
  { key: "maxFill", ru: "Загрузка не больше", en: "Fill at most", hintRu: "форма HQ должна показать 0,98", hintEn: "HQ's form must show 0.98", percent: true },
  { key: "pickupMonths", ru: "Месяцев, где можно просить сверх IBP", en: "Months HQ can add on top of the IBP", hintRu: "этот и следующие", hintEn: "this and the next ones" },
  { key: "dangerLine", ru: "Опасная черта, мес. запаса", en: "Danger line, months of stock", hintRu: "ниже — предупреждение", hintEn: "below — a warning" },
  { key: "defaultTarget", ru: "Запас по умолчанию, мес.", en: "Default stock target, months", hintRu: "где ниже не задано", hintEn: "where none is set below" },
];

export default function PlanSettingsView({ settings, shipMonths, targets, isAdmin }: PlanSettingsViewProps) {
  const { locale } = useT();
  const ru = locale === "ru";
  const router = useRouter();
  const shown = (f: Field) => (f.percent ? String(+((settings[f.key] as number) * 100).toFixed(2)) : String(settings[f.key]));
  const [vals, setVals] = useState<Record<string, string>>({});
  const [tins, setTins] = useState<Record<string, string>>({});
  const [rxAhead, setRxAhead] = useState<string | null>(null);
  const [tg, setTg] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const num = (s: string) => Number(s.replace(",", ".").trim());

  async function saveSettings() {
    const body: Record<string, unknown> = {};
    for (const f of FIELDS) if (vals[f.key] !== undefined) body[f.key] = f.percent ? num(vals[f.key]) / 100 : num(vals[f.key]);
    if (Object.keys(tins).length) body.tinsPerBaby = Object.fromEntries(Object.entries(tins).map(([k, v]) => [k, num(v)]));
    if (rxAhead !== null) body.rxAhead = rxAhead.trim() === "" ? null : num(rxAhead);
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/planning/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      return setMsg(b.error ?? "error");
    }
    for (const [m, v] of Object.entries(tg)) {
      const r = await fetch("/api/planning/inputs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "TARGET", monthKey: m, value: v.trim() === "" ? null : num(v) }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        setBusy(false);
        return setMsg(`${monthTag(m, ru)}: ${e.error ?? "error"}`);
      }
    }
    setBusy(false);
    setVals({});
    setTins({});
    setRxAhead(null);
    setTg({});
    setMsg(ru ? "Сохранено — план пересчитан" : "Saved — the plan recalculated");
    router.refresh();
  }

  const dirty = Object.keys(vals).length + Object.keys(tins).length + Object.keys(tg).length + (rxAhead !== null ? 1 : 0);
  const input = "pnum w-[90px] rounded-md border border-border bg-surface px-2 py-1 text-right text-[12.5px]";

  return (
    <div className="grid gap-3.5 lg:grid-cols-2">
      <section className="pcard p-5">
        <h2 className="text-[14px] font-extrabold">{ru ? "Спрос" : "Demand"}</h2>
        <table className="ptable mt-2 text-[12.5px]">
          <tbody>
            {(["P1", "P2", "P3"] as const).map((st) => (
              <tr key={st}>
                <td>
                  {ru ? `Банок в месяц на ребёнка, Platin ${st.slice(1)}` : `Tins a month per baby, Platin ${st.slice(1)}`}
                </td>
                <td className="!text-right">
                  <input disabled={!isAdmin} className={input} value={tins[st] ?? String(settings.tinsPerBaby[st])} onChange={(e) => setTins((x) => ({ ...x, [st]: e.target.value }))} />
                </td>
              </tr>
            ))}
            <tr>
              <td>
                {ru ? "Рецептов в месяц вперёд" : "Prescriptions a month ahead"}
                <div className="text-[11px] font-semibold text-muted">{ru ? "пусто — среднее трёх последних" : "empty — the average of the last three"}</div>
              </td>
              <td className="!text-right">
                <input disabled={!isAdmin} className={input} placeholder={ru ? "среднее" : "average"} value={rxAhead ?? (settings.rxAhead == null ? "" : String(settings.rxAhead))} onChange={(e) => setRxAhead(e.target.value)} />
              </td>
            </tr>
          </tbody>
        </table>

        <h2 className="mt-5 text-[14px] font-extrabold">{ru ? "Поставки" : "Supply"}</h2>
        <table className="ptable mt-2 text-[12.5px]">
          <tbody>
            {FIELDS.map((f) => (
              <tr key={f.key}>
                <td>
                  {ru ? f.ru : f.en}
                  <div className="text-[11px] font-semibold text-muted">{ru ? f.hintRu : f.hintEn}</div>
                </td>
                <td className="!text-right whitespace-nowrap">
                  <input disabled={!isAdmin} className={input} value={vals[f.key] ?? shown(f)} onChange={(e) => setVals((x) => ({ ...x, [f.key]: e.target.value }))} />
                  {f.percent && <span className="ml-1 text-muted">%</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="pcard p-5">
        <h2 className="text-[14px] font-extrabold">{ru ? "Запас на конец месяца продажи, мес." : "Stock at the end of the sell month, months"}</h2>
        <p className="mt-1 text-[12px] font-semibold text-muted">
          {ru
            ? `По месяцу отгрузки. Пусто — ${settings.defaultTarget} (по умолчанию). Меньше запаса — меньше денег в товаре, но выше риск нехватки.`
            : `By ship month. Empty — ${settings.defaultTarget} (the default). Less stock ties up less money but risks running short.`}
        </p>
        <table className="ptable mt-2 text-[12.5px]">
          <tbody>
            {shipMonths.map((m) => (
              <tr key={m}>
                <td>{monthTag(m, ru)}</td>
                <td className="!text-right">
                  <input
                    disabled={!isAdmin}
                    className={input}
                    placeholder={String(settings.defaultTarget)}
                    value={tg[m] ?? (targets[m] != null ? String(targets[m]) : "")}
                    onChange={(e) => setTg((x) => ({ ...x, [m]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {isAdmin && (
        <div className="flex items-center gap-3 lg:col-span-2">
          <button type="button" disabled={busy || dirty === 0} onClick={() => void saveSettings()} className="rounded-lg px-4 py-2 text-[12.5px] font-extrabold text-white disabled:opacity-50" style={{ background: "var(--accent)" }}>
            {busy ? "…" : ru ? `Сохранить${dirty ? ` (${dirty})` : ""}` : `Save${dirty ? ` (${dirty})` : ""}`}
          </button>
          {msg && <span className="text-[12px] font-bold text-muted">{msg}</span>}
        </div>
      )}
    </div>
  );
}
