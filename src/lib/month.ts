// Global month selection: the top-bar switcher sets ?month= on the current
// page and persists the choice in a cookie, so navigating between pages keeps
// the same month. Server pages resolve in that order.
import { cookies } from "next/headers";
import type { MonthIn } from "./engine/types";
import { MONTH_COOKIE } from "./month-cookie";

export { MONTH_COOKIE };

/**
 * Resolve the selected month for a page.
 * Explicit ?month= wins (including "all" where the page supports it),
 * then the cookie, then the provided fallback.
 */
export async function resolveMonthId(
  param: string | undefined,
  months: MonthIn[],
  fallback: string,
  opts: { allowAll?: boolean } = {}
): Promise<string> {
  const valid = (id: string | undefined): id is string =>
    !!id && (months.some((m) => m.id === id) || (!!opts.allowAll && id === "all"));
  if (valid(param)) return param;
  const store = await cookies();
  const fromCookie = store.get(MONTH_COOKIE)?.value;
  if (valid(fromCookie)) return fromCookie;
  return fallback;
}
