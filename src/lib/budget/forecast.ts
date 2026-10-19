// The rolling forecast: closed months are actual, the rest is the plan, and the
// plan starts from the real position at the end of the last closed month. When
// a month closes, the start moves forward and every later month recalculates —
// stock is re-ordered to the target cover, Fargo pays what it really still owes,
// cash starts from the bank. Pure — no DB imports.
import { monthRange, runBudget, type BudgetInputs, type BudgetOpening, type BudgetSupply } from "./model";
import { shiftMonthly } from "./store";

/** The inputs the forecast runs on: the inputs' own opening, or a later real one with the monthly inputs moved on. */
export function forecastInputs(inputs: BudgetInputs, realOpening: BudgetOpening | null): BudgetInputs {
  if (!realOpening || realOpening.monthId <= inputs.opening.monthId) return inputs;
  const offset = monthRange(inputs.opening.monthId, realOpening.monthId).length - 1;
  return { ...inputs, opening: realOpening, monthly: shiftMonthly(inputs.monthly, offset) };
}

/** The plan part of the forecast; trucks and sales from the supply plan when given. */
export function forecastRun(inputs: BudgetInputs, realOpening: BudgetOpening | null, supply?: BudgetSupply) {
  return runBudget(forecastInputs(inputs, realOpening), { supply });
}
