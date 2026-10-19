import { describe, expect, it } from "vitest";
import { channelShares, CHANNEL_KEYS, monthNumber, paymentWeights, runBudget, type BudgetInputs } from "../model";
import { capitalAnswer } from "../capital";
import { forecastRun } from "../forecast";
import { checkInputs, parseStored, shiftMonthly } from "../store";
import { opexGroupOf } from "../actuals";

// A small business with round numbers: 1,000 units a month at 100 incl. VAT, all sold by TI,
// trucks of 1,000, HQ price 5 EUR × 10 = 50 a unit, three months from January to March 2027.
const months = 3;
const fill = <T>(v: T) => Array.from({ length: months }, () => v);
function inputs(over: Partial<BudgetInputs> = {}): BudgetInputs {
  return {
    vatRate: 0.12, profitTaxRate: 0.15, eurRate: 10, sellPriceChange: 0, sellPriceChangeMonth: 1, hqPriceChange: 0, hqPriceChangeMonth: 1,
    baseUnits: 1000, growth: 0, allowance: 0, spikeReady: 0.2, importCostPct: 0.1, importVatPct: 0.12, truckUnits: 1000,
    coverMonths: 2, buildupMonths: 0, leadDays: 30, hqEurPerUnit: null,
    products: [{ name: "A", listPrice: 100, hqEur: 5, units: 1 }],
    korzinkaShare: 0.5,
    channels: CHANNEL_KEYS.map((key) => ({ key, name: key, mix: key === "korzinka" ? 0.5 : 0.125, discount: 0, days: 30 })),
    medicalPct: 0, mrPayroll: 1000, officePayroll: 0, payrollTaxes: 0, officeCosts: 0, marketing: 0, tradePromo: 0, smartUp: 0,
    vehicles: 0, certificates: 0, certificatesMonth: 3, bankFeePct: 0, shared: [], nutribenSales: 0, nutribenGrowth: 0,
    fargoRemitPct: 0.8, tiMarkup: 0, distStartMonth: 1, fargoOldMonths: 1, reserveMonths: 1, spikeBuffer: 0,
    opening: {
      monthId: "2026-12", cash: 100_000, stockUnits: 2000, stockValue: 110_000, arrivingUnits: 1000, arrivingHqValue: 50_000, transitPaid: 50_000,
      customersOwe: 0, loans: 0, vatCredit: 0, vatPayable: 0, profitTaxPayable: 0, priorOwner: 0,
      fargoOwes: 0, fargoStockUnits: 0, fargoStockValue: 0, fargoCustomersOwe: 0, profitYtd: 0,
    },
    monthly: {
      spikePct: fill(0), expectedUnits: fill(null), tiShare: fill(1), fixedTrucks: fill(null), stockToFargo: fill(0),
      fargoPaid: fill(null), fargoReturns: fill(0), loans: fill(0), priorOwnerPaid: fill(0), plannedCapital: fill(0),
    },
    ...over,
  };
}
const run = (i = inputs()) => runBudget(i, { end: "2027-03" });

describe("budget model", () => {
  it("pays HQ by lead time: 30 days the month before, 40 days two-thirds and one-third", () => {
    expect(paymentWeights(30)).toEqual([0, 1, 0]);
    expect(paymentWeights(0)).toEqual([1, 0, 0]);
    const [w0, w1, w2] = paymentWeights(40);
    expect(w0).toBe(0);
    expect(w1).toBeCloseTo(2 / 3);
    expect(w2).toBeCloseTo(1 / 3);
  });

  it("keeps Korzinka's typed share and spreads the rest over the other channels' mix", () => {
    const s = channelShares({ ...inputs(), korzinkaShare: 0.2 });
    expect(s.korzinka).toBe(0.2);
    expect(s.chains).toBeCloseTo(0.2); // 0.125 of 0.5 → a quarter of the remaining 0.8
    expect(Object.values(s).reduce((t, x) => t + x, 0)).toBeCloseTo(1);
  });

  it("counts month numbers from October 2026", () => {
    expect(monthNumber("2026-10")).toBe(1);
    expect(monthNumber("2027-01")).toBe(4);
  });

  it("orders whole trucks to the target cover and balances every month", () => {
    const r = run();
    expect(r.months).toEqual(["2027-01", "2027-02", "2027-03"]);
    expect(r.stock.arrivals[0]).toBe(1000); // the truck already on the way
    // after January: 2,000 open + 1,000 arrived − 1,000 sold = 2,000 = the 2-month target, so each month one truck
    expect(r.stock.arrivals.slice(1)).toEqual([1000, 1000]);
    expect(r.stock.tiClose).toEqual([2000, 2000, 2000]);
    expect(r.balance.check).toEqual([0, 0, 0]);
  });

  it("collects what customers do not still owe, by payment days", () => {
    const r = run(inputs({ channels: CHANNEL_KEYS.map((key) => ({ key, name: key, mix: key === "korzinka" ? 0.5 : 0.125, discount: 0, days: key === "korzinka" ? 60 : 30 })) }));
    // 100,000 invoiced a month: Korzinka's half owes two months, the rest one
    expect(r.sales.customersOwe[0]).toBeCloseTo(100_000);
    expect(r.sales.customersOwe[1]).toBeCloseTo(150_000);
    expect(r.sales.collected[0]).toBeCloseTo(0);
    expect(r.sales.collected[1]).toBeCloseTo(50_000);
    expect(r.sales.collected[2]).toBeCloseTo(100_000);
  });

  it("asks for the largest gap below the cash reserve, from the month it opens", () => {
    const r = run(inputs({ opening: { ...inputs().opening, cash: 0 } }));
    const cap = capitalAnswer(r, inputs());
    expect(cap.ask).toBeCloseTo(Math.max(0, ...cap.monthly.shortfall));
    expect(cap.firstNeeded).toBe("2027-01");
    expect(cap.bridge.total).toBeCloseTo(cap.monthly.shortfall[cap.bridge.month]);
    expect(cap.checks.balances).toBe(true);
  });
});

