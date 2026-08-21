import { describe, expect, it } from "vitest";
import {
  calibrate,
  packSplit,
  rawStageDemand,
  recruitmentFor,
  retentionAt,
  stageDemand,
  DEFAULT_COHORT,
} from "../cohort";
import { buildDemandModel, stageOf } from "../model";

const P = { ...DEFAULT_COHORT, packsPerBaby: 3, retention1: 0.4, retention2: 0.3, retention3: 0.2, stage3FadePerMonth: 0.8 };

describe("retention curve", () => {
  it("steps down by stage and fades in stage 3", () => {
    expect(retentionAt(0, P)).toBe(0.4);
    expect(retentionAt(5, P)).toBe(0.4);
    expect(retentionAt(6, P)).toBe(0.3);
    expect(retentionAt(11, P)).toBe(0.3);
    expect(retentionAt(12, P)).toBe(0.2);
    expect(retentionAt(14, P)).toBeCloseTo(0.2 * 0.8 * 0.8);
    expect(retentionAt(18, P)).toBe(0);
  });
});

describe("recruitment forward-fill", () => {
  const rec = { "2026-05": 3000, "2026-06": 3300, "2026-07": 3600 };
  it("uses records, holds trailing average forward, zero before programme", () => {
    expect(recruitmentFor(rec, "2026-06", P)).toBe(3300);
    expect(recruitmentFor(rec, "2026-09", P)).toBe(3300); // (3000+3300+3600)/3
    expect(recruitmentFor(rec, "2026-01", P)).toBe(0);
  });
  it("uses the explicit ahead assumption when set", () => {
    expect(recruitmentFor(rec, "2026-09", { ...P, recruitmentAhead: 5000 })).toBe(5000);
  });
});

describe("stage demand wave", () => {
  // recruitment ramps Nov-25..Jul-26 like reality: later cohorts much bigger
  const rec = {
    "2025-11": 900, "2025-12": 700, "2026-01": 800, "2026-02": 1100,
    "2026-03": 1800, "2026-04": 2400, "2026-05": 3500, "2026-06": 3200, "2026-07": 3900,
  };
  it("P1 demand reflects the last 6 cohorts", () => {
    // Aug-26: ages 1..6 -> cohorts Jul..Feb(a=6 is P2) — a=0..5 => Mar..Aug(fwd-filled)
    const p1 = rawStageDemand("P1", "2026-08", rec, P);
    // cohorts Aug(fill 3533.33)+Jul+Jun+May+Apr+Mar = 3533.33+3900+3200+3500+2400+1800 = 18333.33 * 0.4 * 3
    expect(p1).toBeCloseTo(18333.333 * 0.4 * 3, 0);
  });
  it("P2 wave grows as the big cohorts age in", () => {
    const dec = rawStageDemand("P2", "2026-12", rec, P); // ages 6-11 = Jun-25..Jan-26? no: Dec-6=Jun-26 .. Dec-11=Jan-26
    const aug = rawStageDemand("P2", "2026-08", rec, P); // ages 6-11 = Feb-26..Sep-25
    expect(dec).toBeGreaterThan(aug * 2); // the wave: Jun cohort 3200 vs Sep-25 0
  });
});

// steady-state recruitment: every cohort 3000, so raw stage demand is flat
const STEADY: Record<string, number> = Object.fromEntries(
  ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"].map(
    (k) => [k, 3000]
  )
);

describe("calibration", () => {
  const rec = STEADY;
  it("scales raw model to actual level at steady state", () => {
    const actual = { "2026-05": 2000, "2026-06": 2000, "2026-07": 2000 };
    const cal = calibrate("P1", actual, rec, "2026-07", P);
    const demand = stageDemand("P1", "2026-07", rec, cal, P);
    expect(demand).toBeCloseTo(2000, 0);
  });
  it("keeps the sum over the calibration window even mid-ramp", () => {
    const ramp = { "2026-05": 3000, "2026-06": 3000, "2026-07": 3000 };
    const actual = { "2026-05": 2000, "2026-06": 2000, "2026-07": 2000 };
    const cal = calibrate("P1", actual, ramp, "2026-07", P);
    const total = ["2026-05", "2026-06", "2026-07"].reduce(
      (s, m) => s + stageDemand("P1", m, ramp, cal, P),
      0
    );
    expect(total).toBeCloseTo(6000, 0);
  });
  it("is neutral when there is no history", () => {
    const cal = calibrate("P1", {}, rec, "2026-07", P);
    expect(cal.scale).toBe(1);
    expect(cal.basePerMonth).toBe(0);
  });
  it("uses additive base when actual exceeds the raw cohort (pre-programme market)", () => {
    // stage-2 situation: actual 5000/mo, raw cohort tiny
    const smallRec = { "2026-05": 300, "2026-06": 300, "2026-07": 300 };
    const actual = { "2026-05": 5000, "2026-06": 5000, "2026-07": 5000 };
    const cal = calibrate("P2", actual, smallRec, "2026-07", P);
    expect(cal.scale).toBe(1); // wave NOT amplified
    expect(cal.basePerMonth).toBeGreaterThan(4000);
    // future demand = base + wave, not base × explosion
    const future = stageDemand("P2", "2027-01", smallRec, cal, P);
    expect(future).toBeGreaterThan(cal.basePerMonth); // wave adds on top
    expect(future).toBeLessThan(cal.basePerMonth + 300 * 6 * 3); // bounded by full cohort
  });
});

describe("pack split", () => {
  it("splits by recent share and defaults to even", () => {
    const split = packSplit(["a", "b"], { a: { "2026-07": 750 }, b: { "2026-07": 250 } }, "2026-07");
    expect(split.a).toBeCloseTo(0.75);
    expect(packSplit(["a", "b"], {}, "2026-07").a).toBeCloseTo(0.5);
  });
});

describe("model assembly", () => {
  it("maps names to stages and builds series for all skus", () => {
    expect(stageOf("Platin 1 400g")).toBe("P1");
    expect(stageOf("Platin 3 800g")).toBe("P3");
    expect(stageOf("AC EXPERT 350g DS")).toBeNull();
    const skus = [
      { id: "p1a", name: "Platin 1 400g" },
      { id: "p1b", name: "Platin 1 800g" },
      { id: "ac", name: "AC EXPERT 350g" },
    ];
    const actual = {
      p1a: { "2026-05": 3000, "2026-06": 3000, "2026-07": 3000 },
      p1b: { "2026-05": 1000, "2026-06": 1000, "2026-07": 1000 },
      ac: { "2026-05": 600, "2026-06": 700, "2026-07": 800 },
    };
    const m = buildDemandModel(skus, actual, STEADY, "2026-08", 12, P);
    // P1 total calibrated to 4000/mo at steady state, split 75/25
    expect(m.series.p1a["2026-08"]).toBeCloseTo(3000, -1);
    expect(m.series.p1b["2026-08"]).toBeCloseTo(1000, -1);
    // specialty = run-rate
    expect(m.series.ac["2026-10"]).toBeCloseTo(700, 5);
  });
});
