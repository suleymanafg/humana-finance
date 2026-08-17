"use client";

// «Запросы данных» — compose a request, watch its status, chase it.
// Chasing people is the actual work here, so the list leads with status and a
// «Напомнить» button rather than with the figures.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader, Input, PageTitle, Select } from "./ui";
import { IconCheck, IconCopy, IconPencil, IconPlus, IconSend, IconTrash, IconX } from "./icons";
import { Collapsible } from "./analysis";
import { crud } from "@/lib/crud-client";
import { useT } from "@/lib/locale-context";

interface KindLite {
  id: string;
  labelRu: string;
  labelEn: string;
}
interface ContactLite {
  id: string;
  name: string;
  role: string | null;
  telegramUser: string | null;
  hasChat: boolean;
  email: string | null;
  active: boolean;
  requestCount: number;
}
interface RequestLite {
  id: string;
  kind: string;
  kindLabel: string;
  monthId: string;
  monthNameRu: string;
  monthNameEn: string;
  contactId: string;
  contactName: string;
  contactHasChat: boolean;
  contactEmail: string | null;
  status: string;
  url: string;
  note: string | null;
  dueDate: string | null;
  createdAt: string;
  sentAt: string | null;
  submittedAt: string | null;
  total: number;
  filled: number;
  accepted: number;
}

/** Status buckets for the list filter — chasing needs «активные», review needs «к проверке». */
const FILTERS: Array<{ id: string; ru: string; en: string; statuses: string[] | null }> = [
  { id: "all", ru: "Все", en: "All", statuses: null },
  { id: "draft", ru: "Черновики", en: "Drafts", statuses: ["DRAFT"] },
  { id: "active", ru: "Ожидают ответа", en: "Awaiting reply", statuses: ["SENT", "OPENED", "PARTIAL"] },
  { id: "review", ru: "К проверке", en: "To review", statuses: ["SUBMITTED"] },
  { id: "done", ru: "Завершённые", en: "Finished", statuses: ["INTEGRATED", "REVOKED"] },
];

const STATUS: Record<string, { ru: string; en: string; tone: "neutral" | "accent" | "warn" | "ok" }> = {
  DRAFT: { ru: "Черновик", en: "Draft", tone: "neutral" },
  SENT: { ru: "Отправлено", en: "Sent", tone: "accent" },
  OPENED: { ru: "Открыто", en: "Opened", tone: "accent" },
  PARTIAL: { ru: "Заполняется", en: "In progress", tone: "warn" },
  SUBMITTED: { ru: "Готово к проверке", en: "Ready to review", tone: "warn" },
  INTEGRATED: { ru: "Интегрировано", en: "Integrated", tone: "ok" },
  REVOKED: { ru: "Отозвано", en: "Revoked", tone: "neutral" },
};

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as {
    ok?: boolean;
    error?: string;
    delivered?: boolean;
    via?: string[];
    reason?: string;
    url?: string;
  };
}

