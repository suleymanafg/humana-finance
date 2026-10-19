import { describe, expect, it } from "vitest";
import { splitIntoTrucks } from "../truck-split";

// made-up products: four at 0.8 of a place a pallet, one bigger at 1.2
const skus = [
  { id: "p400", pcsPerPallet: 600, placesPerPallet: 0.8 },
  { id: "p800", pcsPerPallet: 400, placesPerPallet: 0.8 },
  { id: "x", pcsPerPallet: 1000, placesPerPallet: 0.8 },
  { id: "y", pcsPerPallet: 400, placesPerPallet: 0.8 },
  { id: "big", pcsPerPallet: 800, placesPerPallet: 1.2 },
];

describe("truck split", () => {
  it("two trucks of 32.4 places each: one bigger pallet per truck, the rest in turn", () => {
    // 78 small pallets (62.4) + 2 big (2.4) = 64.8 = 2 × 32.4
    const units = { p400: 30 * 600, p800: 25 * 400, x: 13 * 1000, y: 10 * 400, big: 2 * 800 };
    const t = splitIntoTrucks(units, skus, 2);
    expect(t).toHaveLength(2);
    for (const truck of t) {
      expect(truck.places).toBeCloseTo(32.4);
      expect(truck.pallets.big).toBe(1);
    }
    const back = (id: string) => t.reduce((s, x) => s + (x.units[id] ?? 0), 0);
    for (const [id, u] of Object.entries(units)) expect(back(id)).toBe(u);
  });

  it("three bigger pallets in one truck still make 32.4", () => {
    const units = { p400: 20 * 600, p800: 16 * 400, big: 3 * 800 };
    const [truck] = splitIntoTrucks(units, skus, 1);
    expect(truck.places).toBeCloseTo(32.4);
  });
});
