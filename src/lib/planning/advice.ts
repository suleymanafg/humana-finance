// Advice from the facts only (owner, 17 Nov 2026). The order planner walks the
// ship months in turn and counts every load it proposes as if it were taken —
// so a month's number rests on proposals that may never happen (3 trucks
// proposed, 2, 1 or none taken). Here nothing proposed is ever counted:
//
// - the stock outlook is today's stock and the trucks that are in the app;
// - each ship month's advice stands alone: the load that brings stock to the
//   target at the end of its sell month, from the stock and the trucks in the
//   app. It does not assume another month's advice is followed — once a truck
//   is in the app, every month is counted again from it;
// - a month whose IBP is still open is advised as the number to enter, on top
//   of what is already ordered in the IBP for the months before it (an order
//   made is a fact; it is taken as leaving DMK in its ship month).
//
// Sizing a load (whole pallets, whole trucks at HQ's fill) is the order
// planner's, asked for one ship month at a time. Pure — no DB.
import { planOrders, type KnownLoad, type OrderPlannerInput, type PlannedLoad, type PlannerSku } from "./order-planner";

export interface AdviceInput {
  skus: PlannerSku[];
  /** the advice starts after this month; stockEnd is sellable stock at its end */
  stockMonth: string;
  stockEnd: Record<string, number>;
  demand: Record<string, Record<string, number>>;
  /** trucks in the app that become sellable after stockMonth */
  trucks: KnownLoad[];
  /** what is entered in the IBP, by ship month */
  ibpEntered: Record<string, Record<string, number>>;
  /** ordered in the IBP for ship months up to stockMonth and not on a truck */
  open: Record<string, number>;
  /** ship months to advise, ascending, from stockMonth */
  shipMonths: string[];
  /** the IBP for ship months up to this one is closed */
  frozenThrough: string;
  /** run the outlooks to this month */
  through: string;
  sellMonthOf: (shipMonth: string) => string;
  targetOf: (shipMonth: string) => number;
  truckPlaces?: number;
  minFill?: number;
  maxFill?: number;
  spillShare?: number;
  dangerLine?: number;
}

export interface Outlook {
  /** month-end stock, months of the next month's demand it covers, demand not served */
  stock: Record<string, Record<string, number>>;
  cover: Record<string, Record<string, number>>;
  lost: Record<string, Record<string, number>>;
}

export interface MonthAdvice {
  shipMonth: string;
  sellMonth: string;
  /** pickup: the IBP is closed — trucks load what is ordered, HQ is asked for the rest; ibp: open — the number to enter */
  kind: "pickup" | "ibp";
  /** the advised load, on top of the trucks the app already has for this ship month */
  load: PlannedLoad;
  /** the need before it is rounded to whole trucks, in trucks */
  needTrucks: number;
  /** pickup: ordered in the IBP up to this ship month and not on a truck; ibp: entered for this ship month */
  ordered: Record<string, number>;
  /** months of stock aimed for at the end of the sell month */
  target: number;
}

export interface Advice {
  /** today's stock and the trucks in the app — nothing else */
  facts: Outlook;
  /** the same, plus everything ordered in the IBP leaving DMK in its ship month */
  ordered: Outlook;
  months: MonthAdvice[];
}

const total = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

