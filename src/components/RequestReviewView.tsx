"use client";

// Review a submission before any of it reaches the reports. Each line shows
// what the app holds now against what was sent, with the delta, so the eye
// lands on what actually changes. Only ACCEPTED lines are written.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader, Num, PageTitle } from "./ui";
import { IconCheck, IconX } from "./icons";
import { fmtN, toNum } from "@/lib/format";
import { useT } from "@/lib/locale-context";

interface ItemUI {
  id: string;
  label: string;
  priorValue: number | null;
  currentValue: number | null;
  value: number | null;
  note: string | null;
  decision: string;
}

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as { ok?: boolean; error?: string; integrated?: number };
}

export default function RequestReviewView({
  readOnly,
  id,
  kindLabel,
  unit,
  monthNameRu,
  monthNameEn,
  contactName,
  status,
  url,
  submittedAt,
  items,
  currentValues,
}: {
  readOnly: boolean;
  id: string;
  kindLabel: string;
  unit: "money" | "qty";
  monthNameRu: string;
  monthNameEn: string;
  contactName: string;
  status: string;
  url: string;
  submittedAt: string | null;
  items: ItemUI[];
  currentValues: Record<string, number | null>;
}) {
  const { locale } = useT();
  const ru = locale === "ru";
  const router = useRouter();
  const monthName = ru ? monthNameRu : monthNameEn;

  const [rows, setRows] = useState<ItemUI[]>(() =>
    items.map((i) => ({ ...i, currentValue: currentValues[i.id] ?? null }))
  );
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const integrated = status === "INTEGRATED";
  const answered = rows.filter((r) => r.value !== null);
  const accepted = rows.filter((r) => r.decision === "ACCEPTED" && r.value !== null);
  const acceptedTotal = useMemo(
    () => accepted.reduce((s, r) => s + (r.value ?? 0), 0),
    [accepted]
  );

  async function decide(itemId: string, decision: "ACCEPTED" | "REJECTED" | "PENDING") {
    setRows((rs) => rs.map((r) => (r.id === itemId ? { ...r, decision } : r)));
    await post({ action: "decide", itemId, decision });
  }

  async function decideAll(decision: "ACCEPTED" | "REJECTED") {
    setRows((rs) =>
      rs.map((r) => (decision === "ACCEPTED" && r.value === null ? r : { ...r, decision }))
    );
    await post({ action: "decideAll", id, decision });
  }

  async function saveEdit(itemId: string) {
    const raw = edits[itemId];
    if (raw === undefined) return;
    const value = raw.trim() === "" ? null : toNum(raw);
    setRows((rs) => rs.map((r) => (r.id === itemId ? { ...r, value } : r)));
    setEdits((e) => {
      const next = { ...e };
      delete next[itemId];
      return next;
    });
    await post({ action: "decide", itemId, decision: "ACCEPTED", value });
    setRows((rs) => rs.map((r) => (r.id === itemId ? { ...r, decision: "ACCEPTED" } : r)));
  }

  async function integrate() {
    if (accepted.length === 0) return;
    setBusy(true);
    setError(null);
    const result = await post({ action: "integrate", id });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="pb-16">
      <PageTitle
        title={`${kindLabel} · ${monthName}`}
        subtitle={
          ru
            ? `От: ${contactName}${submittedAt ? ` · отправлено ${new Date(submittedAt).toLocaleString("ru-RU")}` : ""}`
            : `From: ${contactName}${submittedAt ? ` · sent ${new Date(submittedAt).toLocaleString("en-GB")}` : ""}`
        }
        right={
          <Link href="/requests">
            <Button variant="secondary">← {ru ? "Все запросы" : "All requests"}</Button>
          </Link>
        }
      />

      {integrated && (
        <div className="mb-4 rounded-lg border border-ok/20 bg-ok-soft px-3 py-2 text-[12.5px] text-ok">
          {ru
            ? "Данные уже интегрированы — ссылка больше не работает."
            : "Already integrated — the link no longer works."}
        </div>
      )}

      {!integrated && answered.length === 0 && (
        <div className="mb-4 rounded-lg border border-border bg-surface-low px-3 py-2 text-[12.5px]">
          {ru ? "Пока ничего не заполнено. Ссылка: " : "Nothing filled in yet. Link: "}
          <span className="break-all font-mono text-[11.5px]">{url}</span>
        </div>
      )}

      <Card>
        <CardHeader
          title={ru ? "Проверка" : "Review"}
          desc={
            ru
              ? `Заполнено ${answered.length} из ${rows.length} · принято ${accepted.length}`
              : `${answered.length} of ${rows.length} filled · ${accepted.length} accepted`
          }
          right={
            !readOnly && !integrated ? (
              <>
                <Button variant="secondary" onClick={() => decideAll("ACCEPTED")}>
                  {ru ? "Принять все" : "Accept all"}
                </Button>
                <Button variant="secondary" onClick={() => decideAll("REJECTED")}>
                  {ru ? "Снять все" : "Clear all"}
                </Button>
              </>
            ) : undefined
          }
        />
        <div className="overflow-x-auto">
          <table className="tbl w-full">
            <thead>
              <tr>
                <th>{ru ? "Позиция" : "Line"}</th>
                <th className="text-right">{ru ? "Сейчас" : "Current"}</th>
                <th className="text-right">{ru ? "Прислали" : "Submitted"}</th>
                <th className="text-right">{ru ? "Разница" : "Delta"}</th>
                <th className="w-24 text-center">{ru ? "Решение" : "Decision"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const missing = r.value === null;
                const delta = missing ? null : (r.value as number) - (r.currentValue ?? 0);
                const changed = delta !== null && Math.abs(delta) >= 0.5;
                return (
                  <tr
                    key={r.id}
                    className={r.decision === "REJECTED" ? "opacity-45" : undefined}
                  >
                    <td>
                      <span className="text-[13px]">{r.label}</span>
                      {r.note && (
                        <span className="mt-0.5 block text-[11.5px] italic text-muted">
                          «{r.note}»
                        </span>
                      )}
                    </td>
                    <td className="text-right">
                      {r.currentValue === null ? (
                        <span className="text-[12px] text-muted">—</span>
                      ) : (
                        <Num v={r.currentValue} className="text-muted" />
                      )}
                    </td>
                    <td className="text-right">
                      {missing ? (
                        <span className="text-[12px] text-muted">
                          {ru ? "не заполнено" : "not filled"}
                        </span>
                      ) : edits[r.id] !== undefined ? (
                        <input
                          autoFocus
                          value={edits[r.id]}
                          onChange={(e) => setEdits((s) => ({ ...s, [r.id]: e.target.value }))}
                          onBlur={() => saveEdit(r.id)}
                          onKeyDown={(e) => e.key === "Enter" && saveEdit(r.id)}
                          className="num h-7 w-28 rounded border border-accent bg-surface px-1.5 text-right text-[13px] outline-none"
                        />
                      ) : (
                        <button
                          onClick={() =>
                            !readOnly && !integrated &&
                            setEdits((s) => ({ ...s, [r.id]: fmtN(r.value) }))
                          }
                          className="num font-semibold hover:text-accent"
                          title={ru ? "Изменить" : "Edit"}
                        >
                          {fmtN(r.value)}
                        </button>
                      )}
                    </td>
                    <td className="text-right">
                      {delta === null ? (
                        <span className="text-[12px] text-muted">—</span>
                      ) : changed ? (
                        <Num v={delta} />
                      ) : (
                        <span className="text-[12px] text-muted">
                          {ru ? "без изменений" : "no change"}
                        </span>
                      )}
                    </td>
                    <td>
                      {integrated ? (
                        <div className="text-center">
                          {r.decision === "ACCEPTED" ? (
                            <Badge tone="ok">{ru ? "принято" : "accepted"}</Badge>
                          ) : (
                            <span className="text-[12px] text-muted">—</span>
                          )}
                        </div>
                      ) : (
                        <div className="flex justify-center gap-1">
                          <button
                            disabled={readOnly || missing}
                            onClick={() =>
                              decide(r.id, r.decision === "ACCEPTED" ? "PENDING" : "ACCEPTED")
                            }
                            title={ru ? "Принять" : "Accept"}
                            className={`rounded p-1 transition-colors disabled:opacity-30 ${
                              r.decision === "ACCEPTED"
                                ? "bg-ok-soft text-ok"
                                : "text-muted hover:bg-surface-low hover:text-ok"
                            }`}
                          >
                            <IconCheck size={14} />
                          </button>
                          <button
                            disabled={readOnly}
                            onClick={() =>
                              decide(r.id, r.decision === "REJECTED" ? "PENDING" : "REJECTED")
                            }
                            title={ru ? "Отклонить" : "Reject"}
                            className={`rounded p-1 transition-colors disabled:opacity-30 ${
                              r.decision === "REJECTED"
                                ? "bg-danger-soft text-danger"
                                : "text-muted hover:bg-surface-low hover:text-danger"
                            }`}
                          >
                            <IconX size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!integrated && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <span className="text-[12.5px] text-muted">
              {ru ? "К записи" : "Will write"}: {accepted.length}{" "}
              {ru ? "позиций" : "lines"} ·{" "}
              <span className="num font-semibold text-foreground">{fmtN(acceptedTotal)}</span>
              {unit === "qty" ? (ru ? " шт." : " units") : ""}
            </span>
            <div className="flex items-center gap-2">
              {error && <span className="text-[12px] text-danger">{error}</span>}
              <Button onClick={integrate} disabled={readOnly || busy || accepted.length === 0}>
                {busy ? (ru ? "Запись…" : "Writing…") : ru ? "Интегрировать" : "Integrate"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
