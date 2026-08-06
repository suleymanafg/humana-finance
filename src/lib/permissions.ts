// One place that answers "who may do what". Every page, nav item, and API
// route reads its answer from here — so a permission question is settled by
// editing this file, not by hunting role checks across the codebase.
import type { Role } from "./auth-crypto";

/**
 * Structural entities reshape the app itself — categories, products, channels,
 * warehouses, months, settings, contacts. Only ADMIN may touch them, which is
 * the whole point of STAFF: the owner defines the shape, staff fill it in.
 *
 * Everything else in the CRUD registry is a *figure* — an OPEX amount, a stock
 * count, a shipment line — and STAFF may write those.
 */
export const STRUCTURAL_ENTITIES = new Set([
  "product",
  "channel",
  "opexCategory",
  "marketingCategory",
  "importExpenseCategory",
  "warehouse",
  "month",
  "setting",
  "contact",
]);

/** May write figures (OPEX amounts, stock, AR, shipments, balance inputs). */
export const canEditData = (role?: Role): boolean => role === "ADMIN" || role === "STAFF";

/** May add/rename/remove categories, products, channels, warehouses, settings. */
export const canEditStructure = (role?: Role): boolean => role === "ADMIN";

/** May write a specific CRUD entity. */
export const canWriteEntity = (role: Role | undefined, entity: string): boolean =>
  STRUCTURAL_ENTITIES.has(entity) ? canEditStructure(role) : canEditData(role);

/**
 * Pages STAFF and VIEWER never see: reference data, integrity checks, the
 * request/collection workflow, and the 1C sync that lives on the close page.
 * Guarded server-side in proxy.ts as well as hidden from the nav.
 */
export const ADMIN_ONLY_PATHS = ["/settings", "/health", "/requests"];

export const canAccessPath = (role: Role | undefined, pathname: string): boolean =>
  ADMIN_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))
    ? canEditStructure(role)
    : true;
