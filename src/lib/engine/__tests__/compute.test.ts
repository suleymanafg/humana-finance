import { describe, expect, it } from "vitest";
import { compute, monthIdOfDate, quarterLabelOf } from "../compute";
import type { Dataset } from "../types";

// Synthetic fixture with hand-computed expected values.
// Products: A (regular, 100 000), A-promo (75 000, costs via A), B (135 800).
// Shipment S1 (Aug): A 100 × 5 EUR × 14 000 = 70 000; B 50 × 6 EUR × 14 000 = 84 000.
//   purchase = 7 000 000 + 4 200 000 = 11 200 000; expenses 1 120 000 → loadFactor 1.1
//   TI costs: A 77 000, B 92 400. Fargo costs: A 80 000, B 95 000.
// Shipment S2 (Sep): A 100 × 5 EUR × 15 000 = 75 000; no expenses → loadFactor 1.
//   Fargo cost missing (null) → health check.
// avg TI cost A = (100×77 000 + 100×75 000)/200 = 76 000; avg Fargo A = 80 000.

function fixture(): Dataset {
  return {
    products: [
      { id: "A", nameRu: "A", price: 100_000, isPromo: false, regularProductId: null, sortOrder: 0 },
      { id: "A-promo", nameRu: "A (АКЦИЯ)", price: 75_000, isPromo: true, regularProductId: "A", sortOrder: 1 },
      { id: "B", nameRu: "B", price: 135_800, isPromo: false, regularProductId: null, sortOrder: 2 },
    ],
    channels: [
      { id: "C1", name: "Город", retroPct: 0.1, cashPct: 0.5, sortOrder: 0 },
      { id: "C2", name: "Корзинка", retroPct: 0, cashPct: 0, sortOrder: 1 },
    ],
    months: [
      { id: "2025-08", nameRu: "Август 2025", nameEn: "August 2025", sortOrder: 0 },
      { id: "2025-09", nameRu: "Сентябрь 2025", nameEn: "September 2025", sortOrder: 1 },
    ],
    warehouses: [
      { id: "W1", name: "Основной склад", sortOrder: 0 },
      { id: "W2", name: "Склад 2", sortOrder: 1 },
    ],
    sales: [
      { monthId: "2025-08", productId: "A", channelId: "C1", qty: 10 },
      { monthId: "2025-08", productId: "A-promo", channelId: "C1", qty: 4 },
      { monthId: "2025-08", productId: "B", channelId: "C2", qty: 5 },
    ],
    shipments: [
      {
        id: "S1",
        code: "Авиа №1",
        monthId: "2025-08",
        lines: [
          { id: "L1", productId: "A", qty: 100, priceEur: 5, rate: 14_000, fargoUnitCost: 80_000 },
          { id: "L2", productId: "B", qty: 50, priceEur: 6, rate: 14_000, fargoUnitCost: 95_000 },
        ],
      },
      {
        id: "S2",
        code: "Фура №2",
        monthId: "2025-09",
        lines: [{ id: "L3", productId: "A", qty: 100, priceEur: 5, rate: 15_000, fargoUnitCost: null }],
      },
    ],
    importExpenses: [
      { id: "E1", shipmentId: "S1", monthId: "2025-08", categoryName: "Транспорт", amount: 800_000 },
      { id: "E2", shipmentId: "S1", monthId: "2025-08", categoryName: "НДС (импорт)", amount: 320_000 },
    ],
    opexTi: [
      {
        id: "OT1",
        monthId: "2025-08",
        categoryName: "Зарплата",
        plGroup: "TI_SALARIES",
        bankAmount: 200_000,
        cashAmount: 50_000,
      },
    ],
    opexFargo: [
      { id: "OF1", monthId: "2025-08", categoryName: "Склад", plGroup: "FG_WAREHOUSE", amount: 300_000 },
      { id: "OF2", monthId: "2025-08", categoryName: "Новая", plGroup: null, amount: 10_000 },
    ],
    taxFilings: [
      {
        id: "F1",
        quarterLabel: "Q3 2025",
        taxAmount: 500_000,
        bookedMonthId: "2025-09",
        declaredExpenses: 100_000,
      },
    ],
    contributions: [{ id: "K1", date: "2025-08-01T00:00:00.000Z", tiAmount: 1_000_000, fargoAmount: 400_000 }],
    transfers: [{ id: "T1", date: "2025-08-20T00:00:00.000Z", cashAmount: 100_000, bankAmount: 200_000 }],
    // stock split across two warehouses; balance sheet sums them
    stockCounts: [
      { monthId: "2025-08", productId: "A", warehouseId: "W1", qty: 12 },
      { monthId: "2025-08", productId: "A", warehouseId: "W2", qty: 8 },
    ],
    monthBalances: [
      {
        monthId: "2025-08",
        tiBank: 500_000,
        goodsInTransit: 200_000,
        vatPrepayment: 10_000,
        priorVatBalance: 20_000,
        nutribenLoan: 30_000,
      },
    ],
    arEntries: [{ id: "AR1", monthId: "2025-08", customerName: "Дарвоза", amount: 50_000 }],
    taxes: { vatRate: 0.12, deemedCashMargin: 0.03, fargoIncomeTaxRate: 0.019, tiIncomeTaxRate: 0.15 },
    golden: null,
  };
}

