// Per-month data-completeness status — drives the Balance timeline, the top-bar
// month switcher dots, and the Ввод данных (monthly close) checklist.
import type { Dataset } from "./engine/types";

export interface MonthStatus {
  monthId: string;
  status: "complete" | "partial" | "empty";
  closed: boolean;
  hasSales: boolean;
  hasShipments: boolean;
  hasOpexTi: boolean;
  hasOpexFargo: boolean;
  hasStock: boolean;
  hasInputs: boolean;
  hasAr: boolean;
}

export function computeMonthStatus(dataset: Dataset): MonthStatus[] {
  return dataset.months.map((m) => {
    const checks = {
      hasSales: dataset.sales.some((s) => s.monthId === m.id && s.qty > 0),
      hasShipments: dataset.shipments.some((s) => s.monthId === m.id),
      hasOpexTi: dataset.opexTi.some((e) => e.monthId === m.id),
      hasOpexFargo: dataset.opexFargo.some((e) => e.monthId === m.id),
      hasStock: dataset.stockCounts.some((s) => s.monthId === m.id && s.qty > 0),
      hasInputs: dataset.monthBalances.some((b) => b.monthId === m.id),
      hasAr: dataset.arEntries.some((a) => a.monthId === m.id),
    };
    // shipments are legitimately absent in some months, so they do not gate
    // completeness
    const required = [checks.hasSales, checks.hasOpexTi, checks.hasOpexFargo, checks.hasStock, checks.hasInputs];
    const status: MonthStatus["status"] = required.every(Boolean)
      ? "complete"
      : required.some(Boolean) || checks.hasAr || checks.hasShipments
        ? "partial"
        : "empty";
    return { monthId: m.id, status, closed: !!m.closedAt, ...checks };
  });
}

/** The month the app should open on: latest with sales, else latest non-empty. */
export function defaultMonthId(status: MonthStatus[], fallback: string): string {
  return (
    status.filter((s) => s.hasSales).at(-1)?.monthId ??
    status.filter((s) => s.status !== "empty").at(-1)?.monthId ??
    fallback
  );
}
