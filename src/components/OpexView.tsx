"use client";

// OPEX workspace (TI + Fargo). Marketing was folded into OPEX on 2026-08-03,
// so this is the single place operating expenses are entered and reviewed.
//
// Layout, simplest-first:
//   month strip (click any month, data-carrying months are solid)
//   → 4 metric tiles
//   → one table grouped by P&L group, amounts inline-editable,
//     categories addable / renamable / removable right in the table
//   → collapsed groups × months history.
// «Заполнить месяц» opens a slide-over for the monthly ritual: copy the prior
// month, adjust, save. TI splits Банк/Наличные; Fargo has a single amount.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input, PageTitle, Select } from "./ui";
import { IconDownload, IconPencil, IconPlus, IconTrash, IconX } from "./icons";
import { Collapsible, Delta, MetricStrip, fmtN, fmtPct, type Metric } from "./analysis";
import MonthStrip from "./MonthStrip";
import { useT } from "@/lib/locale-context";
import { crud } from "@/lib/crud-client";
import { toNum } from "@/lib/format";
import { FARGO_GROUPS, GROUP_LABELS, TI_GROUPS } from "@/lib/groups";
import type { MonthIn } from "@/lib/engine/types";
import type { DictKey } from "@/lib/i18n";

export interface OpexCategoryLite {
  id: string;
  name: string;
  plGroup: string | null;
  /** false = removed from the list; still shown in months where it holds an
      amount, so the table total can never drift from the P&L. */
  active: boolean;
}
export interface OpexEntryLite {
  id: string;
  monthId: string;
  categoryId: string;
  bank: number; // Fargo: the whole amount lives here, cash stays 0
  cash: number;
}

interface CatMonth {
  bank: number;
  cash: number;
  ids: string[];
}

const keyOf = (categoryId: string, monthId: string) => `${categoryId}|${monthId}`;
const num = toNum;
/** re-print a typed amount with comma grouping once the field loses focus */
const pretty = (s: string) => (s.trim() === "" ? "" : fmtN(num(s)));

/**
 * Numeric cell body. The trailing slot is always reserved — with it, editable
 * figures, group subtotals and the grand total all land on the same right edge.
 */
function NumCell({
  value,
  className = "",
  action,
}: {
  value: number;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <span className={`num ${className}`}>{fmtN(value)}</span>
      <span className="w-3.5 shrink-0">{action}</span>
    </div>
  );
}

/**
 * Amount cell. Shows the formatted figure (with comma grouping); hovering
 * reveals a pencil, and only pressing it opens the editor — so numbers can't
 * be changed by accidentally typing into a table.
 */
