"use client";

// What the person outside the company sees: a document-style table — position,
// prior month, value, comment — with a totals row, so it reads like the
// familiar accounting form it replaces. Prior-month figures are one click to
// carry over; «Сохранить черновик» lets a long list be finished later.
// Scrolls horizontally on a narrow phone rather than collapsing the table.
import { useMemo, useState } from "react";
import { fmtN, toNum } from "@/lib/format";

interface Row {
  id?: string;
  label: string;
  freeLabel: string | null;
  priorValue: number | null;
  value: number | null;
  note: string | null;
}
interface Draft {
  id?: string;
  label: string;
  freeLabel: string;
  priorValue: number | null;
  value: string;
  note: string;
}

const pretty = (s: string) => (s.trim() === "" ? "" : fmtN(toNum(s)));

export default function FillForm({
  token,
  kindLabel,
  hint,
  allowAddRows,
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
  unit: "money" | "qty";
  monthName: string;
  note: string | null;
  dueDate: string | null;
  alreadySubmitted: boolean;
  items: Row[];
}) {
  const [draft, setDraft] = useState<Draft[]>(() =>
    items.map((i) => ({
      id: i.id,
      label: i.label,
      freeLabel: i.freeLabel ?? "",
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

  const priorTotal = draft.reduce((s, r) => s + (r.priorValue ?? 0), 0);
  const hasPrior = draft.some((r) => r.priorValue !== null);
  const unitLabel = unit === "qty" ? "шт." : "UZS";

  return (
    <main className="mx-auto max-w-3xl px-4 pb-36 pt-8">
      {/* document header */}
      <header className="mb-5 rounded-xl border border-border bg-surface px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
              Humana Uzbekistan · сбор данных
            </p>
            <h1 className="mt-1.5 font-display text-[22px] font-semibold leading-tight">
              {kindLabel} — {monthName}
            </h1>
            {hint && <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-muted">{hint}</p>}
          </div>
          <div className="shrink-0 text-right text-[12.5px] leading-relaxed text-muted">
            <div>
              Позиций: <span className="num font-medium text-ink">{draft.length}</span>
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
      </header>

      {/* the form itself — a proper table */}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr className="border-b border-border bg-surface-low text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
              <th className="px-4 py-2.5 text-left font-semibold">Позиция</th>
              {hasPrior && <th className="w-36 px-3 py-2.5 text-right font-semibold">Прошлый месяц</th>}
              <th className="w-40 px-3 py-2.5 text-right font-semibold">{monthName} · {unitLabel}</th>
              <th className="w-56 px-4 py-2.5 text-left font-semibold">Комментарий</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {draft.map((r, i) => (
              <tr key={r.id ?? `new-${i}`} className="group">
                <td className="px-4 py-2 text-[13.5px] leading-snug">
                  {allowAddRows && !r.id ? (
                    <input
                      value={r.freeLabel}
                      onChange={(e) => set(i, { freeLabel: e.target.value, label: e.target.value })}
                      placeholder="Название клиента…"
                      className="w-full min-w-40 rounded-md border border-border bg-surface px-2 py-1.5 text-[13.5px] outline-none focus:border-accent"
                    />
                  ) : (
                    r.label
                  )}
                </td>
                {hasPrior && (
                  <td className="px-3 py-2 text-right">
                    {r.priorValue !== null ? (
                      <button
                        onClick={() => set(i, { value: fmtN(r.priorValue as number) })}
                        title="Нажмите, чтобы подставить это значение"
                        className="num rounded px-1.5 py-0.5 text-[13px] text-muted transition-colors hover:bg-accent-soft hover:text-accent"
                      >
                        {fmtN(r.priorValue)}
                      </button>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                )}
                <td className="px-3 py-2 text-right">
                  <input
                    inputMode="decimal"
                    value={r.value}
                    onChange={(e) => set(i, { value: e.target.value })}
                    onBlur={(e) => set(i, { value: pretty(e.target.value) })}
                    placeholder="0"
                    className="num h-9 w-32 rounded-md border border-border bg-surface px-2 text-right text-[14px] outline-none transition-colors focus:border-accent focus:ring-[3px] focus:ring-accent-soft"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    value={r.note}
                    onChange={(e) => set(i, { note: e.target.value })}
                    placeholder="—"
                    className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[12.5px] outline-none transition-colors placeholder:text-muted/50 hover:border-border focus:border-accent focus:bg-surface"
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border-strong bg-surface-low font-semibold">
              <td className="px-4 py-2.5 text-[13px]">Итого</td>
              {hasPrior && (
                <td className="num px-3 py-2.5 text-right text-[13px] text-muted">{fmtN(priorTotal)}</td>
              )}
              <td className="num px-5 py-2.5 text-right text-[14px]">{fmtN(total)}</td>
              <td className="px-4 py-2.5 text-right text-[12px] font-normal text-muted">
                заполнено {filled} из {draft.length}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {allowAddRows && (
        <button
          onClick={() =>
            setDraft((d) => [
              ...d,
              { label: "", freeLabel: "", priorValue: null, value: "", note: "" },
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
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
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
