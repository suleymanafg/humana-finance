import { describe, expect, it } from "vitest";
import { placeStep, planOrders, type OrderPlannerInput } from "../order-planner";
import { splitIntoTrucks } from "../truck-split";
import { addMonths } from "../compute";

// made-up figures: two products, 100 tins a pallet, a 10-pallet truck
const months: string[] = [];
for (let m = "2027-01"; m <= "2027-12"; m = addMonths(m, 1)) months.push(m);
const demand = { a: Object.fromEntries(months.map((m) => [m, 1000])), b: Object.fromEntries(months.map((m) => [m, 500])) };
const base: OrderPlannerInput = {
  skus: [
    { id: "a", pcsPerPallet: 100, priceEur: 5 },
    { id: "b", pcsPerPallet: 100, priceEur: 8 },
  ],
  stockMonth: "2027-01",
  stockEnd: { a: 2000, b: 1000 },
  demand,
  shipMonths: ["2027-02", "2027-03", "2027-04", "2027-05"],
  known: [],
  ibpEntered: {},
  frozenThrough: "2027-01",
  extraThrough: "2027-01",
  open: {},
  sellMonthOf: (m) => addMonths(m, 1),
  targetOf: () => 2,
  truckPlaces: 10,
};
const units = (p: ReturnType<typeof planOrders>, k: number) => p.loads[k].units;

describe("order planner", () => {
  it("orders up to the target in whole pallets and whole trucks", () => {
    const p = planOrders(base);
    // Feb load sells in March: end of March needs 2 × April + March − end of February
    // a: 2000 + 1000 − (2000 − 1000) = 2000 → 20 pallets; b: 1000 + 500 − 500 = 1000 → 10 pallets → 3 trucks
    expect(units(p, 0)).toEqual({ a: 2000, b: 1000 });
    expect(p.loads[0].trucks).toBe(3);
    for (const l of p.loads) expect(l.pallets % 10).toBe(0);
    expect(Object.values(p.lost.a).every((x) => x === 0)).toBe(true);
  });

  it("a later sell month asks for more: the load must cover the months on the road", () => {
    const p1 = planOrders(base);
    const p2 = planOrders({ ...base, sellMonthOf: (m) => addMonths(m, 2) });
    expect(units(p2, 0).a).toBeGreaterThan(units(p1, 0).a);
  });

  it("collects what is open at DMK before ordering anything new", () => {
    const p = planOrders({ ...base, open: { a: 500 } });
    expect(p.loads[0].fromOpen.a).toBe(500);
    expect(p.loads[0].ibpToEnter.a).toBe(units(p, 0).a - 500);
    expect(p.openLeft.a).toBe(0);
  });

  it("a take-only-the-IBP month takes what is entered and fills the truck; the month before carries through it", () => {
    const p = planOrders({ ...base, frozenThrough: "2027-03", extraThrough: "2027-02", ibpEntered: { "2027-03": { a: 300, b: 200 } } });
    expect(p.loads[1].onlyIbp).toBe(true);
    expect(units(p, 1).a + units(p, 1).b).toBe(1000); // 5 pallets filled to one 10-pallet truck
    expect(p.loads[1].fromIbp).toEqual({ a: 300, b: 200 });
    const plain = planOrders(base);
    expect(units(p, 0).a).toBeGreaterThanOrEqual(units(plain, 0).a); // February had to carry stock through March's small load
  });

  it("a spill under a quarter truck is left out, from products that stay above the danger line", () => {
    // end of February a: 1950 − 1000 = 950 → needs 2000 + 1000 − 950 = 2050 → 21 pallets; b needs nothing
    // 21 pallets = 2 trucks + 1 → the spare pallet is left out (a still ends March at 1.95 months)
    const p = planOrders({ ...base, stockEnd: { a: 1950, b: 3000 } });
    expect(p.loads[0].pallets).toBe(20);
    expect(p.loads[0].trucks).toBe(2);
    expect(units(p, 0)).toEqual({ a: 2000, b: 0 });
    // a spill of 3 pallets (over a quarter of 10) fills the third truck instead
    const q = planOrders({ ...base, stockEnd: { a: 1750, b: 3000 } });
    expect(q.loads[0].trucks).toBe(3);
    expect(q.loads[0].pallets).toBe(30);
  });

  it("HQ's truck: 33 places, every truck filled to at least 0.98 and never over", () => {
    const skus = [
      { id: "a", pcsPerPallet: 100, priceEur: 5, placesPerPallet: 0.8 },
      { id: "b", pcsPerPallet: 100, priceEur: 8, placesPerPallet: 1.2 },
    ];
    for (const stockA of [1000, 1300, 1700, 2100, 2600, 3300]) {
      const p = planOrders({ ...base, skus, truckPlaces: 33, stockEnd: { a: stockA, b: 400 }, demand: { a: Object.fromEntries(months.map((m) => [m, 3000])), b: Object.fromEntries(months.map((m) => [m, 400])) } });
      for (const l of p.loads) {
        if (!l.trucks) continue;
        expect(l.places).toBeLessThanOrEqual(l.trucks * 33 + 1e-9);
        expect(l.fill).toBeGreaterThanOrEqual(0.98);
        expect(l.underFilled).toBe(false);
      }
    }
  });

  it("HQ's form must show 0.98: each truck at 0.98–0.985, a small pallet swapped for a big one when needed", () => {
    const skus = [
      { id: "a", pcsPerPallet: 100, priceEur: 5, placesPerPallet: 0.8 },
      { id: "b", pcsPerPallet: 100, priceEur: 8, placesPerPallet: 1.2 },
    ];
    for (const stockA of [1000, 1300, 1700, 2100, 2600]) {
      const p = planOrders({ ...base, skus, truckPlaces: 33, maxFill: 0.985, stockEnd: { a: stockA, b: 400 }, demand: { a: Object.fromEntries(months.map((m) => [m, 3000])), b: Object.fromEntries(months.map((m) => [m, 400])) } });
      for (const l of p.loads) {
        if (!l.trucks) continue;
        expect(l.fill).toBeGreaterThanOrEqual(0.98);
        expect(l.fill).toBeLessThan(0.985);
      }
    }
  });
  it("every truck on its own: 32.4 places of 33 (0.8 and 1.2 pallets), at least one big pallet per truck", () => {
    expect(placeStep([0.8, 1.2])).toBeCloseTo(0.4);
    const skus = [
      { id: "a", pcsPerPallet: 100, priceEur: 5, placesPerPallet: 0.8 },
      { id: "b", pcsPerPallet: 100, priceEur: 8, placesPerPallet: 1.2 },
    ];
    // b sells little: left alone the loads would carry fewer big pallets than trucks
    for (const demandB of [0, 50, 150, 400]) {
      for (const stockA of [1000, 2100, 4000]) {
        const p = planOrders({ ...base, skus, truckPlaces: 33, maxFill: 0.985, stockEnd: { a: stockA, b: 300 }, demand: { a: Object.fromEntries(months.map((m) => [m, 9000])), b: Object.fromEntries(months.map((m) => [m, demandB])) } });
        for (const l of p.loads) {
          if (!l.trucks) continue;
          for (const t of splitIntoTrucks(l.units, skus, l.trucks, 33)) {
            expect(t.places).toBeGreaterThanOrEqual(0.98 * 33 - 1e-9);
            expect(t.places).toBeLessThanOrEqual(0.985 * 33 + 1e-9);
          }
        }
      }
    }
  });
});
