"use client";

// Body of the floating AI-assistant panel. Talks to /api/chat, which streams
// NDJSON lines: {t:"text",d} | {t:"tool",label} | {t:"done"} | {t:"error",message}.
// History lives in sessionStorage as plain text and is re-sent whole on every
// question — the server is stateless. Mounted only client-side (after the
// launcher is clicked), so reading sessionStorage in the initializer is safe.
import { useEffect, useRef, useState } from "react";
import { Badge } from "./ui";
import { IconSparkles } from "./icons";
import { useT } from "@/lib/locale-context";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
}

const STORAGE_KEY = "hf-chat";

const STARTERS: { ru: string; en: string }[] = [
  { ru: "Почему изменилась прибыль в мае 2026?", en: "Why did profit change in May 2026?" },
  { ru: "Что сейчас не так с данными?", en: "What is currently wrong with the data?" },
  { ru: "Сходится ли баланс за апрель 2026?", en: "Does the April 2026 balance sheet reconcile?" },
  { ru: "Какой продукт даёт лучшую маржу?", en: "Which product has the best margin?" },
];

export default function ChatBody({ configured }: { configured: boolean }) {
  const { locale } = useT();
  const ru = locale === "ru";
  const [msgs, setMsgs] = useState<ChatMsg[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]") as ChatMsg[];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
    } catch {
      /* storage full — history just won't persist */
    }
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [msgs]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setInput("");
    const history: ChatMsg[] = [...msgs, { role: "user", content: q }];
    setMsgs([...history, { role: "assistant", content: "", tools: [] }]);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locale,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMsgs(history); // drop the empty assistant bubble
        setError(
          res.status === 503
            ? ru
              ? "AI не настроен: добавьте ANTHROPIC_API_KEY."
              : "AI is not configured: add ANTHROPIC_API_KEY."
            : (body.error ?? `HTTP ${res.status}`)
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const patch = (fn: (last: ChatMsg) => ChatMsg) =>
        setMsgs((cur) => {
          const next = [...cur];
          next[next.length - 1] = fn(next[next.length - 1]);
          return next;
        });

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: { t: string; d?: string; label?: string; message?: string };
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }
          if (evt.t === "text" && evt.d) {
            patch((m) => ({ ...m, content: m.content + evt.d }));
          } else if (evt.t === "tool" && evt.label) {
            patch((m) => ({ ...m, tools: [...(m.tools ?? []), evt.label!] }));
          } else if (evt.t === "error") {
            setError(evt.message ?? "error");
          }
        }
      }
    } catch {
      setError(ru ? "Связь прервалась. Попробуйте ещё раз." : "Connection lost. Try again.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
        {!configured && (
          <div className="rounded-lg border border-warn/20 bg-warn-soft px-3 py-2 text-[12px] text-warn">
            {ru
              ? "AI не настроен. Добавьте ANTHROPIC_API_KEY в .env (локально) или в переменные окружения Vercel, затем перезапустите."
              : "AI is not configured. Add ANTHROPIC_API_KEY to .env locally or to the Vercel environment variables, then restart."}
          </div>
        )}

        {msgs.length === 0 && (
          <div className="pt-6 text-center">
            <div className="mx-auto mb-2.5 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
              <IconSparkles size={18} />
            </div>
            <p className="mb-4 px-4 text-[12.5px] leading-relaxed text-muted">
              {ru
                ? "Спросите о выручке, марже, расходах, балансе или расхождениях в данных."
                : "Ask about revenue, margins, expenses, the balance sheet, or data discrepancies."}
            </p>
            <div className="flex flex-col items-stretch gap-1.5 px-2">
              {STARTERS.map((s) => (
                <button
                  key={s.ru}
                  onClick={() => ask(ru ? s.ru : s.en)}
                  disabled={busy || !configured}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-left text-[12.5px] transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  {ru ? s.ru : s.en}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[88%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[13px] leading-relaxed text-white"
                  : "max-w-[95%] rounded-2xl rounded-bl-md border border-border bg-background px-3.5 py-2 text-[13px] leading-relaxed"
              }
            >
              {m.role === "assistant" && (m.tools?.length ?? 0) > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {m.tools!.map((tl, j) => (
                    <Badge key={j} tone="accent">
                      {tl}
                    </Badge>
                  ))}
                </div>
              )}
              <div className="whitespace-pre-wrap">
                {m.content ||
                  (m.role === "assistant" && busy && i === msgs.length - 1 ? (
                    <span className="text-muted">{ru ? "Думаю…" : "Thinking…"}</span>
                  ) : (
                    m.content
                  ))}
              </div>
            </div>
          </div>
        ))}

        {error && (
          <div className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-[12px] text-danger">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border px-3 pb-2.5 pt-2.5">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            rows={1}
            placeholder={
              !configured
                ? ru
                  ? "AI не настроен"
                  : "AI not configured"
                : ru
                  ? "Спросите о цифрах…"
                  : "Ask about the figures…"
            }
            disabled={busy || !configured}
            className="max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-border bg-surface px-3 py-2 text-[13px] outline-none transition-shadow placeholder:text-muted/60 focus:border-accent focus:ring-[3px] focus:ring-accent-soft disabled:bg-background"
          />
          <button
            onClick={() => ask(input)}
            disabled={busy || !configured || !input.trim()}
            className="h-10 shrink-0 rounded-xl bg-accent px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50"
          >
            {busy ? "…" : ru ? "Спросить" : "Ask"}
          </button>
        </div>
        <div className="mt-1 flex items-center justify-between text-[10.5px] text-muted">
          <span>
            {ru ? "AI может ошибаться — проверяйте важное." : "AI can make mistakes — verify what matters."}
          </span>
          {msgs.length > 0 && (
            <button onClick={() => setMsgs([])} className="hover:text-accent hover:underline">
              {ru ? "Новый диалог" : "New chat"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
