import { describe, expect, it } from "vitest";
import { compute } from "../compute";
import { FifoCurve } from "../fifo";
import { fixture } from "./fixture";


const month = <T extends { monthId: string }>(rows: T[], id: string) => rows.find((r) => r.monthId === id)!;

describe("FIFO curve", () => {
  const curve = new FifoCurve([
    { qty: 10, unit: 100 },
    { qty: 5, unit: 200 },
  ]);
  it("values the first units at the first batch, then the next", () => {
    expect(curve.valueAt(0)).toBe(0);
    expect(curve.valueAt(4)).toBe(400);
    expect(curve.valueAt(10)).toBe(1_000);
    expect(curve.valueAt(12)).toBe(1_400);
    expect(curve.between(8, 12)).toBe(600);
  });
  it("continues at the last batch past the end and at the first below zero", () => {
    expect(curve.valueAt(17)).toBe(2_400);
    expect(curve.valueAt(-2)).toBe(-200);
  });
  it("is zero without batches", () => {
    expect(new FifoCurve([]).valueAt(5)).toBe(0);
  });
});

describe("landed cost", () => {
  const c = compute(fixture());
  const s1 = c.shipments.find((s) => s.shipmentId === "S1")!;
  it("spreads import expenses by value, excluding import VAT and own-cost lines", () => {
    expect(s1.expenseTotal).toBe(960_000);
    expect(s1.importVat).toBe(1_200_000);
    expect(s1.loadFactor).toBeCloseTo(1.1, 12);
    expect(s1.lines.find((l) => l.id === "L1")!.unitCost).toBeCloseTo(61_600, 6);
    expect(s1.lines.find((l) => l.id === "L2")!.unitCost).toBeCloseTo(77_000, 6);
    expect(s1.lines.find((l) => l.id === "L3")!.unitCost).toBe(5_000);
    expect(s1.lines.find((l) => l.id === "L3")!.inFifo).toBe(false);
  });
  it("keeps trucks in transit out of the batches", () => {
    expect(c.fifo.A.tiBatches.map((b) => b.code)).toEqual(["Truck 1", "Truck 2"]);
  });
});

describe("TI cost of goods, FIFO by truck", () => {
  const c = compute(fixture());
  const line = (id: string) => c.invoices.find((l) => l.id === id)!;
  it("draws invoices from the oldest truck first", () => {
    expect(line("I1").tiCost).toBeCloseTo(80 * 61_600, 4);
    expect(line("I3").tiCost).toBeCloseTo(20 * 61_600 + 40 * 70_000, 4);
    expect(line("I4").tiCost).toBeCloseTo(50 * 77_000, 4);
  });
  it("values own-cost goods at their own cost, outside FIFO", () => {
    expect(line("I2").tiCost).toBe(50_000);
    expect(line("I2").outsideFifo).toBe(true);
  });
  it("draws write-offs after the invoices", () => {
    expect(c.writeOffs[0].value).toBeCloseTo(5 * 70_000, 4);
  });
});

describe("Fargo cost of goods, FIFO by TI invoice", () => {
  const c = compute(fixture());
  const a = (m: string) => c.fifo.A.months[m];
  it("uses invoice lines in date order, promo units included", () => {
    expect(a("2025-08").fargoCogs).toBeCloseTo(60 * 65_000, 4);
    expect(a("2025-08").groupCogs).toBeCloseTo(60 * 61_600, 4);
  });
  it("books the count shortfall as a loss after the month's sales", () => {
    expect(a("2025-09").fargoCogs).toBeCloseTo(20 * 65_000 + 10 * 0, 4);
    expect(a("2025-09").fargoLoss).toBeCloseTo(3 * 72_000, 4);
    expect(a("2025-09").groupCogs).toBeCloseTo(20 * 61_600 + 10 * 5_000, 4);
    expect(a("2025-09").groupLoss).toBeCloseTo(3 * 67_200, 4);
    expect(a("2025-10").fargoCogs).toBeCloseTo(10 * 72_000, 4);
    expect(a("2025-10").fargoLoss).toBeCloseTo(0, 6);
  });
  it("values Fargo's stock at the count", () => {
    expect(a("2025-09").fargoStockUnits).toBe(57);
    expect(a("2025-09").fargoStock).toBeCloseTo(57 * 72_000, 4);
  });
  it("ignores a month whose count rows are all zero", () => {
    const ds = fixture();
    ds.stockCounts.push(
      { monthId: "2025-10", productId: "A", warehouseId: "W1", qty: 0 },
      { monthId: "2025-10", productId: "B", warehouseId: "W1", qty: 0 }
    );
    const z = compute(ds).fifo.A.months["2025-10"];
    expect(z.fargoLoss).toBeCloseTo(0, 6);
    expect(z.cumCountDiff).toBe(a("2025-09").cumCountDiff);
  });
});

