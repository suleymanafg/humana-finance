"use client";

// Loads a budget workbook (the owner's v10 layout): first a check — the answer
// its inputs give and how its opening compares with the books — then, on
// request, it becomes the approved budget, the working forecast or both.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { fmtN } from "@/lib/format";
import { shortMonth } from "@/lib/statement-ui";
import { Button, Card, CardHeader, Select } from "../ui";

interface Summary {
  ask: number;
  firstNeeded: string | null;
  worstMonth: string;
  headroom: number;
  checks: Record<string, boolean>;
  openingVsBooks: { key: string; workbook: number; books: number }[] | null;
  applied: boolean;
  error?: string;
}

export default function BudgetImport({ hasBudget }: { hasBudget: boolean }) {
  const { locale, l } = useT();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState(hasBudget ? "forecast" : "both");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(apply: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("target", target);
    if (apply) form.set("apply", "1");
    const res = await fetch("/api/budget/import", { method: "POST", body: form });
    const json = (await res.json().catch(() => ({ error: res.statusText }))) as Summary;
    setBusy(false);
    if (!res.ok || json.error) {
      setError(json.error ?? res.statusText);
      setSummary(null);
      return;
    }
    setSummary(json);
    if (apply) router.refresh();
  }

  const differs = summary?.openingVsBooks?.filter((d) => Math.abs(d.workbook - d.books) > 0.5) ?? [];
  return (
    <Card className="mb-4">
      <CardHeader
        title={l({ ru: "Загрузить книгу бюджета из Excel", en: "Load a budget workbook from Excel" })}
        desc={l({ ru: "Формат книги v10/v11: вкладки «Допущения» и «Помесячно». Сначала проверка, потом загрузка.", en: "The v10/v11 layout: the Inputs and Monthly tabs. A check first, then the load." })}
      />
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
        <input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setSummary(null); }} />
        <Select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="both">{l({ ru: "как исходный бюджет и оценку", en: "as the original budget and the estimate" })}</option>
          <option value="forecast">{l({ ru: "только как оценку", en: "as the estimate only" })}</option>
          <option value="approved">{l({ ru: "только как исходный бюджет", en: "as the original budget only" })}</option>
        </Select>
        <Button variant="secondary" onClick={() => send(false)} disabled={!file || busy}>{l({ ru: "Проверить", en: "Check" })}</Button>
        <Button onClick={() => send(true)} disabled={!file || busy || !summary || summary.applied}>{l({ ru: "Загрузить", en: "Load" })}</Button>
        {error && <span className="text-danger">{error}</span>}
      </div>
      {summary && (
        <div className="border-t border-border px-4 py-3 text-[12.5px]">
          <div className="mb-1">
            {l({ ru: "Просим у акционеров", en: "Ask shareholders for" })}: <b className="tabular-nums">{fmtN(summary.ask)}</b>
            {summary.firstNeeded && <> · {l({ ru: "с", en: "from" })} {shortMonth(summary.firstNeeded, locale)}</>}
            {" · "}{l({ ru: "самый узкий месяц", en: "tightest month" })} {shortMonth(summary.worstMonth, locale)} ({fmtN(summary.headroom)})
            {" · "}
            {Object.values(summary.checks).every(Boolean) ? <span className="text-ok">{l({ ru: "все проверки OK", en: "all checks OK" })}</span> : <span className="text-danger">{l({ ru: "проверки не прошли", en: "checks fail" })}</span>}
          </div>
          {summary.openingVsBooks &&
            (differs.length === 0 ? (
              <div className="text-ok">{l({ ru: "✓ Начальные остатки книги совпадают с учётом", en: "✓ The workbook's opening matches the books" })}</div>
            ) : (
              <div className="text-warn">
                {l({ ru: "Начальные остатки расходятся с учётом:", en: "The opening differs from the books:" })}{" "}
                {differs.map((d) => `${d.key} ${fmtN(d.workbook)} / ${fmtN(d.books)}`).join("; ")}
              </div>
            ))}
          {summary.applied && <div className="mt-1 text-ok">{l({ ru: "Загружено.", en: "Loaded." })}</div>}
        </div>
      )}
    </Card>
  );
}
