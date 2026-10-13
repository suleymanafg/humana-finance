import { describe, expect, it } from "vitest";
import { buildSupplyPlan, supplyChecks, type SupplyInput, type SupplySku } from "../supply";
import { ibpChanges, parseIbpExport, ORDER_FIGURE } from "../ibp-export";

// small trucks keep the arithmetic readable: 10 pallets of 100 units
const settings = { minCoverMonths: 4, truckPallets: 10, truckMaxKg: 1e9, productionLeadMonths: 4, orderDeadlineDay: 20 };
const slot = { deadline: "2026-10-20", daysLeft: 7, orderMonth: "2026-10", shipMonth: "2027-02", arrivalMonth: "2027-03" };
const sku = (id: string, name = "Platin 1 400g"): SupplySku => ({
  id,
  name,
  article: id,
  pcsPerCarton: 4,
  pcsPerPallet: 100,
  grossKgPerUnit: 0.5,
  priceEur: 5,
});
const steady = (q: number) => ({ "2026-07": q, "2026-08": q, "2026-09": q });

// A sells 1,000 a month, has sold 400 of October already and holds 2,000
const input = (over: Partial<SupplyInput> = {}): SupplyInput => ({
  today: "2026-10-13",
  skus: [sku("A")],
  onHand: { A: 2000 },
  soldThisMonth: { A: 400 },
  sales: { A: steady(1000) },
  model: {},
  transit: [],
  atDmk: { A: 5000 },
  orders: {},
  settings,
  slot,
  leadDays: 37,
  ...over,
});

describe("pick up now", () => {
  it("takes what lasts until the IBP order lands plus a month, filled up to whole trucks", () => {
    // Nov opens at 2,000 − 600 = 1,400; Nov–Feb 4,000 + a month of March = 5,000 → need 3,600 (36 pallets)
    const p = buildSupplyPlan(input(), "sales").pickup;
    expect(p.trucks).toBe(4);
    expect(p.shape).toBe("topped");
    expect(p.units).toBe(3920); // filled to 39.2 pallets = 98% of 4 trucks
    expect(p.lines[0].topUp).toBe(320);
    expect(p.leftAtDmk).toEqual({ A: 1080 });
    expect(p.sellableDate).toBe("2026-11-19");
  });

  it("trims a small spill to whole trucks from the product with the most cover", () => {
    const p = buildSupplyPlan(
      input({
        skus: [sku("A"), sku("B", "Platin 2 400g")],
        onHand: { A: 2000, B: 1000 },
        soldThisMonth: { A: 400, B: 0 },
        sales: { A: steady(1000), B: steady(500) },
        atDmk: { A: 1100, B: 2100 },
      }),
      "sales"
    ).pickup;
    // A wants all 1,100 it can get, B wants 2,000: 31 pallets → 3 trucks, B (more cover) gives one pallet
    expect(p.trucks).toBe(3);
    expect(p.shape).toBe("trimmed");
    expect(Object.fromEntries(p.lines.map((l) => [l.skuId, l.units]))).toEqual({ A: 1100, B: 1900 });
  });

  it("does not send a part-empty truck: under one truck and nothing to fill it with", () => {
    const p = buildSupplyPlan(input({ atDmk: { A: 500 } }), "sales").pickup;
    expect(p.shape).toBe("partial");
    expect(p.units).toBe(500);
  });

  it("says what still runs out when DMK has none of it", () => {
    const p = buildSupplyPlan(input({ atDmk: {} }), "sales").pickup;
    expect(p.shape).toBe("none");
    // Oct 2,000 → 1,400 → Nov 400 → Dec short 600, Jan and Feb short 1,000 each
    expect(p.stillShort).toEqual([{ skuId: "A", units: 2600, fromMonth: "2026-12" }]);
  });
});

describe("IBP order for the slot", () => {
  it("covers the arrival month and the cover policy after it", () => {
    const ibp = buildSupplyPlan(input({ atDmk: {} }), "sales").ibp;
    expect(ibp.shipMonth).toBe("2027-02");
    expect(ibp.units).toBe(5000); // Mar–Jul, nothing left by March
    expect(ibp.trucks).toBe(5);
    expect(ibp.shape).toBe("full");
  });

  it("counts orders past their deadline, not the open ones after the slot or the slot's own entry", () => {
    const ibp = buildSupplyPlan(
      input({ atDmk: {}, orders: { A: { "2027-01": 1500, "2027-03": 2000, "2027-02": 9999 } } }),
      "sales"
    ).ibp;
    // the January order (fixed) lands in February: 1,500 − 1,000 leaves 500 at the end of February,
    // so March + 4 months = 5,000 − 500 = 4,500 (45 pallets), filled to 98% of 5 trucks
    expect(ibp.lines[0].units - ibp.lines[0].topUp).toBe(4500);
    expect(ibp.units).toBe(4900);
    expect(ibp.shape).toBe("topped");
    expect(ibp.laterEntered).toBe(2000);
    expect(ibp.entered).toBe(9999);
  });
});

