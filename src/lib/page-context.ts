// Shared start of every server page: the computed model and the selected month.
import { getComputed } from "./data";
import { getSession } from "./auth";
import { canEditClosedMonth, canEditData } from "./permissions";
import { computeMonthStatus, defaultMonthId } from "./month-status";
import { resolveMonthId } from "./month";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, type Locale } from "./i18n";

export async function pageContext(monthParam: string | undefined) {
  const { dataset, computed } = await getComputed();
  const status = computeMonthStatus(dataset);
  const monthId = await resolveMonthId(monthParam, dataset.months, defaultMonthId(status, dataset.months[0]?.id ?? ""));
  const session = await getSession();
  const locale: Locale = (await cookies()).get(LOCALE_COOKIE)?.value === "en" ? "en" : "ru";
  const month = dataset.months.find((m) => m.id === monthId);
  const closed = !!month?.closedAt;
  return {
    dataset,
    computed,
    status,
    monthId,
    session,
    locale,
    /** pick the page language from an inline { ru, en } label */
    l: (label: { ru: string; en: string }) => label[locale],
    months: dataset.months.map((m) => ({ id: m.id, nameRu: m.nameRu, nameEn: m.nameEn })),
    /** months that are not closed yet: their figures are preliminary */
    openMonths: dataset.months.filter((m) => !m.closedAt).map((m) => m.id),
    canEdit: canEditData(session?.role) && (!closed || canEditClosedMonth(session?.role)),
    canEditAny: canEditData(session?.role),
    isAdmin: session?.role === "ADMIN",
  };
}

export type SearchParams = Promise<Record<string, string | undefined>>;