describe("supply from the plan", () => {
  it("takes units sold, arrivals and HQ payments from the plan instead of the truck rule, and still balances", () => {
    const by = (a: number, b: number, c: number) => ({ "2027-01": a, "2027-02": b, "2027-03": c });
    const supply = {
      marketUnits: by(900, 1100, 1000),
      listPrice: by(100, 100, 120),
      arrivals: by(1000, 0, 2000), // the truck on the way at the opening is in the plan's January
      arrivalsHq: by(50_000, 0, 100_000),
      paidHq: by(0, 100_000, 0), // March's trucks paid at dispatch in February
      trucks: by(1, 0, 2),
    };
    const r = runBudget(inputs(), { end: "2027-03", supply });
    expect(r.sales.marketUnits).toEqual([900, 1100, 1000]);
    expect(r.sales.price).toEqual([100, 100, 120]);
    expect(r.stock.arrivals).toEqual([1000, 0, 2000]);
    expect(r.stock.trucks).toEqual([1, 0, 2]);
    expect(r.cash.paidHq.map((x) => x + 0)).toEqual([0, -100_000, 0]);
    expect(r.stock.transit).toEqual([0, 100_000, 0]); // paid before the start, then February's payment — both arrived
    expect(r.balance.check).toEqual([0, 0, 0]);
  });

  it("keeps an approved budget's plan snapshot when stored, and drops a malformed one", () => {
    const year = <T,>(v: T) => Array.from({ length: 12 }, () => v); // a stored budget runs to December 2027
    const full = inputs({
      monthly: { spikePct: year(0), expectedUnits: year(null), tiShare: year(1), fixedTrucks: year(null), stockToFargo: year(0), fargoPaid: year(null), fargoReturns: year(0), loans: year(0), priorOwnerPaid: year(0), plannedCapital: year(0) },
    });
    const supply = { marketUnits: { "2027-01": 1 }, arrivals: {}, arrivalsHq: {}, paidHq: {}, trucks: {} };
    const stored = parseStored(JSON.stringify({ name: "b", savedAt: "2026-10-19T00:00:00Z", savedBy: "x", inputs: full, supply }));
    expect(stored?.supply).toEqual(supply);
    const bad = parseStored(JSON.stringify({ name: "b", savedAt: "2026-10-19T00:00:00Z", savedBy: "x", inputs: full, supply: [1] }));
    expect(bad).not.toBeNull();
    expect(bad?.supply).toBeUndefined();
  });
});

describe("rolling forecast", () => {
  it("starts from a later real position and keeps the later months' inputs on their months", () => {
    const i = inputs({ monthly: { ...inputs().monthly, fixedTrucks: [null, null, 3] } });
    const real = { ...i.opening, monthId: "2027-01", cash: 5_000, stockUnits: 1500, stockValue: 82_500, arrivingUnits: 0, arrivingHqValue: 0, transitPaid: 0 };
    const r = runBudget({ ...i, opening: real, monthly: shiftMonthly(i.monthly, 1) }, { end: "2027-03" });
    expect(r.months).toEqual(["2027-02", "2027-03"]);
    expect(r.cash.open[0]).toBe(5_000);
    expect(r.stock.arrivals[1]).toBe(3000); // March's typed 3 trucks stay in March
    expect(r.balance.check).toEqual([0, 0]);
  });

  it("lets trucks typed for the first month win over the trucks recorded on the way", () => {
    const i = inputs({ monthly: { ...inputs().monthly, fixedTrucks: [2, null, null] } });
    const r = run(i);
    expect(r.stock.arrivals[0]).toBe(2000);
    expect(r.stock.hqArriving[0]).toBe(100_000); // valued at the HQ price, not the recorded truck
    expect(r.balance.check).toEqual([0, 0, 0]);
  });

  it("runs the plan from the inputs' own opening while nothing later is closed", () => {
    const i = inputs();
    expect(forecastRun(i, null).months[0]).toBe("2027-01");
    expect(forecastRun(i, { ...i.opening, monthId: "2026-11" }).months[0]).toBe("2027-01");
  });
});

describe("stored budgets", () => {
  it("accepts complete inputs and names the first problem otherwise", () => {
    const full = { ...inputs(), monthly: { ...inputs().monthly } };
    // checkInputs expects one value per month up to December 2027
    const n = 12;
    const long = <T>(v: T) => Array.from({ length: n }, () => v);
    full.monthly = { spikePct: long(0), expectedUnits: long(null), tiShare: long(1), fixedTrucks: long(null), stockToFargo: long(0), fargoPaid: long(null), fargoReturns: long(0), loans: long(0), priorOwnerPaid: long(0), plannedCapital: long(0) };
    expect("inputs" in checkInputs(full)).toBe(true);
    expect(checkInputs({ ...full, leadDays: 90 })).toEqual({ error: "leadDays: 0–60" });
    expect(checkInputs({ ...full, baseUnits: "a lot" })).toEqual({ error: "baseUnits: number expected" });
  });

  it("puts TI's cost categories into the budget's P&L groups", () => {
    expect(opexGroupOf("Обл Мед инвестиция", "TI_MEDICAL_INVEST")).toBe("medical");
    expect(opexGroupOf("Зарплата мед отдел", "TI_SALARIES")).toBe("medical");
    expect(opexGroupOf("Офис зарплата", "TI_SALARIES")).toBe("admin");
    expect(opexGroupOf("Флаеры", "TI_MARKETING")).toBe("marketing");
  });
});
