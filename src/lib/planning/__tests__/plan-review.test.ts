import { describe, expect, it } from "vitest";
import { estimateOf, planEstimateSourceFor, type PlanEstimate } from "../plan-review";
import type { PlanData } from "../plan-data";

// made-up figures: one product, an estimate kept at the start of November covering Nov–Dec
const est = (monthId: string, months: string[], sold: number[]): PlanEstimate => ({ monthId, takenAt: `${monthId}-02T00:00:00Z`, takenBy: "x", months, values: { a: { sold, stockEnd: sold.map((x) => x * 2) } } });
const nov = est("2026-11", ["2026-11", "2026-12"], [100, 110]);
const plan = {
  skus: [{ id: "a", stage: "P1", size800: false }],
  engine: { stageForecast: { P1: { "2026-10": 500 } }, share800: { P1: 0.4 }, expertLevel: {} },
} as unknown as PlanData;

describe("plan estimate and actual", () => {
  it("compares a month with the estimate kept at its start, else an earlier one covering it, else the model in hindsight", () => {
    expect(planEstimateSourceFor("2026-11", [nov]).kind).toBe("start");
    expect(planEstimateSourceFor("2026-12", [nov]).kind).toBe("earlier");
    expect(planEstimateSourceFor("2026-10", [nov]).kind).toBe("hindsight");
  });

  it("reads the kept figures, and in hindsight only sales (stage forecast × the 400 g share)", () => {
    expect(estimateOf(plan, planEstimateSourceFor("2026-12", [nov]), "a", "sold", "2026-12")).toBe(110);
    expect(estimateOf(plan, planEstimateSourceFor("2026-11", [nov]), "a", "stockEnd", "2026-11")).toBe(200);
    const h = planEstimateSourceFor("2026-10", [nov]);
    expect(estimateOf(plan, h, "a", "sold", "2026-10")).toBeCloseTo(300);
    expect(estimateOf(plan, h, "a", "stockEnd", "2026-10")).toBeNull();
  });
});
