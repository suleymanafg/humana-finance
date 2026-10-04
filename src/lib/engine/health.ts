// Data-integrity checks. Each returns ok/warn and where to fix it, so nothing
// inconsistent is ever silently absorbed into the statements.
import type { Computed, Dataset, HealthCheck } from "./types";

const LIST_LIMIT = 12;
const fmt = (v: number) => Math.round(v).toLocaleString("en-US");

function check(key: string, items: string[], href: string, severity: "warn" | "info" = "warn"): HealthCheck {
  return {
    key,
    status: items.length > 0 ? "warn" : "ok",
    severity,
    count: items.length,
    details: items.slice(0, LIST_LIMIT),
    href,
  };
}

export function buildHealthChecks(
  ds: Dataset,
  c: Computed,
  extra: {
    oversold: Array<{ productId: string; monthId: string; units: number }>;
    overdrawn: Map<string, number>;
  }
): HealthCheck[] {
  const productIds = new Set(ds.products.map((p) => p.id));
  const channelIds = new Set(ds.channels.map((ch) => ch.id));
  const monthIds = new Set(ds.months.map((m) => m.id));
  const name = (id: string) => ds.products.find((p) => p.id === id)?.nameRu ?? id;
  const checks: HealthCheck[] = [];

  checks.push(
    check(
      "unknownSaleRefs",
      ds.sales
        .filter((s) => !productIds.has(s.productId) || !channelIds.has(s.channelId) || !monthIds.has(s.monthId))
        .map((s) => `${s.monthId} / ${s.productId} / ${s.channelId}`),
      "/sales"
    )
  );
  checks.push(
    check(
      "negativeSaleQty",
      ds.sales
        .filter((s) => s.qty < 0)
        .sort((a, b) => a.qty - b.qty)
        .map((s) => `${s.monthId} · ${name(s.productId)}: ${s.qty}`),
      "/sales",
      "info"
    )
  );
  checks.push(
    check(
      "unmappedOpexTi",
      [...new Set(ds.opexTi.filter((e) => !e.plGroup).map((e) => e.categoryName))],
      "/settings"
    )
  );
  checks.push(
    check(
      "unmappedOpexFargo",
      [...new Set(ds.opexFargo.filter((e) => !e.plGroup).map((e) => e.categoryName))],
      "/settings"
    )
  );
  checks.push(
    check(
      "shipmentsNoExpenses",
      c.shipments
        .filter((s) => s.status === "ARRIVED" && s.expenseTotal === 0 && s.purchaseTotal > 0)
        .map((s) => s.code),
      "/goods/shipments"
    )
  );
  checks.push(
    check(
      "expensesUnallocatable",
      c.shipments
        .filter((s) => s.expenseTotal > 0 && s.purchaseTotal === 0)
        .map((s) => `${s.code}: ${fmt(s.expenseTotal)}`),
      "/goods/shipments"
    )
  );
  checks.push(
    check(
      "invoicedBeyondArrived",
      [...extra.overdrawn].map(([pid, units]) => `${name(pid)}: ${fmt(units)}`),
      "/goods/fifo"
    )
  );
  checks.push(
    check(
      "soldBeyondInvoiced",
      extra.oversold.map((o) => `${o.monthId} · ${name(o.productId)}: ${fmt(o.units)}`),
      "/goods/stock"
    )
  );
  checks.push(
    check(
      "invoiceVatMismatch",
      c.invoices
        .filter((l) => Math.abs(l.vat - l.amount * ds.taxes.vatRate) > 1)
        .map((l) => `${l.date.slice(0, 10)} № ${l.number} · ${name(l.productId)}`),
      "/goods/invoices",
      "info"
    )
  );
  checks.push(
    check(
      "settlementCheck",
      c.settlement.filter((s) => Math.abs(s.check) >= 1).map((s) => `${s.monthId}: ${fmt(s.check)}`),
      "/settlement/monthly"
    )
  );
  checks.push(
    check(
      "groupReconCheck",
      c.group.filter((g) => Math.abs(g.recon.check) >= 1).map((g) => `${g.monthId}: ${fmt(g.recon.check)}`),
      "/statements/pnl"
    )
  );
  checks.push(
    check(
      "tiVatDifference",
      c.ti
        .filter((t) => Math.abs(t.vat.difference) >= 1 && (t.vat.netModel !== 0 || t.vat.perAccount !== 0))
        .map((t) => `${t.monthId}: ${fmt(t.vat.difference)}`),
      "/taxes/ti-vat",
      "info"
    )
  );
  checks.push(
    check(
      "clientsUnassigned",
      (ds.clientMaps ?? []).filter((cm) => !cm.channelId).map((cm) => cm.displayName),
      "/settings"
    )
  );
  return checks;
}
