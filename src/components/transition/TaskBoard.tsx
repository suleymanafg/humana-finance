"use client";

// The handover plan: tasks grouped by workstream. Status changes inline; the
// rest of a task is edited in a dialog. Writes go through /api/crud/trTask.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { crud } from "@/lib/crud-client";
import {
  PRIORITY,
  TASK_STATUS,
  TR_STREAMS,
  isClosedTask,
  optionsOf,
  todayYmd,
  type Bi,
} from "@/lib/transition/model";
import type { TaskView } from "@/lib/transition/tasks";
import { Badge, Button, IconButton, Input, Modal, Select } from "../ui";
import { IconCheck, IconPencil, IconPlus } from "../icons";

type Filter = "open" | "attention" | "all";

const fmtDate = (d: string) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}` : "");

export default function TaskBoard({ tasks, regions }: { tasks: TaskView[]; regions: Array<{ id: string; name: string }> }) {
  const { l, locale } = useT();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("open");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Partial<TaskView> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const title = (t: Pick<TaskView, "title" | "titleEn">) => (locale === "en" && t.titleEn ? t.titleEn : t.title);
  const details = (t: Pick<TaskView, "details" | "detailsEn">) => (locale === "en" && t.detailsEn ? t.detailsEn : t.details);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const visible = tasks.filter((t) => {
    if (filter === "open" && isClosedTask(t.status)) return false;
    if (filter === "attention" && !(t.overdue || t.status === "BLOCKED" || t.waiting || (t.priority === "URGENT" && !isClosedTask(t.status))))
      return false;
    if (query) {
      const q = query.toLowerCase();
      const hay = `${t.title} ${t.titleEn ?? ""} ${t.owner ?? ""} ${t.notes ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  async function setStatus(t: TaskView, status: string) {
    setError(null);
    const doneAt = status === "DONE" ? todayYmd() : null;
    const res = await crud("trTask", "update", { id: t.id, data: { status, doneAt } });
    if (res.error) setError(res.error);
    router.refresh();
  }

  async function save() {
    if (!editing) return;
    setError(null);
    const data: Record<string, unknown> = {
      stream: editing.stream,
      title: editing.title?.trim() || editing.titleEn?.trim(),
      titleEn: editing.titleEn?.trim() || null,
      details: editing.details?.trim() || null,
      detailsEn: editing.detailsEn?.trim() || null,
      owner: editing.owner?.trim() || null,
      status: editing.status ?? "TODO",
      priority: editing.priority ?? "NORMAL",
      startDate: editing.startDate || null,
      dueDate: editing.dueDate || null,
      dependsOnId: editing.dependsOnId || null,
      regionId: editing.regionId || null,
      notes: editing.notes?.trim() || null,
    };
    if (!data.title) {
      setError(l({ ru: "Нужно название задачи", en: "The task needs a title" }));
      return;
    }
    const prev = editing.id ? byId.get(editing.id) : undefined;
    if (data.status === "DONE" && prev?.status !== "DONE") data.doneAt = todayYmd();
    if (data.status !== "DONE") data.doneAt = null;
    const res = editing.id
      ? await crud("trTask", "update", { id: editing.id, data })
      : await crud("trTask", "create", { data });
    if (res.error) {
      setError(res.error);
      return;
    }
    setEditing(null);
    router.refresh();
  }

  async function remove() {
    if (!editing?.id || !confirm(l({ ru: "Удалить задачу?", en: "Delete this task?" }))) return;
    const res = await crud("trTask", "delete", { id: editing.id });
    if (res.error) {
      setError(res.error);
      return;
    }
    setEditing(null);
    router.refresh();
  }

  const filters: Array<{ value: Filter; label: Bi }> = [
    { value: "open", label: { ru: "Открытые", en: "Open" } },
    { value: "attention", label: { ru: "Требуют внимания", en: "Need attention" } },
    { value: "all", label: { ru: "Все", en: "All" } },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-border bg-surface p-0.5">
          {filters.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded px-3 py-1 text-[12.5px] transition-colors ${
                filter === f.value ? "bg-accent text-white" : "text-muted hover:text-foreground"
              }`}
            >
              {l(f.label)}
            </button>
          ))}
        </div>
        <Input
          placeholder={l({ ru: "Поиск по задачам", en: "Search tasks" })}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-64"
        />
        {error && <span className="text-[12px] text-danger">{error}</span>}
      </div>

      <div className="space-y-4">
        {TR_STREAMS.map((s) => {
          const all = tasks.filter((t) => t.stream === s.key && t.status !== "DROPPED");
          const rows = visible.filter((t) => t.stream === s.key);
          if (all.length === 0 && filter !== "all") return null;
          const done = all.filter((t) => t.status === "DONE").length;
          return (
            <section key={s.key} className="quiet-card overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <h2 className="text-[13px] font-semibold tracking-[-0.01em]">{l(s.label)}</h2>
                  <p className="mt-0.5 text-[12px] text-muted">{l(s.desc)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="num text-[12px] text-muted">
                    {done}/{all.length}
                  </span>
                  <IconButton
                    tone="accent"
                    title={l({ ru: "Добавить задачу", en: "Add a task" })}
                    onClick={() => setEditing({ stream: s.key, status: "TODO", priority: "NORMAL" })}
                  >
                    <IconPlus size={15} />
                  </IconButton>
                </div>
              </div>
              {rows.length === 0 ? (
                <div className="px-4 py-3 text-[12.5px] text-muted">
                  {l({ ru: "Нет задач в этом фильтре", en: "No tasks in this filter" })}
                </div>
              ) : (
                <table className="tbl">
                  <tbody>
                    {rows.map((t) => {
                      const dep = t.dependsOnId ? byId.get(t.dependsOnId) : undefined;
                      const region = regions.find((r) => r.id === t.regionId);
                      const closed = isClosedTask(t.status);
                      return (
                        <tr key={t.id} className="group">
                          <td style={{ width: 150 }}>
                            <Select
                              value={t.status}
                              onChange={(e) => setStatus(t, e.target.value)}
                              className="w-full"
                              aria-label={l({ ru: "Статус", en: "Status" })}
                            >
                              {optionsOf(TASK_STATUS, locale).map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </Select>
                          </td>
                          <td>
                            <div className={`text-[13px] ${closed ? "text-muted line-through decoration-border-strong" : ""}`}>
                              {title(t)}
                            </div>
                            {(details(t) || dep || region || t.notes) && (
                              <div className="mt-0.5 space-y-0.5 text-[12px] leading-snug text-muted">
                                {details(t) && <div>{details(t)}</div>}
                                {t.notes && <div>{t.notes}</div>}
                                {dep && (
                                  <div className={t.waiting ? "text-warn" : ""}>
                                    {l({ ru: "После: ", en: "After: " })}
                                    {title(dep)}
                                    {!t.waiting && <IconCheck size={12} className="ml-1 inline text-ok" />}
                                  </div>
                                )}
                                {region && <div>{region.name}</div>}
                              </div>
                            )}
                          </td>
                          <td style={{ width: 110 }}>
                            {t.priority !== "NORMAL" && !closed && (
                              <Badge tone={PRIORITY[t.priority]?.tone}>{l(PRIORITY[t.priority]?.label ?? { ru: t.priority, en: t.priority })}</Badge>
                            )}
                          </td>
                          <td style={{ width: 120 }} className="text-[12.5px] text-muted">
                            {t.owner}
                          </td>
                          <td style={{ width: 120 }} className="whitespace-nowrap text-right">
                            {t.dueDate && (
                              <span
                                className={`num text-[12.5px] ${
                                  closed ? "text-muted" : t.overdue ? "font-semibold text-danger" : (t.dueIn ?? 99) <= 7 ? "text-warn" : ""
                                }`}
                                title={t.dueDate}
                              >
                                {fmtDate(t.dueDate)}
                              </span>
                            )}
                            {t.status === "DONE" && t.doneAt && (
                              <div className="text-[11px] text-ok">
                                {l({ ru: "готово ", en: "done " })}
                                {fmtDate(t.doneAt)}
                              </div>
                            )}
                          </td>
                          <td style={{ width: 44 }} className="text-right">
                            <IconButton
                              tone="accent"
                              title={l({ ru: "Изменить", en: "Edit" })}
                              onClick={() => setEditing({ ...t })}
                              className="opacity-0 transition-opacity group-hover:opacity-100"
                            >
                              <IconPencil size={14} />
                            </IconButton>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
      </div>

      {editing && (
        <Modal
          title={editing.id ? l({ ru: "Задача", en: "Task" }) : l({ ru: "Новая задача", en: "New task" })}
          onClose={() => setEditing(null)}
          wide
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label={{ ru: "Название (RU)", en: "Title (RU)" }} wide>
              <Input value={editing.title ?? ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className="w-full" />
            </Field>
            <Field label={{ ru: "Название (EN)", en: "Title (EN)" }} wide>
              <Input value={editing.titleEn ?? ""} onChange={(e) => setEditing({ ...editing, titleEn: e.target.value })} className="w-full" />
            </Field>
            <Field label={{ ru: "Подробности (RU)", en: "Details (RU)" }}>
              <TextArea value={editing.details ?? ""} onChange={(v) => setEditing({ ...editing, details: v })} />
            </Field>
            <Field label={{ ru: "Подробности (EN)", en: "Details (EN)" }}>
              <TextArea value={editing.detailsEn ?? ""} onChange={(v) => setEditing({ ...editing, detailsEn: v })} />
            </Field>
            <Field label={{ ru: "Направление", en: "Workstream" }}>
              <Select value={editing.stream ?? ""} onChange={(e) => setEditing({ ...editing, stream: e.target.value })} className="w-full">
                {TR_STREAMS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {l(s.label)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={{ ru: "Исполнитель", en: "Owner" }}>
              <Input value={editing.owner ?? ""} onChange={(e) => setEditing({ ...editing, owner: e.target.value })} className="w-full" />
            </Field>
            <Field label={{ ru: "Статус", en: "Status" }}>
              <Select value={editing.status ?? "TODO"} onChange={(e) => setEditing({ ...editing, status: e.target.value })} className="w-full">
                {optionsOf(TASK_STATUS, locale).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={{ ru: "Приоритет", en: "Priority" }}>
              <Select value={editing.priority ?? "NORMAL"} onChange={(e) => setEditing({ ...editing, priority: e.target.value })} className="w-full">
                {optionsOf(PRIORITY, locale).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={{ ru: "Начало", en: "Start" }}>
              <Input type="date" value={editing.startDate ?? ""} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })} className="w-full" />
            </Field>
            <Field label={{ ru: "Срок", en: "Due" }}>
              <Input type="date" value={editing.dueDate ?? ""} onChange={(e) => setEditing({ ...editing, dueDate: e.target.value })} className="w-full" />
            </Field>
            <Field label={{ ru: "После задачи", en: "After task" }}>
              <Select
                value={editing.dependsOnId ?? ""}
                onChange={(e) => setEditing({ ...editing, dependsOnId: e.target.value || null })}
                className="w-full"
              >
                <option value="">—</option>
                {tasks
                  .filter((t) => t.id !== editing.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {title(t).slice(0, 80)}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={{ ru: "Регион", en: "Region" }}>
              <Select
                value={editing.regionId ?? ""}
                onChange={(e) => setEditing({ ...editing, regionId: e.target.value || null })}
                className="w-full"
              >
                <option value="">—</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={{ ru: "Заметки", en: "Notes" }} wide>
              <TextArea value={editing.notes ?? ""} onChange={(v) => setEditing({ ...editing, notes: v })} />
            </Field>
          </div>
          <div className="mt-4 flex items-center justify-between">
            {editing.id ? (
              <Button variant="danger" onClick={remove}>
                {l({ ru: "Удалить", en: "Delete" })}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              {error && <span className="text-[12px] text-danger">{error}</span>}
              <Button variant="secondary" onClick={() => setEditing(null)}>
                {l({ ru: "Отмена", en: "Cancel" })}
              </Button>
              <Button onClick={save}>{l({ ru: "Сохранить", en: "Save" })}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, children, wide = false }: { label: Bi; children: React.ReactNode; wide?: boolean }) {
  const { l } = useT();
  return (
    <label className={`flex flex-col gap-1 ${wide ? "col-span-2" : ""}`}>
      <span className="text-[12px] font-semibold text-muted">{l(label)}</span>
      {children}
    </label>
  );
}

export function TextArea({ value, onChange, rows = 3 }: { value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <textarea
      value={value}
      rows={rows}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] shadow-[0_1px_2px_rgba(16,24,40,0.04)] outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent-soft"
    />
  );
}
