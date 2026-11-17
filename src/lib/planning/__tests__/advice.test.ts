import { describe, expect, it } from "vitest";
import { buildAdvice, type AdviceInput } from "../advice";
import { addMonths } from "../compute";

// made-up figures: one product, 1,000 tins a month, 100 tins a pallet, a 10-pallet truck,
// a load sellable two months after its ship month
const months: string[] = [];
for (let m = "2027-01"; m <= "2028-12"; m = addMonths(m, 1)) months.push(m);
const base: AdviceInput = {
  skus: [{ id: "a", pcsPerPallet: 100, priceEur: 5 }],
  stockMonth: "2027-01",
  stockEnd: { a: 3000 },
  demand: { a: Object.fromEntries(months.map((m) => [m, 1000])) },
  trucks: [],
  ibpEntered: {},
  open: {},
  shipMonths: ["2027-01", "2027-02", "2027-03", "2027-04"],
  frozenThrough: "2027-03",
  through: "2027-12",
  sellMonthOf: (m) => addMonths(m, 2),
  targetOf: () => 1,
  truckPlaces: 10,
  minFill: 0.9,
};
const of = (a: ReturnType<typeof buildAdvice>, m: string) => a.months.find((x) => x.shipMonth === m)!;

describe("advice from the facts", () => {
  it("each month stands alone: a later month does not count an earlier month's advice as taken", () => {
    const a = buildAdvice(base);
    // January's load sells in March: stock 3000 − Feb 1000 = 2000 at the start of March; March 1000 + target 1000 → nothing needed
    expect(of(a, "2027-01").load.trucks).toBe(0);
    // February's sells in April: 1000 left after March; April 1000 + target 1000 − 1000 = 1000 → one truck
    expect(of(a, "2027-02").load.trucks).toBe(1);
    // March's sells in May: nothing left after April — and February's truck is NOT counted: May 1000 + target 1000 = 2 trucks
    expect(of(a, "2027-03").load.trucks).toBe(2);
  });

  it("the outlook holds only the stock and the trucks in the app", () => {
    const a = buildAdvice(base);
    expect(a.facts.stock.a["2027-04"]).toBe(0);
    expect(a.facts.lost.a["2027-05"]).toBe(1000);
    const withTruck = buildAdvice({ ...base, trucks: [{ shipMonth: "2027-02", sellMonth: "2027-04", units: { a: 1000 } }] });
    expect(withTruck.facts.stock.a["2027-04"]).toBe(1000);
  });

  it("a truck put in the app changes the months after it", () => {
    const withTruck = buildAdvice({ ...base, trucks: [{ shipMonth: "2027-02", sellMonth: "2027-04", units: { a: 1000 } }] });
    // February has its truck: nothing more; March now starts May with 1000 → one truck instead of two
    expect(of(withTruck, "2027-02").load.trucks).toBe(0);
    expect(of(withTruck, "2027-03").load.trucks).toBe(1);
  });

  it("sales lost before a load can be sold are not ordered again", () => {
    // empty warehouse: March's load sells in May — it carries May and the target, not the missed February–April
    const a = buildAdvice({ ...base, stockEnd: { a: 0 } });
    expect(of(a, "2027-03").load.units.a).toBe(2000);
  });

  it("a closed month shows what is ordered in the IBP and not on a truck; the load takes it first", () => {
    const a = buildAdvice({ ...base, open: { a: 300 }, ibpEntered: { "2027-02": { a: 400 } } });
    expect(of(a, "2027-01").ordered.a).toBe(300);
    expect(of(a, "2027-02").ordered.a).toBe(700);
    expect(of(a, "2027-02").load.fromOpen.a).toBe(700);
    expect(of(a, "2027-02").load.extra.a).toBe(300);
  });

  it("an open IBP month is advised on top of the orders already made, taken in their months", () => {
    const plain = buildAdvice(base);
    // April's IBP is open; sells in June. Nothing ordered: June 1000 + target 1000 → 2000 to enter
    expect(of(plain, "2027-04").kind).toBe("ibp");
    expect(of(plain, "2027-04").load.units.a).toBe(2000);
    // 1,000 ordered for March (sells in May, all sold there): June still needs 2000
    const ordered = buildAdvice({ ...base, ibpEntered: { "2027-03": { a: 1000 }, "2027-04": { a: 500 } } });
    expect(of(ordered, "2027-04").load.units.a).toBe(2000);
    expect(of(ordered, "2027-04").ordered.a).toBe(500);
    // 3,000 ordered for March leaves 2,000 at the end of May: June is covered to the target
    const plenty = buildAdvice({ ...base, ibpEntered: { "2027-03": { a: 3000 } } });
    expect(of(plenty, "2027-04").load.trucks).toBe(0);
    // the outlook with the orders counts them; the facts do not
    expect(plenty.ordered.stock.a["2027-05"]).toBe(2000);
    expect(plenty.facts.stock.a["2027-05"]).toBe(0);
  });

  it("a need of a couple of pallets is not a truck while no product is in danger", () => {
    // target 2 months: February's load sells in April, 2800 left at its start; April 1000 + 2000 − 2800 = 2 pallets short,
    // and without them April still ends at 1.8 months
    const a = buildAdvice({ ...base, stockEnd: { a: 4800 }, targetOf: () => 2, shipMonths: ["2027-02"] });
    expect(of(a, "2027-02").needTrucks).toBeGreaterThan(0);
    expect(of(a, "2027-02").load.trucks).toBe(0);
    // the same gap with a product about to fall under the danger line keeps its truck
    const tight = buildAdvice({ ...base, stockEnd: { a: 3900 }, shipMonths: ["2027-02"] });
    expect(of(tight, "2027-02").load.trucks).toBe(1);
  });
});