describe("landed cost (3.1)", () => {
  it("allocates import expenses via load factor and computes TI unit costs", () => {
    const c = compute(fixture());
    const s1 = c.shipmentCosts.find((s) => s.shipmentId === "S1")!;
    expect(s1.purchaseTotal).toBe(11_200_000);
    expect(s1.expenseTotal).toBe(1_120_000);
    expect(s1.loadFactor).toBeCloseTo(1.1, 10);
    expect(s1.lines.find((l) => l.productId === "A")!.tiUnitCost).toBeCloseTo(77_000, 6);
    expect(s1.lines.find((l) => l.productId === "B")!.tiUnitCost).toBeCloseTo(92_400, 6);
    const s2 = c.shipmentCosts.find((s) => s.shipmentId === "S2")!;
    expect(s2.loadFactor).toBe(1);
    expect(s2.lines[0].tiUnitCost).toBe(75_000);
  });

  it("computes qty-weighted average costs across all shipments", () => {
    const c = compute(fixture());
    expect(c.productCosts["A"].avgTiCost).toBeCloseTo(76_000, 6);
    expect(c.productCosts["A"].avgFargoCost).toBeCloseTo(80_000, 6); // only lines with a cost
    expect(c.productCosts["B"].avgTiCost).toBeCloseTo(92_400, 6);
    expect(c.productCosts["B"].avgFargoCost).toBeCloseTo(95_000, 6);
  });
});

describe("revenue & retro (3.2)", () => {
  it("computes revenue with promo prices, cash/bank/retro splits per channel", () => {
    const c = compute(fixture());
    const aug = c.monthly.find((m) => m.monthId === "2025-08")!;
    expect(aug.revenue).toBe(1_979_000); // 10×100k + 4×75k + 5×135.8k
    expect(aug.revenueByChannel["C1"]).toBe(1_300_000);
    expect(aug.revenueByChannel["C2"]).toBe(679_000);
    expect(aug.cashRevenue).toBeCloseTo(650_000, 6);
    expect(aug.bankRevenue).toBeCloseTo(1_329_000, 6);
    expect(aug.retroBonus).toBeCloseTo(130_000, 6);
  });
});

