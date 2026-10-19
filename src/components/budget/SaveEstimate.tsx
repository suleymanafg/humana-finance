"use client";

// Keeps the estimate as it stands now for the first open month — what that
// month's actual will be compared with. Closing the month before does it on its
// own; this is for taking it again (e.g. after the month-end balances came in).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { shortMonth } from "@/lib/statement-ui";

export default function SaveEstimate({ month, keptAt }: { month: string; keptAt: string | null }) {
  const { l, locale } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const m = shortMonth(month, locale);
  const date = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

  async function save() {
    const ok = confirm(
      keptAt
        ? l({ ru: `Оценка на начало ${m} уже сохранена ${date(keptAt)}. Заменить её текущей?`, en: `The estimate at the start of ${m} was kept on ${date(keptAt)}. Replace it with the current one?` })
        : l({ ru: `Сохранить текущую оценку как оценку на начало ${m}? С ней будет сравниваться факт ${m}.`, en: `Keep the current estimate as the one at the start of ${m}? ${m}'s actual will be compared with it.` })
    );
    if (!ok) return;
    setBusy(true);
    const res = await fetch("/api/budget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "estimate" }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMsg(l({ ru: "Сохранено", en: "Kept" }));
      router.refresh();
    } else setMsg(body.error === "no-balances" ? l({ ru: "Сначала внесите остатки на конец закрытого месяца", en: "Enter the closed month's month-end balances first" }) : body.error ?? "error");
  }

  return (
    <span className="flex items-center gap-2 text-[12px] text-muted">
      {keptAt
        ? l({ ru: `Оценка на начало ${m}: сохранена ${date(keptAt)}`, en: `Estimate at the start of ${m}: kept ${date(keptAt)}` })
        : l({ ru: `Оценка на начало ${m} ещё не сохранена — сохранится при закрытии предыдущего месяца`, en: `Estimate at the start of ${m} not kept yet — kept when the month before closes` })}
      <button type="button" disabled={busy} onClick={() => void save()} className="rounded-md border border-border px-2.5 py-1 font-medium text-foreground hover:bg-surface-low">
        {busy ? "…" : keptAt ? l({ ru: "Сохранить заново", en: "Keep again" }) : l({ ru: "Сохранить сейчас", en: "Keep now" })}
      </button>
      {msg && <span>{msg}</span>}
    </span>
  );
}
