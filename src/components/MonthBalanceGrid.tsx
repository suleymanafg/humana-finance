"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { crud } from "@/lib/crud-client";
import { fmtN, parseNum } from "@/lib/format";
import type { MonthLite } from "./statement";

type Field = "tiBank" | "tiCash" | "goodsInTransit";
const FIELDS: Array<{ field: Field; label: { ru: string; en: string } }> = [
  { field: "tiBank", label: { ru: "Деньги TI на счёте", en: "TI cash at bank" } },
  { field: "tiCash", label: { ru: "Деньги TI в кассе", en: "TI cash on hand" } },
  { field: "goodsInTransit", label: { ru: "Товар в пути (предоплата)", en: "Goods in transit (prepaid)" } },
];

/** Month-end cash and prepayments: one row per month, saved as you leave a cell. */
export default function MonthBalanceGrid({
  months,
  monthId,
  balances,
  closed,
  canEdit,
  canEditClosed,
}: {
  months: MonthLite[];
  monthId: string;
  balances: Record<string, { tiBank: number; tiCash: number; goodsInTransit: number }>;
  closed: string[];
  canEdit: boolean;
  canEditClosed: boolean;
}) {
  const { locale, l } = useT();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function save(month: string, field: Field, text: string) {
    const v = parseNum(text) ?? 0;
    const current = balances[month];
    if ((current?.[field] ?? 0) === v && current) return;
    const data = { monthId: month, tiBank: current?.tiBank ?? 0, tiCash: current?.tiCash ?? 0, goodsInTransit: current?.goodsInTransit ?? 0, [field]: v };
    const res = await crud("monthBalance", "upsert", { data });
    if (res.error) setError(res.error);
    else router.refresh();
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="stmt">
        <thead>
          <tr>
            <th>{l({ ru: "Конец месяца", en: "Month-end" })}</th>
            {FIELDS.map((f) => (
              <th key={f.field}>{l(f.label)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...months].reverse().map((m) => {
            const b = balances[m.id];
            const editable = canEdit && (!closed.includes(m.id) || canEditClosed);
            return (
              <tr key={m.id} className={m.id === monthId ? "font-semibold" : ""}>
                <td>
                  {locale === "ru" ? m.nameRu : m.nameEn}
                  {!b && <span className="ml-2 text-[11.5px] font-normal text-muted">{l({ ru: "не внесено", en: "not entered" })}</span>}
                </td>
                {FIELDS.map((f) => (
                  <td key={f.field}>
                    {editable ? (
                      <input
                        key={`${m.id}-${f.field}-${b?.[f.field] ?? ""}`}
                        defaultValue={b ? fmtN(b[f.field]) : ""}
                        placeholder="—"
                        onBlur={(e) => {
                          if (e.target.value.trim() === "" && !b) return;
                          void save(m.id, f.field, e.target.value);
                        }}
                        className="w-40 rounded-md border border-border bg-surface px-2 py-1 text-right text-[12.5px] tabular-nums outline-none focus:border-accent"
                      />
                    ) : b ? (
                      fmtN(b[f.field])
                    ) : (
                      "—"
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <div className="border-t border-border px-3 py-2 text-[12px] text-danger">{error}</div>}
    </div>
  );
}
