"use client";

// Small action buttons for the handover pages: they POST to a module endpoint,
// show the result in a line, and refresh the page.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { Button } from "../ui";
import { askAssistant } from "../ChatBody";
import { IconSparkles } from "../icons";
import type { Bi } from "@/lib/transition/model";

export function PostButton({
  url,
  body,
  label,
  confirmText,
  done,
  variant = "secondary",
}: {
  url: string;
  body?: Record<string, unknown>;
  label: Bi;
  confirmText?: Bi;
  /** the line shown after success; {key} is replaced by that field of the endpoint's JSON */
  done: Bi;
  variant?: "primary" | "secondary";
}) {
  const { l, locale } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);

  async function run() {
    if (confirmText && !confirm(l(confirmText))) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) setMsg({ text: String(json.error ?? `HTTP ${res.status}`), error: true });
      else {
        setMsg({ text: l(done).replace(/\{(\w+)\}/g, (_, k: string) => String(json[k] ?? "")), error: false });
        router.refresh();
      }
    } catch {
      setMsg({ text: locale === "ru" ? "Нет связи с сервером" : "No connection", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button variant={variant} onClick={run} disabled={busy}>
        {busy ? "…" : l(label)}
      </Button>
      {msg && <span className={`text-[12px] ${msg.error ? "text-danger" : "text-muted"}`}>{msg.text}</span>}
    </span>
  );
}

export function SeedPlanButton({ empty }: { empty: boolean }) {
  return (
    <PostButton
      url="/api/transition/seed"
      variant={empty ? "primary" : "secondary"}
      label={
        empty
          ? { ru: "Загрузить стартовый план", en: "Load the starting plan" }
          : { ru: "Добавить недостающее из стартового плана", en: "Add what's missing from the starting plan" }
      }
      done={{
        ru: "Добавлено: регионов {regions}, задач {tasks}, решений {decisions}",
        en: "Added: {regions} regions, {tasks} tasks, {decisions} decisions",
      }}
    />
  );
}

/** Buttons that put a prepared question to the AI assistant. */
export function AskGuide({ questions }: { questions: Bi[] }) {
  const { l } = useT();
  return (
    <div className="flex flex-col gap-1.5">
      {questions.map((q) => (
        <button
          key={q.en}
          onClick={() => askAssistant(l(q))}
          className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 text-left text-[12.5px] transition-colors hover:border-accent/40 hover:bg-surface-low"
        >
          <IconSparkles size={14} className="mt-0.5 shrink-0 text-accent" />
          <span>{l(q)}</span>
        </button>
      ))}
    </div>
  );
}

/** A search box that sets one search parameter when Enter is pressed. */
export function ParamSearch({ param, value, placeholder }: { param: string; value: string; placeholder: Bi }) {
  const { l } = useT();
  const router = useRouter();
  const [text, setText] = useState(value);
  return (
    <input
      value={text}
      placeholder={l(placeholder)}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        const p = new URLSearchParams(window.location.search);
        if (text.trim()) p.set(param, text.trim());
        else p.delete(param);
        router.push(`${window.location.pathname}?${p.toString()}`, { scroll: false });
      }}
      className="h-8 w-56 rounded-md border border-border bg-surface px-2.5 text-[13px] outline-none placeholder:text-muted/60 focus:border-accent"
    />
  );
}
