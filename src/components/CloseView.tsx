"use client";

// Ввод данных (monthly close): a guided six-step checklist for one month.
// Each step shows its status and opens the focused place to enter that data.
// Once the data is in, ADMIN closes the month here — freezing it for STAFF
// and the 1C feeds and putting it onto the P&L — and can reopen it later.
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { fmtN } from "@/lib/format";
import { IconCheck, IconChevronRight } from "./icons";
import Sync1cPanel from "./Sync1cPanel";
import type { MonthIn } from "@/lib/engine/types";
import type { MonthStatus } from "@/lib/month-status";
import type { DictKey } from "@/lib/i18n";

export default function CloseView({
  months,
  monthId,
  status,
  summary,
  closedInfo,
  isAdmin,
}: {
  months: MonthIn[];
  monthId: string;
  status: MonthStatus | null;
  summary: { revenue: number; totalOpex: number; netProfit: number };
  closedInfo: { closed: boolean; closedBy: string | null; closedAt: string | null };
  isAdmin: boolean;
}) {
  const { t, locale } = useT();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function setClosed(action: "close" | "reopen") {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/close-month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthId, action }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "error");
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }
  const monthName = (() => {
    const m = months.find((x) => x.id === monthId);
    return m ? (locale === "ru" ? m.nameRu : m.nameEn) : monthId;
  })();

  const steps: Array<{
    key: DictKey;
    done: boolean;
    optional?: boolean;
    href: string;
    note: { ru: string; en: string };
  }> = [
    {
      key: "stepSales",
      done: !!status?.hasSales,
      href: `/sales?month=${monthId}`,
      note: {
        ru: "Количество по товарам и каналам — вручную, CSV или из 1С",
        en: "Quantities by product and channel — manual, CSV or from 1C",
      },
    },
    {
      key: "stepShipments",
      done: !!status?.hasShipments,
      optional: true,
      href: "/shipments",
      note: {
        ru: "Только в месяцы с новыми поставками из Германии",
        en: "Only in months with new shipments from Germany",
      },
    },
    {
      key: "stepOpexTi",
      done: !!status?.hasOpexTi,
      href: `/opex-ti?month=${monthId}`,
      note: { ru: "Банк и наличные по категориям", en: "Bank and cash by category" },
    },
    {
      key: "stepOpexFargo",
      done: !!status?.hasOpexFargo,
      href: `/opex-fargo?month=${monthId}`,
      note: { ru: "Расходы дистрибуции по категориям", en: "Distribution expenses by category" },
    },
    {
      key: "stepStockBalance",
      done: !!status?.hasStock && !!status?.hasInputs,
      href: `/close/balance?month=${monthId}`,
      note: {
        ru: "Остатки по складам, дебиторка, банк, займы, взносы и платежи Fargo↔TI",
        en: "Warehouse stock, AR, bank, loans, capital and Fargo↔TI payments",
      },
    },
  ];

  const required = steps.filter((s) => !s.optional);
  const doneCount = required.filter((s) => s.done).length;
  const progress = required.length > 0 ? doneCount / required.length : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-16">
      <div>
        <h1 className="font-display text-[24px] font-semibold tracking-[-0.01em]">
          {t("closeTitle")} — {monthName}
        </h1>
        <p className="mt-1 text-[13.5px] text-muted">{t("closeSubtitle")}</p>
      </div>

      {/* progress */}
      <div className="quiet-card rounded-xl p-6">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="label-caps">{t("monthProgress")}</span>
          <span className="font-display text-[20px] font-semibold text-accent">
            {doneCount} / {required.length}
          </span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-low">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        {progress === 1 && (
          <div className="mt-3 flex items-center gap-1.5 text-[13px] font-medium text-ok">
            <IconCheck size={14} /> {t("monthComplete")} · {t("netProfit").toLowerCase()}:{" "}
            <span className="num">{fmtN(summary.netProfit)}</span>
          </div>
        )}
      </div>

      {/* close / reopen */}
      <div className="quiet-card rounded-xl p-6">
        {closedInfo.closed ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-ok">
                <IconCheck size={16} /> {t("monthClosedBadge")}
              </div>
              <p className="mt-1 text-[13px] text-muted">
                {t("closedOn")}
                {closedInfo.closedBy ? ` · ${closedInfo.closedBy}` : ""}
                {closedInfo.closedAt
                  ? ` · ${new Date(closedInfo.closedAt).toLocaleDateString(
                      locale === "ru" ? "ru-RU" : "en-GB",
                      { day: "numeric", month: "long", year: "numeric" }
                    )}`
                  : ""}
              </p>
            </div>
            {isAdmin && (
              <button
                onClick={() => {
                  if (confirm(t("reopenMonthConfirm"))) void setClosed("reopen");
                }}
                disabled={busy || pending}
                className="rounded-lg border border-border px-4 py-2 text-[13.5px] font-medium transition-colors hover:border-border-strong hover:bg-surface-low disabled:opacity-50"
              >
                {t("reopenMonthBtn")}
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 max-w-xl">
              <div className="text-[15px] font-medium">{t("closeMonthBtn")}</div>
              <p className="mt-1 text-[13px] text-muted">{t("closeMonthHint")}</p>
            </div>
            {isAdmin && (
              <button
                onClick={() => {
                  if (progress < 1 && !confirm(t("closeMonthConfirmIncomplete"))) return;
                  void setClosed("close");
                }}
                disabled={busy || pending}
                className="rounded-lg bg-accent px-4 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {busy || pending ? t("saving") : t("closeMonthBtn")}
              </button>
            )}
          </div>
        )}
        {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
      </div>

      {/* steps */}
      <div className="space-y-3">
        {steps.map((s, i) => (
          <Link
            key={s.key}
            href={s.href}
            className="quiet-card group flex items-center gap-5 rounded-xl p-5 transition-colors"
          >
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-[15px] font-bold ${
                s.done ? "bg-ok-soft text-ok" : "bg-surface-low text-muted"
              }`}
            >
              {s.done ? <IconCheck size={17} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-medium">{t(s.key)}</span>
                {s.done ? (
                  <span className="rounded bg-ok-soft px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ok">
                    {t("stepDone")}
                  </span>
                ) : s.optional ? (
                  <span className="rounded bg-surface-low px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {t("stepOptional")}
                  </span>
                ) : (
                  <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warn">
                    {t("stepPending")}
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-[13px] text-muted">
                {locale === "ru" ? s.note.ru : s.note.en}
              </p>
            </div>
            <span className="flex items-center gap-1 text-[13px] font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
              {t("open")} <IconChevronRight size={14} />
            </span>
          </Link>
        ))}
      </div>

      <Sync1cPanel monthId={monthId} monthName={monthName} />
    </div>
  );
}