describe("the month-by-month picture", () => {
  it("loses sales rather than carrying a shortfall, and shows each arrival", () => {
    const plan = buildSupplyPlan(input({ atDmk: {} }), "sales");
    const cells = Object.fromEntries(plan.rows[0].cells.map((c) => [c.month, c]));
    expect(cells["2026-12"].short).toBe(600);
    expect(cells["2027-01"].closing).toBe(0);
    expect(cells["2027-01"].short).toBe(1000);
    expect(cells["2027-03"].closing).toBe(4000);
    expect(cells["2027-03"].arrivals).toEqual([{ kind: "new", label: "2027-02", units: 5000 }]);
  });

  it("uses the cohort model where it has a figure, sales elsewhere", () => {
    const plan = buildSupplyPlan(input({ model: { A: { "2026-11": 3000 } } }), "model");
    const nov = plan.rows[0].cells.find((c) => c.month === "2026-11")!;
    const dec = plan.rows[0].cells.find((c) => c.month === "2026-12")!;
    const novIn = nov.arrivals.reduce((t, a) => t + a.units, 0);
    expect(1400 + novIn - 3000).toBe(nov.closing);
    expect(nov.closing - 1000).toBe(dec.closing - dec.arrivals.reduce((t, a) => t + a.units, 0));
  });
});

describe("checks", () => {
  it("flags an overdue truck, stale IBP data, orders far from sales and odd weights", () => {
    const checks = supplyChecks(
      input({
        skus: [{ ...sku("A", "Platin 1 800g"), grossKgPerUnit: 0.109 }],
        transit: [{ code: "Truck 14", etaDate: "2026-10-01", etaMonth: "2026-10", units: { A: 100 } }],
        orders: { A: { "2026-12": 600 } },
      }),
      { ibpSyncedAt: "2026-08-24", unlinked: [] }
    );
    expect(checks.map((c) => c.kind)).toEqual(["truck-overdue", "ibp-stale", "orders-vs-sales", "weights"]);
  });
});

describe("DMK's IBP export", () => {
  const rows = [
    ["Customer", "Customer Description", "Product ID", "Product Desc", "Key Figures", "Oct-26", "Nov-26", "Dec-26"],
    ["1", "TI", "70987", "Platin 1 400g", "Order History", 8240, null, null],
    ["1", "TI", "70987", "Platin 1 400g", ORDER_FIGURE, 7200, 0, 16000.000001],
    ["1", "TI", "70929", "HN Expert 300g", ORDER_FIGURE, null, 500, 1500],
    ["1", "TI", "99999", "Unknown", ORDER_FIGURE, 0, 0, 10],
  ];

  it("reads only the orders, by ship month", () => {
    const parsed = parseIbpExport(rows);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.months).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(parsed.byArticle["70987"].orders).toEqual({ "2026-10": 7200, "2026-11": 0, "2026-12": 16000 });
    expect(parsed.byArticle["70929"].orders).toEqual({ "2026-11": 500, "2026-12": 1500 });
  });

  it("changes the app's orders from a ship month on, through superseded articles too", () => {
    const parsed = parseIbpExport(rows);
    if ("error" in parsed) throw new Error(parsed.error);
    const { changes, unmatched } = ibpChanges(
      parsed,
      [
        { id: "p1", article: "70987", altArticles: null, name: "Platin 1 400g" },
        { id: "hn", article: "71292", altArticles: "70929", name: "HN Expert 300g" },
      ],
      { p1: { "2026-10": 1, "2026-12": 9100 }, hn: { "2026-12": 1500 } },
      "2026-11"
    );
    expect(changes).toEqual([
      { skuId: "hn", name: "HN Expert 300g", shipMonth: "2026-11", from: 0, to: 500 },
      { skuId: "p1", name: "Platin 1 400g", shipMonth: "2026-12", from: 9100, to: 16000 },
    ]);
    expect(unmatched).toEqual(["99999 Unknown"]);
  });

  it("refuses a file that is not the export", () => {
    expect(parseIbpExport([["a", "b"], [1, 2]])).toHaveProperty("error");
  });
});
