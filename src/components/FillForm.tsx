"use client";

// What the person outside the company sees: an accounting-document table.
// OPEX Fargo / stock / AR: position | prior month | value | comment, grouped
// into tinted sections (P&L groups, warehouses) with live subtotals.
// OPEX Turbo Impex: bank and cash as separate columns under a two-tier header,
// one row per category, with a row total. The grand-total row is the same
// indigo band the app uses everywhere. Prior-month figures are one click to
// carry over; «Сохранить черновик» lets a long list be finished later.
import { useMemo, useState } from "react";
import { fmtN, toNum } from "@/lib/format";

export interface FillItem {
  id?: string;
  label: string;
  rowLabel: string; // label without the field/warehouse suffix
  freeLabel: string | null;
  field: string; // bankAmount | cashAmount | amount | qty
  pairKey: string | null; // refId — pairs TI bank+cash rows
  group: string | null; // section heading (P&L group / warehouse)
  priorValue: number | null;
  value: number | null;
  note: string | null;
}

interface Draft {
  id?: string;
  rowLabel: string;
  freeLabel: string;
  field: string;
  pairKey: string | null;
  group: string | null;
  priorValue: number | null;
  value: string;
  note: string;
}

const pretty = (s: string) => (s.trim() === "" ? "" : fmtN(toNum(s)));

const inputCls =
  "num h-9 w-28 rounded-md border border-border bg-surface px-2 text-right text-[13.5px] outline-none transition-colors focus:border-accent focus:ring-[3px] focus:ring-accent-soft";
const priorBtnCls =
  "num rounded px-1.5 py-0.5 text-[12.5px] text-muted transition-colors hover:bg-accent-soft hover:text-accent";
const noteCls =
  "w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[12.5px] outline-none transition-colors placeholder:text-muted/40 hover:border-border focus:border-accent focus:bg-surface";

