// Stage demand engine — the owner's budget workbook (v17, «Спрос» tab) as code.
//
// Babies recruited by verified prescription (foil tracking) move through
// Platin 1 (months 0–5 after the prescription), Platin 2 (6–11) and Platin 3
// (12–17). A stage's sales a month = a LEVEL + babies on the stage × TINS A
// BABY BUYS a month. The level is re-learned every month from the last three
// closed months in which the stage had stock, so the engine always starts from
// what really sells; the babies term carries the wave the prescriptions
// started. A stage splits into 400 g / 800 g by the 800 g share of its latest
// month with stock. Expert products have no stages: each is the average of
// its last three months with stock.
//
// "Had stock" comes from the month-end stock: a month ran short when it
// started with less than half a month's sales on hand (the owner can override
// a month either way). Pure — no DB; the caller assembles the inputs.
import { addMonths } from "./compute";

export type Stage = "P1" | "P2" | "P3";
export const STAGES: Stage[] = ["P1", "P2", "P3"];

/** months after the prescription a baby spends on each stage */
const STAGE_WINDOW: Record<Stage, [number, number]> = { P1: [0, 5], P2: [6, 11], P3: [12, 17] };

export interface EngineProduct {
  id: string;
  /** Platin stage and tin size; null stage = Expert (no stages) */
  stage: Stage | null;
  size800: boolean;
}

export interface StageEngineParams {
  /** tins a month one recruited baby adds on each stage */
  tinsPerBaby: Record<Stage, number>;
  /** prescriptions a month after the last entered month; null = average of the last 3 */
  rxAhead: number | null;
  /** closed months used to learn a level */
  window: number;
  /** a month ran short when it started with less than this share of a month's sales */
  shortShare: number;
}

export const DEFAULT_ENGINE_PARAMS: StageEngineParams = {
  tinsPerBaby: { P1: 0.435, P2: 0.2, P3: 0.1 },
  rxAhead: null,
  window: 3,
  shortShare: 0.5,
};

export interface StageEngineInput {
  /** every month the engine looks at, ascending — history and forecast */
  months: string[];
  /** the last month whose sales are whole */
  lastClosed: string;
  /** share of the month after lastClosed already done when its sales were taken (0–1) */
  monthDone: number;
  products: EngineProduct[];
  /** units sold: whole months up to lastClosed, then the current month so far */
  sales: Record<string, Record<string, number>>;
  /** sellable stock at month-end (actual), by product and month */
  stockEnd: Record<string, Record<string, number>>;
  /** verified prescriptions by month */
  rx: Record<string, number>;
  /** owner's say on a month: true = ran short, false = had stock */
  shortOverride?: Record<string, Record<string, boolean>>;
  /** owner's own number a month for a product, replacing the engine from the current month on */
  productOverride?: Record<string, number>;
  /** owner's own 800 g share for a stage */
  shareOverride?: Partial<Record<Stage, number>>;
  params?: Partial<StageEngineParams>;
}

export interface Learned {
  /** the level (stages: without the prescription babies; Expert: sales a month) */
  level: number;
  /** the months it was learned from */
  months: string[];
}

export interface StageEngineResult {
  rxAhead: number;
  rxUsed: Record<string, number>;
  babies: Record<Stage, Record<string, number>>;
  short: Record<string, Record<string, boolean>>;
  stageLevel: Record<Stage, Learned>;
  expertLevel: Record<string, Learned>;
  share800: Record<Stage, number>;
  /** level + tins × babies for every month (past months = what the engine would have said) */
  stageForecast: Record<Stage, Record<string, number>>;
  /** demand by product: actual for closed months, so far + the rest for the current month, forecast after */
  demand: Record<string, Record<string, number>>;
  /** the engine's full-month figure for the current month, and the pace it is running at */
  thisMonth: Record<string, { forecast: number; runningAt: number }>;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : 0);

