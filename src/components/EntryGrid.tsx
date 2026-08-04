"use client";

// Generic inline-editable data grid backed by /api/crud/<entity>.
// Rows are plain objects with an `id`; extra display-only fields are supported
// via readOnly columns (values precomputed server-side).
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import type { DictKey } from "@/lib/i18n";
import { crud } from "@/lib/crud-client";
import { Button, IconButton, Input, Num, Select, EmptyState } from "./ui";
import { IconCheck, IconPencil, IconPlus, IconTrash, IconX } from "./icons";
import { parseNum } from "@/lib/format";

export interface Col {
  field: string;
  labelKey?: DictKey;
  label?: string; // literal label override
  type: "text" | "number" | "select" | "date" | "bool";
  options?: Array<{ value: string; label: string }>;
  readOnly?: boolean;
  decimals?: number;
  width?: string;
}

type Row = Record<string, unknown> & { id: string };

export default function EntryGrid({
  entity,
  cols,
  rows,
  readOnly = false,
  sumFields = [],
  defaults = {},
  emptyLabel,
}: {
  entity: string;
  cols: Col[];
  rows: Row[];
  readOnly?: boolean;
  sumFields?: string[];
  defaults?: Record<string, unknown>;
  emptyLabel?: string;
}) {
  const { t } = useT();
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editableCols = useMemo(() => cols.filter((c) => !c.readOnly), [cols]);

  function startEdit(row: Row | null) {
    setError(null);
    if (row) {
      setEditingId(row.id);
      const d: Record<string, unknown> = {};
      for (const c of editableCols) d[c.field] = row[c.field];
      setDraft(d);
    } else {
      setEditingId("new");
      const d: Record<string, unknown> = { ...defaults };
      for (const c of editableCols) {
        if (!(c.field in d)) d[c.field] = c.type === "number" ? "" : c.options?.[0]?.value ?? "";
      }
      setDraft(d);
    }
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    // creates must include non-column defaults (e.g. a fixed shipmentId/monthId)
    const data: Record<string, unknown> = editingId === "new" ? { ...defaults } : {};
    for (const c of editableCols) {
      let v = draft[c.field];
      if (c.type === "number") v = typeof v === "number" ? v : parseNum(String(v ?? "")) ?? 0;
      if (c.type === "bool") v = v === true || v === "true";
      if (v === "" && c.type !== "text") v = null;
      data[c.field] = v;
    }
    const res =
      editingId === "new"
        ? await crud(entity, "create", { data })
        : await crud(entity, "update", { id: editingId!, data });
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setEditingId(null);
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm(t("confirmDelete"))) return;
    setBusy(true);
    await crud(entity, "delete", { id });
    setBusy(false);
    router.refresh();
  }

  function cellInput(c: Col) {
    const v = draft[c.field];
    if (c.type === "bool") {
      return (
        <Select
          value={String(v ?? "false")}
          onChange={(e) => setDraft({ ...draft, [c.field]: e.target.value })}
          className="w-full"
        >
          <option value="true">✓</option>
          <option value="false">—</option>
        </Select>
      );
    }
    if (c.type === "select") {
      return (
        <Select
          value={String(v ?? "")}
          onChange={(e) => setDraft({ ...draft, [c.field]: e.target.value })}
          className="w-full"
        >
          {c.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    }
    return (
      <Input
        type={c.type === "date" ? "date" : "text"}
        value={String(v ?? "")}
        onChange={(e) => setDraft({ ...draft, [c.field]: e.target.value })}
        className={`w-full ${c.type === "number" ? "text-right" : ""}`}
      />
    );
  }

  function cellDisplay(row: Row, c: Col) {
    const v = row[c.field];
    if (c.type === "bool") return <span>{v ? "✓" : "—"}</span>;
    if (c.type === "number") return <Num v={typeof v === "number" ? v : null} decimals={c.decimals ?? 0} />;
    if (c.type === "date" && v) return <span>{String(v).slice(0, 10)}</span>;
    if (c.type === "select") {
      const o = c.options?.find((x) => x.value === v);
      return <span>{o?.label ?? String(v ?? "")}</span>;
    }
    return <span>{String(v ?? "")}</span>;
  }

  const label = (c: Col) => c.label ?? (c.labelKey ? t(c.labelKey) : c.field);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.field} style={c.width ? { width: c.width } : undefined} className={c.type === "number" ? "text-right" : ""}>
                  {label(c)}
                </th>
              ))}
              {!readOnly && <th className="w-24 text-right">{t("actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) =>
              editingId === row.id ? (
                <tr key={row.id} className="bg-accent-soft/50">
                  {cols.map((c) => (
                    <td key={c.field}>{c.readOnly ? cellDisplay(row, c) : cellInput(c)}</td>
                  ))}
                  <td className="whitespace-nowrap text-right">
                    <div className="flex justify-end gap-1">
                      <IconButton tone="accent" onClick={save} title={t("save")}>
                        <IconCheck size={15} />
                      </IconButton>
                      <IconButton onClick={() => setEditingId(null)} title={t("cancel")}>
                        <IconX size={15} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={row.id} className="group">
                  {cols.map((c) => (
                    <td key={c.field} className={c.type === "number" ? "text-right" : ""}>
                      {cellDisplay(row, c)}
                    </td>
                  ))}
                  {!readOnly && (
                    <td className="whitespace-nowrap text-right">
                      <div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <IconButton tone="accent" onClick={() => startEdit(row)} title={t("edit")}>
                          <IconPencil size={14} />
                        </IconButton>
                        <IconButton tone="danger" onClick={() => remove(row.id)} title={t("delete")}>
                          <IconTrash size={14} />
                        </IconButton>
                      </div>
                    </td>
                  )}
                </tr>
              )
            )}
            {editingId === "new" && (
              <tr className="bg-accent-soft/50">
                {cols.map((c) => (
                  <td key={c.field}>{c.readOnly ? null : cellInput(c)}</td>
                ))}
                <td className="whitespace-nowrap text-right">
                  <div className="flex justify-end gap-1">
                    <IconButton tone="accent" onClick={save} title={t("save")}>
                      <IconCheck size={15} />
                    </IconButton>
                    <IconButton onClick={() => setEditingId(null)} title={t("cancel")}>
                      <IconX size={15} />
                    </IconButton>
                  </div>
                </td>
              </tr>
            )}
            {sumFields.length > 0 && rows.length > 0 && (
              <tr className="font-semibold">
                {cols.map((c, i) => (
                  <td key={c.field} className={c.type === "number" ? "text-right" : ""}>
                    {i === 0 ? (
                      t("total")
                    ) : sumFields.includes(c.field) ? (
                      <Num
                        v={rows.reduce((s, r) => s + (typeof r[c.field] === "number" ? (r[c.field] as number) : 0), 0)}
                        decimals={c.decimals ?? 0}
                        strong
                      />
                    ) : null}
                  </td>
                ))}
                {!readOnly && <td />}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && editingId !== "new" && <EmptyState text={emptyLabel ?? t("noData")} />}
      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        {!readOnly ? (
          <Button variant="secondary" onClick={() => startEdit(null)} disabled={editingId !== null}>
            <IconPlus size={14} /> {t("add")}
          </Button>
        ) : (
          <span />
        )}
        {error && <span className="text-[12px] text-danger">{error}</span>}
      </div>
    </div>
  );
}
