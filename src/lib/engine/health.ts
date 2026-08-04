// Data-integrity checks. Every check returns ok/warn + where to fix it.
// Nothing is ever silently dropped — anything unmapped or inconsistent lands here.

import type { Dataset, HealthCheck, MonthlyResult, ProductCost, ShipmentCost } from "./types";
import { costProductIdOf } from "./compute";

interface Ctx {
  shipmentCosts: ShipmentCost[];
  productCosts: Record<string, ProductCost>;
  monthly: MonthlyResult[];
  ytd: MonthlyResult;
}

const LIST_LIMIT = 12;

function check(
  key: string,
  items: string[],
  href: string,
  severity: "warn" | "info" = "warn"
): HealthCheck {
  return {
    key,
    status: items.length > 0 ? "warn" : "ok",
    severity,
    count: items.length,
    details: items.slice(0, LIST_LIMIT),
    href,
  };
}

export function buildHealthChecks(ds: Dataset, ctx: Ctx): HealthCheck[] {
  const checks: HealthCheck[] = [];
  const productIds = new Set(ds.products.map((p) => p.id));
  const channelIds = new Set(ds.channels.map((c) => c.id));
  const monthIds = new Set(ds.months.map((m) => m.id));

  // unknown references in sales (possible via raw imports)
  checks.push(
    check(
      "unknownSaleRefs",
      ds.sales
        .filter(
          (s) => !productIds.has(s.productId) || !channelIds.has(s.channelId) || !monthIds.has(s.monthId)
        )
        .map((s) => `${s.monthId} / ${s.productId} / ${s.channelId}`),
      "/sales"
    )
  );

  // negative quantities are returns (возвраты) — expected, so informational only:
  // returns booked against a prior month's sales legitimately go negative
  const productName = (id: string) => ds.products.find((p) => p.id === id)?.nameRu ?? id;
  checks.push(
    check(
      "negativeSaleQty",
      ds.sales
        .filter((s) => s.qty < 0)
        .sort((a, b) => a.qty - b.qty)
        .map((s) => `${s.monthId} · ${productName(s.productId)}: ${s.qty}`),
      "/sales",
      "info"
    )
  );

  // unmapped OPEX categories that actually carry entries
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
      ctx.shipmentCosts.filter((s) => s.expenseTotal === 0 && s.purchaseTotal > 0).map((s) => s.code),
      "/shipments"
    )
  );

  // expenses attached to shipments with no purchase value (cannot be allocated)
  checks.push(
    check(
      "expensesUnallocatable",
      ctx.shipmentCosts
        .filter((s) => s.expenseTotal > 0 && s.purchaseTotal === 0)
        .map((s) => `${s.code}: ${s.expenseTotal}`),
      "/shipments"
    )
  );

  checks.push(
    check(
      "linesMissingFargoCost",
      ctx.shipmentCosts.filter((s) => s.hasMissingFargoCost).map((s) => s.code),
      "/shipments"
    )
  );

  // products sold without any landed-cost data => COGS understated
  const soldNoCost = new Set<string>();
  for (const m of ctx.monthly) {
    for (const pid of Object.keys(m.qtyByProduct)) {
      const costId = costProductIdOf(pid, ds);
      if (!ctx.productCosts[costId] || ctx.productCosts[costId].totalQty === 0) {
        soldNoCost.add(ds.products.find((p) => p.id === pid)?.nameRu ?? pid);
      }
    }
  }
  checks.push(check("soldWithoutCost", [...soldNoCost], "/shipments"));

  // tie: sales qty vs VAT-detail qty per month
  const qtyTies: string[] = [];
  for (const m of ctx.monthly) {
    const vatQty = m.vatRows.reduce((s, r) => s + r.qty, 0);
    if (Math.abs(vatQty - m.totalQty) > 1e-6) qtyTies.push(`${m.monthId}: ${m.totalQty} vs ${vatQty}`);
  }
  checks.push(check("qtyTieSalesVsVat", qtyTies, "/taxes"));

  // tie: P&L revenue vs channel detail; VAT total vs detail rows
  const revTies: string[] = [];
  const vatTies: string[] = [];
  for (const m of ctx.monthly) {
    const chSum = Object.values(m.revenueByChannel).reduce((s, v) => s + v, 0);
    if (Math.abs(chSum - m.revenue) > 0.01) revTies.push(`${m.monthId}`);
    const vatSum = m.vatRows.reduce((s, r) => s + r.totalVat, 0);
    if (Math.abs(vatSum - m.fargoVat) > 0.01) vatTies.push(`${m.monthId}`);
  }
  checks.push(check("revenueTie", revTies, "/pnl"));
  checks.push(check("vatTie", vatTies, "/taxes"));

  // golden values vs workbook (once real data is imported these should match)
  if (ds.golden) {
    const upto = ds.months.filter((m) => m.id <= ds.golden!.toMonthId).map((m) => m.id);
    const set = new Set(upto);
    let revenue = 0,
      cogs = 0,
      net = 0;
    for (const m of ctx.monthly) {
      if (set.has(m.monthId)) {
        revenue += m.revenue;
        cogs += m.cogs;
        net += m.netProfit;
      }
    }
    // relative tolerance: price rounding to whole som moves multi-billion
    // totals by a few thousand, which is not a data problem
    const REL_TOL = 0.0005; // 0.05%
    const items: string[] = [];
    const compare = (label: string, actual: number, expected: number | null) => {
      if (expected == null) return; // reference not available yet
      const tol = Math.max(1000, Math.abs(expected) * REL_TOL);
      if (Math.abs(actual - expected) > tol) {
        items.push(`${label}: ${Math.round(actual)} vs ${expected}`);
      }
    };
    compare("Revenue", revenue, ds.golden.revenue);
    compare("COGS", cogs, ds.golden.cogs);
    compare("Net", net, ds.golden.netProfit);
    checks.push(check("goldenValues", items, "/settings"));
  }

  return checks;
}
