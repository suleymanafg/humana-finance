// Per-month data completeness — drives the month switcher dots, the overview's
// attention list and the month-close checklist.
import type { Dataset } from "./engine/types";

export interface MonthStatus {
  monthId: string;
  status: "complete" | "partial" | "empty";
  closed: boolean;
  hasSales: boolean;
  hasShipments: boolean;
  hasInvoices: boolean;
  hasOpexTi: boolean;
  hasOpexFargo: boolean;
  hasStock: boolean;
  hasInputs: boolean;
  hasAr: boolean;
  hasTransfers: boolean;
  hasVatAccount: boolean;
}

export function computeMonthStatus(dataset: Dataset): MonthStatus[] {
  return dataset.months.map((m) => {
    const checks = {
      hasSales: dataset.sales.some((s) => s.monthId === m.id && s.qty > 0),
      hasShipments: dataset.shipments.some((s) => s.monthId === m.id && s.status === "ARRIVED"),
      hasInvoices: dataset.invoices.some((l) => l.date.slice(0, 7) === m.id),
      hasOpexTi: dataset.opexTi.some((e) => e.monthId === m.id),
      hasOpexFargo: dataset.opexFargo.some((e) => e.monthId === m.id),
      hasStock: dataset.stockCounts.some((s) => s.monthId === m.id && s.qty > 0),
      hasInputs: dataset.monthBalances.some((b) => b.monthId === m.id),
      hasAr: dataset.arEntries.some((a) => a.monthId === m.id),
      hasTransfers: dataset.transfers.some((t) => t.date.slice(0, 7) === m.id),
      hasVatAccount: dataset.vatAccount.some((e) => e.period === m.id),
    };
    // trucks, invoices and payments are legitimately absent in some months
    const required = [checks.hasSales, checks.hasOpexTi, checks.hasOpexFargo, checks.hasStock, checks.hasInputs];
    const status: MonthStatus["status"] = required.every(Boolean)
      ? "complete"
      : required.some(Boolean) || checks.hasAr || checks.hasShipments || checks.hasInvoices
        ? "partial"
        : "empty";
    return { monthId: m.id, status, closed: !!m.closedAt, ...checks };
  });
}

/** The month the app opens on: the latest with sales, else the latest with any data. */
export function defaultMonthId(status: MonthStatus[], fallback: string): string {
  return (
    status.filter((s) => s.hasSales).at(-1)?.monthId ??
    status.filter((s) => s.status !== "empty").at(-1)?.monthId ??
    fallback
  );
}