export function buildAdvice(input: AdviceInput): Advice {
  const ids = input.skus.map((s) => s.id);
  const CAP = input.truckPlaces ?? 33;
  const spillShare = input.spillShare ?? 0.25;
  const danger = input.dangerLine ?? 1;
  const common: Omit<OrderPlannerInput, "shipMonths" | "known" | "open"> = {
    skus: input.skus,
    stockMonth: input.stockMonth,
    stockEnd: input.stockEnd,
    demand: input.demand,
    // nothing is "taken whatever the need": the advice is the need, the IBP is shown beside it
    ibpEntered: {},
    frozenThrough: "",
    extraThrough: "",
    sellMonthOf: input.sellMonthOf,
    targetOf: input.targetOf,
    truckPlaces: input.truckPlaces,
    minFill: input.minFill,
    maxFill: input.maxFill,
    spillShare: input.spillShare,
    dangerLine: input.dangerLine,
    through: input.through,
    // on their own, months see the stock run out before their load is sellable: those sales are lost, not owed
    lostIsLost: true,
  };
  const outlook = (known: KnownLoad[]): Outlook => {
    const r = planOrders({ ...common, shipMonths: [], known, open: {} });
    return { stock: r.stock, cover: r.cover, lost: r.lost };
  };

  // everything ordered in the IBP and not on a truck, as loads of their ship months
  // (what waits at DMK today leaves in the current month)
  const trucksOf = (m: string, id: string) => input.trucks.reduce((t, k) => (k.shipMonth === m ? t + (k.units[id] ?? 0) : t), 0);
  const orderedLoads: KnownLoad[] = [];
  if (total(input.open) > 0) orderedLoads.push({ shipMonth: input.stockMonth, sellMonth: input.sellMonthOf(input.stockMonth), units: input.open });
  for (const m of Object.keys(input.ibpEntered).sort()) {
    if (m <= input.stockMonth || m > input.through) continue;
    // trucks already in the app for the month carry its order
    const units = Object.fromEntries(ids.map((id) => [id, Math.max(0, (input.ibpEntered[m][id] ?? 0) - trucksOf(m, id))]));
    if (total(units) > 0) orderedLoads.push({ shipMonth: m, sellMonth: input.sellMonthOf(m), units });
  }

  const facts = outlook(input.trucks);
  const ordered = outlook([...input.trucks, ...orderedLoads]);

  const months = input.shipMonths.map((m): MonthAdvice => {
    const kind = m <= input.frozenThrough ? "pickup" : "ibp";
    // pickup: from the facts alone, loading first what is ordered and still at DMK by then;
    // ibp: on top of the orders already made for the months before it
    const waiting = Object.fromEntries(ids.map((id) => [id, orderedLoads.reduce((t, l) => (l.shipMonth <= m ? t + (l.units[id] ?? 0) : t), 0)]));
    const known = kind === "pickup" ? input.trucks : [...input.trucks, ...orderedLoads.filter((l) => l.shipMonth < m)];
    // a spill of a few pallets over whole trucks is left out; where the target is the danger line itself,
    // a product may then end a quarter month under it rather than a whole truck be added
    const trimLine = Math.min(danger, Math.max(0, input.targetOf(m) - 0.25));
    let load = planOrders({ ...common, dangerLine: trimLine, shipMonths: [m], known, open: kind === "pickup" ? waiting : {} }).loads[0];
    const needTrucks = load.places > 0 && load.trucks > 0 ? load.needPlaces / (load.places / load.trucks) : load.needPlaces / CAP;
    // a need under a quarter truck is not worth a truck while no product falls under the danger line without it
    const sell = load.sellMonth;
    if (load.trucks > 0 && load.needPlaces < spillShare * CAP) {
      const without = kind === "pickup" ? facts : outlook(known);
      const safe = ids.every((id) => (input.demand[id]?.[sell] ?? 0) <= 0 || (without.cover[id]?.[sell] ?? 0) >= danger);
      if (safe) load = emptyLoad(load, ids);
    }
    return {
      shipMonth: m,
      sellMonth: sell,
      kind,
      load,
      needTrucks,
      ordered: kind === "pickup" ? waiting : Object.fromEntries(ids.map((id) => [id, input.ibpEntered[m]?.[id] ?? 0])),
      target: input.targetOf(m),
    };
  });

  return { facts, ordered, months };
}

function emptyLoad(l: PlannedLoad, ids: string[]): PlannedLoad {
  const zero = () => Object.fromEntries(ids.map((id) => [id, 0]));
  return { ...l, units: zero(), pallets: 0, trucks: 0, places: 0, fill: 0, underFilled: false, fromIbp: zero(), fromOpen: zero(), extra: zero(), ibpToEnter: zero(), eur: 0 };
}
