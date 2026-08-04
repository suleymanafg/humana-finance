// Minimal Telegram Bot API client — send only, no polling. The webhook at
// /api/telegram/webhook handles the one inbound case we need (a recipient
// tapping Start, which is how we learn their chat id).
//
// Bots cannot message someone who has never opened the conversation; that is a
// platform rule, not a limitation here. Until a contact taps Start there is no
// chat id and the UI falls back to a copyable link.

const API = "https://api.telegram.org";

export const botToken = () => process.env.TELEGRAM_BOT_TOKEN ?? "";
export const telegramConfigured = () => botToken() !== "";

interface SendResult {
  ok: boolean;
  error?: string;
}

export async function sendMessage(chatId: string, text: string): Promise<SendResult> {
  const token = botToken();
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN not set" };
  try {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: false,
      }),
    });
    const json = (await res.json()) as { ok: boolean; description?: string };
    return json.ok ? { ok: true } : { ok: false, error: json.description ?? "telegram error" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/** Escape the few characters Telegram's HTML parse mode treats as markup. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function requestMessage(opts: {
  contactName: string;
  kindLabel: string;
  monthName: string;
  itemCount: number;
  dueDate: Date | null;
  note: string | null;
  url: string;
}): string {
  const lines = [
    `Здравствуйте, ${esc(opts.contactName)}!`,
    "",
    `Просьба заполнить: <b>${esc(opts.kindLabel)}</b> за <b>${esc(opts.monthName)}</b>`,
    `Позиций: ${opts.itemCount}`,
  ];
  if (opts.dueDate) lines.push(`Срок: ${opts.dueDate.toLocaleDateString("ru-RU")}`);
  if (opts.note) lines.push("", esc(opts.note));
  lines.push("", opts.url, "", "<i>Ссылка личная — не пересылайте её.</i>");
  return lines.join("\n");
}

export function reminderMessage(opts: {
  kindLabel: string;
  monthName: string;
  filled: number;
  total: number;
  url: string;
}): string {
  return [
    `Напоминание: <b>${esc(opts.kindLabel)}</b> за <b>${esc(opts.monthName)}</b>`,
    `Заполнено ${opts.filled} из ${opts.total}.`,
    "",
    opts.url,
  ].join("\n");
}
