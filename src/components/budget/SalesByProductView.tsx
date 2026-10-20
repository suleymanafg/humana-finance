"use client";

// «Продажи по товарам» — sales in tins, product by product and month by month.
// Closed months are actual. The others are the estimate: the demand model's,
// or your own number typed over it. Totals and revenue follow as you type;
// saving makes it the estimate — the supply plan sizes the trucks to it and the
// budget (revenue, cash, capital) recalculates. Any cell goes back to the model.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";

type Cell =
  | { m: string; kind: "actual"; v: number }
  | { m: string; kind: "estimate"; v: number; model: number; own: number | null; soldSoFar: number | null; short: number };

export interface SalesByProductProps {
  months: string[];
  thisMonth: string;
  rows: { id: string; name: string; listPrice: number; cells: Cell[] }[];
  summary: { ask: number; firstNeeded: string | null; net27: number; units27: number; trucks27: number };
  isAdmin: boolean;
}

const key = (id: string, m: string) => `${id}|${m}`;
const parse = (t: string) => {
  const n = Number(t.replace(/[^\d]/g, ""));
  return t.trim() === "" || !Number.isFinite(n) ? null : n;
};

function Tile({ label, now, was, fmt, good }: { label: string; now: number; was?: number; fmt: (v: number) => string; good?: "up" | "down" }) {
  const { l } = useT();
  const d = was === undefined ? 0 : now - was;
  const shown = was !== undefined && Math.abs(d) > 1e-6 && fmt(now) !== fmt(was);
  const better = good === "up" ? d > 0 : d < 0;
  return (
    <div className="rounded-xl border border-border bg-surface px-5 py-4">
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className="figure-num mt-1.5 text-[22px] font-semibold leading-none">{fmt(now)}</div>
      {shown && <div className={`mt-1.5 text-[12px] ${better ? "text-ok" : "text-danger"}`}>{l({ ru: "было", en: "was" })} {fmt(was!)}</div>}
    </div>
  );
}

