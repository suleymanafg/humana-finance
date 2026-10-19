import { describe, expect, it } from "vitest";
import { runStageEngine, type EngineProduct } from "../stage-engine";
import { addMonths } from "../compute";

// made-up figures: a small market, prescriptions starting in January
const months: string[] = [];
for (let m = "2026-01"; m <= "2026-12"; m = addMonths(m, 1)) months.push(m);
const products: EngineProduct[] = [
  { id: "a400", stage: "P1", size800: false },
  { id: "a800", stage: "P1", size800: true },
  { id: "b400", stage: "P2", size800: false },
  { id: "b800", stage: "P2", size800: true },
  { id: "x", stage: null, size800: false },
];
const flat = (v: number, until = "2026-06") => Object.fromEntries(months.filter((m) => m <= until).map((m) => [m, v]));
const base = {
  months,
  lastClosed: "2026-05",
  monthDone: 0.5,
  products,
  rx: { "2026-01": 100, "2026-02": 100, "2026-03": 100, "2026-04": 100, "2026-05": 100 },
  sales: { a400: flat(300), a800: flat(100), b400: flat(60), b800: flat(40), x: flat(50) },
  stockEnd: { a400: flat(900), a800: flat(300), b400: flat(200), b800: flat(200), x: flat(150) },
  params: { tinsPerBaby: { P1: 0.5, P2: 0.2, P3: 0.1 } },
};

describe("stage engine", () => {
  it("counts babies on each stage from the prescriptions", () => {
    const r = runStageEngine(base);
    expect(r.rxAhead).toBe(100); // average of the last three entered months
    expect(r.babies.P1["2026-05"]).toBe(500); // Jan–May
    expect(r.babies.P1["2026-07"]).toBe(600); // Feb–Jul, Jun–Jul at the assumption
    expect(r.babies.P2["2026-07"]).toBe(100); // Jan, six months back
    expect(r.babies.P3["2026-12"]).toBe(0);
  });

  it("learns the level from the last three months and adds the babies", () => {
    const r = runStageEngine(base);
    // Mar–May: P1 sold 400 a month with 300, 400, 500 babies → level 400 − 0.5 × 400 = 200
    expect(r.stageLevel.P1.months).toEqual(["2026-03", "2026-04", "2026-05"]);
    expect(r.stageLevel.P1.level).toBeCloseTo(200);
    expect(r.stageForecast.P1["2026-08"]).toBeCloseTo(200 + 0.5 * 600);
    // the 800 g share of the latest month with stock splits the stage
    expect(r.share800.P1).toBeCloseTo(0.25);
    expect(r.demand.a800["2026-08"]).toBeCloseTo(500 * 0.25);
    expect(r.demand.x["2026-08"]).toBeCloseTo(50);
  });

  it("closed months are actual; this month is sold so far plus the rest at the forecast", () => {
    const r = runStageEngine(base);
    expect(r.demand.a400["2026-04"]).toBe(300);
    const f = r.thisMonth.a400.forecast;
    expect(r.demand.a400["2026-06"]).toBeCloseTo(300 + 0.5 * f);
    expect(r.thisMonth.a400.runningAt).toBeCloseTo(600);
  });

  it("skips a month that started with too little stock, and the owner can override it", () => {
    const short = { ...base, stockEnd: { ...base.stockEnd, a400: { ...base.stockEnd.a400, "2026-03": 50 } } };
    const r = runStageEngine(short);
    expect(r.short.a400["2026-04"]).toBe(true); // April started with 50, under half a month's 300
    expect(r.stageLevel.P1.months).toEqual(["2026-02", "2026-03", "2026-05"]);
    const back = runStageEngine({ ...short, shortOverride: { a400: { "2026-04": false } } });
    expect(back.stageLevel.P1.months).toEqual(["2026-03", "2026-04", "2026-05"]);
  });

  it("the owner's own number replaces the engine from this month on", () => {
    const r = runStageEngine({ ...base, productOverride: { x: 80 } });
    expect(r.demand.x["2026-05"]).toBe(50);
    expect(r.demand.x["2026-06"]).toBeCloseTo(50 + 0.5 * 80);
    expect(r.demand.x["2026-09"]).toBe(80);
  });
});
