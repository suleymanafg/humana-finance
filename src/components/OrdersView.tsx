"use client";

// «Заказы IBP» — the record of what is ordered from DMK, by ship month. The
// orders come from DMK's IBP export (uploaded here, checked before applied);
// months from the open slot on can be adjusted by hand. What was collected
// and what is still waiting at DMK is the app's own (trucks), never DMK's.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { dstr, monthShort, monthTag, pn, splitPack } from "@/lib/planning/ui-format";
import type { IbpChange } from "@/lib/planning/ibp-export";

export interface OrdersViewProps {
  skus: Array<{ id: string; name: string; pcsPerPallet: number }>;
  months: string[]; // ship months shown
  orders: Record<string, Record<string, number>>; // skuId -> ship month -> qty
  pickups: Record<string, Record<string, number>>; // skuId -> dispatch month -> units
  atDmk: Record<string, number>;
  salesPerMonth: Record<string, number>;
  slotShip: string; // the ship month the next deadline decides
  thisMonth: string;
  ibpSyncedAt: string | null;
  truckPallets: number;
}

type Preview = { months: string[]; changes: IbpChange[]; unmatched: string[]; applied: boolean };

export default function OrdersView(props: OrdersViewProps) {
  const { skus, months, orders, pickups, atDmk, salesPerMonth, slotShip, thisMonth, ibpSyncedAt, truckPallets } = props;
  const { locale } = useT();
  const ru = locale === "ru";
  const router = useRouter();

  // ── upload ──
  const [file, setFile] = useState<File | null>(null);
  const [from, setFrom] = useState(months.find((m) => m > thisMonth) ?? thisMonth);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(apply: boolean) {
    if (!file) {
      setError(ru ? "Выберите файл выгрузки" : "Choose the export file");
      return;
    }
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("from", from);
    if (apply) fd.append("apply", "1");
    const res = await fetch("/api/planning/ibp-import", { method: "POST", body: fd });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? (ru ? "Не удалось прочитать файл" : "Could not read the file"));
      return;
    }
    setPreview(body as Preview);
    if (apply) router.refresh();
  }

  // ── manual edits, open months only ──
  const [edits, setEdits] = useState<Record<string, string>>({});
  const key = (skuId: string, m: string) => `${skuId}|${m}`;
  const valueOf = (skuId: string, m: string) => {
    const e = edits[key(skuId, m)];
    if (e !== undefined) return Number(e.replace(/[^\d]/g, "")) || 0;
    return orders[skuId]?.[m] ?? 0;
  };
  const dirty = useMemo(
    () => Object.entries(edits).filter(([k, v]) => {
      const [skuId, m] = k.split("|");
      return (Number(v.replace(/[^\d]/g, "")) || 0) !== (orders[skuId]?.[m] ?? 0);
    }),
    [edits, orders]
  );
  const [saving, setSaving] = useState(false);
  async function saveEdits() {
    if (dirty.length === 0 || saving) return;
    setSaving(true);
    const byMonth: Record<string, Array<{ skuId: string; qty: number }>> = {};
    for (const [k, v] of dirty) {
      const [skuId, m] = k.split("|");
      (byMonth[m] ??= []).push({ skuId, qty: Number(v.replace(/[^\d]/g, "")) || 0 });
    }
    for (const [shipMonth, lines] of Object.entries(byMonth)) {
      await fetch("/api/planning/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipMonth, lines }),
      });
    }
    setSaving(false);
    setEdits({});
    router.refresh();
  }

  const palletsOf = (skuId: string, units: number) => {
    const p = skus.find((s) => s.id === skuId)?.pcsPerPallet ?? 0;
    return p > 0 ? units / p : 0;
  };

  return (
    <div className="space-y-4">
      <section className="pcard p-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-[14px] font-extrabold">{ru ? "Загрузить выгрузку IBP" : "Load the IBP export"}</h2>
          <span className="text-[12px] font-semibold text-muted">
            {ibpSyncedAt
              ? ru ? `последняя загрузка ${dstr(ibpSyncedAt.slice(0, 10))}` : `last loaded ${dstr(ibpSyncedAt.slice(0, 10))}`
              : ru ? "ещё не загружалась" : "never loaded"}
          </span>
        </div>
        <p className="mt-1 text-[12px] font-semibold text-muted">
          {ru
            ? "Из файла берутся только заказы (Partner Forecast Input) по месяцам отгрузки. Что забрано и что ждёт у DMK — по нашим фурам."
            : "Only the orders (Partner Forecast Input) by ship month are taken. What was collected and what waits at DMK comes from our trucks."}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setError(null);
            }}
            className="text-[12.5px]"
          />
          <label className="flex items-center gap-1.5 text-[12px] font-bold text-muted">
            {ru ? "с месяца отгрузки" : "from ship month"}
            <select value={from} onChange={(e) => { setFrom(e.target.value); setPreview(null); }} className="rounded-md border border-border bg-surface px-2 py-1 text-[12.5px]">
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthTag(m, ru)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => void send(false)} className="rounded-lg border border-border px-3.5 py-1.5 text-[12.5px] font-bold">
            {busy && !preview ? "…" : ru ? "Проверить" : "Check"}
          </button>
          {preview && !preview.applied && preview.changes.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void send(true)}
              className="rounded-lg px-3.5 py-1.5 text-[12.5px] font-extrabold text-white"
              style={{ background: "var(--accent)" }}
            >
              {ru ? `Применить ${preview.changes.length} изм.` : `Apply ${preview.changes.length} changes`}
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-[12.5px] font-bold" style={{ color: "var(--danger)" }}>{error}</p>}
        {preview && (
          <div className="mt-3 text-[12.5px]">
            {preview.applied && <p className="font-bold" style={{ color: "var(--ok)" }}>{ru ? "Загружено." : "Loaded."}</p>}
            {preview.changes.length === 0 ? (
              <p className="font-semibold text-muted">{ru ? "Заказы в приложении уже совпадают с выгрузкой." : "The app's orders already match the export."}</p>
            ) : (
              <table className="ptable mt-1">
                <thead>
                  <tr>
                    <th>{ru ? "Товар" : "Product"}</th>
                    <th>{ru ? "Отгрузка" : "Ship month"}</th>
                    <th>{ru ? "Было" : "Was"}</th>
                    <th>{ru ? "Станет" : "Will be"}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.changes.map((c) => (
                    <tr key={`${c.skuId}|${c.shipMonth}`}>
                      <td className="font-bold">{splitPack(c.name).name} <span className="text-[11px]" style={{ color: "var(--sky)" }}>{splitPack(c.name).pack}</span></td>
                      <td>{monthTag(c.shipMonth, ru)}</td>
                      <td className="pnum text-muted">{pn(c.from)}</td>
                      <td className="pnum font-bold">{pn(c.to)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {preview.unmatched.length > 0 && (
              <p className="mt-2 font-semibold" style={{ color: "var(--warn-ink)" }}>
                {ru ? "Нет в справочнике SKU (пропущено): " : "Not in the SKU list (skipped): "}
                {preview.unmatched.join(", ")}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="pcard overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3" style={{ borderColor: "var(--hair)" }}>
          <h2 className="text-[14px] font-extrabold">{ru ? "Заказы по месяцам отгрузки" : "Orders by ship month"}</h2>
          <span className="text-[11.5px] font-semibold text-muted">
            {ru
              ? `до ${monthTag(slotShip, true)} — зафиксировано; с ${monthTag(slotShip, true)} можно менять`
              : `before ${monthTag(slotShip, false)} — fixed; from ${monthTag(slotShip, false)} on — open`}
          </span>
          {dirty.length > 0 && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveEdits()}
              className="ml-auto rounded-lg px-3.5 py-1.5 text-[12.5px] font-extrabold text-white"
              style={{ background: "var(--accent)" }}
            >
              {saving ? "…" : ru ? `Сохранить (${dirty.length})` : `Save (${dirty.length})`}
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="ptable text-[12.5px]">
            <thead>
              <tr>
                <th>{ru ? "Товар" : "Product"}</th>
                <th>{ru ? "Ждёт у DMK" : "At DMK"}</th>
                <th>{ru ? "Продажи/мес" : "Sales/mo"}</th>
                {months.map((m) => (
                  <th
                    key={m}
                    className="!text-center"
                    style={m === slotShip ? { background: "var(--accent)", color: "#fff" } : m < slotShip ? { color: "var(--faint)" } : undefined}
                  >
                    {monthShort(m, ru)} {m.slice(2, 4)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {skus.map((s) => {
                const { name, pack } = splitPack(s.name);
                return (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap">
                      <span className="font-bold">{name}</span> <span className="text-[11px] font-bold" style={{ color: "var(--sky)" }}>{pack}</span>
                    </td>
                    <td className="pnum">{atDmk[s.id] ? pn(atDmk[s.id]) : "—"}</td>
                    <td className="pnum text-muted">{pn(salesPerMonth[s.id] ?? 0)}</td>
                    {months.map((m) => {
                      const v = valueOf(s.id, m);
                      if (m < slotShip) {
                        return (
                          <td key={m} className="pnum" style={{ color: m <= thisMonth ? "var(--faint)" : undefined }}>
                            {v ? pn(v) : "—"}
                          </td>
                        );
                      }
                      return (
                        <td key={m} className="!px-1">
                          <input
                            inputMode="numeric"
                            value={edits[key(s.id, m)] ?? (v ? String(v) : "")}
                            onChange={(e) => setEdits((x) => ({ ...x, [key(s.id, m)]: e.target.value }))}
                            className="pnum w-[76px] rounded-md border border-border bg-surface px-1.5 py-1 text-right text-[12.5px]"
                            placeholder="0"
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>{ru ? "Итого, шт" : "Total, units"}</td>
                <td className="pnum">{pn(skus.reduce((t, s) => t + (atDmk[s.id] ?? 0), 0))}</td>
                <td className="pnum">{pn(skus.reduce((t, s) => t + (salesPerMonth[s.id] ?? 0), 0))}</td>
                {months.map((m) => (
                  <td key={m} className="pnum">{pn(skus.reduce((t, s) => t + valueOf(s.id, m), 0))}</td>
                ))}
              </tr>
              <tr>
                <td>{ru ? "Фур (по паллетам)" : "Trucks (by pallets)"}</td>
                <td />
                <td />
                {months.map((m) => {
                  const pal = skus.reduce((t, s) => t + palletsOf(s.id, valueOf(s.id, m)), 0);
                  return (
                    <td key={m} className="pnum text-muted">
                      {pal > 0 ? (pal / truckPallets).toFixed(1) : "—"}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td>{ru ? "Забрано (по дате отгрузки)" : "Collected (by dispatch)"}</td>
                <td />
                <td />
                {months.map((m) => {
                  const u = skus.reduce((t, s) => t + (pickups[s.id]?.[m] ?? 0), 0);
                  return (
                    <td key={m} className="pnum text-muted">
                      {m <= thisMonth && u > 0 ? pn(u) : "—"}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="px-5 py-3 text-[11.5px] font-semibold text-muted">
          {ru
            ? "«Ждёт у DMK» — заказано на месяцы отгрузки до текущего минус всё забранное с января 2026."
            : "«At DMK» — ordered for ship months up to this one, less everything collected since January 2026."}
        </p>
      </section>
    </div>
  );
}
