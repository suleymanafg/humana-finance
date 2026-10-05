// Calculation engine: every figure in the app derives from the raw inputs here.
// Pure functions over a Dataset snapshot — nothing derived is stored.
import {
  arrivedInOrder,
  computeFargoCosting,
  computeShipments,
  computeTiCosting,
  costProductResolver,
} from "./costing";
import { buildHealthChecks } from "./health";
import { computeBalances, computeSettlement } from "./positions";
import {
  computeFargoMonths,
  computeGroupMonths,
  computeTiMonths,
  priorOwnerVatOpening,
} from "./results";
import type { Computed, Dataset } from "./types";

export { costProductResolver, isImportVat, monthOf } from "./costing";
export { FARGO_WRITEOFF_GROUP } from "./results";

/** Promo SKUs are costed as their regular SKU. */
export function costProductIdOf(productId: string, ds: Dataset): string {
  return costProductResolver(ds)(productId);
}

export function compute(ds: Dataset): Computed {
  const monthIds = ds.months.map((m) => m.id);
  const costOf = costProductResolver(ds);
  const shipments = computeShipments(ds, costOf);
  const arrived = arrivedInOrder(shipments);
  const tiCosting = computeTiCosting(ds, arrived, costOf);
  const { fifo, stock, oversold, writeOffs: fargoWriteOffs } = computeFargoCosting(ds, monthIds, arrived, tiCosting, costOf);
  const priorOwnerOpening = monthIds.length > 0 ? priorOwnerVatOpening(ds, monthIds[0]) : 0;
  const fargo = computeFargoMonths(ds, monthIds, tiCosting.invoices, fifo, costOf);
  const ti = computeTiMonths(ds, monthIds, tiCosting.invoices, tiCosting.writeOffs, priorOwnerOpening);
  const group = computeGroupMonths(ds, monthIds, ti, fargo, fifo, costOf);
  const settlement = computeSettlement(ds, monthIds, fargo, tiCosting.invoices, fifo);
  const balance = computeBalances(
    ds,
    monthIds,
    arrived,
    tiCosting.invoices,
    tiCosting.writeOffs,
    ti,
    fargo,
    group,
    settlement,
    fifo
  );
  const computed: Computed = {
    monthIds,
    shipments,
    invoices: tiCosting.invoices,
    writeOffs: tiCosting.writeOffs,
    fargoWriteOffs,
    fifo,
    ti,
    fargo,
    group,
    settlement,
    balance,
    stock,
    priorOwnerVatOpening: priorOwnerOpening,
    healthChecks: [],
  };
  computed.healthChecks = buildHealthChecks(ds, computed, {
    oversold,
    overdrawn: tiCosting.overdrawn,
  });
  return computed;
}

/** Sum of numeric fields over a run of monthly rows (ratios are recomputed by callers). */
export function sumRows<T extends object>(rows: T[], keys: Array<keyof T>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k as string] = rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  return out;
}