describe("invoiced amount overrides list price", () => {
  it("uses the sale's amount for revenue when present, list price otherwise", () => {
    const ds = fixture();
    // A sold at a 10% discount in C1; promo row keeps its list-price basis
    ds.sales = [
      { monthId: "2025-08", productId: "A", channelId: "C1", qty: 10, amount: 900_000 },
      { monthId: "2025-08", productId: "A-promo", channelId: "C1", qty: 4 },
    ];
    const c = compute(ds);
    const aug = c.monthly.find((m) => m.monthId === "2025-08")!;
    // 900 000 (invoiced) + 4 × 75 000 (list) = 1 200 000
    expect(aug.revenue).toBe(1_200_000);
    expect(aug.revenueByChannel["C1"]).toBe(1_200_000);
    // quantities are untouched, so COGS still costs 14 units at 76 000
    expect(aug.cogs).toBeCloseTo(14 * 76_000, 6);
    // retro and cash/bank splits follow the invoiced revenue
    expect(aug.retroBonus).toBeCloseTo(1_200_000 * 0.1, 6);
    expect(aug.cashRevenue).toBeCloseTo(600_000, 6);
  });

  it("treats a zero amount as a real zero, not as missing", () => {
    const ds = fixture();
    ds.sales = [{ monthId: "2025-08", productId: "A", channelId: "C1", qty: 10, amount: 0 }];
    const c = compute(ds);
    expect(c.monthly.find((m) => m.monthId === "2025-08")!.revenue).toBe(0);
  });
});

describe("COGS (3.3)", () => {
  it("costs sales at weighted-average TI cost; promo uses regular product cost", () => {
    const c = compute(fixture());
    const aug = c.monthly.find((m) => m.monthId === "2025-08")!;
    // A: 10×76 000 + promo 4×76 000 + B: 5×92 400
    expect(aug.cogs).toBeCloseTo(760_000 + 304_000 + 462_000, 6);
    expect(aug.grossProfit).toBeCloseTo(1_979_000 - 1_526_000, 6);
  });
});

describe("Fargo VAT (3.4)", () => {
  it("splits qty by month cash share; bank VAT on real margin, cash VAT on deemed 3%", () => {
    const c = compute(fixture());
    const aug = c.monthly.find((m) => m.monthId === "2025-08")!;
    const cashShare = 650_000 / 1_979_000;
    const rowA = aug.vatRows.find((r) => r.productId === "A")!;
    expect(rowA.qtyCash).toBeCloseTo(10 * cashShare, 10);
    expect(rowA.qtyBank).toBeCloseTo(10 - 10 * cashShare, 10);
    expect(rowA.bankVat).toBeCloseTo((10 - 10 * cashShare) * (100_000 - 80_000) * 0.12, 6);
    expect(rowA.cashVat).toBeCloseTo(10 * cashShare * 80_000 * 0.03 * 0.12, 6);
    // promo uses regular Fargo cost but its own (promo) sell price
    const rowP = aug.vatRows.find((r) => r.productId === "A-promo")!;
    expect(rowP.fargoUnitCost).toBeCloseTo(80_000, 6);
    expect(rowP.sellPrice).toBe(75_000);
    expect(aug.fargoVat).toBeCloseTo(
      aug.vatRows.reduce((s, r) => s + r.bankVat + r.cashVat, 0),
      6
    );
  });

  it("handles a zero-revenue month without NaN", () => {
    const c = compute(fixture());
    const sep = c.monthly.find((m) => m.monthId === "2025-09")!;
    expect(sep.revenue).toBe(0);
    expect(sep.fargoVat).toBe(0);
    expect(Number.isNaN(sep.netProfit)).toBe(false);
  });
});

describe("P&L rollup (3.5–3.7)", () => {
  it("computes income taxes, OPEX groups, EBITDA and net profit", () => {
    const c = compute(fixture());
    const aug = c.monthly.find((m) => m.monthId === "2025-08")!;
    expect(aug.fargoIncomeTax).toBeCloseTo(1_979_000 * 0.019, 6);
    expect(aug.tiIncomeTax).toBe(0); // filing booked in Sep
    const sep = c.monthly.find((m) => m.monthId === "2025-09")!;
    expect(sep.tiIncomeTax).toBe(500_000);
    expect(aug.opexTiByGroup["TI_SALARIES"]).toBe(250_000);
    expect(aug.opexFargoByGroup["FG_WAREHOUSE"]).toBe(300_000);
    expect(aug.opexFargoByGroup["UNMAPPED"]).toBe(10_000); // never dropped
    // OPEX TI + OPEX Fargo + retro (marketing is folded into OPEX categories)
    expect(aug.totalOpex).toBeCloseTo(250_000 + 310_000 + 130_000, 6);
    expect(aug.ebitda).toBeCloseTo(aug.grossProfit - aug.totalOpex, 6);
    expect(aug.netProfit).toBeCloseTo(aug.ebitda - (aug.fargoVat + aug.fargoIncomeTax + aug.tiIncomeTax), 6);
    // YTD aggregates
    expect(c.ytd.revenue).toBe(1_979_000);
    expect(c.ytd.tiIncomeTax).toBe(500_000);
  });
});