export default function FillForm({
  token,
  kindLabel,
  hint,
  allowAddRows,
  split,
  unit,
  monthName,
  note,
  dueDate,
  alreadySubmitted,
  items,
}: {
  token: string;
  kindLabel: string;
  hint: string;
  allowAddRows: boolean;
  /** bank + cash as separate columns (OPEX Turbo Impex) */
  split: boolean;
  unit: "money" | "qty";
  monthName: string;
  note: string | null;
  dueDate: string | null;
  alreadySubmitted: boolean;
  items: FillItem[];
}) {
  const [draft, setDraft] = useState<Draft[]>(() =>
    items.map((i) => ({
      id: i.id,
      rowLabel: i.rowLabel,
      freeLabel: i.freeLabel ?? "",
      field: i.field,
      pairKey: i.pairKey,
      group: i.group,
      priorValue: i.priorValue,
      value: i.value === null ? "" : fmtN(i.value),
      note: i.note ?? "",
    }))
  );
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const [done, setDone] = useState(alreadySubmitted);
  const [error, setError] = useState<string | null>(null);

  const filled = draft.filter((r) => r.value.trim() !== "").length;
  const total = useMemo(() => draft.reduce((s, r) => s + toNum(r.value), 0), [draft]);
  const unitLabel = unit === "qty" ? "шт." : "UZS";

  const set = (i: number, patch: Partial<Draft>) =>
    setDraft((d) => d.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function send(submit: boolean) {
    setBusy(submit ? "submit" : "draft");
    setError(null);
    const rows = draft
      .filter((r) => r.id || r.freeLabel.trim() !== "")
      .map((r) => ({
        id: r.id,
        freeLabel: r.freeLabel.trim() || null,
        value: r.value.trim() === "" ? null : toNum(r.value),
        note: r.note.trim() || null,
      }));
    const res = await fetch(`/api/f/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows, submit }),
    });
    setBusy(null);
    if (!res.ok) {
      setError("Не удалось сохранить. Проверьте связь и попробуйте ещё раз.");
      return;
    }
    if (submit) setDone(true);
    else setError("Черновик сохранён.");
  }

  // ── render model: sections of rows; split mode pairs bank+cash ──
  interface RowRef {
    label: string;
    valueIdx: number; // non-split: the item; split: bank item
    cashIdx?: number; // split: cash item
  }
  interface Section {
    label: string | null;
    rows: RowRef[];
  }
  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    const at = (g: string | null): Section => {
      const last = out[out.length - 1];
      if (last && last.label === g) return last;
      const s = { label: g, rows: [] as RowRef[] };
      out.push(s);
      return s;
    };
    if (!split) {
      draft.forEach((r, i) => at(r.group).rows.push({ label: r.rowLabel, valueIdx: i }));
      return out;
    }
    const seen = new Map<string, RowRef>();
    draft.forEach((r, i) => {
      const key = r.pairKey ?? `i${i}`;
      const existing = seen.get(key);
      if (!existing) {
        const row: RowRef = { label: r.rowLabel, valueIdx: i };
        seen.set(key, row);
        at(r.group).rows.push(row);
      }
      const row = seen.get(key)!;
      if (r.field === "cashAmount") row.cashIdx = i;
      else row.valueIdx = i;
    });
    return out;
  }, [draft, split]);

  const sumOf = (idxs: Array<number | undefined>, prior: boolean): number =>
    idxs.reduce<number>((s, i) => {
      const r = i === undefined ? undefined : draft[i];
      if (!r) return s;
      return s + (prior ? (r.priorValue ?? 0) : toNum(r.value));
    }, 0);

  const hasPrior = draft.some((r) => r.priorValue !== null);
  const bankIdxs = sections.flatMap((s) => s.rows.map((r) => r.valueIdx));
  const cashIdxs = sections.flatMap((s) => s.rows.map((r) => r.cashIdx));
  const showSections = sections.some((s) => s.label !== null);

  const priorCell = (idx: number | undefined) => {
    if (idx === undefined) return <td className="px-3 py-2 text-right" />;
    const r = draft[idx];
    return (
      <td className="px-3 py-2 text-right">
        {r.priorValue !== null ? (
          <button
            onClick={() => set(idx, { value: fmtN(r.priorValue as number) })}
            title="Нажмите, чтобы подставить это значение"
            className={priorBtnCls}
          >
            {fmtN(r.priorValue)}
          </button>
        ) : (
          <span className="text-[12.5px] text-muted/50">—</span>
        )}
      </td>
    );
  };

  const valueCell = (idx: number | undefined) => {
    if (idx === undefined) return <td className="px-3 py-2 text-right" />;
    const r = draft[idx];
    return (
      <td className="px-3 py-2 text-right">
        <input
          inputMode="decimal"
          value={r.value}
          onChange={(e) => set(idx, { value: e.target.value })}
          onBlur={(e) => set(idx, { value: pretty(e.target.value) })}
          placeholder="0"
          className={inputCls}
        />
      </td>
    );
  };

  if (done) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-ok-soft text-[22px] text-ok">
          ✓
        </div>
        <h1 className="font-display text-[20px] font-semibold">Спасибо, отправлено</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          {kindLabel} за {monthName} получены. Если нужно что-то исправить, откройте эту же ссылку
          и отправьте снова.
        </p>
        <button
          onClick={() => setDone(false)}
          className="mx-auto mt-5 text-[13px] font-medium text-accent hover:underline"
        >
          Исправить
        </button>
      </main>
    );
  }

  const sectionBand = (label: string, cols: React.ReactNode) => (
    <tr key={`s-${label}`} className="border-t border-border bg-accent-soft/40">
      <td className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-accent">
        {label}
      </td>
      {cols}
    </tr>
  );

  return (
    <main className="mx-auto max-w-4xl px-4 pb-36 pt-8">
      {/* document header */}
      <header className="mb-5 overflow-hidden rounded-xl border border-border bg-surface shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
        <div className="h-1 bg-accent" />
        <div className="px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
                Humana Uzbekistan · сбор данных
              </p>
              <h1 className="mt-1.5 font-display text-[22px] font-semibold leading-tight">
                {kindLabel} — {monthName}
              </h1>
              {hint && (
                <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-muted">{hint}</p>
              )}
            </div>
            <div className="shrink-0 text-right text-[12.5px] leading-relaxed text-muted">
              <div>
                Позиций: <span className="num font-medium text-ink">{sections.reduce((s, x) => s + x.rows.length, 0)}</span>
              </div>
              {dueDate && (
                <div className="mt-0.5 font-medium text-warn">
                  Срок: {new Date(dueDate).toLocaleDateString("ru-RU")}
                </div>
              )}
            </div>
          </div>
          {note && (
            <p className="mt-4 rounded-lg border-l-2 border-accent bg-accent-soft/50 px-3 py-2 text-[13px] leading-relaxed">
              {note}
            </p>
          )}
        </div>
      </header>

      {/* the form — an accounting table */}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
        {split ? (
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr className="border-b border-border bg-surface-low text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                <th rowSpan={2} className="px-4 py-2 text-left align-bottom font-semibold">
                  Статья расходов
                </th>
                <th colSpan={2} className="border-l border-border px-3 pt-2.5 text-center font-semibold">
                  Банк
                </th>
                <th colSpan={2} className="border-l border-border px-3 pt-2.5 text-center font-semibold">
                  Наличные
                </th>
                <th rowSpan={2} className="border-l border-border px-3 py-2 text-right align-bottom font-semibold">
                  Итого · {unitLabel}
                </th>
                <th rowSpan={2} className="px-4 py-2 text-left align-bottom font-semibold">
                  Комментарий
                </th>
              </tr>
              <tr className="border-b border-border bg-surface-low text-[10.5px] font-medium normal-case tracking-normal text-muted/80">
                <th className="border-l border-border px-3 pb-2 text-right font-medium">прошлый месяц</th>
                <th className="px-3 pb-2 text-right font-medium">{monthName}</th>
                <th className="border-l border-border px-3 pb-2 text-right font-medium">прошлый месяц</th>
                <th className="px-3 pb-2 text-right font-medium">{monthName}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sections.map((s) => (
                <SectionRows key={s.label ?? "_"} >
                  {s.label &&
                    sectionBand(
                      s.label,
                      <>
                        <td className="num border-l border-border px-3 py-2 text-right text-[12px] text-muted">
                          {fmtN(sumOf(s.rows.map((r) => r.valueIdx), true))}
                        </td>
                        <td className="num px-3 py-2 text-right text-[12px] font-semibold text-accent">
                          {fmtN(sumOf(s.rows.map((r) => r.valueIdx), false))}
                        </td>
                        <td className="num border-l border-border px-3 py-2 text-right text-[12px] text-muted">
                          {fmtN(sumOf(s.rows.map((r) => r.cashIdx), true))}
                        </td>
                        <td className="num px-3 py-2 text-right text-[12px] font-semibold text-accent">
                          {fmtN(sumOf(s.rows.map((r) => r.cashIdx), false))}
                        </td>
                        <td className="num border-l border-border px-3 py-2 text-right text-[12px] font-semibold text-accent">
                          {fmtN(
                            sumOf(s.rows.map((r) => r.valueIdx), false) +
                              sumOf(s.rows.map((r) => r.cashIdx), false)
                          )}
                        </td>
                        <td />
                      </>
                    )}
                  {s.rows.map((row) => {
                    const rowTotal = toNum(draft[row.valueIdx].value) + (row.cashIdx !== undefined ? toNum(draft[row.cashIdx].value) : 0);
                    return (
                      <tr key={row.valueIdx} className="transition-colors hover:bg-surface-low/60">
                        <td className="px-4 py-2 text-[13.5px] leading-snug">{row.label}</td>
                        {priorCell(row.valueIdx)}
                        {valueCell(row.valueIdx)}
                        {priorCell(row.cashIdx)}
                        {valueCell(row.cashIdx)}
                        <td className="num border-l border-border px-3 py-2 text-right text-[13.5px] font-medium">
                          {rowTotal !== 0 ? fmtN(rowTotal) : <span className="text-muted/40">—</span>}
                        </td>
                        <td className="px-4 py-2">
                          <input
                            value={draft[row.valueIdx].note}
                            onChange={(e) => set(row.valueIdx, { note: e.target.value })}
                            placeholder="—"
                            className={noteCls}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </SectionRows>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-accent font-semibold text-white">
                <td className="px-4 py-3 text-[13px]">ИТОГО</td>
                <td className="num px-3 py-3 text-right text-[12.5px] text-white/70">
                  {fmtN(sumOf(bankIdxs, true))}
                </td>
                <td className="num px-3 py-3 text-right text-[13.5px]">{fmtN(sumOf(bankIdxs, false))}</td>
                <td className="num px-3 py-3 text-right text-[12.5px] text-white/70">
                  {fmtN(sumOf(cashIdxs, true))}
                </td>
                <td className="num px-3 py-3 text-right text-[13.5px]">{fmtN(sumOf(cashIdxs, false))}</td>
                <td className="num px-3 py-3 text-right text-[14px]">{fmtN(total)}</td>
                <td className="px-4 py-3 text-right text-[12px] font-normal text-white/80">
                  заполнено {filled} из {draft.length}
                </td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="border-b border-border bg-surface-low text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                <th className="px-4 py-2.5 text-left font-semibold">Позиция</th>
                {hasPrior && <th className="w-36 px-3 py-2.5 text-right font-semibold">Прошлый месяц</th>}
                <th className="w-40 px-3 py-2.5 text-right font-semibold">
                  {monthName} · {unitLabel}
                </th>
                <th className="w-56 px-4 py-2.5 text-left font-semibold">Комментарий</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sections.map((s) => (
                <SectionRows key={s.label ?? "_"}>
                  {s.label &&
                    showSections &&
                    sectionBand(
                      s.label,
                      <>
                        {hasPrior && (
                          <td className="num px-3 py-2 text-right text-[12px] text-muted">
                            {fmtN(sumOf(s.rows.map((r) => r.valueIdx), true))}
                          </td>
                        )}
                        <td className="num px-4 py-2 text-right text-[12px] font-semibold text-accent">
                          {fmtN(sumOf(s.rows.map((r) => r.valueIdx), false))}
                        </td>
                        <td />
                      </>
                    )}
                  {s.rows.map((row) => {
                    const i = row.valueIdx;
                    const r = draft[i];
                    return (
                      <tr key={r.id ?? `new-${i}`} className="transition-colors hover:bg-surface-low/60">
                        <td className="px-4 py-2 text-[13.5px] leading-snug">
                          {allowAddRows && !r.id ? (
                            <input
                              value={r.freeLabel}
                              onChange={(e) => set(i, { freeLabel: e.target.value, rowLabel: e.target.value })}
                              placeholder="Название клиента…"
                              className="w-full min-w-40 rounded-md border border-border bg-surface px-2 py-1.5 text-[13.5px] outline-none focus:border-accent"
                            />
                          ) : (
                            row.label
                          )}
                        </td>
                        {hasPrior && priorCell(i)}
                        {valueCell(i)}
                        <td className="px-4 py-2">
                          <input
                            value={r.note}
                            onChange={(e) => set(i, { note: e.target.value })}
                            placeholder="—"
                            className={noteCls}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </SectionRows>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-accent font-semibold text-white">
                <td className="px-4 py-3 text-[13px]">ИТОГО</td>
                {hasPrior && (
                  <td className="num px-3 py-3 text-right text-[12.5px] text-white/70">
                    {fmtN(draft.reduce((s, r) => s + (r.priorValue ?? 0), 0))}
                  </td>
                )}
                <td className="num px-5 py-3 text-right text-[14px]">{fmtN(total)}</td>
                <td className="px-4 py-3 text-right text-[12px] font-normal text-white/80">
                  заполнено {filled} из {draft.length}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {allowAddRows && (
        <button
          onClick={() =>
            setDraft((d) => [
              ...d,
              {
                rowLabel: "",
                freeLabel: "",
                field: "amount",
                pairKey: null,
                group: d[d.length - 1]?.group ?? null,
                priorValue: null,
                value: "",
                note: "",
              },
            ])
          }
          className="mt-3 w-full rounded-xl border border-dashed border-border py-2.5 text-[13px] font-medium text-accent transition-colors hover:bg-accent-soft"
        >
          + Добавить клиента
        </button>
      )}

      <p className="mt-4 text-center text-[11.5px] text-muted">
        Ссылка персональная — не пересылайте её. Данные попадут на проверку и будут учтены после
        подтверждения.
      </p>

      {/* sticky footer: progress, running total, and the two actions */}
      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[12.5px]">
            <span className="whitespace-nowrap text-muted">
              Заполнено {filled} из {draft.length}
            </span>
            <span className="whitespace-nowrap">
              Итого <span className="num font-semibold">{fmtN(total)}</span>
              {unit === "qty" ? " шт." : ""}
            </span>
            {error && <span className="text-warn">{error}</span>}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => send(false)}
              disabled={busy !== null}
              className="h-10 rounded-lg border border-border bg-surface px-4 text-[13.5px] font-medium transition-colors hover:bg-surface-low disabled:opacity-50"
            >
              {busy === "draft" ? "Сохранение…" : "Сохранить черновик"}
            </button>
            <button
              onClick={() => send(true)}
              disabled={busy !== null || filled === 0}
              className="h-10 rounded-lg bg-accent px-5 text-[13.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy === "submit" ? "Отправка…" : "Отправить"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

/** Grouping helper so a section (band + its rows) can be emitted inside <tbody>. */
function SectionRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
