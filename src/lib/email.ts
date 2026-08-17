// Minimal SMTP email client — send only, mirroring telegram.ts. Configured
// with a Gmail app password (SMTP_USER / SMTP_PASS); switching to a
// transactional provider later is an env change, not a code change.
//
// Templates are plain, table-free HTML so they render the same in Gmail,
// Outlook and phone clients. The fill link is the whole point of the message;
// everything else stays short.
import nodemailer from "nodemailer";

export const emailConfigured = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS);

/** Where owner notifications (a responder submitted data) are sent. */
export const notifyAddress = () => process.env.NOTIFY_EMAIL || process.env.SMTP_USER || "";

interface SendResult {
  ok: boolean;
  error?: string;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<SendResult> {
  if (!emailConfigured()) return { ok: false, error: "SMTP_USER / SMTP_PASS not set" };
  try {
    const port = Number(process.env.SMTP_PORT ?? 465);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "smtp.gmail.com",
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.MAIL_FROM ?? `Humana Finance <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "smtp error" };
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const button = (url: string, label: string) =>
  `<p style="margin:24px 0"><a href="${url}" style="background:#1f108e;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">${label}</a></p>` +
  `<p style="color:#667085;font-size:13px">Если кнопка не открывается — скопируйте ссылку:<br><a href="${url}">${url}</a></p>`;

const wrap = (body: string) =>
  `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1d2939;max-width:560px;margin:0 auto;padding:8px 4px">${body}` +
  `<p style="color:#98a2b3;font-size:12px;margin-top:32px">Humana Finance · Turbo Impex + Fargo</p></div>`;

export function requestEmail(opts: {
  contactName: string;
  kindLabel: string;
  monthName: string;
  itemCount: number;
  dueDate: Date | null;
  note: string | null;
  url: string;
}): { subject: string; html: string } {
  const lines = [
    `<p>Здравствуйте, ${esc(opts.contactName)}!</p>`,
    `<p>Просьба заполнить: <b>${esc(opts.kindLabel)}</b> за <b>${esc(opts.monthName)}</b> (${opts.itemCount} позиций).</p>`,
  ];
  if (opts.dueDate) lines.push(`<p>Срок: <b>${opts.dueDate.toLocaleDateString("ru-RU")}</b></p>`);
  if (opts.note) lines.push(`<p>${esc(opts.note)}</p>`);
  lines.push(button(opts.url, "Заполнить данные"));
  lines.push(`<p style="color:#667085;font-size:13px"><i>Ссылка личная — не пересылайте её.</i></p>`);
  return {
    subject: `${opts.kindLabel} — ${opts.monthName} · Humana Finance`,
    html: wrap(lines.join("")),
  };
}

export function reminderEmail(opts: {
  kindLabel: string;
  monthName: string;
  filled: number;
  total: number;
  url: string;
}): { subject: string; html: string } {
  return {
    subject: `Напоминание: ${opts.kindLabel} — ${opts.monthName}`,
    html: wrap(
      `<p>Напоминание: <b>${esc(opts.kindLabel)}</b> за <b>${esc(opts.monthName)}</b>.</p>` +
        `<p>Заполнено ${opts.filled} из ${opts.total}.</p>` +
        button(opts.url, "Продолжить заполнение")
    ),
  };
}

export function submittedNotice(opts: {
  contactName: string;
  kindLabel: string;
  monthName: string;
  filled: number;
  total: number;
  reviewUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `Данные получены: ${opts.kindLabel} — ${opts.monthName} (${opts.contactName})`,
    html: wrap(
      `<p><b>${esc(opts.contactName)}</b> прислал(а) данные: <b>${esc(opts.kindLabel)}</b> за <b>${esc(opts.monthName)}</b>.</p>` +
        `<p>Заполнено ${opts.filled} из ${opts.total}. Цифры ждут вашей проверки — в P&L они попадут только после интеграции.</p>` +
        button(opts.reviewUrl, "Проверить и интегрировать")
    ),
  };
}
