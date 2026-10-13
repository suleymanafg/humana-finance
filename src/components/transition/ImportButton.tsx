"use client";

// Upload a list (.xlsx or .csv), map its columns to the fields the module
// needs, check it, then import. The file is read on the server
// (/api/transition/parse) and nothing is stored until «Импортировать».
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { normName, type Bi } from "@/lib/transition/model";
import { Button, Modal, Select } from "../ui";
import { IconUpload } from "../icons";

type Cell = string | number | null;
interface Sheet {
  name: string;
  rows: Cell[][];
}
export interface ImportField {
  key: string;
  label: Bi;
  required?: boolean;
  /** header words that identify the column (any language, lower case) */
  synonyms: string[];
}
interface Result {
  ok: number;
  created: number;
  updated: number;
  rejected: Array<{ row: number; reason: string }>;
  sample: Array<Record<string, unknown>>;
}

const matches = (header: Cell, f: ImportField) => {
  const h = normName(String(header ?? ""));
  return !!h && f.synonyms.some((s) => h.includes(s));
};

export default function ImportButton({
  kind,
  fields,
  title,
  hint,
  replaceLabel,
}: {
  kind: "outlets" | "stock" | "tiSales";
  fields: ImportField[];
  title: Bi;
  hint?: Bi;
  /** offer "replace the previous upload" (stock lists are full snapshots) */
  replaceLabel?: Bi;
}) {
  const { l } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerIdx, setHeaderIdx] = useState(0);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Result | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const sheet = sheets?.[sheetIdx];
  const header = sheet?.rows[headerIdx] ?? [];

  function guess(s: Sheet) {
    // header row: the early row that names the most of our fields
    let best = 0;
    let bestScore = -1;
    s.rows.slice(0, 20).forEach((row, i) => {
      const score = fields.filter((f) => row.some((c) => matches(c, f))).length;
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    setHeaderIdx(best);
    autoMap(s.rows[best] ?? []);
  }

  function autoMap(row: Cell[]) {
    const m: Record<string, number> = {};
    const used = new Set<number>();
    for (const f of fields) {
      const i = row.findIndex((c, idx) => !used.has(idx) && matches(c, f));
      if (i >= 0) {
        m[f.key] = i;
        used.add(i);
      }
    }
    setMapping(m);
  }

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    setPreview(null);
    setDone(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/transition/parse", { method: "POST", body: form });
      const json = (await res.json()) as { sheets?: Sheet[]; error?: string };
      if (!res.ok || !json.sheets) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (json.sheets.length === 0) throw new Error(l({ ru: "В файле нет данных", en: "The file has no data" }));
      setSheets(json.sheets);
      setSheetIdx(0);
      guess(json.sheets[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(() => {
    if (!sheet) return [];
    return sheet.rows
      .slice(headerIdx + 1)
      .map((r) => Object.fromEntries(fields.filter((f) => mapping[f.key] !== undefined).map((f) => [f.key, r[mapping[f.key]] ?? null])))
      .filter((o) => Object.values(o).some((v) => v !== null && v !== ""));
  }, [sheet, headerIdx, mapping, fields]);

  const missing = fields.filter((f) => f.required && mapping[f.key] === undefined);

  async function send(mode: "preview" | "commit") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/transition/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, mode, rows, replace: replaceLabel ? replace : false }),
      });
      const json = (await res.json()) as Result & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (mode === "preview") setPreview(json);
      else {
        setDone(
          l({
            ru: `Импортировано: ${json.ok} (новых ${json.created}, обновлено ${json.updated}), пропущено ${json.rejected.length}`,
            en: `Imported ${json.ok} (${json.created} new, ${json.updated} updated), ${json.rejected.length} skipped`,
          })
        );
        setSheets(null);
        setPreview(null);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setSheets(null);
    setPreview(null);
    setError(null);
  }

  const columns = header.map((c, i) => ({ value: i, label: `${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ""} · ${String(c ?? "").slice(0, 40) || "—"}` }));

  return (
    <>
      <span className="inline-flex items-center gap-2">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <IconUpload size={14} /> {l(title)}
        </Button>
        {done && <span className="text-[12px] text-muted">{done}</span>}
      </span>
      {open && (
        <Modal title={l(title)} onClose={close} wide>
          {hint && <p className="mb-3 text-[12.5px] text-muted">{l(hint)}</p>}
          <input
            type="file"
            accept=".xlsx,.xlsm,.csv"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            className="text-[13px]"
          />

          {sheet && (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                {sheets!.length > 1 && (
                  <label className="flex flex-col gap-1">
                    <span className="text-[12px] font-semibold text-muted">{l({ ru: "Лист", en: "Sheet" })}</span>
                    <Select
                      value={sheetIdx}
                      onChange={(e) => {
                        const i = Number(e.target.value);
                        setSheetIdx(i);
                        setPreview(null);
                        guess(sheets![i]);
                      }}
                    >
                      {sheets!.map((s, i) => (
                        <option key={s.name} value={i}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-muted">{l({ ru: "Строка заголовков", en: "Header row" })}</span>
                  <Select
                    value={headerIdx}
                    onChange={(e) => {
                      const i = Number(e.target.value);
                      setHeaderIdx(i);
                      setPreview(null);
                      autoMap(sheet.rows[i] ?? []);
                    }}
                  >
                    {sheet.rows.slice(0, 20).map((r, i) => (
                      <option key={i} value={i}>
                        {i + 1}: {r.filter((c) => c !== null).slice(0, 4).join(" · ").slice(0, 60)}
                      </option>
                    ))}
                  </Select>
                </label>
                <span className="pb-1.5 text-[12px] text-muted">
                  {l({ ru: `Строк с данными: ${rows.length}`, en: `Data rows: ${rows.length}` })}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                {fields.map((f) => (
                  <label key={f.key} className="flex items-center justify-between gap-3">
                    <span className="text-[12.5px]">
                      {l(f.label)}
                      {f.required && <span className="text-danger"> *</span>}
                    </span>
                    <Select
                      value={mapping[f.key] ?? ""}
                      onChange={(e) => {
                        const m = { ...mapping };
                        if (e.target.value === "") delete m[f.key];
                        else m[f.key] = Number(e.target.value);
                        setMapping(m);
                        setPreview(null);
                      }}
                      className="w-56"
                    >
                      <option value="">—</option>
                      {columns.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                  </label>
                ))}
              </div>

              {replaceLabel && (
                <label className="flex items-center gap-2 text-[12.5px]">
                  <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                  {l(replaceLabel)}
                </label>
              )}

              {preview && (
                <div className="rounded-lg border border-border">
                  <div className="border-b border-border bg-surface-low/50 px-3 py-2 text-[12.5px]">
                    {l({
                      ru: `Будет записано: ${preview.ok} (новых ${preview.created}, обновится ${preview.updated}); пропущено: ${preview.rejected.length}`,
                      en: `Will write ${preview.ok} (${preview.created} new, ${preview.updated} updated); skipped: ${preview.rejected.length}`,
                    })}
                  </div>
                  {preview.sample.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="tbl is-compact">
                        <thead>
                          <tr>
                            {Object.keys(preview.sample[0]).map((k) => (
                              <th key={k}>{k}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.sample.map((r, i) => (
                            <tr key={i}>
                              {Object.keys(preview.sample[0]).map((k) => (
                                <td key={k}>{String(r[k] ?? "")}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {preview.rejected.length > 0 && (
                    <ul className="max-h-32 overflow-y-auto border-t border-border px-3 py-2 text-[12px] text-danger">
                      {preview.rejected.slice(0, 30).map((r) => (
                        <li key={r.row}>
                          {l({ ru: "Строка", en: "Row" })} {r.row}: {r.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                {missing.length > 0 && (
                  <span className="mr-auto text-[12px] text-warn">
                    {l({ ru: "Укажите колонку: ", en: "Choose a column for: " })}
                    {missing.map((f) => l(f.label)).join(", ")}
                  </span>
                )}
                <Button variant="secondary" onClick={() => send("preview")} disabled={busy || missing.length > 0 || rows.length === 0}>
                  {l({ ru: "Проверить", en: "Check" })}
                </Button>
                <Button onClick={() => send("commit")} disabled={busy || !preview || preview.ok === 0}>
                  {l({ ru: "Импортировать", en: "Import" })}
                </Button>
              </div>
            </div>
          )}
          {error && <p className="mt-3 text-[12.5px] text-danger">{error}</p>}
          {busy && <p className="mt-3 text-[12.5px] text-muted">…</p>}
        </Modal>
      )}
    </>
  );
}