describe("Fargo write-offs", () => {
  const ds = fixture();
  ds.fargoWriteOffs = [
    { id: "F1", date: "2025-09-25", productId: "A", qty: 2, reason: "EXPIRED" },
    { id: "F2", date: "2025-10-15", productId: "A-promo", qty: 1, reason: "DAMAGED" },
  ];
  const c = compute(ds);
  const base = compute(fixture());
  const a = (m: string) => c.fifo.A.months[m];
  const sep = (r: { fargo: Array<{ monthId: string }> }) => r.fargo.findIndex((f) => f.monthId === "2025-09");
  it("come off Fargo's book stock, so the count shows only what they do not explain", () => {
    const row = c.stock.find((s) => s.monthId === "2025-09")!.products.find((p) => p.productId === "A")!;
    expect(row.fargoWrittenOff).toBe(2);
    expect(row.fargoBook).toBe(58);
    expect(row.difference).toBe(1);
    expect(a("2025-09").fargoWriteOff).toBeCloseTo(2 * 72_000, 4);
    expect(a("2025-09").fargoLoss).toBeCloseTo(1 * 72_000, 4);
    expect(a("2025-09").groupWriteOff).toBeCloseTo(2 * 67_200, 4);
    expect(a("2025-09").groupLoss).toBeCloseTo(1 * 67_200, 4);
  });
  it("leave a counted month's total loss and profit as they were", () => {
    const f = c.fargo[sep(c)];
    const f0 = base.fargo[sep(base)];
    expect(f.writeOffLoss + f.stockLoss).toBeCloseTo(f0.stockLoss, 4);
    expect(f.grossProfit).toBeCloseTo(f0.grossProfit, 4);
    expect(c.group[sep(c)].netProfit).toBeCloseTo(base.group[sep(base)].netProfit, 4);
  });
  it("cost a write-off between counts in its own month", () => {
    expect(a("2025-10").unitsWrittenOff).toBe(1);
    expect(a("2025-10").fargoWriteOff).toBeCloseTo(72_000, 4);
    expect(a("2025-10").fargoLoss).toBeCloseTo(0, 6);
    expect(a("2025-10").fargoStockUnits).toBe(150 - 100 - 3 - 1);
    expect(c.fargoWriteOffs.find((w) => w.id === "F2")!.value).toBeCloseTo(72_000, 4);
  });
  it("keep the group, the settlement and the balance sheets tied", () => {
    for (const g of c.group) expect(Math.abs(g.recon.check)).toBeLessThan(1e-6);
    for (const s of c.settlement) expect(Math.abs(s.check)).toBeLessThan(1e-6);
    for (const b of c.balance) expect(Math.abs(b.fargo.check)).toBeLessThan(1e-6);
  });
});

describe("Fargo results and VAT", () => {
  const c = compute(fixture());
  const aug = month(c.fargo, "2025-08");
  it("takes VAT out of revenue: 12/112 on bank sales, 12% of cost × 1.03 on cash sales", () => {
    const bankVat = (3_000_000 + 900_000) * (0.12 / 1.12);
    const cashVat = 50 * 0.5 * 65_000 * 1.03 * 0.12;
    expect(aug.salesAtPrice).toBe(6_900_000);
    expect(aug.vat.outputBank).toBeCloseTo(bankVat, 4);
    expect(aug.vat.outputCash).toBeCloseTo(cashVat, 4);
    expect(aug.revenue).toBeCloseTo(6_900_000 - bankVat - cashVat, 4);
    expect(aug.incomeTax).toBeCloseTo(6_900_000 * 0.019, 6);
  });
  it("carries a VAT credit forward instead of paying", () => {
    const net = aug.vat.outputBank + aug.vat.outputCash - 624_000;
    expect(net).toBeLessThan(0);
    expect(aug.vat.paid).toBe(0);
    expect(aug.vat.creditOut).toBeCloseTo(-net, 6);
    expect(month(c.fargo, "2025-09").vat.creditIn).toBeCloseTo(-net, 6);
  });
  it("keeps recorded write-offs out of operating costs", () => {
    const sep = month(c.fargo, "2025-09");
    expect(sep.writeOffsRecorded).toBe(77_000);
    expect(sep.opex).toBe(0);
  });
});

