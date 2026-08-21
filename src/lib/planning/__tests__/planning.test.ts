import { describe, expect, it } from "vitest";
import {
  addMonths,
  demandFor,
  nextOrderSlot,
  projectSku,
  recommendQty,
  runRate,
  truckStats,
  DEFAULT_SETTINGS,
  type PlanningSkuIn,
  type SkuSituation,
} from "../compute";

const sku: PlanningSkuIn = {
  id: "s1",
  article: "70987",
  name: "Platin 1 400g",
  productId: "p1",
  pcsPerCarton: 4,
  pcsPerLayer: 96,
  pcsPerPallet: 624,
  grossKgPerUnit: 0.5,
  priceEur: 4.63,
  active: true,
};

const baseSit: SkuSituation = {
  skuId: "s1",
  currentStock: 10_000,
  stockAsOf: "2026-07",
  forecast: { "2026-09": 2000, "2026-10": 2000, "2026-11": 2000, "2026-12": 2000, "2027-01": 2000, "2027-02": 2000 },
  actualSales: { "2026-05": 1800, "2026-06": 2100, "2026-07": 2100 },
  arrivals: {},
};

describe("month arithmetic", () => {
  it("adds across year boundaries", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-08", 4)).toBe("2026-12");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});

describe("order slot", () => {
  it("uses the current month before the deadline day", () => {
    const slot = nextOrderSlot(new Date(2026, 7, 20)); // Aug 20
    expect(slot.orderMonth).toBe("2026-08");
    expect(slot.shipMonth).toBe("2026-12");
    expect(slot.arrivalMonth).toBe("2027-01");
    expect(slot.daysLeft).toBe(0);
  });
  it("rolls to next month after the deadline", () => {
    const slot = nextOrderSlot(new Date(2026, 7, 21)); // Aug 21
    expect(slot.orderMonth).toBe("2026-09");
    expect(slot.shipMonth).toBe("2027-01");
  });
});

describe("demand", () => {
  it("prefers forecast, falls back to run-rate", () => {
    const rr = runRate(baseSit.actualSales, "2026-08");
    expect(rr).toBe(2000); // (1800+2100+2100)/3
    expect(demandFor(baseSit, "2026-09", rr)).toEqual({ qty: 2000, fromForecast: true });
    expect(demandFor(baseSit, "2027-05", rr)).toEqual({ qty: 2000, fromForecast: false });
  });
});

describe("projection", () => {
  it("drains stock by demand and adds arrivals", () => {
    const sit: SkuSituation = { ...baseSit, arrivals: { "2026-10": 5000 } };
    const p = projectSku(sit, "2026-08", 6);
    // Aug: 10000 - 2000(rr) = 8000; Sep: 6000; Oct: 6000+5000-2000 = 9000
    expect(p.cells[0].closing).toBe(8000);
    expect(p.cells[2].closing).toBe(9000);
    expect(p.cells[2].arrivals).toBe(5000);
  });
  it("flags stockout and risk months", () => {
    const sit: SkuSituation = { ...baseSit, currentStock: 3000 };
    const p = projectSku(sit, "2026-08", 6);
    expect(p.riskMonth).toBe("2026-08"); // cover already below 4
    expect(p.stockoutMonth).toBe("2026-09"); // 3000-2000-2000 < 0
  });
  it("cover counts forward months of demand", () => {
    const p = projectSku(baseSit, "2026-08", 12);
    // stock 10000, demand 2000/mo -> current cover 5
    expect(p.currentCover).toBeCloseTo(5, 5);
  });
});

describe("recommendation", () => {
  it("orders enough to restore the floor at arrival, rounded to cartons", () => {
    const p = projectSku(baseSit, "2026-08", 14);
    // at end of Dec (before Jan arrival): 10000 - 5*2000 = 0
    // need: demand Jan + 4 more months = 5*2000 = 10000 -> order 10000 (already carton-round)
    expect(recommendQty(p, sku, "2027-01")).toBe(10_000);
  });
  it("subtracts open contract arrivals in the arrival month", () => {
    const sit: SkuSituation = { ...baseSit, arrivals: { "2027-01": 4000 } };
    const p = projectSku(sit, "2026-08", 14);
    expect(recommendQty(p, sku, "2027-01")).toBe(6000);
  });
  it("returns zero when stock is ample", () => {
    const sit: SkuSituation = { ...baseSit, currentStock: 50_000 };
    const p = projectSku(sit, "2026-08", 14);
    expect(recommendQty(p, sku, "2027-01")).toBe(0);
  });
});

describe("truck", () => {
  it("computes pallets, weight and the binding constraint", () => {
    const stats = truckStats([{ skuId: "s1", qty: 6240 }], { s1: sku }, DEFAULT_SETTINGS);
    expect(stats.pallets).toBeCloseTo(10);
    expect(stats.grossKg).toBeCloseTo(3120);
    expect(stats.eurTotal).toBeCloseTo(28_891.2);
    // 10/33 pallets vs 3120/21500 kg -> pallets bind
    expect(stats.binding).toBe("pallets");
    expect(stats.utilization).toBeCloseTo(10 / 33);
  });
});
