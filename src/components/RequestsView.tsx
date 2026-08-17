"use client";

// «Запросы данных» — compose a request, watch its status, chase it.
// Chasing people is the actual work here, so the list leads with status and a
// «Напомнить» button rather than with the figures.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader, Input, PageTitle, Select } from "./ui";
import { IconCheck, IconCopy, IconPlus, IconSend, IconUser } from "./icons";
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
}
interface RequestLite {
  id: string;
  kind: string;
  kindLabel: string;
  monthId: string;
  monthNameRu: string;
  monthNameEn: string;
  contactName: string;
  contactHasChat: boolean;
  status: string;
  url: string;
  dueDate: string | null;
  createdAt: string;
  total: number;
  filled: number;
  accepted: number;
}

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
  contacts,
  requests,
}: {
  readOnly: boolean;
  telegramReady: boolean;
  emailReady: boolean;
  kinds: KindLite[];
  months: Array<{ id: string; nameRu: string; nameEn: string }>;
  contacts: ContactLite[];
  requests: RequestLite[];
}) {
  const { locale } = useT();
  const ru = locale === "ru";
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const monthName = (r: RequestLite) => (ru ? r.monthNameRu : r.monthNameEn);

  async function act(id: string, action: "send" | "remind" | "revoke") {
    setBusy(id);
    const result = await post({ action, id });
    setBusy(null);
    if (result.error) {
      setFlash(result.error);
    } else if (result.delivered) {
      const channels = (result.via ?? [])
        .map((v) => (v === "telegram" ? "Telegram" : "email"))
        .join(" + ");
      setFlash(ru ? `Отправлено: ${channels || "доставлено"}` : `Sent via ${channels || "delivered"}`);
    } else if (action !== "revoke") {
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
        />
        {requests.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-muted">
            {ru
              ? "Пока нет запросов. Создайте первый — например, OPEX за прошлый месяц вашему бухгалтеру."
              : "No requests yet. Create one — say last month's OPEX for your accountant."}
          </p>
        ) : (
          <div className="divide-y divide-border">
            {requests.map((r) => {
              const s = STATUS[r.status] ?? STATUS.DRAFT;
              const pct = r.total > 0 ? Math.round((r.filled / r.total) * 100) : 0;
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
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
                      {r.dueDate &&
                        ` · ${ru ? "срок" : "due"} ${new Date(r.dueDate).toLocaleDateString(ru ? "ru-RU" : "en-GB")}`}
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
                        onClick={() => navigator.clipboard?.writeText(r.url)}
                        title={ru ? "Скопировать ссылку" : "Copy link"}
                        className="rounded p-1.5 text-muted transition-colors hover:bg-surface-low hover:text-foreground"
                      >
                        <IconCopy size={15} />
                      </button>
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
                    </div>
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
  contacts,
  telegramReady,
  onDone,
}: {
  kinds: KindLite[];
  months: Array<{ id: string; nameRu: string; nameEn: string }>;
  contacts: ContactLite[];
  telegramReady: boolean;
  onDone: () => void;
}) {
  const { locale } = useT();
  const ru = locale === "ru";
  const [kind, setKind] = useState(kinds[0]?.id ?? "");
  const [monthId, setMonthId] = useState(months[months.length - 1]?.id ?? "");
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

  async function add() {
    if (!name.trim()) return;
    await crud("contact", "create", {
      data: { name: name.trim(), role: role.trim() || null, email: email.trim() || null },
    });
    setName("");
    setRole("");
    setEmail("");
    router.refresh();
  }

  return (
    <div className="p-4">
      <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
        {ru
          ? "Просто список тех, у кого вы запрашиваете данные — чтобы было видно, кто за что отвечает и кто ещё не ответил. Заводить учётные записи не нужно: у человека нет доступа в приложение, только ссылка на свою форму."
          : "Just the list of people you ask for figures — so you can see who owes what and who hasn't replied. No accounts needed: they never get access to the app, only a link to their own form."}
      </p>

      <div className="space-y-1.5">
        {contacts.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-2 text-[13px]">
            <IconUser size={14} />
            <span className="font-medium">{c.name}</span>
            {c.role && <span className="text-muted">· {c.role}</span>}
            {telegramReady &&
              (c.hasChat ? (
                <Badge tone="ok">Telegram{c.telegramUser ? ` @${c.telegramUser}` : ""}</Badge>
              ) : (
                <Badge tone="neutral">{ru ? "нет Telegram" : "no Telegram"}</Badge>
              ))}
            {readOnly ? (
              c.email && <Badge tone="ok">{c.email}</Badge>
            ) : (
              <ContactEmailCell id={c.id} email={c.email} ru={ru} />
            )}
          </div>
        ))}
        {contacts.length === 0 && (
          <p className="text-[13px] text-muted">{ru ? "Контактов пока нет." : "No contacts yet."}</p>
        )}
      </div>

      {!readOnly && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={ru ? "Имя" : "Name"}
            className="w-40"
          />
          <Input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder={ru ? "Роль (бухгалтер, склад)" : "Role"}
            className="w-52"
          />
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
            className="w-56"
          />
          <Button variant="secondary" onClick={add}>
            <IconPlus size={13} /> {ru ? "Добавить" : "Add"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Inline email on a contact row — commit on blur, empty clears the address. */
function ContactEmailCell({ id, email, ru }: { id: string; email: string | null; ru: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(email ?? "");
  const [last, setLast] = useState(email ?? "");
  if (last !== (email ?? "")) {
    setLast(email ?? "");
    setText(email ?? "");
  }
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={async () => {
        const v = text.trim();
        if (v === (email ?? "")) return;
        await crud("contact", "update", { id, data: { email: v || null } });
        router.refresh();
      }}
      placeholder={ru ? "email…" : "email…"}
      className="w-56 rounded-md border border-border bg-surface px-2 py-1 text-[12px] outline-none focus:border-accent"
    />
  );
}
