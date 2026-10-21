import { describe, expect, it } from "vitest";
import { effectOf } from "../medical-effect";

describe("medical effectiveness", () => {
  it("good only when sales grow and tins per prescription grow", () => {
    expect(effectOf({ tins: 1200, foils: 100, paid: 0 }, { tins: 1000, foils: 100, paid: 0 }).verdict).toBe("good");
    // sales up 20%, prescriptions up 50% — growth bought at a higher price
    expect(effectOf({ tins: 1200, foils: 150, paid: 0 }, { tins: 1000, foils: 100, paid: 0 }).verdict).toBe("costly");
  });

  it("prescriptions without sales growing is no return, even when spend went down", () => {
    expect(effectOf({ tins: 1000, foils: 150, paid: 0 }, { tins: 1000, foils: 100, paid: 0 }).verdict).toBe("noReturn");
    expect(effectOf({ tins: 900, foils: 80, paid: 8e6 }, { tins: 1000, foils: 100, paid: 9e6 }).verdict).toBe("noReturn");
    expect(effectOf({ tins: 1030, foils: 100, paid: 0 }, { tins: 1000, foils: 100, paid: 0 }).verdict).toBe("noReturn"); // +3% is noise
  });

  it("no prescriptions, ratios and cost per tin", () => {
    const e = effectOf({ tins: 500, foils: 0, paid: 0 }, { tins: 400, foils: 0, paid: 0 });
    expect(e.verdict).toBe("noRx");
    expect(e.perRx).toBeNull();
    const f = effectOf({ tins: 600, foils: 200, paid: 30e6 }, { tins: 0, foils: 0, paid: 0 });
    expect(f.verdict).toBe("good");
    expect(f.salesChange).toBeNull();
    expect(f.perRx).toBe(3);
    expect(f.costPerTin).toBe(50000);
  });
});
