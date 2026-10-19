"use client";

// «Спрос» — how the plan's demand is made, and the owner's say in it. The
// stage engine: babies on each stage (verified prescriptions of the last six
// months, by age) × tins per baby, on top of a level learned from the last
// three clean months of sales; Expert products run at their own level. A month
// that started with too little stock is not clean (marked «нет товара»); a
// click overrides the mark. A product's own number replaces the forecast.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { monthShort, monthTag, pn } from "@/lib/planning/ui-format";
import type { Stage } from "@/lib/planning/stage-engine";
import { SkuName } from "./PlanView";

interface LearnedView {
  level: number;
  months: string[];
}

export interface DemandViewProps {
  thisMonth: string;
  monthDone: number;
  past: string[];
  ahead: string[];
  products: Array<{ id: string; name: string; stage: Stage | null; size800: boolean }>;
  demand: Record<string, Record<string, number>>;
  short: Record<string, Record<string, boolean>>;
  overrides: { short: Record<string, Record<string, boolean>>; own: Record<string, number>; share: Partial<Record<Stage, number>> };
  thisMonthFc: Record<string, { forecast: number; runningAt: number }>;
  stage: {
    level: Record<Stage, LearnedView>;
    share800: Record<Stage, number>;
    tins: Record<Stage, number>;
    babies: Record<Stage, Record<string, number>>;
    forecast: Record<Stage, Record<string, number>>;
  };
  expert: Record<string, LearnedView>;
  rx: Record<string, number>;
  rxUsed: Record<string, number>;
  rxAhead: number;
  rxAheadSetting: number | null;
  rxMonths: string[];
}

const STAGES: Stage[] = ["P1", "P2", "P3"];
const AGES: Record<Stage, [string, string]> = { P1: ["0–6 мес", "0–6 mo"], P2: ["6–12 мес", "6–12 mo"], P3: ["12–18 мес", "12–18 mo"] };

async function postJson(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const b = await res.json().catch(() => ({}));
  return b.error ?? "error";
}

type FoilLine = { monthKey: string; foils: number; paid: number; now: number | null; closed: boolean };

