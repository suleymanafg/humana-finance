// Telegram webhook. The only inbound case we care about is a recipient tapping
// Start, which is how a Contact gets a chat id — bots cannot message anyone who
// has not opened the conversation first.
//
// The path carries a secret segment set as TELEGRAM_WEBHOOK_SECRET so the
// endpoint is not callable by anyone who guesses the URL. Message text is
// treated purely as data: nothing here interprets it as an instruction.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { sendMessage, telegramConfigured } from "@/lib/telegram";

interface TgUpdate {
  message?: {
    text?: string;
    chat?: { id?: number; first_name?: string; last_name?: string; username?: string };
  };
}

export async function POST(request: NextRequest) {
  // Dormant unless a bot is actually configured. Without this the route would
  // be an unauthenticated public endpoint that creates Contact rows.
  if (!telegramConfigured()) return NextResponse.json({ error: "not found" }, { status: 404 });

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const update = (await request.json().catch(() => ({}))) as TgUpdate;
  const chat = update.message?.chat;
  const chatId = chat?.id ? String(chat.id) : null;
  if (!chatId) return NextResponse.json({ ok: true });

  const displayName =
    [chat?.first_name, chat?.last_name].filter(Boolean).join(" ").trim() ||
    chat?.username ||
    `chat ${chatId}`;

  const existing = await prisma.contact.findUnique({ where: { telegramChatId: chatId } });
  if (!existing) {
    await prisma.contact.create({
      data: {
        name: displayName,
        telegramChatId: chatId,
        telegramUser: chat?.username ?? null,
      },
    });
    await sendMessage(
      chatId,
      "Здравствуйте! Вы подключены к сбору данных Humana. Когда появится запрос, я пришлю ссылку на форму."
    );
  } else if (chat?.username && existing.telegramUser !== chat.username) {
    await prisma.contact.update({
      where: { id: existing.id },
      data: { telegramUser: chat.username },
    });
  }

  return NextResponse.json({ ok: true });
}
