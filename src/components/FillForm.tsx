"use client";

// What the person outside the company sees. Deliberately plain: one column, big
// tap targets, prior month shown as a grey hint so an unchanged line is a
// single tap, and «Сохранить черновик» so a long list can be finished later.
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
  const [openNote, setOpenNote] = useState<number | null>(null);

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

  return (
    <main className="mx-auto max-w-md px-4 pb-32 pt-7">
      <header className="mb-5">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-accent">
          Humana · сбор данных
        </p>
        <h1 className="mt-1 font-display text-[21px] font-semibold leading-tight">
          {kindLabel}
          <span className="block text-muted">{monthName}</span>
        </h1>
        {hint && <p className="mt-2 text-[13px] leading-relaxed text-muted">{hint}</p>}
        {dueDate && (
          <p className="mt-1 text-[12.5px] text-warn">
            Срок: {new Date(dueDate).toLocaleDateString("ru-RU")}
          </p>
        )}
        {note && (
          <p className="mt-3 rounded-lg border border-border bg-surface-low px-3 py-2 text-[13px] leading-relaxed">
            {note}
          </p>
        )}
      </header>

      <div className="space-y-2">
        {draft.map((r, i) => (
          <div key={r.id ?? `new-${i}`} className="rounded-xl border border-border bg-surface p-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                {allowAddRows && !r.id ? (
                  <input
                    value={r.freeLabel}
                    onChange={(e) => set(i, { freeLabel: e.target.value, label: e.target.value })}
                    placeholder="Название клиента"
                    className="w-full rounded-lg border border-border bg-surface px-2 py-1 text-[13.5px] outline-none focus:border-accent"
                  />
                ) : (
                  <span className="block text-[13.5px] font-medium leading-snug">{r.label}</span>
                )}
                {r.priorValue !== null && (
                  <button
                    onClick={() => set(i, { value: fmtN(r.priorValue as number) })}
                    className="mt-0.5 text-[11.5px] text-muted hover:text-accent"
                    title="Подставить прошлый месяц"
                  >
                    прошлый месяц: <span className="num">{fmtN(r.priorValue)}</span>
                  </button>
                )}
              </div>
              <input
                inputMode="decimal"
                value={r.value}
                onChange={(e) => set(i, { value: e.target.value })}
                onBlur={(e) => set(i, { value: pretty(e.target.value) })}
                placeholder={unit === "qty" ? "шт." : "сум"}
                className="num h-10 w-32 shrink-0 rounded-lg border border-border bg-surface px-2 text-right text-[15px] outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-soft"
              />
            </div>

            {openNote === i || r.note ? (
              <input
                value={r.note}
                onChange={(e) => set(i, { note: e.target.value })}
                placeholder="Комментарий (необязательно)"
                className="mt-2 w-full rounded-lg border border-border bg-surface px-2 py-1 text-[12.5px] outline-none focus:border-accent"
              />
            ) : (
              <button
                onClick={() => setOpenNote(i)}
                className="mt-1.5 text-[11.5px] text-muted hover:text-accent"
              >
                + комментарий
              </button>
            )}
          </div>
        ))}
      </div>

      {allowAddRows && (
        <button
          onClick={() =>
            setDraft((d) => [
              ...d,
              { label: "", freeLabel: "", priorValue: null, value: "", note: "" },
            ])
          }
          className="mt-3 w-full rounded-xl border border-dashed border-border py-2.5 text-[13px] font-medium text-accent hover:bg-accent-soft"
        >
          + Добавить клиента
        </button>
      )}

      {/* sticky footer: progress, running total, and the two actions */}
      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-md">
          <div className="mb-2 flex items-baseline justify-between text-[12.5px]">
            <span className="text-muted">
              Заполнено {filled} из {draft.length}
            </span>
            <span>
              Итого <span className="num font-semibold">{fmtN(total)}</span>
              {unit === "qty" ? " шт." : ""}
            </span>
          </div>
          {error && <p className="mb-2 text-[12px] text-warn">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => send(false)}
              disabled={busy !== null}
              className="h-11 flex-1 rounded-lg border border-border bg-surface text-[13.5px] font-medium disabled:opacity-50"
            >
              {busy === "draft" ? "Сохранение…" : "Сохранить черновик"}
            </button>
            <button
              onClick={() => send(true)}
              disabled={busy !== null || filled === 0}
              className="h-11 flex-1 rounded-lg bg-accent text-[13.5px] font-semibold text-white disabled:opacity-50"
            >
              {busy === "submit" ? "Отправка…" : "Отправить"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