function FoilUpload({ ru }: { ru: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<FoilLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function send(apply: boolean) {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    if (apply) fd.append("apply", "1");
    const res = await fetch("/api/planning/foil-import", { method: "POST", body: fd });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(body.error ?? (ru ? "Не удалось прочитать файл" : "Could not read the file"));
    setLines(body.lines as FoilLine[]);
    if (apply) {
      setMsg(ru ? `Записано месяцев: ${body.written}` : `Months written: ${body.written}`);
      router.refresh();
    }
  }

  const changes = (lines ?? []).filter((l) => l.closed && l.foils !== l.now);
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setLines(null); setMsg(null); }} className="text-[12.5px]" />
        <button type="button" disabled={busy || !file} onClick={() => void send(false)} className="rounded-lg border border-border px-3.5 py-1.5 text-[12.5px] font-bold">
          {busy && !lines ? "…" : ru ? "Проверить" : "Check"}
        </button>
        {lines && changes.length > 0 && (
          <button type="button" disabled={busy} onClick={() => void send(true)} className="rounded-lg px-3.5 py-1.5 text-[12.5px] font-extrabold text-white" style={{ background: "var(--accent)" }}>
            {ru ? `Записать ${changes.length} мес.` : `Write ${changes.length} months`}
          </button>
        )}
        {msg && <span className="text-[12px] font-bold text-muted">{msg}</span>}
      </div>
      {lines && (
        <table className="ptable mt-2 text-[12px]">
          <thead>
            <tr>
              <th>{ru ? "Месяц" : "Month"}</th>
              <th>{ru ? "Фольги (рецепты)" : "Foils (Rx)"}</th>
              <th>{ru ? "Выплачено" : "Paid"}</th>
              <th>{ru ? "Сейчас в приложении" : "In the app now"}</th>
            </tr>
          </thead>
          <tbody>
            {lines.slice(-8).map((l) => (
              <tr key={l.monthKey}>
                <td>{monthTag(l.monthKey, ru)}{!l.closed && <span className="ml-1 text-muted">({ru ? "идёт" : "open"})</span>}</td>
                <td className="pnum font-bold" style={{ color: l.closed && l.foils !== l.now ? "var(--info)" : undefined }}>{pn(l.foils)}</td>
                <td className="pnum text-muted">{pn(l.paid)}</td>
                <td className="pnum text-muted">{l.now == null ? "—" : pn(l.now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function DemandView(p: DemandViewProps) {
  const { locale } = useT();
  const ru = locale === "ru";
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [own, setOwn] = useState<Record<string, string>>({});
  const [rxEdit, setRxEdit] = useState<Record<string, string>>({});
  const [shareEdit, setShareEdit] = useState<Record<string, string>>({});

  async function run(key: string, url: string, body: unknown) {
    setBusy(key);
    setError(null);
    const err = await postJson(url, body);
    setBusy(null);
    if (err) setError(err);
    else router.refresh();
  }

  const toggleShort = (id: string, m: string) => {
    const has = p.overrides.short[id]?.[m] !== undefined;
    void run(`s:${id}:${m}`, "/api/planning/inputs", { kind: "SHORT", skuId: id, monthKey: m, value: has ? null : p.short[id]?.[m] ? 0 : 1 });
  };
  const saveOwn = (id: string) => {
    const raw = (own[id] ?? "").replace(/[^\d]/g, "");
    void run(`o:${id}`, "/api/planning/inputs", { kind: "OWN_DEMAND", skuId: id, value: raw === "" ? null : Number(raw) });
    setOwn((x) => { const n = { ...x }; delete n[id]; return n; });
  };
  const saveShare = (st: Stage) => {
    const raw = (shareEdit[st] ?? "").replace(",", ".").trim();
    void run(`sh:${st}`, "/api/planning/inputs", { kind: "OWN_SHARE", skuId: st, value: raw === "" ? null : Number(raw) / 100 });
    setShareEdit((x) => { const n = { ...x }; delete n[st]; return n; });
  };
  const saveRx = (m: string) => {
    const raw = (rxEdit[m] ?? "").replace(/[^\d]/g, "");
    if (raw === "") return;
    void run(`rx:${m}`, "/api/planning/recruitment", { monthKey: m, babies: Number(raw) });
    setRxEdit((x) => { const n = { ...x }; delete n[m]; return n; });
  };

  const cols = [...p.past, p.thisMonth, ...p.ahead];
  const stageActual = (st: Stage, m: string) => p.products.filter((x) => x.stage === st).reduce((t, x) => t + (p.demand[x.id]?.[m] ?? 0), 0);

  return (
    <div className="space-y-4">
      {error && <p className="text-[12.5px] font-bold" style={{ color: "var(--danger)" }}>{error}</p>}

      {/* prescriptions */}
      <section className="pcard p-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-[14px] font-extrabold">{ru ? "Рецепты (фольги)" : "Prescriptions (foils)"}</h2>
          <span className="text-[12px] font-semibold text-muted">
            {ru
              ? `каждый проверенный рецепт — один ребёнок; на будущие месяцы ${p.rxAheadSetting == null ? "среднее трёх последних" : "задано в настройках"}: ${pn(p.rxAhead)} в мес.`
              : `each verified prescription is one baby; months ahead use ${p.rxAheadSetting == null ? "the average of the last three" : "the settings figure"}: ${pn(p.rxAhead)} a month`}
          </span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="ptable text-[12.5px]">
            <thead>
              <tr>
                {p.rxMonths.map((m) => (
                  <th key={m} className="!text-center">{monthTag(m, ru)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {p.rxMonths.map((m) => (
                  <td key={m} className="!px-1 !text-center">
                    {m < p.thisMonth ? (
                      <input
                        inputMode="numeric"
                        value={rxEdit[m] ?? (p.rx[m] != null ? String(p.rx[m]) : "")}
                        onChange={(e) => setRxEdit((x) => ({ ...x, [m]: e.target.value }))}
                        onBlur={() => rxEdit[m] !== undefined && saveRx(m)}
                        disabled={busy === `rx:${m}`}
                        className="pnum w-[70px] rounded-md border border-border bg-surface px-1.5 py-1 text-right text-[12.5px]"
                        placeholder="—"
                      />
                    ) : (
                      <span className="pnum text-muted">{pn(p.rxUsed[m])}</span>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] font-semibold text-muted">
          {ru
            ? "Загрузите файл учёта фольг (лист «Foil Tracking»): берутся закрытые месяцы, текущий — нет, его фольги ещё приходят."
            : "Upload the foil tracking workbook (sheet «Foil Tracking»): closed months are taken, not the current one — its foils are still coming in."}
        </p>
        <FoilUpload ru={ru} />
      </section>

      {/* stages */}
      <section className="pcard overflow-hidden">
        <div className="flex flex-wrap items-baseline gap-3 border-b px-5 py-3" style={{ borderColor: "var(--hair)" }}>
          <h2 className="text-[14px] font-extrabold">{ru ? "Стадии: база + дети × банок на ребёнка" : "Stages: level + babies × tins per baby"}</h2>
          <span className="text-[11.5px] font-semibold text-muted">
            {ru ? "база выучена по последним трём чистым месяцам; доля 800 г — по последнему чистому" : "the level is learned from the last three clean months; the 800 g share from the latest clean one"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="ptable text-[12.5px]">
            <thead>
              <tr>
                <th>{ru ? "Стадия" : "Stage"}</th>
                <th>{ru ? "База" : "Level"}</th>
                <th>{ru ? "Банок/ребёнка" : "Tins/baby"}</th>
                <th>{ru ? "Доля 800 г" : "800 g share"}</th>
                {cols.map((m) => (
                  <th key={m} className="!text-center" style={m === p.thisMonth ? { background: "var(--info-soft)" } : undefined}>{monthShort(m, ru)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STAGES.map((st) => (
                <tr key={st}>
                  <td className="whitespace-nowrap font-bold">
                    Platin {st.slice(1)} <span className="text-[11px] font-semibold text-muted">{AGES[st][ru ? 0 : 1]}</span>
                  </td>
                  <td className="pnum" title={p.stage.level[st].months.map((m) => monthTag(m, ru)).join(", ")}>
                    {pn(p.stage.level[st].level)}
                    <div className="text-[10.5px] text-muted">{p.stage.level[st].months.map((m) => monthShort(m, ru).toLowerCase()).join(" ")}</div>
                  </td>
                  <td className="pnum">{p.stage.tins[st]}</td>
                  <td className="!px-1">
                    <input
                      value={shareEdit[st] ?? (p.overrides.share[st] != null ? String(Math.round((p.overrides.share[st] as number) * 100)) : "")}
                      placeholder={`${Math.round(p.stage.share800[st] * 100)}`}
                      onChange={(e) => setShareEdit((x) => ({ ...x, [st]: e.target.value }))}
                      onBlur={() => shareEdit[st] !== undefined && saveShare(st)}
                      disabled={busy === `sh:${st}`}
                      title={ru ? "пусто — по продажам; число — своя доля, %" : "empty — from sales; a number — your own share, %"}
                      className="pnum w-[52px] rounded-md border border-border bg-surface px-1.5 py-1 text-right text-[12.5px]"
                    />
                    <span className="ml-0.5 text-muted">%</span>
                  </td>
                  {cols.map((m) => {
                    const fc = p.stage.forecast[st]?.[m] ?? 0;
                    const act = m < p.thisMonth ? stageActual(st, m) : null;
                    return (
                      <td key={m} className="pnum !text-center" style={m === p.thisMonth ? { background: "var(--info-soft)" } : undefined}>
                        {act != null ? (
                          <>
                            <div>{pn(act)}</div>
                            <div className="text-[10.5px] text-muted" title={ru ? "что сказала бы модель" : "what the model would have said"}>{pn(fc)}</div>
                          </>
                        ) : (
                          <>
                            <div className="font-bold">{pn(fc)}</div>
                            <div className="text-[10.5px] text-muted" title={ru ? "детей на стадии" : "babies on the stage"}>{pn(p.stage.babies[st]?.[m])} {ru ? "дет." : "bb"}</div>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 text-[11.5px] font-semibold text-muted">
          {ru
            ? "Прошлые месяцы: сверху — продажи стадии, снизу — что сказала бы модель. Будущие: прогноз и число детей на стадии. Банки на ребёнка меняются в настройках."
            : "Past months: the stage's sales on top, what the model would have said below. Ahead: the forecast and the babies on the stage. Tins per baby are in the settings."}
        </p>
      </section>

      {/* products */}
      <section className="pcard overflow-hidden">
        <div className="flex flex-wrap items-baseline gap-3 border-b px-5 py-3" style={{ borderColor: "var(--hair)" }}>
          <h2 className="text-[14px] font-extrabold">{ru ? "Спрос по товарам" : "Demand by product"}</h2>
          <span className="text-[11.5px] font-semibold text-muted">
            {ru
              ? `прошлые месяцы — продажи; ${monthShort(p.thisMonth, true).toLowerCase()} — продано + остаток месяца по прогнозу (прошло ${Math.round(p.monthDone * 100)}%); дальше — прогноз`
              : `past months — sales; ${monthShort(p.thisMonth, false)} — sold so far + the rest at the forecast (${Math.round(p.monthDone * 100)}% done); then the forecast`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="ptable text-[12.5px]">
            <thead>
              <tr>
                <th>{ru ? "Товар" : "Product"}</th>
                {cols.map((m) => (
                  <th key={m} className="!text-center" style={m === p.thisMonth ? { background: "var(--info-soft)" } : undefined}>{monthShort(m, ru)}</th>
                ))}
                <th>{ru ? "Своё число/мес" : "Own number/mo"}</th>
              </tr>
            </thead>
            <tbody>
              {p.products.map((x) => (
                <tr key={x.id}>
                  <td>
                    <SkuName name={x.name} />
                    {!x.stage && p.expert[x.id] && (
                      <div className="text-[10.5px] font-semibold text-muted">
                        {ru ? "база" : "level"} {pn(p.expert[x.id].level)} ({p.expert[x.id].months.map((m) => monthShort(m, ru).toLowerCase()).join(" ")})
                      </div>
                    )}
                  </td>
                  {cols.map((m) => {
                    const v = p.demand[x.id]?.[m] ?? 0;
                    const past = m < p.thisMonth;
                    const isShort = !!p.short[x.id]?.[m];
                    const forced = p.overrides.short[x.id]?.[m] !== undefined;
                    if (!past) {
                      return (
                        <td key={m} className="pnum !text-center" style={m === p.thisMonth ? { background: "var(--info-soft)" } : undefined}>
                          <div className={m === p.thisMonth ? undefined : "font-bold"}>{pn(v)}</div>
                          {m === p.thisMonth && (
                            <div className="text-[10.5px] text-muted" title={ru ? "темп месяца" : "the month's pace"}>{ru ? "темп" : "pace"} {pn(p.thisMonthFc[x.id]?.runningAt)}</div>
                          )}
                        </td>
                      );
                    }
                    return (
                      <td key={m} className="!px-1 !text-center">
                        <button
                          type="button"
                          disabled={busy === `s:${x.id}:${m}`}
                          onClick={() => toggleShort(x.id, m)}
                          title={
                            ru
                              ? `${isShort ? "Месяц с нехваткой товара — не учитывается в базе." : "Чистый месяц — учитывается в базе."} ${forced ? "Отмечено вами (клик — вернуть автоматическую отметку)." : "Отметка автоматическая (клик — изменить)."}`
                              : `${isShort ? "Short of stock — left out of the level." : "Clean month — counts for the level."} ${forced ? "Marked by you (click to go back to automatic)." : "Automatic mark (click to change)."}`
                          }
                          className="pnum w-full rounded-md px-1 py-0.5 text-[12.5px]"
                          style={{
                            background: isShort ? "var(--warn-soft)" : "transparent",
                            color: isShort ? "var(--warn-ink)" : undefined,
                            outline: forced ? "1.5px dashed var(--accent)" : undefined,
                          }}
                        >
                          {pn(v)}
                          {isShort && <div className="text-[10px] font-extrabold">{ru ? "нет товара" : "short"}</div>}
                        </button>
                      </td>
                    );
                  })}
                  <td className="!px-1">
                    <span className="flex items-center gap-1">
                      <input
                        inputMode="numeric"
                        value={own[x.id] ?? (p.overrides.own[x.id] != null ? String(p.overrides.own[x.id]) : "")}
                        onChange={(e) => setOwn((o) => ({ ...o, [x.id]: e.target.value }))}
                        onBlur={() => own[x.id] !== undefined && saveOwn(x.id)}
                        disabled={busy === `o:${x.id}`}
                        placeholder={ru ? "модель" : "model"}
                        className="pnum w-[80px] rounded-md border border-border bg-surface px-1.5 py-1 text-right text-[12.5px]"
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 text-[11.5px] font-semibold text-muted">
          {ru
            ? "Клик по прошлому месяцу меняет отметку «нет товара» (пунктир — ваша отметка). «Своё число» заменяет прогноз товара на все будущие месяцы; пусто — по модели."
            : "Click a past month to change its «short» mark (dashed — your mark). «Own number» replaces the product's forecast for every month ahead; empty — the model's."}
        </p>
      </section>
    </div>
  );
}