export default function SalesByProductView({ months, thisMonth, rows, summary, isAdmin }: SalesByProductProps) {
  const { locale, l } = useT();
  const ru = locale === "ru";
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [before, setBefore] = useState<SalesByProductProps["summary"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const tins = (v: number) => Math.round(v).toLocaleString(ru ? "ru-RU" : "en-US");
  const bn = (v: number, d = 2) => (v / 1e9).toFixed(d).replace(".", ru ? "," : ".");
  const mon = (id: string) => {
    const [y, mm] = id.split("-").map(Number);
    return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString(ru ? "ru-RU" : "en-GB", { month: "short", timeZone: "UTC" }).replace(".", "");
  };

  // the figure a cell stands at now: your unsaved edit, else the estimate
  const valueOf = (rowId: string, c: Cell): number => {
    if (c.kind === "actual") return c.v;
    const e = edits[key(rowId, c.m)];
    if (e === undefined) return c.v;
    const n = parse(e);
    return n == null ? c.model : Math.max(n, c.soldSoFar ?? 0);
  };
  const changes = Object.keys(edits).length;
  const ownCount = rows.reduce((t, r) => t + r.cells.filter((c) => c.kind === "estimate" && c.own != null).length, 0);
  const months27 = months.map((m, i) => ({ m, i })).filter((x) => x.m.startsWith("2027"));
  const year = (r: SalesByProductProps["rows"][number]) => months27.reduce((t, x) => t + valueOf(r.id, r.cells[x.i]), 0);
  const colTotal = (i: number) => rows.reduce((t, r) => t + valueOf(r.id, r.cells[i]), 0);
  const colRevenue = (i: number) => rows.reduce((t, r) => t + valueOf(r.id, r.cells[i]) * r.listPrice, 0);
  const colShort = (i: number) => rows.reduce((t, r) => t + (r.cells[i].kind === "estimate" ? (r.cells[i] as Extract<Cell, { kind: "estimate" }>).short : 0), 0);

  async function send(batch: { kind: string; skuId: string; monthKey: string; value: number | null }[], done: string) {
    if (batch.length === 0) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/planning/inputs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batch }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(body.error ?? "error");
    setBefore(summary);
    setEdits({});
    setMsg(done);
    router.refresh();
  }

  function save() {
    const batch = Object.entries(edits).map(([k, t]) => {
      const [skuId, monthKey] = k.split("|");
      const c = rows.find((r) => r.id === skuId)!.cells.find((x) => x.m === monthKey) as Extract<Cell, { kind: "estimate" }>;
      const n = parse(t);
      // the model's own figure needs no override
      return { kind: "OWN_MONTH", skuId, monthKey, value: n == null || Math.abs(n - c.model) < 0.5 ? null : n };
    });
    void send(batch, l({ ru: "Сохранено — оценка пересчитана", en: "Saved — the estimate recalculated" }));
  }

  function resetAll() {
    if (!confirm(l({ ru: "Вернуть все ваши числа к модели спроса?", en: "Put all your numbers back to the demand model?" }))) return;
    const batch = rows.flatMap((r) => r.cells.filter((c) => c.kind === "estimate" && c.own != null).map((c) => ({ kind: "OWN_MONTH", skuId: r.id, monthKey: c.m, value: null })));
    void send(batch, l({ ru: "Вернули модель", en: "Back to the model" }));
  }

  return (
    <div>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label={l({ ru: "Нужно от акционеров", en: "Needed from shareholders" })} now={summary.ask} was={before?.ask} fmt={(v) => `${bn(v)} ${ru ? "млрд" : "bn"}`} good="down" />
        <Tile label={l({ ru: "Чистая прибыль 2027", en: "2027 net profit" })} now={summary.net27} was={before?.net27} fmt={(v) => `${bn(v)} ${ru ? "млрд" : "bn"}`} good="up" />
        <Tile label={l({ ru: "Продажи 2027, банок", en: "2027 sales, tins" })} now={summary.units27} was={before?.units27} fmt={tins} good="up" />
        <Tile label={l({ ru: "Фур в 2027", en: "Trucks in 2027" })} now={summary.trucks27} was={before?.trucks27} fmt={(v) => tins(v)} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-[13px]">
        {isAdmin && (
          <>
            <button type="button" disabled={busy || changes === 0} onClick={save} className="rounded-lg bg-accent px-4 py-2 font-medium text-white disabled:opacity-40">
              {busy ? "…" : changes ? l({ ru: `Сохранить (${changes})`, en: `Save (${changes})` }) : l({ ru: "Сохранить", en: "Save" })}
            </button>
            {changes > 0 && (
              <button type="button" onClick={() => setEdits({})} className="rounded-lg border border-border px-3.5 py-2 font-medium">
                {l({ ru: "Отменить правки", en: "Undo edits" })}
              </button>
            )}
            {ownCount > 0 && changes === 0 && (
              <button type="button" disabled={busy} onClick={resetAll} className="rounded-lg border border-border px-3.5 py-2 font-medium text-muted">
                {l({ ru: `Вернуть модель (${ownCount})`, en: `Back to the model (${ownCount})` })}
              </button>
            )}
          </>
        )}
        {msg && <span className="text-muted">{msg}</span>}
        <span className="ml-auto flex items-center gap-4 text-[12px] text-muted">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent align-middle" />{l({ ru: "ваше число", en: "your number" })}</span>
          <span className="text-danger">−123 {l({ ru: "не хватит товара", en: "short of stock" })}</span>
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 z-10 min-w-[190px] bg-surface px-4 py-3 text-left text-[12px] font-normal text-muted">{l({ ru: "банок", en: "tins" })}</th>
              {months.map((m, i) => (
                <th key={m} className={`whitespace-nowrap px-1.5 py-3 text-right ${m === thisMonth ? "bg-surface-low" : ""}`}>
                  <div className="font-semibold">{mon(m)} {m.slice(2, 4)}</div>
                  <div className={`text-[10.5px] font-normal ${rows[0]?.cells[i].kind === "actual" ? "text-ok" : "text-muted"}`}>
                    {rows[0]?.cells[i].kind === "actual" ? l({ ru: "факт", en: "actual" }) : m === thisMonth ? l({ ru: "идёт", en: "running" }) : l({ ru: "оценка", en: "estimate" })}
                  </div>
                </th>
              ))}
              <th className="whitespace-nowrap border-l border-border bg-surface-low px-3 py-3 text-right font-semibold">2027</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60">
                <td className="sticky left-0 z-10 bg-surface px-4 py-1.5 font-medium">{r.name.replace(/^Humana\s+/i, "")}</td>
                {r.cells.map((c) => {
                  if (c.kind === "actual") return <td key={c.m} className="figure-num px-2 py-1.5 text-right text-muted">{tins(c.v)}</td>;
                  const k = key(r.id, c.m);
                  const edited = edits[k] !== undefined;
                  const text = edited ? edits[k] : String(Math.round(c.v));
                  return (
                    <td key={c.m} className={`px-1 py-1 text-right align-top ${c.m === thisMonth ? "bg-surface-low" : ""}`}>
                      <div className="relative">
                        {c.own != null && !edited && <span className="absolute left-0.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-accent" title={l({ ru: `ваше число; модель: ${tins(c.model)} — очистите ячейку, чтобы вернуть`, en: `your number; the model: ${tins(c.model)} — clear the cell to go back` })} />}
                        <input
                          inputMode="numeric"
                          disabled={!isAdmin}
                          value={text}
                          title={c.soldSoFar != null ? l({ ru: `продано ${tins(c.soldSoFar)}; модель: ${tins(c.model)}`, en: `sold ${tins(c.soldSoFar)}; the model: ${tins(c.model)}` }) : l({ ru: `модель: ${tins(c.model)}`, en: `the model: ${tins(c.model)}` })}
                          onChange={(e) => setEdits((x) => ({ ...x, [k]: e.target.value }))}
                          className={`figure-num w-[68px] rounded-md border bg-surface px-1.5 py-1 text-right outline-none focus:border-accent ${edited ? "border-warn bg-warn-soft" : "border-transparent hover:border-border"}`}
                        />
                      </div>
                      {c.short > 0.5 && !edited && <div className="pr-1.5 text-[10.5px] text-danger">−{tins(c.short)}</div>}
                    </td>
                  );
                })}
                <td className="figure-num border-l border-border bg-surface-low px-3 py-1.5 text-right font-semibold">{tins(year(r))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-foreground/70 font-semibold">
              <td className="sticky left-0 z-10 bg-surface px-4 py-2">{l({ ru: "Итого, банок", en: "Total, tins" })}</td>
              {months.map((m, i) => (
                <td key={m} className={`figure-num px-2 py-2 text-right ${m === thisMonth ? "bg-surface-low" : ""}`}>{tins(colTotal(i))}</td>
              ))}
              <td className="figure-num border-l border-border bg-surface-low px-3 py-2 text-right">{tins(months27.reduce((t, x) => t + colTotal(x.i), 0))}</td>
            </tr>
            <tr className="text-muted">
              <td className="sticky left-0 z-10 bg-surface px-4 py-1.5">{l({ ru: "По прайсу, млрд сум", en: "At list price, bn UZS" })}</td>
              {months.map((m, i) => (
                <td key={m} className={`figure-num px-2 py-1.5 text-right ${m === thisMonth ? "bg-surface-low" : ""}`}>{bn(colRevenue(i))}</td>
              ))}
              <td className="figure-num border-l border-border bg-surface-low px-3 py-1.5 text-right">{bn(months27.reduce((t, x) => t + colRevenue(x.i), 0))}</td>
            </tr>
            {months.some((_, i) => colShort(i) > 0.5) && (
              <tr className="text-danger">
                <td className="sticky left-0 z-10 bg-surface px-4 py-1.5">{l({ ru: "Не хватит товара, банок", en: "Short of stock, tins" })}</td>
                {months.map((m, i) => (
                  <td key={m} className="figure-num px-2 py-1.5 text-right">{colShort(i) > 0.5 ? tins(colShort(i)) : ""}</td>
                ))}
                <td className="border-l border-border bg-surface-low" />
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </div>
  );
}