export function runStageEngine(input: StageEngineInput): StageEngineResult {
  const p: StageEngineParams = { ...DEFAULT_ENGINE_PARAMS, ...input.params, tinsPerBaby: { ...DEFAULT_ENGINE_PARAMS.tinsPerBaby, ...input.params?.tinsPerBaby } };
  const { months, lastClosed } = input;
  const current = addMonths(lastClosed, 1);
  const sale = (id: string, m: string) => input.sales[id]?.[m] ?? 0;

  // prescriptions: entered months, then the average of the last three entered up to lastClosed
  const lastThree = [0, 1, 2].map((k) => addMonths(lastClosed, -k)).filter((m) => input.rx[m] !== undefined);
  const rxAhead = p.rxAhead ?? Math.round(avg(lastThree.map((m) => input.rx[m])));
  const rxUsed: Record<string, number> = {};
  for (const m of months) rxUsed[m] = input.rx[m] ?? (m > lastClosed ? rxAhead : 0);

  const babies = {} as Record<Stage, Record<string, number>>;
  for (const st of STAGES) {
    const [a, b] = STAGE_WINDOW[st];
    babies[st] = {};
    for (const m of months) {
      let t = 0;
      for (let k = a; k <= b; k++) t += rxUsed[addMonths(m, -k)] ?? 0; // months before the timeline count as none
      babies[st][m] = t;
    }
  }

  // ran short: the month started with less than half a month's sales on hand
  const short: Record<string, Record<string, boolean>> = {};
  for (const pr of input.products) {
    short[pr.id] = {};
    months.forEach((m, k) => {
      const prev = months[k - 1];
      const stock = prev !== undefined ? input.stockEnd[pr.id]?.[prev] : undefined;
      const auto = k > 0 && m <= lastClosed && stock !== undefined && stock < p.shortShare * Math.max(sale(pr.id, m), sale(pr.id, prev));
      short[pr.id][m] = input.shortOverride?.[pr.id]?.[m] ?? auto;
    });
  }

  const closed = months.filter((m) => m <= lastClosed);
  const lastClean = (ids: string[]) => closed.filter((m) => ids.every((id) => !short[id][m])).slice(-p.window);
  const pair = (st: Stage) => {
    const ids = input.products.filter((x) => x.stage === st);
    return { small: ids.find((x) => !x.size800)?.id, big: ids.find((x) => x.size800)?.id, ids: ids.map((x) => x.id) };
  };

  const stageLevel = {} as Record<Stage, Learned>;
  const share800 = {} as Record<Stage, number>;
  const stageForecast = {} as Record<Stage, Record<string, number>>;
  for (const st of STAGES) {
    const { big, ids } = pair(st);
    const used = lastClean(ids);
    const sold = (m: string) => ids.reduce((t, id) => t + sale(id, m), 0);
    const level = avg(used.map(sold)) - p.tinsPerBaby[st] * avg(used.map((m) => babies[st][m]));
    stageLevel[st] = { level, months: used };
    const latest = used.at(-1);
    const auto = latest && big && sold(latest) ? sale(big, latest) / sold(latest) : 0;
    share800[st] = input.shareOverride?.[st] ?? auto;
    stageForecast[st] = Object.fromEntries(months.map((m) => [m, level + p.tinsPerBaby[st] * babies[st][m]]));
  }

  const expertLevel: Record<string, Learned> = {};
  for (const pr of input.products.filter((x) => x.stage === null)) {
    const used = lastClean([pr.id]);
    expertLevel[pr.id] = { level: avg(used.map((m) => sale(pr.id, m))), months: used };
  }

  const demand: Record<string, Record<string, number>> = {};
  const thisMonth: StageEngineResult["thisMonth"] = {};
  for (const pr of input.products) {
    const engineAt = (m: string) =>
      pr.stage === null ? expertLevel[pr.id].level : stageForecast[pr.stage][m] * (pr.size800 ? share800[pr.stage] : 1 - share800[pr.stage]);
    const own = input.productOverride?.[pr.id];
    const forecastAt = (m: string) => own ?? engineAt(m);
    demand[pr.id] = {};
    for (const m of months) {
      demand[pr.id][m] = m <= lastClosed ? sale(pr.id, m) : m === current ? sale(pr.id, m) + (1 - input.monthDone) * forecastAt(m) : forecastAt(m);
    }
    thisMonth[pr.id] = { forecast: forecastAt(current), runningAt: input.monthDone > 0 ? sale(pr.id, current) / input.monthDone : 0 };
  }

  return { rxAhead, rxUsed, babies, short, stageLevel, expertLevel, share800, stageForecast, demand, thisMonth };
}
