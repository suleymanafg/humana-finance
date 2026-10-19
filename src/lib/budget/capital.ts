// How much capital the business needs and when — the Capital tab of the
// budget workbook, read off a budget run. The business needs its stock, the
// goods prepaid to HQ, what customers owe, what still sits with Fargo and a
// cash reserve; wherever cash without new money falls below the reserve, the
// gap is capital to bring in by that month. Pure — no DB imports.
import { yearIndexes, total, type BudgetInputs, type BudgetRun } from "./model";

const argmax = (a: number[]) => a.reduce((best, x, i) => (x > a[best] ? i : best), 0);

export function capitalAnswer(run: BudgetRun, inputs: BudgetInputs) {
  const H = run.months.length;
  const b = run.balance;
  const range = (f: (i: number) => number) => Array.from({ length: H }, (_, i) => f(i));

  const tied = {
    stock: b.stock,
    transit: b.transit,
    customersOwe: b.customersOwe,
    withFargo: range((i) => b.fargoStock[i] + b.fargoOwes[i]),
    reserve: run.cash.reserve,
  };
  const needed = range((i) => tied.stock[i] + tied.transit[i] + tied.customersOwe[i] + tied.withFargo[i] + tied.reserve[i]);
  const cashWithoutNew = range((i) => run.cash.close[i] - b.capitalAdded[i]);
  const shortfall = range((i) => tied.reserve[i] - cashWithoutNew[i]); // + short, − surplus
  const neededBy = range((i) => Math.max(0, ...shortfall.slice(0, i + 1)));
  const bringIn = range((i) => neededBy[i] - (i === 0 ? 0 : neededBy[i - 1]));

  const peak = argmax(needed); // month the business needs most money
  const worst = argmax(shortfall); // month cash is furthest below the reserve
  const firstShort = shortfall.findIndex((x) => x > 0);
  const ask = Math.max(...neededBy);
  const dec2026 = run.months.indexOf("2026-12");
  const byEnd2026 = dec2026 >= 0 ? neededBy[dec2026] : 0;
  const stockTransitMarket = (i: number) => tied.stock[i] + tied.transit[i] + tied.customersOwe[i];
  const spikeReserve = inputs.spikeReady * stockTransitMarket(peak);

  // what could change the answer (the workbook's rules of thumb)
  const fargoReceived = range((i) => run.cash.fargoPaid.slice(0, i + 1).reduce((t, x) => t + x, 0));
  const ifFargoStops = Math.max(0, ...range((i) => shortfall[i] + fargoReceived[i] - run.cash.fargoPaid[0]));
  const ifFargoSkipsSecondMonth = Math.max(0, ...range((i) => shortfall[i] + (i === 1 ? run.cash.fargoPaid[1] : 0)));

  // the bridge: need − capital already in the business − profit − bills not yet paid = capital to ask
  const bridge = {
    month: worst,
    needed: needed[worst],
    ownFunds: -b.ownFunds,
    profit: -b.profitSinceOrigin[worst],
    unpaid: -(b.vatPayable[worst] + b.taxPayable[worst] - b.vatCredit[worst] + b.loans[worst] + b.priorOwner[worst] + b.otherLiabilities),
  };
  const bridgeTotal = bridge.needed + bridge.ownFunds + bridge.profit + bridge.unpaid;

  const year = (y: number) => {
    const idx = yearIndexes(run, y);
    return {
      year: y,
      months: idx.length,
      tiUnits: total(run.pnl.tiUnits, idx),
      fargoUnits: total(run.pnl.fargoUnits, idx),
      netRevenue: total(run.pnl.netRevenue, idx),
      grossProfit: total(run.pnl.grossProfit, idx),
      ebitda: total(run.pnl.ebitda, idx),
      netProfit: total(run.pnl.netProfit, idx),
    };
  };
  const years = [...new Set(run.months.map((m) => Number(m.slice(0, 4))))].map(year);

  return {
    ask,
    byEnd2026,
    during2027: ask - byEnd2026,
    firstNeeded: firstShort >= 0 ? run.months[firstShort] : null,
    headroom: -Math.max(...shortfall), // lowest cash above the reserve (negative = the gap)
    worstMonth: run.months[worst],
    peakMonth: run.months[peak],
    spikeReserve,
    askWithSpike: Math.max(0, Math.max(...shortfall) + spikeReserve),
    spikeBuffer: inputs.spikeBuffer,
    tiedAtPeak: {
      stock: tied.stock[peak],
      transit: tied.transit[peak],
      customersOwe: tied.customersOwe[peak],
      withFargo: tied.withFargo[peak],
      reserve: tied.reserve[peak],
      total: needed[peak],
    },
    bridge: { ...bridge, total: bridgeTotal },
    whatIf: {
      fargoStops: ifFargoStops,
      fargoSkipsSecondMonth: ifFargoSkipsSecondMonth,
      firstMonthCushion: -shortfall[0], // how short the first month's Fargo payment can fall
      oneMonthLessStock: run.stock.cover[peak] === 0 ? 0 : tied.stock[peak] / run.stock.cover[peak],
      tenFewerDays: (run.sales.invoicedTotal[peak] * (1 - inputs.allowance)) / 30 * 10,
      tenPctMoreSales: 0.1 * stockTransitMarket(peak),
    },
    monthly: { ...tied, needed, cashWithoutNew, shortfall, neededBy, bringIn, cover: run.stock.cover, invoiced: run.sales.invoicedTotal },
    years,
    checks: {
      balances: run.balance.check.every((x) => x === 0),
      noStockOut: run.stock.lowestUnits >= -0.5,
      channelsAddUp: Math.round(Object.values(run.averages.shares).reduce((t, x) => t + x, 0) * 1e4) === 1e4,
      timingAddsUp: Math.round(run.averages.paymentWeights.reduce((t, x) => t + x, 0) * 1e6) === 1e6,
      bridgeTies: Math.round(Math.max(0, bridgeTotal) - ask) === 0,
    },
  };
}

export type CapitalAnswer = ReturnType<typeof capitalAnswer>;
