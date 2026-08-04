"use client";

// «Синхронизация 1С» — pulls the month's sales from the pinetrade API.
// Credentials are typed in at load time and sent to our server route only
// (the browser never talks to 1C directly); the server passes them through to
// 1C and forgets them. Preview first, then an explicit full-snapshot Apply.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { fmtN } from "@/lib/format";
import { Badge, Button, Input } from "./ui";
import type { BatchSyncReport, ReconcileReport, SyncReport } from "@/lib/sync-1c-core";

export default function Sync1cPanel({ monthId, monthName }: { monthId: string; monthName: string }) {
  const { t } = useT();
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [byClientName, setByClientName] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [reconcile, setReconcile] = useState<ReconcileReport | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [batch, setBatch] = useState<BatchSyncReport | null>(null);
  const [batchOk, setBatchOk] = useState(false);
  const [batching, setBatching] = useState(false);
  const [excelOk, setExcelOk] = useState(false);
  const [done, setDone] = useState(false);

  const excelWarn = !!report && report.current.withAmount > 0 && !report.committed;

  async function run(mode: "preview" | "commit") {
    setBusy(true);
    setError(null);
    if (mode === "preview") {
      setReport(null);
      setDone(false);
      setExcelOk(false);
    }
    try {
      const res = await fetch("/api/sync/1c", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, monthId, login, password, byClientName }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setReport(body as SyncReport);
      if (mode === "commit") {
        setDone(true);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runReconcile() {
    setReconciling(true);
    setError(null);
    setReconcile(null);
    try {
      const res = await fetch("/api/sync/1c", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "reconcile", login, password }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setReconcile(body as ReconcileReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReconciling(false);
    }
  }

  async function runBatch() {
    setBatching(true);
    setError(null);
    try {
      const res = await fetch("/api/sync/1c", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "commit-all", login, password, byClientName }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setBatch(body as BatchSyncReport);
      setReconcile(null);
      setReport(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatching(false);
    }
  }

  const totalNew = report?.products.reduce((s, p) => s + p.qtyNew, 0) ?? 0;
  const totalCur = report?.products.reduce((s, p) => s + p.qtyCur, 0) ?? 0;
  const mismatched = reconcile?.months.filter((m) => m.appQty !== m.apiQty) ?? [];

  return (
    <div className="quiet-card rounded-xl p-6">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="font-display text-[17px] font-semibold">{t("sync1cTitle")}</h2>
        <span className="rounded bg-surface-low px-1.5 py-0.5 text-[11px] font-semibold text-muted">
          {monthName}
        </span>
      </div>
      <p className="mb-4 text-[13px] text-muted">{t("sync1cSubtitle")}</p>

      {/* credentials + load */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label-caps mb-1 block">{t("sync1cLogin")}</span>
          <Input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="off"
            name="sync1c-login"
            className="w-40"
          />
        </label>
        <label className="block">
          <span className="label-caps mb-1 block">{t("sync1cPassword")}</span>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            name="sync1c-password"
            className="w-40"
          />
        </label>
        <Button onClick={() => run("preview")} disabled={busy || reconciling || !login || !password}>
          {busy && !report ? t("sync1cLoading") : t("sync1cLoad")}
        </Button>
        <Button
          variant="secondary"
          onClick={runReconcile}
          disabled={busy || reconciling || !login || !password}
        >
          {reconciling ? t("sync1cReconciling") : t("sync1cReconcile")}
        </Button>
      </div>
      <p className="mt-2 text-[12px] text-muted">{t("sync1cReconcileNote")}</p>
      <label className="mt-3 flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={byClientName}
          onChange={(e) => setByClientName(e.target.checked)}
          className="accent-accent"
        />
        {t("sync1cByClient")}
      </label>
      <p className="mt-2 text-[12px] text-muted">{t("sync1cPasswordNote")}</p>

      {error && (
        <div className="mt-4 rounded-lg border border-warn/40 bg-warn-soft p-3 text-[13px] text-warn">
          {error}
        </div>
      )}

      {report && (
        <div className="mt-5 space-y-5 border-t border-border pt-5">
          {/* summary */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
            <span>
              <span className="label-caps mr-2">{t("sync1cDocs")}</span>
              <span className="num font-medium">{fmtN(report.fetched.sales)}</span> {t("sync1cSales")} ·{" "}
              <span className="num font-medium">{fmtN(report.fetched.returns)}</span> {t("sync1cReturns")}
            </span>
            <span>
              <span className="label-caps mr-2">{t("sync1cQtyNet")}</span>
              <span className="num font-medium">{fmtN(totalCur)}</span> →{" "}
              <span className="num font-semibold text-accent">{fmtN(totalNew)}</span>
            </span>
            {report.fetched.outsidePeriod > 0 && (
              <span className="text-muted">
                {fmtN(report.fetched.outsidePeriod)} {t("sync1cOutsidePeriod")}
              </span>
            )}
            {done && <Badge tone="ok">✓ {t("sync1cApplied")}</Badge>}
          </div>

          {/* per-product comparison */}
          <div>
            <div className="label-caps mb-2">{t("sync1cByProduct")}</div>
            <div className="max-h-72 overflow-auto rounded-lg border border-border">
              <table className="tbl w-full">
                <thead>
                  <tr>
                    <th className="text-left text-[12px]">{t("product")}</th>
                    <th className="text-right text-[12px]">{t("sync1cWas")}</th>
                    <th className="text-right text-[12px]">{t("sync1cWillBe")}</th>
                    <th className="text-right text-[12px]">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {report.products.map((p) => {
                    const d = p.qtyNew - p.qtyCur;
                    return (
                      <tr key={p.productId}>
                        <td className="text-[12.5px]">{p.name}</td>
                        <td className="num text-right text-[12.5px]">{fmtN(p.qtyCur)}</td>
                        <td className="num text-right text-[12.5px] font-medium">{fmtN(p.qtyNew)}</td>
                        <td
                          className={`num text-right text-[12.5px] ${
                            d === 0 ? "text-muted" : d > 0 ? "text-ok" : "text-warn"
                          }`}
                        >
                          {d > 0 ? "+" : ""}
                          {fmtN(d)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* per-channel distribution */}
          <div>
            <div className="label-caps mb-2">{t("sync1cByChannel")}</div>
            <div className="max-h-56 overflow-auto rounded-lg border border-border">
              <table className="tbl w-full">
                <tbody>
                  {report.channels.map((c) => (
                    <tr key={c.channelId}>
                      <td className="text-[12.5px]">{c.name}</td>
                      <td className="num text-right text-[12.5px]">{fmtN(c.qty)}</td>
                      <td className="num text-right text-[12px] text-muted">
                        {totalNew !== 0 ? `${((c.qty / totalNew) * 100).toFixed(1)}%` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* problems */}
          {report.unknownSkus.length > 0 && (
            <div className="rounded-lg border border-warn/40 bg-warn-soft p-3">
              <div className="mb-1 text-[13px] font-medium text-warn">
                {t("sync1cUnknownSkus")} ({report.unknownSkus.length})
              </div>
              <ul className="space-y-0.5 text-[12.5px]">
                {report.unknownSkus.map((u) => (
                  <li key={u.code + u.name}>
                    {u.code} · {u.name} — <span className="num">{fmtN(u.qty)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.negativeKeys.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <div className="mb-1 text-[13px] font-medium text-muted">{t("sync1cNegative")}</div>
              <ul className="space-y-0.5 text-[12.5px]">
                {report.negativeKeys.map((n, i) => (
                  <li key={i}>
                    {n.product} / {n.channel} — <span className="num">{fmtN(n.qty)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.fallbackClients.length > 0 && (
            <details className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer text-[13px] font-medium">
                {t("sync1cFallback")} ({report.fallbackClients.length})
              </summary>
              <p className="mt-1 text-[12px] text-muted">{t("sync1cFallbackNote")}</p>
              <ul className="mt-2 max-h-48 space-y-0.5 overflow-auto text-[12.5px]">
                {report.fallbackClients.map((f) => (
                  <li key={f.client} className="flex justify-between gap-3">
                    <span className="truncate">{f.client}</span>
                    <span className="num shrink-0">{fmtN(f.qty)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {report.learnedCodes.length > 0 && (
            <div className="text-[12.5px] text-muted">
              {t("sync1cLearned")}:{" "}
              {report.learnedCodes.map((l) => `${l.code} → ${l.product}`).join("; ")}
            </div>
          )}

          {/* apply */}
          {!done && (
            <div className="space-y-3 border-t border-border pt-4">
              {excelWarn && (
                <div className="rounded-lg border border-warn/40 bg-warn-soft p-3 text-[13px]">
                  <p className="font-medium text-warn">{t("sync1cExcelWarn")}</p>
                  <label className="mt-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={excelOk}
                      onChange={(e) => setExcelOk(e.target.checked)}
                      className="accent-accent"
                    />
                    {t("sync1cExcelConfirm")}
                  </label>
                </div>
              )}
              <div className="flex items-center gap-3">
                <Button
                  onClick={() => run("commit")}
                  disabled={busy || (excelWarn && !excelOk) || !login || !password}
                >
                  {t("sync1cApply")}
                </Button>
                <span className="text-[12px] text-muted">{t("sync1cReplaceNote")}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {reconcile && (
        <div className="mt-5 space-y-4 border-t border-border pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="label-caps">{t("sync1cReconcile")}</span>
            <span className="text-[12px] text-muted">
              {reconcile.dateFrom} — {reconcile.dateTo}
            </span>
            {mismatched.length === 0 ? (
              <Badge tone="ok">✓ {t("sync1cAllMatch")}</Badge>
            ) : (
              <Badge tone="warn">
                {mismatched.length} {t("sync1cMismatch")}
              </Badge>
            )}
          </div>
          <div className="overflow-auto rounded-lg border border-border">
            <table className="tbl w-full">
              <thead>
                <tr>
                  <th className="text-left text-[12px]">{t("month")}</th>
                  <th className="text-right text-[12px]">{t("sync1cInApp")}</th>
                  <th className="text-right text-[12px]">{t("sync1cIn1c")}</th>
                  <th className="text-right text-[12px]">Δ</th>
                </tr>
              </thead>
              <tbody>
                {reconcile.months.map((m) => {
                  const d = m.apiQty - m.appQty;
                  return (
                    <tr key={m.monthId}>
                      <td className="text-[12.5px]">
                        {m.monthId}
                        {m.products.length > 0 && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[11.5px] text-muted">
                              {m.products.length} SKU
                            </summary>
                            <ul className="mt-1 space-y-0.5 text-[11.5px] text-muted">
                              {m.products.map((p) => (
                                <li key={p.name}>
                                  {p.name}: <span className="num">{fmtN(p.appQty)}</span> →{" "}
                                  <span className="num">{fmtN(p.apiQty)}</span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td className="num text-right align-top text-[12.5px]">{fmtN(m.appQty)}</td>
                      <td className="num text-right align-top text-[12.5px]">{fmtN(m.apiQty)}</td>
                      <td
                        className={`num text-right align-top text-[12.5px] ${
                          d === 0 ? "text-ok" : "text-warn"
                        }`}
                      >
                        {d === 0 ? "✓" : `${d > 0 ? "+" : ""}${fmtN(d)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {reconcile.unknownSkus.length > 0 && (
            <div className="text-[12px] text-muted">
              {t("sync1cExcludedBoth")}:{" "}
              {reconcile.unknownSkus.map((u) => `${u.name} (${fmtN(u.qty)})`).join("; ")}
            </div>
          )}

          {/* batch replace — deliberately only offered after seeing the diff */}
          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-[13px] text-muted">{t("sync1cReplaceAllNote")}</p>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={batchOk}
                onChange={(e) => setBatchOk(e.target.checked)}
                className="accent-accent"
              />
              {t("sync1cReplaceAllConfirm")}
            </label>
            <Button
              variant="danger"
              onClick={runBatch}
              disabled={batching || busy || !batchOk || !login || !password}
            >
              {batching ? t("sync1cReplacing") : t("sync1cReplaceAll")}
            </Button>
          </div>
        </div>
      )}

      {batch && (
        <div className="mt-5 space-y-4 border-t border-border pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="ok">✓ {t("sync1cReplaceAllDone")}</Badge>
            <span className="text-[12px] text-muted">
              {batch.dateFrom} — {batch.dateTo}
            </span>
          </div>
          <div className="overflow-auto rounded-lg border border-border">
            <table className="tbl w-full">
              <thead>
                <tr>
                  <th className="text-left text-[12px]">{t("month")}</th>
                  <th className="text-right text-[12px]">{t("sync1cWas")}</th>
                  <th className="text-right text-[12px]">{t("sync1cWillBe")}</th>
                  <th className="text-right text-[12px]">Δ</th>
                </tr>
              </thead>
              <tbody>
                {batch.months.map((m) => {
                  const d = m.qtyNew - m.qtyCur;
                  return (
                    <tr key={m.monthId}>
                      <td className="text-[12.5px]">{m.monthId}</td>
                      <td className="num text-right text-[12.5px]">{fmtN(m.qtyCur)}</td>
                      <td className="num text-right text-[12.5px] font-medium">{fmtN(m.qtyNew)}</td>
                      <td
                        className={`num text-right text-[12.5px] ${
                          d === 0 ? "text-muted" : d > 0 ? "text-ok" : "text-warn"
                        }`}
                      >
                        {d === 0 ? "—" : `${d > 0 ? "+" : ""}${fmtN(d)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {batch.skipped.length > 0 && (
            <div className="text-[12px] text-muted">
              {t("sync1cSkippedMonths")}: {batch.skipped.join(", ")}
            </div>
          )}
          {batch.unknownSkus.length > 0 && (
            <div className="text-[12px] text-muted">
              {t("sync1cUnknownSkus")}:{" "}
              {batch.unknownSkus.map((u) => `${u.code} · ${u.name} (${fmtN(u.qty)})`).join("; ")}
            </div>
          )}
          {batch.fallbackClients.length > 0 && (
            <details className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer text-[13px] font-medium">
                {t("sync1cFallback")} ({batch.fallbackClients.length})
              </summary>
              <ul className="mt-2 max-h-48 space-y-0.5 overflow-auto text-[12.5px]">
                {batch.fallbackClients.map((f) => (
                  <li key={f.client} className="flex justify-between gap-3">
                    <span className="truncate">{f.client}</span>
                    <span className="num shrink-0">{fmtN(f.qty)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
