"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { crud } from "@/lib/crud-client";
import { fmtN, parseNum } from "@/lib/format";

/** Month-end physical count: products × warehouses, saved as you leave a cell. */
export default function StockCountGrid({
  monthId,
  products,
  warehouses,
  counts,
  readOnly,
}: {
  monthId: string;
  products: Array<{ id: string; name: string }>;
  warehouses: Array<{ id: string; name: string }>;
  counts: Record<string, number>; // productId|warehouseId → qty
  readOnly: boolean;
}) {
  const { l } = useT();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const total = (pid: string) => warehouses.reduce((s, w) => s + (counts[`${pid}|${w.id}`] ?? 0), 0);

  async function save(productId: string, warehouseId: string, text: string, previous: number | undefined) {
    const qty = parseNum(text) ?? 0;
    if (qty === (previous ?? 0)) return;
    const res = await crud("stockCount", "upsert", { data: { monthId, productId, warehouseId, qty } });
    if (res.error) setError(res.error);
    else router.refresh();
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="stmt">
        <thead>
          <tr>
            <th>{l({ ru: "Товар", en: "Product" })}</th>
            {warehouses.map((w) => (
              <th key={w.id}>{w.name}</th>
            ))}
            {warehouses.length > 1 && <th>{l({ ru: "Итого", en: "Total" })}</th>}
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              {warehouses.map((w) => {
                const key = `${p.id}|${w.id}`;
                const v = counts[key];
                return (
                  <td key={w.id}>
                    {readOnly ? (
                      v == null ? "—" : fmtN(v)
                    ) : (
                      <input
                        defaultValue={v == null ? "" : fmtN(v)}
                        key={`${key}-${v ?? ""}`}
                        onBlur={(e) => save(p.id, w.id, e.target.value, v)}
                        placeholder="—"
                        className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-right text-[12.5px] tabular-nums outline-none focus:border-accent"
                      />
                    )}
                  </td>
                );
              })}
              {warehouses.length > 1 && <td className="font-semibold">{fmtN(total(p.id))}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {error && <div className="border-t border-border px-3 py-2 text-[12px] text-danger">{error}</div>}
    </div>
  );
}