export default function RequestsView({
  readOnly,
  telegramReady,
  emailReady,
  kinds,
  months,
  defaultMonthId,
  contacts,
  requests,
}: {
  readOnly: boolean;
  telegramReady: boolean;
  emailReady: boolean;
  kinds: KindLite[];
  months: Array<{ id: string; nameRu: string; nameEn: string }>;
  defaultMonthId: string;
  contacts: ContactLite[];
  requests: RequestLite[];
}) {
  const { locale } = useT();
  const ru = locale === "ru";
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [filter, setFilter] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);

  const monthName = (r: RequestLite) => (ru ? r.monthNameRu : r.monthNameEn);
  const activeFilter = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const visibleRequests = activeFilter.statuses
    ? requests.filter((r) => activeFilter.statuses!.includes(r.status))
    : requests;

  async function act(id: string, action: "send" | "remind" | "revoke" | "delete") {
    if (action === "revoke" && !confirm(ru ? "Отозвать запрос? Ссылка перестанет работать." : "Revoke? The link will stop working."))
      return;
    if (
      action === "delete" &&
      !confirm(
        ru
          ? "Удалить запрос безвозвратно? Ссылка и все введённые данные будут удалены."
          : "Delete permanently? The link and everything entered through it will be removed."
      )
    )
      return;
    setBusy(id);
    const result = await post({ action, id });
    setBusy(null);
    if (result.error) {
      setFlash(result.error);
    } else if (action === "revoke" || action === "delete") {
      setFlash(action === "revoke" ? (ru ? "Отозвано" : "Revoked") : ru ? "Удалено" : "Deleted");
    } else if (result.delivered) {
      const channels = (result.via ?? [])
        .map((v) => (v === "telegram" ? "Telegram" : "email"))
        .join(" + ");
      setFlash(ru ? `Отправлено: ${channels || "доставлено"}` : `Sent via ${channels || "delivered"}`);
    } else {
      // no automatic channel: put the link on the clipboard so sending it
      // yourself is one action rather than a hunt for the copy button
      if (result.url) await navigator.clipboard?.writeText(result.url).catch(() => {});
      setFlash(
        ru
          ? "Ссылка скопирована — отправьте её любым способом"
          : "Link copied — send it however you like"
      );
    }
    router.refresh();
  }

  return (
    <div className="pb-16">
      <PageTitle
        title={ru ? "Запросы данных" : "Data requests"}
        subtitle={
          ru
            ? "Отправьте список того, что нужно заполнить. Ответы попадают на проверку и в отчёты только после вашего подтверждения."
            : "Send someone a list of figures to fill in. Their answers wait for your confirmation before they reach the reports."
        }
        right={
          !readOnly && (
            <Button onClick={() => setComposing((v) => !v)}>
              <IconPlus size={14} /> {ru ? "Новый запрос" : "New request"}
            </Button>
          )
        }
      />

      {flash && (
        <div className="mb-4 rounded-lg border border-border bg-surface-low px-3 py-2 text-[12.5px]">
          {flash}
          <button onClick={() => setFlash(null)} className="ml-2 text-muted hover:text-foreground">
            ×
          </button>
        </div>
      )}

      {!telegramReady && !emailReady && (
        <div className="mb-4 rounded-lg border border-border bg-surface-low px-3 py-2 text-[12.5px] text-muted">
          {ru
            ? "Автоотправка не подключена — ссылку копируете и отправляете сами, любым удобным способом. Всё остальное работает как обычно."
            : "No automatic delivery configured — copy each link and send it yourself, any way you like. Everything else works as normal."}
        </div>
      )}

      {composing && !readOnly && (
        <ComposeCard
          kinds={kinds}
          months={months}
          defaultMonthId={defaultMonthId}
          telegramReady={telegramReady}
          contacts={contacts.filter((c) => c.active)}
          onDone={() => {
            setComposing(false);
            router.refresh();
          }}
        />
      )}

      <Card className="mb-4">
        <CardHeader
          title={ru ? "Запросы" : "Requests"}
          desc={ru ? `${requests.length} всего` : `${requests.length} total`}
          right={
            <div className="flex flex-wrap items-center gap-1">
              {FILTERS.map((f) => {
                const n = f.statuses
                  ? requests.filter((r) => f.statuses!.includes(r.status)).length
                  : requests.length;
                if (f.id !== "all" && n === 0) return null;
                return (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                      filter === f.id
                        ? "bg-accent text-white"
                        : "text-muted hover:bg-surface-low hover:text-ink"
                    }`}
                  >
                    {ru ? f.ru : f.en} · {n}
                  </button>
                );
              })}
            </div>
          }
        />
        {visibleRequests.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-muted">
            {requests.length === 0
              ? ru
                ? "Пока нет запросов. Создайте первый — например, OPEX за прошлый месяц вашему бухгалтеру."
                : "No requests yet. Create one — say last month's OPEX for your accountant."
              : ru
                ? "В этом фильтре пусто."
                : "Nothing under this filter."}
          </p>
        ) : (
          <div className="divide-y divide-border">
            {visibleRequests.map((r) => {
              const s = STATUS[r.status] ?? STATUS.DRAFT;
              const pct = r.total > 0 ? Math.round((r.filled / r.total) * 100) : 0;
              const live = ["SENT", "OPENED", "PARTIAL", "SUBMITTED"].includes(r.status);
              const when = (iso: string | null) =>
                iso ? new Date(iso).toLocaleDateString(ru ? "ru-RU" : "en-GB") : "";
              return (
                <div key={r.id}>
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/requests/${r.id}`}
                          className="text-[13.5px] font-semibold hover:text-accent hover:underline"
                        >
                          {r.kindLabel}
                        </Link>
                        <span className="text-[13px] text-muted">· {monthName(r)}</span>
                        <Badge tone={s.tone}>{ru ? s.ru : s.en}</Badge>
                      </div>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {r.contactName}
                        {r.contactEmail ? ` · ${r.contactEmail}` : ""}
                        {r.dueDate && ` · ${ru ? "срок" : "due"} ${when(r.dueDate)}`}
                        {r.sentAt && ` · ${ru ? "отправлен" : "sent"} ${when(r.sentAt)}`}
                        {r.submittedAt && ` · ${ru ? "получен" : "received"} ${when(r.submittedAt)}`}
                        {r.status !== "DRAFT" && ` · ${ru ? "заполнено" : "filled"} ${r.filled}/${r.total}`}
                      </p>
                      {r.status !== "DRAFT" && r.status !== "INTEGRATED" && (
                        <div className="mt-1.5 h-1 w-full max-w-xs overflow-hidden rounded-full bg-surface-low">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </div>

                    {!readOnly && (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          onClick={async () => {
                            await navigator.clipboard?.writeText(r.url).catch(() => {});
                            setFlash(ru ? "Ссылка скопирована" : "Link copied");
                          }}
                          title={ru ? "Скопировать ссылку" : "Copy link"}
                          className="rounded p-1.5 text-muted transition-colors hover:bg-surface-low hover:text-foreground"
                        >
                          <IconCopy size={15} />
                        </button>
                        {r.status !== "INTEGRATED" && r.status !== "REVOKED" && (
                          <button
                            onClick={() => setEditingId(editingId === r.id ? null : r.id)}
                            title={ru ? "Изменить (срок, сообщение, получатель)" : "Edit (due, note, recipient)"}
                            className={`rounded p-1.5 transition-colors hover:bg-surface-low ${
                              editingId === r.id ? "text-accent" : "text-muted hover:text-foreground"
                            }`}
                          >
                            <IconPencil size={15} />
                          </button>
                        )}
                        {r.status === "DRAFT" && (
                          <Button onClick={() => act(r.id, "send")} disabled={busy === r.id}>
                            <IconSend size={13} /> {ru ? "Отправить" : "Send"}
                          </Button>
                        )}
                        {(r.status === "SENT" || r.status === "OPENED" || r.status === "PARTIAL") && (
                          <Button
                            variant="secondary"
                            onClick={() => act(r.id, "remind")}
                            disabled={busy === r.id}
                          >
                            {ru ? "Напомнить" : "Remind"}
                          </Button>
                        )}
                        {r.status === "SUBMITTED" && (
                          <Link href={`/requests/${r.id}`}>
                            <Button>{ru ? "Проверить" : "Review"}</Button>
                          </Link>
                        )}
                        {live && (
                          <button
                            onClick={() => act(r.id, "revoke")}
                            disabled={busy === r.id}
                            title={ru ? "Отозвать — ссылка перестанет работать" : "Revoke — the link stops working"}
                            className="rounded p-1.5 text-muted transition-colors hover:bg-surface-low hover:text-warn"
                          >
                            <IconX size={15} />
                          </button>
                        )}
                        <button
                          onClick={() => act(r.id, "delete")}
                          disabled={busy === r.id}
                          title={ru ? "Удалить" : "Delete"}
                          className="rounded p-1.5 text-muted transition-colors hover:bg-surface-low hover:text-danger"
                        >
                          <IconTrash size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                  {editingId === r.id && !readOnly && (
                    <RequestEditor
                      request={r}
                      contacts={contacts.filter((c) => c.active)}
                      ru={ru}
                      onDone={(msg) => {
                        setEditingId(null);
                        if (msg) setFlash(msg);
                        router.refresh();
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Collapsible
        title={ru ? "Контакты" : "Contacts"}
        note={
          telegramReady
            ? `${contacts.filter((c) => c.active).length} · ${
                contacts.filter((c) => c.hasChat).length
              } ${ru ? "в Telegram" : "on Telegram"}`
            : `${contacts.filter((c) => c.active).length}`
        }
      >
        <ContactsPanel
          contacts={contacts}
          readOnly={readOnly}
          ru={ru}
          telegramReady={telegramReady}
        />
      </Collapsible>
    </div>
  );
}

function ComposeCard({
  kinds,
  months,
  defaultMonthId,
  contacts,
  telegramReady,
  onDone,
}: {
  kinds: KindLite[];
  months: Array<{ id: string; nameRu: string; nameEn: string }>;
  defaultMonthId: string;
  contacts: ContactLite[];
  telegramReady: boolean;
  onDone: () => void;
}) {
  const { locale } = useT();
  const ru = locale === "ru";
  const [kind, setKind] = useState(kinds[0]?.id ?? "");
  const [monthId, setMonthId] = useState(defaultMonthId || (months.at(-1)?.id ?? ""));
  const [contactId, setContactId] = useState(contacts[0]?.id ?? "");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // adding a recipient inline: hunting for a collapsed panel elsewhere on the
  // page mid-compose is exactly the wrong moment to send someone away
  const [addingContact, setAddingContact] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const router = useRouter();

  async function addContact() {
    const name = newName.trim();
    if (!name) return;
    const created = await crud("contact", "create", {
      data: { name, role: newRole.trim() || null, email: newEmail.trim() || null },
    });
    if (created.error || !created.id) {
      setError(created.error ?? "error");
      return;
    }
    setContactId(created.id);
    setNewName("");
    setNewRole("");
    setNewEmail("");
    setAddingContact(false);
    setError(null);
    router.refresh();
  }

  async function create(andSend: boolean) {
    if (!contactId) {
      setError(ru ? "Сначала добавьте получателя" : "Add a recipient first");
      return;
    }
    setBusy(true);
    setError(null);
    const created = await post({
      action: "create",
      kind,
      monthId,
      contactId,
      dueDate: dueDate || null,
      note: note.trim() || null,
    });
    if (created.error || !("id" in created)) {
      setBusy(false);
      setError(created.error ?? "error");
      return;
    }
    if (andSend) await post({ action: "send", id: (created as { id: string }).id });
    setBusy(false);
    onDone();
  }

  return (
    <Card className="mb-4">
      <CardHeader title={ru ? "Новый запрос" : "New request"} />
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {ru ? "Что нужно" : "What"}
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {kinds.map((k) => (
              <option key={k.id} value={k.id}>
                {ru ? k.labelRu : k.labelEn}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {ru ? "Месяц" : "Month"}
          <Select value={monthId} onChange={(e) => setMonthId(e.target.value)}>
            {months.map((m) => (
              <option key={m.id} value={m.id}>
                {ru ? m.nameRu : m.nameEn}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex flex-col gap-1 text-[12px] text-muted">
          <span className="flex items-baseline justify-between gap-2">
            {ru ? "Кому" : "Who"}
            {!addingContact && contacts.length > 0 && (
              <button
                onClick={() => setAddingContact(true)}
                className="text-[11.5px] font-medium text-accent hover:underline"
              >
                + {ru ? "новый" : "new"}
              </button>
            )}
          </span>
          {addingContact || contacts.length === 0 ? (
            <div className="flex flex-wrap gap-1.5">
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addContact()}
                placeholder={ru ? "Имя" : "Name"}
                className="min-w-0 flex-1"
              />
              <Input
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addContact()}
                placeholder={ru ? "роль" : "role"}
                className="w-24 min-w-0"
              />
              <Input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addContact()}
                placeholder="email"
                className="w-44 min-w-0"
              />
              <Button variant="secondary" onClick={addContact} disabled={!newName.trim()}>
                <IconCheck size={13} />
              </Button>
            </div>
          ) : (
            <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.role ? ` · ${c.role}` : ""}
                  {telegramReady && !c.hasChat ? (ru ? " (нет Telegram)" : " (no Telegram)") : ""}
                </option>
              ))}
            </Select>
          )}
        </div>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {ru ? "Срок" : "Due"}
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted sm:col-span-2">
          {ru ? "Сообщение (необязательно)" : "Message (optional)"}
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={ru ? "Например: нужно до пятницы, до закрытия месяца" : "e.g. needed before we close the month"}
          />
        </label>
      </div>
      {error && <p className="px-4 pb-2 text-[12px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Button variant="secondary" onClick={() => create(false)} disabled={busy}>
          {ru ? "Сохранить черновик" : "Save draft"}
        </Button>
        <Button onClick={() => create(true)} disabled={busy}>
          <IconSend size={13} /> {busy ? (ru ? "…" : "…") : ru ? "Создать и отправить" : "Create and send"}
        </Button>
      </div>
    </Card>
  );
}

function ContactsPanel({
  contacts,
  readOnly,
  ru,
  telegramReady,
}: {
  contacts: ContactLite[];
  readOnly: boolean;
  ru: boolean;
  telegramReady: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!name.trim()) return;
    const res = await crud("contact", "create", {
      data: { name: name.trim(), role: role.trim() || null, email: email.trim() || null },
    });
    if (res.error) {
      setError(res.error);
      return;
    }
    setName("");
    setRole("");
    setEmail("");
    setError(null);
    router.refresh();
  }

  async function toggleActive(c: ContactLite) {
    await crud("contact", "update", { id: c.id, data: { active: !c.active } });
    router.refresh();
  }

  async function remove(c: ContactLite) {
    if (!confirm(ru ? `Удалить контакт «${c.name}»?` : `Delete contact "${c.name}"?`)) return;
    const res = await crud("contact", "delete", { id: c.id });
    if (res.error)
      setError(
        ru
          ? "Не удалось удалить — у контакта есть запросы. Деактивируйте его."
          : "Cannot delete — the contact has requests. Deactivate instead."
      );
    else setError(null);
    router.refresh();
  }

  return (
    <div className="p-4">
      <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
        {ru
          ? "Люди, у которых вы запрашиваете данные. Имя, роль и email правятся прямо в таблице. Удалить можно только контакт без запросов — остальных деактивируйте: они исчезнут из выбора получателя, но история сохранится."
          : "The people you ask for figures. Name, role and email edit in place. Only a contact with no requests can be deleted — deactivate the rest: they leave the recipient picker but history stays."}
      </p>

      {error && <p className="mb-2 text-[12px] text-danger">{error}</p>}

      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>{ru ? "Имя" : "Name"}</th>
              <th>{ru ? "Роль" : "Role"}</th>
              <th>Email</th>
              {telegramReady && <th>Telegram</th>}
              <th className="text-right">{ru ? "Запросов" : "Requests"}</th>
              <th>{ru ? "Статус" : "Status"}</th>
              {!readOnly && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id} className={c.active ? "" : "opacity-60"}>
                <td>
                  <ContactTextCell id={c.id} field="name" value={c.name} readOnly={readOnly} required width="w-40" />
                </td>
                <td>
                  <ContactTextCell
                    id={c.id}
                    field="role"
                    value={c.role ?? ""}
                    readOnly={readOnly}
                    placeholder={ru ? "роль…" : "role…"}
                    width="w-36"
                  />
                </td>
                <td>
                  <ContactTextCell
                    id={c.id}
                    field="email"
                    value={c.email ?? ""}
                    readOnly={readOnly}
                    placeholder="email…"
                    width="w-56"
                  />
                </td>
                {telegramReady && (
                  <td>
                    {c.hasChat ? (
                      <Badge tone="ok">{c.telegramUser ? `@${c.telegramUser}` : "✓"}</Badge>
                    ) : (
                      <Badge tone="neutral">—</Badge>
                    )}
                  </td>
                )}
                <td className="num text-right">{c.requestCount}</td>
                <td>
                  {readOnly ? (
                    <Badge tone={c.active ? "ok" : "neutral"}>
                      {c.active ? (ru ? "активен" : "active") : ru ? "выключен" : "inactive"}
                    </Badge>
                  ) : (
                    <button
                      onClick={() => toggleActive(c)}
                      title={ru ? "Активен — показывается в выборе получателя" : "Active — appears in the recipient picker"}
                      className={`h-4 w-7 rounded-full transition-colors ${c.active ? "bg-accent" : "bg-border-strong"}`}
                    >
                      <span
                        className={`block h-3 w-3 rounded-full bg-white transition-transform ${
                          c.active ? "translate-x-3.5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  )}
                </td>
                {!readOnly && (
                  <td>
                    {c.requestCount === 0 && (
                      <button
                        onClick={() => remove(c)}
                        title={ru ? "Удалить" : "Delete"}
                        className="text-muted transition-colors hover:text-danger"
                      >
                        <IconTrash size={13} />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {contacts.length === 0 && (
              <tr>
                <td colSpan={telegramReady ? 7 : 6} className="py-6 text-center text-[13px] text-muted">
                  {ru ? "Контактов пока нет." : "No contacts yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={ru ? "Имя" : "Name"} className="w-40" />
          <Input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder={ru ? "Роль (бухгалтер, склад)" : "Role"}
            className="w-52"
          />
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" className="w-56" />
          <Button variant="secondary" onClick={add} disabled={!name.trim()}>
            <IconPlus size={13} /> {ru ? "Добавить" : "Add"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Inline text field on a contact row — commits on blur, Enter commits, Escape reverts. */
function ContactTextCell({
  id,
  field,
  value,
  readOnly,
  placeholder,
  required = false,
  width = "w-40",
}: {
  id: string;
  field: "name" | "role" | "email";
  value: string;
  readOnly: boolean;
  placeholder?: string;
  required?: boolean;
  width?: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(value);
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    setText(value);
  }
  if (readOnly) return <span className="text-[13px]">{value || "—"}</span>;

  async function commit() {
    const v = text.trim();
    if (v === value) return;
    if (required && !v) {
      setText(value);
      return;
    }
    await crud("contact", "update", { id, data: { [field]: v || null } });
    router.refresh();
  }

  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setText(value);
      }}
      placeholder={placeholder}
      className={`${width} rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] outline-none transition-colors hover:border-border focus:border-accent focus:bg-surface`}
    />
  );
}

/** Inline editor under a request row: due date, message, and (drafts only) recipient. */
function RequestEditor({
  request,
  contacts,
  ru,
  onDone,
}: {
  request: RequestLite;
  contacts: ContactLite[];
  ru: boolean;
  onDone: (msg?: string) => void;
}) {
  const [dueDate, setDueDate] = useState(request.dueDate?.slice(0, 10) ?? "");
  const [note, setNote] = useState(request.note ?? "");
  const [contactId, setContactId] = useState(request.contactId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDraft = request.status === "DRAFT";

  async function save() {
    setBusy(true);
    const res = await post({
      action: "update",
      id: request.id,
      dueDate: dueDate || null,
      note: note || null,
      ...(isDraft && contactId !== request.contactId ? { contactId } : {}),
    });
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onDone(ru ? "Запрос обновлён" : "Request updated");
  }

  return (
    <div className="border-t border-dashed border-border bg-surface-low/50 px-4 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {ru ? "Срок" : "Due"}
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-[12px] text-muted">
          {ru ? "Сообщение" : "Message"}
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={ru ? "необязательно" : "optional"} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {ru ? "Получатель" : "Recipient"}
          <Select value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!isDraft}>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
        <Button onClick={save} disabled={busy}>
          {busy ? "…" : ru ? "Сохранить" : "Save"}
        </Button>
        <Button variant="secondary" onClick={() => onDone()}>
          {ru ? "Отмена" : "Cancel"}
        </Button>
      </div>
      {!isDraft && (
        <p className="mt-2 text-[11.5px] text-muted">
          {ru
            ? "Запрос уже отправлен: получателя изменить нельзя (ссылка принадлежит ему). Срок и сообщение попадут в следующее напоминание."
            : "Already sent: the recipient cannot change (the link is theirs). Due date and message go out with the next reminder."}
        </p>
      )}
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