describe("Turbo Impex results and VAT", () => {
  const c = compute(fixture());
  const aug = month(c.ti, "2025-08");
  it("books invoices as revenue at TI cost", () => {
    expect(aug.revenue).toBe(5_200_000);
    expect(aug.cogs).toBeCloseTo(80 * 61_600 + 50_000, 4);
    expect(aug.netProfit).toBeCloseTo(5_200_000 - 4_978_000 - 400_000 - 50_000, 4);
  });
  it("separates the previous owner's VAT overpayment", () => {
    expect(c.priorOwnerVatOpening).toBe(1_000_000);
    expect(aug.vat.accountBalance).toBe(700_000);
    expect(aug.vat.priorOwnerPart).toBe(800_000);
    expect(aug.vat.jvPosition).toBe(-100_000);
    expect(aug.vat.netModel).toBe(624_000 + 250_000 - 1_200_000);
  });
});

describe("consistency checks", () => {
  for (const writeOffDeduct of [false, true]) {
    const ds = fixture();
    ds.taxes.writeOffDeduct = writeOffDeduct;
    const c = compute(ds);
    it(`group profit ties to the company results (write-offs deducted: ${writeOffDeduct})`, () => {
      for (const g of c.group) expect(Math.abs(g.recon.check)).toBeLessThan(1e-6);
    });
    it(`both settlement methods agree (write-offs deducted: ${writeOffDeduct})`, () => {
      for (const s of c.settlement) expect(Math.abs(s.check)).toBeLessThan(1e-6);
    });
    it(`balance sheets tie (write-offs deducted: ${writeOffDeduct})`, () => {
      for (const b of c.balance) {
        expect(Math.abs(b.fargo.check)).toBeLessThan(1e-6);
        expect(Math.abs(b.group.unreconciled - b.ti.unreconciled)).toBeLessThan(1e-6);
        expect(Math.abs(b.ti.unreconciledCash + b.ti.unreconciledVat - b.ti.unreconciled)).toBeLessThan(1e-6);
      }
    });
  }
});

describe("settlement with Fargo", () => {
  const c = compute(fixture());
  const sep = month(c.settlement, "2025-09");
  it("counts every bank payment from Fargo's account in the act", () => {
    expect(sep.invoicesInclVatCum).toBeCloseTo(5_824_000 + 4_838_400 + 4_480_000, 6);
    expect(sep.allBankCum).toBe(5_000_000 + 1_500_000 + 300_000);
    expect(sep.notGoods).toBe(1_800_000);
    expect(sep.byBank + sep.inCash).toBeCloseTo(sep.owes, 6);
  });
  it("deducts customers' debts and payments received", () => {
    const due = c.settlement.filter((s) => s.monthId <= "2025-09").reduce((t, s) => t + s.accrued, 0);
    expect(sep.owes).toBeCloseTo(due - 1_500_000 - 5_000_000 - 600_000, 6);
  });
  it("owes less by the VAT on unsold stock when that VAT is due only when sold", () => {
    expect(sep.fargoStock).toBeGreaterThan(0);
    expect(sep.unsoldStockVat).toBeCloseTo(sep.fargoStock * 0.12, 6);
    expect(sep.owesWhenSold).toBeCloseTo(sep.owes - sep.unsoldStockVat, 6);
    expect(sep.byBankWhenSold + sep.inCashWhenSold).toBeCloseTo(sep.owesWhenSold, 6);
  });
});

describe("balance sheet inputs", () => {
  const c = compute(fixture());
  const sep = month(c.balance, "2025-09");
  it("carries funding and unpaid items as liabilities", () => {
    expect(sep.ti.loans).toBe(400_000);
    expect(sep.ti.priorOwnerCash).toBe(50_000);
    expect(sep.ti.otherReceipts).toBe(20_000);
    expect(sep.ti.profitTaxPayable).toBe(40_000);
    expect(month(c.balance, "2025-10").ti.profitTaxPayable).toBe(0);
  });
  it("includes partner capital paid before the first month", () => {
    expect(sep.ti.tiCapital).toBe(2_000_000);
    expect(sep.ti.fargoCapital).toBe(1_500_000);
  });
});