function AmountCell({
  value,
  readOnly,
  onCommit,
}: {
  value: number;
  readOnly: boolean;
  onCommit: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

  if (readOnly || !editing) {
    return (
      <div className="group/cell">
        <NumCell
          value={value}
          className={value === 0 ? "text-muted/50" : ""}
          action={
            !readOnly && (
              <button
                onClick={() => {
                  setText(value === 0 ? "" : String(value));
                  setEditing(true);
                }}
                className="text-muted opacity-0 transition-opacity hover:text-accent group-hover/cell:opacity-100"
                title="Изменить"
              >
                <IconPencil size={12} />
              </button>
            )
          }
        />
      </div>
    );
  }

  const commit = () => {
    const v = num(text);
    setEditing(false);
    if (v !== value) onCommit(v);
  };
  return (
    <div className="flex items-center justify-end gap-1">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="0"
        className="num w-28 rounded-md border border-accent bg-surface px-2 py-1 text-right text-[13px] outline-none"
      />
      <span className="w-3.5 shrink-0" />
    </div>
  );
}

/** Category name — same hover-then-edit behaviour as the amounts. */
function NameCell({
  name,
  readOnly,
  onRename,
}: {
  name: string;
  /** renaming is a structural change — ADMIN only */
  readOnly: boolean;
  onRename: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);

  if (readOnly || !editing) {
    return (
      <span className="group/name flex items-center gap-1.5">
        <span className="truncate">{name}</span>
        {!readOnly && (
          <button
            onClick={() => {
              setText(name);
              setEditing(true);
            }}
            className="shrink-0 text-muted opacity-0 transition-opacity hover:text-accent group-hover/name:opacity-100"
            title="Переименовать"
          >
            <IconPencil size={11} />
          </button>
        )}
      </span>
    );
  }

  const commit = () => {
    const v = text.trim();
    setEditing(false);
    if (v && v !== name) onRename(v);
  };
  return (
    <input
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      className="w-full rounded-md border border-accent bg-surface px-1.5 py-1 text-[13px] outline-none"
    />
  );
}

export default function OpexView({
  variant,
  entity,
  titleKey,
  descKey,
  months,
  monthId,
  categories,
  entries,
  readOnly,
  canManage,
}: {
  variant: "TI" | "FARGO";
  entity: "opexTi" | "opexFargo";
  titleKey: DictKey;
  descKey: DictKey;
  months: MonthIn[];
  monthId: string;
  categories: OpexCategoryLite[];
  entries: OpexEntryLite[];
  /** may edit amounts (ADMIN or STAFF) */
  readOnly: boolean;
  /** may add / rename / remove categories (ADMIN only) */
  canManage: boolean;
}) {
  const { t, locale } = useT();
  const router = useRouter();
  const ru = locale === "ru";
  const split = variant === "TI";
  const groupKeys = split ? TI_GROUPS : FARGO_GROUPS;
  const [showFill, setShowFill] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGroup, setNewGroup] = useState<string>(groupKeys[0]);

  const monthLabel = (id: string) => {
    const m = months.find((x) => x.id === id);
    return m ? (ru ? m.nameRu : m.nameEn) : id;
  };
  const monthIdx = months.findIndex((m) => m.id === monthId);
  const priorMonthId = monthIdx > 0 ? months[monthIdx - 1].id : null;

  // category+month → amounts + the entry ids behind them
  const byCatMonth = useMemo(() => {
    const m = new Map<string, CatMonth>();
    for (const e of entries) {
      const k = keyOf(e.categoryId, e.monthId);
      const v = m.get(k) ?? { bank: 0, cash: 0, ids: [] };
      v.bank += e.bank;
      v.cash += e.cash;
      v.ids.push(e.id);
      m.set(k, v);
    }
    return m;
  }, [entries]);

  const monthsWithData = useMemo(() => new Set(entries.map((e) => e.monthId)), [entries]);
  const categoriesWithAnyData = useMemo(() => new Set(entries.map((e) => e.categoryId)), [entries]);
  const dynMonths = useMemo(
    () => months.filter((m) => monthsWithData.has(m.id) || m.id === monthId),
    [months, monthsWithData, monthId]
  );

  const totalOfMonth = useMemo(
    () => (mid: string) => {
      // over every category, active or not — the total must equal the P&L
      let bank = 0;
      let cash = 0;
      for (const c of categories) {
        const v = byCatMonth.get(keyOf(c.id, mid));
        if (v) {
          bank += v.bank;
          cash += v.cash;
        }
      }
      return { bank, cash, total: bank + cash };
    },
    [categories, byCatMonth]
  );

  const cur = totalOfMonth(monthId);
  const prior = priorMonthId ? totalOfMonth(priorMonthId) : null;
  const series = dynMonths.map((m) => totalOfMonth(m.id).total);

  // groups in canonical order, plus anything unexpected at the end
  const groupOrder = useMemo(() => {
    const known = [...groupKeys, "UNMAPPED"] as string[];
    const used = [...new Set(categories.map((c) => c.plGroup ?? "UNMAPPED"))];
    return used.sort((a, b) => {
      const ia = known.indexOf(a);
      const ib = known.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  }, [categories, groupKeys]);
  const groupLabel = (g: string) => GROUP_LABELS[g]?.[locale] ?? g;
  /** active categories, plus removed ones that still carry an amount this month */
  const monthCategories = useMemo(
    () =>
      categories.filter((c) => {
        if (c.active) return true;
        const v = byCatMonth.get(keyOf(c.id, monthId));
        return (v?.bank ?? 0) + (v?.cash ?? 0) !== 0;
      }),
    [categories, byCatMonth, monthId]
  );
  const categoriesOfGroup = (g: string) =>
    monthCategories.filter((c) => (c.plGroup ?? "UNMAPPED") === g);

  const largestGroup = useMemo(() => {
    let best: { g: string; v: number } | null = null;
    for (const g of groupOrder) {
      const v = categoriesOfGroup(g).reduce((a, c) => {
        const x = byCatMonth.get(keyOf(c.id, monthId));
        return a + (x ? x.bank + x.cash : 0);
      }, 0);
      if (!best || v > best.v) best = { g, v };
    }
    return best;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupOrder, byCatMonth, monthId, categories]);

  const metrics: Metric[] = split
    ? [
        {
          label: ru ? "Итого за месяц" : "Month total",
          value: fmtN(cur.total),
          delta: prior ? { current: cur.total, previous: prior.total, invert: true } : undefined,
          series,
        },
        { label: t("bank"), value: fmtN(cur.bank), hint: cur.total !== 0 ? fmtPct(cur.bank / cur.total) : undefined },
        { label: t("cash"), value: fmtN(cur.cash), hint: cur.total !== 0 ? fmtPct(cur.cash / cur.total) : undefined },
        {
          label: ru ? "Крупнейшая группа" : "Largest group",
          value: largestGroup ? fmtN(largestGroup.v) : "—",
          hint: largestGroup ? groupLabel(largestGroup.g) : undefined,
        },
      ]
    : [
        {
          label: ru ? "Итого за месяц" : "Month total",
          value: fmtN(cur.total),
          delta: prior ? { current: cur.total, previous: prior.total, invert: true } : undefined,
          series,
        },
        {
          label: ru ? "Пред. месяц" : "Prior month",
          value: prior ? fmtN(prior.total) : "—",
          hint: priorMonthId ? monthLabel(priorMonthId) : undefined,
        },
        {
          label: ru ? "Крупнейшая группа" : "Largest group",
          value: largestGroup ? fmtN(largestGroup.v) : "—",
          hint: largestGroup ? groupLabel(largestGroup.g) : undefined,
        },
        {
          label: ru ? "Категорий с суммой" : "Categories used",
          value: `${categories.filter((c) => (byCatMonth.get(keyOf(c.id, monthId))?.bank ?? 0) + (byCatMonth.get(keyOf(c.id, monthId))?.cash ?? 0) !== 0).length} / ${categories.length}`,
        },
      ];

  // ── writes ────────────────────────────────────────────────────
  async function writeCategoryMonth(
    categoryId: string,
    bank: number,
    cash: number,
    existing: CatMonth | undefined
  ) {
    const data =
      entity === "opexTi"
        ? { monthId, categoryId, bankAmount: bank, cashAmount: cash }
        : { monthId, categoryId, amount: bank + cash };
    if (bank === 0 && cash === 0) {
      for (const id of existing?.ids ?? []) await crud(entity, "delete", { id });
      return;
    }
    if (existing && existing.ids.length > 0) {
      await crud(entity, "update", { id: existing.ids[0], data });
      for (const id of existing.ids.slice(1)) await crud(entity, "delete", { id }); // fold duplicates
    } else {
      await crud(entity, "create", { data });
    }
  }

  async function commitCell(categoryId: string, field: "bank" | "cash", value: number) {
    const existing = byCatMonth.get(keyOf(categoryId, monthId));
    const bank = field === "bank" ? value : (existing?.bank ?? 0);
    const cash = field === "cash" ? value : (existing?.cash ?? 0);
    await writeCategoryMonth(categoryId, bank, cash, existing);
    router.refresh();
  }

  async function addCategory() {
    const name = newName.trim();
    if (!name) return;
    await crud("opexCategory", "create", {
      data: {
        company: variant,
        name,
        plGroup: newGroup,
        sortOrder: categories.length + 1,
        active: true,
      },
    });
    setNewName("");
    setAdding(false);
    router.refresh();
  }

  async function renameCategory(id: string, name: string) {
    await crud("opexCategory", "update", { id, data: { name } });
    router.refresh();
  }

  async function removeCategory(c: OpexCategoryLite) {
    const used = categoriesWithAnyData.has(c.id);
    const msg = used
      ? ru
        ? `«${c.name}» содержит суммы. Убрать из списка? Суммы сохранятся в P&L, и категория останется видимой в месяцах, где она заполнена.`
        : `"${c.name}" holds amounts. Remove it from the list? The amounts stay in the P&L and the category remains visible in months where it is filled.`
      : ru
        ? `Удалить категорию «${c.name}»?`
        : `Delete category "${c.name}"?`;
    if (!confirm(msg)) return;
    // categories with history are deactivated so their past amounts survive
    if (used) await crud("opexCategory", "update", { id: c.id, data: { active: false } });
    else await crud("opexCategory", "delete", { id: c.id });
    router.refresh();
  }

  const visibleCats = (g: string) =>
    categoriesOfGroup(g).filter((c) => {
      if (!hideEmpty) return true;
      const v = byCatMonth.get(keyOf(c.id, monthId));
      return (v?.bank ?? 0) + (v?.cash ?? 0) !== 0;
    });

  const colCount = split ? 5 : 3;

  return (
    <div>
      <PageTitle
        title={t(titleKey)}
        subtitle={t(descKey)}
        right={
          <div className="flex items-center gap-2">
            <a href={`/api/export/${entity === "opexTi" ? "opex-ti" : "opex-fargo"}?month=${monthId}&locale=${locale}`}>
              <Button variant="secondary">
                <IconDownload size={14} /> {t("export")}
              </Button>
            </a>
            {!readOnly && (
              <Button onClick={() => setShowFill(true)}>{ru ? "Заполнить месяц" : "Fill the month"}</Button>
            )}
          </div>
        }
      />

      <MonthStrip months={months} monthId={monthId} hasData={monthsWithData} />

      <MetricStrip metrics={metrics} />

      <div className="quiet-card mb-5 overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="font-display text-[16px] font-semibold">
            {ru ? "Расходы за" : "Expenses for"} {monthLabel(monthId)}
          </h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
              <input
                type="checkbox"
                checked={hideEmpty}
                onChange={(e) => setHideEmpty(e.target.checked)}
                className="accent-accent"
              />
              {ru ? "Скрыть пустые" : "Hide empty"}
            </label>
            {canManage && (
              <Button variant="secondary" onClick={() => setAdding((v) => !v)}>
                <IconPlus size={13} /> {ru ? "Категория" : "Category"}
              </Button>
            )}
          </div>
        </div>

        {adding && canManage && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-low px-4 py-2.5">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCategory()}
              placeholder={ru ? "Название категории" : "Category name"}
              className="w-64"
              autoFocus
            />
            <Select value={newGroup} onChange={(e) => setNewGroup(e.target.value)}>
              {groupKeys.map((g) => (
                <option key={g} value={g}>
                  {groupLabel(g)}
                </option>
              ))}
            </Select>
            <Button onClick={addCategory} disabled={!newName.trim()}>
              {t("add")}
            </Button>
            <button
              onClick={() => setAdding(false)}
              className="text-muted transition-colors hover:text-ink"
              title={t("cancel")}
            >
              <IconX size={15} />
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="tbl w-full min-w-max">
            <thead>
              <tr>
                <th>{t("category")}</th>
                {split ? (
                  <>
                    <th className="text-right">{t("bank")}</th>
                    <th className="text-right">{t("cash")}</th>
                    <th className="text-right">{t("total")}</th>
                  </>
                ) : (
                  <th className="text-right">{t("amount")}</th>
                )}
                <th className="text-right">{ru ? "К пред. месяцу" : "vs prior"}</th>
                {canManage && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {groupOrder.map((g) => {
                const cats = visibleCats(g);
                if (cats.length === 0) return null;
                const sub = categoriesOfGroup(g).reduce(
                  (a, c) => {
                    const v = byCatMonth.get(keyOf(c.id, monthId));
                    return { bank: a.bank + (v?.bank ?? 0), cash: a.cash + (v?.cash ?? 0) };
                  },
                  { bank: 0, cash: 0 }
                );
                return [
                  <tr key={`g-${g}`} className="row-section">
                    <td
                      colSpan={split ? 3 : 1}
                      className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted"
                    >
                      {groupLabel(g)}
                      {g === "UNMAPPED" && <Badge tone="warn">!</Badge>}
                    </td>
                    <td className="text-right">
                      <NumCell value={sub.bank + sub.cash} className="font-semibold" />
                    </td>
                    <td colSpan={canManage ? 2 : 1} />
                  </tr>,
                  ...cats.map((c) => {
                    const v = byCatMonth.get(keyOf(c.id, monthId));
                    const total = (v?.bank ?? 0) + (v?.cash ?? 0);
                    const p = priorMonthId ? byCatMonth.get(keyOf(c.id, priorMonthId)) : undefined;
                    const priorTotal = p ? p.bank + p.cash : 0;
                    return (
                      <tr key={c.id} className="group">
                        <td className="max-w-[300px] pl-5">
                          <div className="flex items-center gap-1.5">
                            <NameCell
                              name={c.name}
                              readOnly={!canManage}
                              onRename={(n) => renameCategory(c.id, n)}
                            />
                            {!c.active && <Badge tone="warn">{ru ? "скрыта" : "hidden"}</Badge>}
                          </div>
                        </td>
                        {split ? (
                          <>
                            <td className="text-right">
                              <AmountCell
                                value={v?.bank ?? 0}
                                readOnly={readOnly}
                                onCommit={(x) => commitCell(c.id, "bank", x)}
                              />
                            </td>
                            <td className="text-right">
                              <AmountCell
                                value={v?.cash ?? 0}
                                readOnly={readOnly}
                                onCommit={(x) => commitCell(c.id, "cash", x)}
                              />
                            </td>
                            <td className="text-right">
                              <NumCell
                                value={total}
                                className={`font-medium ${total === 0 ? "text-muted/50" : ""}`}
                              />
                            </td>
                          </>
                        ) : (
                          <td className="text-right">
                            <AmountCell
                              value={total}
                              readOnly={readOnly}
                              onCommit={(x) => commitCell(c.id, "bank", x)}
                            />
                          </td>
                        )}
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="num text-[11.5px] text-muted">{fmtN(priorTotal)}</span>
                            <span className="w-14 text-right text-[12px]">
                              <Delta current={total} previous={priorTotal} invert />
                            </span>
                          </div>
                        </td>
                        {canManage && (
                          <td>
                            <button
                              onClick={() => removeCategory(c)}
                              className="text-muted opacity-0 transition-all hover:text-danger group-hover:opacity-100"
                              title={ru ? "Убрать категорию" : "Remove category"}
                            >
                              <IconTrash size={13} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  }),
                ];
              })}
              <tr>
                <td
                  className="font-display text-[13px] font-bold uppercase tracking-wide !text-white"
                  style={{ background: "var(--accent)" }}
                >
                  {t("total")}
                </td>
                {split && (
                  <>
                    <td className="text-right !text-white" style={{ background: "var(--accent)" }}>
                      <NumCell value={cur.bank} className="font-semibold" />
                    </td>
                    <td className="text-right !text-white" style={{ background: "var(--accent)" }}>
                      <NumCell value={cur.cash} className="font-semibold" />
                    </td>
                  </>
                )}
                <td className="text-right !text-white" style={{ background: "var(--accent)" }}>
                  <NumCell value={cur.total} className="font-bold" />
                </td>
                <td className="text-right !text-white" style={{ background: "var(--accent)" }}>
                  {/* mirrors the body rows: prior value, then the change chip */}
                  <div className="flex items-center justify-end gap-2">
                    <span className="num text-[11.5px] text-white/70">{prior ? fmtN(prior.total) : "—"}</span>
                    <span className="w-14 text-right text-[12px]">
                      {prior && prior.total !== 0 ? (
                        <span className="num font-semibold">
                          {cur.total >= prior.total ? "+" : ""}
                          {(((cur.total - prior.total) / Math.abs(prior.total)) * 100).toFixed(1)}%
                        </span>
                      ) : (
                        "—"
                      )}
                    </span>
                  </div>
                </td>
                {!readOnly && <td style={{ background: "var(--accent)" }} />}
              </tr>
            </tbody>
          </table>
          {colCount > 0 && categories.length === 0 && (
            <div className="py-10 text-center text-[13px] text-muted">
              {ru ? "Категорий пока нет — добавьте первую." : "No categories yet — add the first one."}
            </div>
          )}
        </div>
      </div>

      <Collapsible title={ru ? "История по месяцам" : "Monthly history"} note={`${dynMonths.length} ${ru ? "мес." : "mo."}`}>
        <div className="overflow-x-auto">
          <table className="tbl min-w-max">
            <thead>
              <tr>
                <th className="sticky-col">{t("group")}</th>
                {dynMonths.map((m) => (
                  <th key={m.id} className={`text-right ${m.id === monthId ? "col-hl" : ""}`}>
                    {`${(ru ? m.nameRu : m.nameEn).split(" ")[0].slice(0, 3)} ’${m.id.slice(2, 4)}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupOrder.map((g) => (
                <tr key={g}>
                  <td className="sticky-col max-w-[220px] truncate">{groupLabel(g)}</td>
                  {dynMonths.map((m) => {
                    const v = categoriesOfGroup(g).reduce((a, c) => {
                      const x = byCatMonth.get(keyOf(c.id, m.id));
                      return a + (x ? x.bank + x.cash : 0);
                    }, 0);
                    return (
                      <td key={m.id} className={`text-right ${m.id === monthId ? "col-hl" : ""}`}>
                        <span className={`num ${v === 0 ? "text-muted/50" : ""}`}>{fmtN(v)}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="row-grand font-semibold">
                <td className="sticky-col">{t("total")}</td>
                {dynMonths.map((m) => (
                  <td key={m.id} className={`text-right ${m.id === monthId ? "col-hl" : ""}`}>
                    <span className="num">{fmtN(totalOfMonth(m.id).total)}</span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Collapsible>

      {showFill && (
        // key={monthId}: the panel seeds its fields from the month it opened
        // on — remount on month change so it can never save into another month
        <FillMonthPanel
          key={monthId}
          variant={variant}
          monthId={monthId}
          monthLabel={monthLabel(monthId)}
          priorMonthId={priorMonthId}
          priorLabel={priorMonthId ? monthLabel(priorMonthId) : null}
          groupOrder={groupOrder}
          groupLabel={groupLabel}
          categoriesOfGroup={categoriesOfGroup}
          byCatMonth={byCatMonth}
          onSave={async (values) => {
            for (const [categoryId, v] of values) {
              const existing = byCatMonth.get(keyOf(categoryId, monthId));
              if (v.bank === (existing?.bank ?? 0) && v.cash === (existing?.cash ?? 0)) continue;
              await writeCategoryMonth(categoryId, v.bank, v.cash, existing);
            }
            router.refresh();
            setShowFill(false);
          }}
          onClose={() => setShowFill(false)}
        />
      )}
    </div>
  );
}

// ── «Заполнить месяц» slide-over ─────────────────────────────────

function FillMonthPanel({
  variant,
  monthId,
  monthLabel,
  priorMonthId,
  priorLabel,
  groupOrder,
  groupLabel,
  categoriesOfGroup,
  byCatMonth,
  onSave,
  onClose,
}: {
  variant: "TI" | "FARGO";
  monthId: string;
  monthLabel: string;
  priorMonthId: string | null;
  priorLabel: string | null;
  groupOrder: string[];
  groupLabel: (g: string) => string;
  categoriesOfGroup: (g: string) => OpexCategoryLite[];
  byCatMonth: Map<string, CatMonth>;
  onSave: (values: Map<string, { bank: number; cash: number }>) => Promise<void>;
  onClose: () => void;
}) {
  const { t, locale } = useT();
  const ru = locale === "ru";
  const split = variant === "TI";

  const [fields, setFields] = useState<Map<string, { bank: string; cash: string; touched: boolean }>>(() => {
    const m = new Map<string, { bank: string; cash: string; touched: boolean }>();
    for (const g of groupOrder)
      for (const c of categoriesOfGroup(g)) {
        const v = byCatMonth.get(keyOf(c.id, monthId));
        m.set(c.id, {
          bank: v && v.bank !== 0 ? fmtN(v.bank) : "",
          cash: v && v.cash !== 0 ? fmtN(v.cash) : "",
          touched: !!v && v.bank + v.cash !== 0,
        });
      }
    return m;
  });
  const [busy, setBusy] = useState(false);

  const setField = (id: string, patch: Partial<{ bank: string; cash: string }>) =>
    setFields((m) => {
      const next = new Map(m);
      const curV = next.get(id) ?? { bank: "", cash: "", touched: false };
      next.set(id, { ...curV, ...patch, touched: true });
      return next;
    });

  function copyFromPrior() {
    if (!priorMonthId) return;
    setFields((m) => {
      const next = new Map(m);
      for (const [id] of next) {
        const p = byCatMonth.get(keyOf(id, priorMonthId));
        next.set(id, {
          bank: p && p.bank !== 0 ? fmtN(p.bank) : "",
          cash: p && p.cash !== 0 ? fmtN(p.cash) : "",
          touched: false, // muted until edited
        });
      }
      return next;
    });
  }

  function clearAll() {
    setFields((m) => {
      const next = new Map<string, { bank: string; cash: string; touched: boolean }>();
      for (const [id] of m) next.set(id, { bank: "", cash: "", touched: true });
      return next;
    });
  }

  let totalBank = 0;
  let totalCash = 0;
  for (const [, v] of fields) {
    totalBank += num(v.bank);
    totalCash += num(v.cash);
  }

  async function save() {
    setBusy(true);
    const values = new Map<string, { bank: number; cash: number }>();
    for (const [id, v] of fields) values.set(id, { bank: num(v.bank), cash: num(v.cash) });
    await onSave(values);
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-xl flex-col bg-surface shadow-[-8px_0_32px_rgba(16,24,40,0.18)]">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 className="font-display text-[16px] font-semibold">
            {ru ? "Заполнить" : "Fill"} {monthLabel}
          </h2>
          <div className="flex items-center gap-2">
            {priorMonthId && (
              <Button variant="secondary" onClick={copyFromPrior}>
                {ru ? "Скопировать из" : "Copy from"} {priorLabel}
              </Button>
            )}
            <Button variant="secondary" onClick={clearAll}>
              {ru ? "Очистить всё" : "Clear all"}
            </Button>
            <button onClick={onClose} className="text-muted transition-colors hover:text-ink" title={t("close")}>
              <IconX size={16} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="sticky top-0 z-10 -mx-5 -mt-4 mb-2 flex items-center gap-2 border-b border-accent-soft bg-accent-soft-bg px-5 py-2">
            <span className="label-caps min-w-0 flex-1">{t("category")}</span>
            <span className="label-caps w-28 text-right">{split ? t("bank") : t("amount")}</span>
            {split && <span className="label-caps w-28 text-right">{t("cash")}</span>}
            <span className="label-caps w-28 shrink-0 text-right">{t("total")}</span>
          </div>
          {groupOrder.map((g) => (
            <div key={g} className="mb-5">
              <div className="label-caps mb-2 border-b border-border pb-1.5">{groupLabel(g)}</div>
              <div className="space-y-1">
                {categoriesOfGroup(g).map((c) => {
                  const f = fields.get(c.id) ?? { bank: "", cash: "", touched: false };
                  const cls = (v: string) =>
                    `num w-28 rounded-md border border-border px-2 py-1.5 text-right text-[13px] outline-none focus:border-accent ${
                      f.touched || v === "" ? "" : "text-muted"
                    }`;
                  return (
                    <div key={c.id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px]" title={c.name}>
                        {c.name}
                      </span>
                      <input
                        value={f.bank}
                        onChange={(e) => setField(c.id, { bank: e.target.value })}
                        onBlur={(e) => setField(c.id, { bank: pretty(e.target.value) })}
                        placeholder={split ? t("bank") : t("amount")}
                        className={cls(f.bank)}
                      />
                      {split && (
                        <input
                          value={f.cash}
                          onChange={(e) => setField(c.id, { cash: e.target.value })}
                          onBlur={(e) => setField(c.id, { cash: pretty(e.target.value) })}
                          placeholder={t("cash")}
                          className={cls(f.cash)}
                        />
                      )}
                      <span className="num w-28 shrink-0 text-right text-[12.5px] text-muted">
                        {fmtN(num(f.bank) + num(f.cash))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-border bg-surface-low px-5 py-3">
          <div className="mb-2 flex items-center justify-end gap-6 text-[12.5px]">
            <span className="label-caps">{t("total")}</span>
            {split && (
              <>
                <span>
                  <span className="mr-1.5 text-muted">{t("bank")}</span>
                  <span className="num font-semibold">{fmtN(totalBank)}</span>
                </span>
                <span>
                  <span className="mr-1.5 text-muted">{t("cash")}</span>
                  <span className="num font-semibold">{fmtN(totalCash)}</span>
                </span>
              </>
            )}
            <span>
              <span className="mr-1.5 text-muted">{ru ? "Всего" : "Total"}</span>
              <span className="num font-display text-[15px] font-bold text-accent">{fmtN(totalBank + totalCash)}</span>
            </span>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? t("saving") : ru ? "Сохранить месяц" : "Save month"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