describe("settlement (3.9)", () => {
  it("accumulates dues, subtracts transfers by date and outstanding AR", () => {
    const c = compute(fixture());
    const aug = c.settlement.find((s) => s.monthId === "2025-08")!;
    const m = c.monthly.find((x) => x.monthId === "2025-08")!;
    const due = m.revenue - m.opexFargoTotal - m.retroBonus - m.fargoVat - m.fargoIncomeTax;
    expect(aug.dueToTi).toBeCloseTo(due, 6);
    expect(aug.cumTransfersCash).toBe(100_000);
    expect(aug.cumTransfersBank).toBe(200_000);
    expect(aug.outstandingAr).toBe(50_000);
    expect(aug.remaining).toBeCloseTo(due - 350_000, 6);
  });
});

describe("balance sheet (3.8)", () => {
  it("values inventory at avg TI cost and balances A = L + E via explicit plug", () => {
    const c = compute(fixture());
    const bs = c.balanceSheets.find((b) => b.monthId === "2025-08")!;
    expect(bs.inventory).toBeCloseTo(20 * 76_000, 6);
    expect(bs.tiCapital).toBe(1_000_000);
    expect(bs.fargoCapital).toBe(400_000);
    const m = c.monthly.find((x) => x.monthId === "2025-08")!;
    expect(bs.retainedEarnings).toBeCloseTo(m.netProfit, 6);
    expect(bs.assetsTotal).toBeCloseTo(bs.liabilitiesTotal + bs.equityTotal, 6);
  });
});

describe("TI quarterly audit (3.6)", () => {
  it("recomputes tax from shipment Fargo values and shows variance vs filing", () => {
    const c = compute(fixture());
    const q3 = c.quarterAudits.find((q) => q.quarterLabel === "Q3 2025")!;
    expect(q3.fargoValue).toBe(12_750_000); // S2 missing cost contributes 0
    const gp = (12_750_000 / 1.12 / 1.03) * 0.03;
    expect(q3.grossProfit).toBeCloseTo(gp, 6);
    expect(q3.computedTax).toBeCloseTo(0.15 * Math.max(0, gp - 100_000), 6);
    expect(q3.filedTax).toBe(500_000);
    expect(q3.taxVariance).toBeCloseTo(500_000 - q3.computedTax, 6);
    expect(q3.computedVat).toBeCloseTo(gp * 0.12, 6);
  });
});

describe("health checks", () => {
  it("flags missing Fargo costs, zero-expense shipments, unmapped categories; ties are ok", () => {
    const c = compute(fixture());
    const by = Object.fromEntries(c.healthChecks.map((h) => [h.key, h]));
    expect(by["linesMissingFargoCost"].status).toBe("warn");
    expect(by["linesMissingFargoCost"].details).toContain("Фура №2");
    expect(by["shipmentsNoExpenses"].status).toBe("warn");
    expect(by["unmappedOpexFargo"].status).toBe("warn");
    expect(by["unmappedOpexTi"].status).toBe("ok");
    expect(by["qtyTieSalesVsVat"].status).toBe("ok");
    expect(by["revenueTie"].status).toBe("ok");
    expect(by["vatTie"].status).toBe("ok");
  });
});

describe("helpers", () => {
  it("derives quarter labels and month buckets", () => {
    expect(quarterLabelOf("2025-08")).toBe("Q3 2025");
    expect(quarterLabelOf("2026-01")).toBe("Q1 2026");
    expect(quarterLabelOf("2026-12")).toBe("Q4 2026");
    expect(monthIdOfDate("2025-08-20T00:00:00.000Z")).toBe("2025-08");
  });
});
