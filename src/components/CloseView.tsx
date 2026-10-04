"use client";

// Month close: a checklist of the month's data, each step opening the page
// where it is entered. ADMIN closes the month here (freezing it for STAFF and
// the 1C feeds) and can reopen it.
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import type { MonthIn } from "@/lib/engine/types";
import type { MonthStatus } from "@/lib/month-status";

export default function CloseView({
  months,
  monthId,
  status,
  closedInfo,
  isAdmin,
}: {
  months: MonthIn[];
  monthId: string;
  status: MonthStatus | null;
  closedInfo: { closed: boolean; closedBy: string | null; closedAt: string | null };
  isAdmin: boolean;
}) {
  const { t, l, locale } = useT();
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

  const step = (
    key: string,
    title: { ru: string; en: string },
    done: boolean,
    href: string,
    note: { ru: string; en: string },
    optional = false
  ) => ({ key, title, done, href, note, optional });
  const steps = [
    step("sales", { ru: "Продажи", en: "Sales" }, !!status?.hasSales, "/sales/data", {
      ru: "Количество по товарам и каналам: из 1С, файлом или вручную",
      en: "Quantities by product and channel: from 1C, a file or by hand",
    }),
    step("invoices", { ru: "Счета-фактуры TI для Fargo", en: "TI invoices to Fargo" }, !!status?.hasInvoices, "/goods/invoices", {
      ru: "Каждая счёт-фактура месяца, как на бумаге",
      en: "Every invoice of the month, as printed",
    }, true),
    step("shipments", { ru: "Поставки", en: "Shipments" }, !!status?.hasShipments, "/goods/shipments", {
      ru: "Только в месяцы, когда пришла фура",
      en: "Only in months when a truck arrived",
    }, true),
    step("opexTi", { ru: "Расходы Turbo Impex", en: "Turbo Impex expenses" }, !!status?.hasOpexTi, "/expenses/ti", {
      ru: "Банк и наличные по категориям",
      en: "Bank and cash by category",
    }),
    step("opexFargo", { ru: "Расходы Fargo", en: "Fargo expenses" }, !!status?.hasOpexFargo, "/expenses/fargo", {
      ru: "Расходы на бизнес Humana, включая ретро-бонусы",
      en: "Costs of the Humana business, including retro bonuses",
    }),
    step("stock", { ru: "Пересчёт склада", en: "Warehouse count" }, !!status?.hasStock, "/goods/stock", {
      ru: "Фактические остатки по товарам на конец месяца",
      en: "Physical stock by product at month-end",
    }),
    step("payments", { ru: "Платежи Fargo", en: "Payments from Fargo" }, !!status?.hasTransfers, "/settlement/payments", {
      ru: "Наличные и банковские платежи Fargo за месяц",
      en: "Fargo's cash and bank payments in the month",
    }, true),
    step("ar", { ru: "Долги покупателей", en: "Customer receivables" }, !!status?.hasAr, "/settlement/receivables", {
      ru: "Сколько покупатели должны Fargo на конец месяца",
      en: "What customers owe Fargo at month-end",
    }, true),
    step("balances", { ru: "Денежные остатки", en: "Cash balances" }, !!status?.hasInputs, "/funding/balances", {
      ru: "Деньги TI на счёте и в кассе, товар в пути",
      en: "TI cash at bank and on hand, goods in transit",
    }),
    step("vat", { ru: "Лицевой счёт по НДС", en: "VAT tax account" }, !!status?.hasVatAccount, "/taxes/ti-vat", {
      ru: "Операции по лицевому счёту TI за месяц",
      en: "TI tax account operations for the month",
    }, true),
  ];

  const required = steps.filter((s) => !s.optional);
  const doneCount = required.filter((s) => s.done).length;
  const progress = required.length > 0 ? doneCount / required.length : 0;

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface px-5 py-4">
        <div className="min-w-0 max-w-xl">
          {closedInfo.closed ? (
            <>
              <div className="text-[15px] font-semibold">
                {monthName} · {t("monthClosedBadge").toLowerCase()}
              </div>
              <p className="mt-1 text-[13px] text-muted">
                {t("closedOn")}
                {closedInfo.closedBy ? ` · ${closedInfo.closedBy}` : ""}
                {closedInfo.closedAt
                  ? ` · ${new Date(closedInfo.closedAt).toLocaleDateString(locale === "ru" ? "ru-RU" : "en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}`
                  : ""}
              </p>
            </>
          ) : (
            <>
              <div className="text-[15px] font-semibold">
                {monthName}: {l({ ru: "внесено", en: "entered" })} {doneCount} {l({ ru: "из", en: "of" })}{" "}
                {required.length} {l({ ru: "обязательных разделов", en: "required sections" })}
              </div>
              <div className="mt-2.5 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-surface-low">
                <div className="h-full rounded-full bg-accent" style={{ width: `${progress * 100}%` }} />
              </div>
              <p className="mt-2.5 text-[13px] leading-snug text-muted">{t("closeMonthHint")}</p>
            </>
          )}
        </div>
        {isAdmin &&
          (closedInfo.closed ? (
            <button
              onClick={() => {
                if (confirm(t("reopenMonthConfirm"))) void setClosed("reopen");
              }}
              disabled={busy || pending}
              className="h-9 rounded-md border border-border px-4 text-[13px] font-medium transition-colors hover:bg-surface-low disabled:opacity-50"
            >
              {t("reopenMonthBtn")}
            </button>
          ) : (
            <button
              onClick={() => {
                if (progress < 1 && !confirm(t("closeMonthConfirmIncomplete"))) return;
                void setClosed("close");
              }}
              disabled={busy || pending}
              className="h-9 rounded-md bg-accent px-4 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {busy || pending ? t("saving") : t("closeMonthBtn")}
            </button>
          ))}
      </div>
      {error && <p className="-mt-3 mb-4 text-[13px] text-danger">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {steps.map((s) => (
          <Link
            key={s.key}
            href={s.href}
            className="flex items-center gap-4 border-b border-border px-5 py-3.5 transition-colors last:border-b-0 hover:bg-surface-low"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium">{locale === "ru" ? s.title.ru : s.title.en}</div>
              <div className="mt-0.5 truncate text-[12.5px] text-muted">{locale === "ru" ? s.note.ru : s.note.en}</div>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] ${
                s.done ? "bg-ok-soft text-ok" : s.optional ? "bg-surface-low text-muted" : "bg-warn-soft text-warn"
              }`}
            >
              {s.done ? t("stepDone") : s.optional ? t("stepOptional") : t("stepPending")}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
