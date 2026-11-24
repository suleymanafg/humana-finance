// Fargo's e-invoices (ЭСФ, from Didox), kept as tins per month and regular SKU in one Setting row. A month in it
// splits Fargo's sales into bank and cash by them: a tin on an e-invoice was paid through the bank, the rest of the
// month's tins in cash (owner, 24 Nov 2026). Loaded from Fargo's registry by `prisma/import-fargo-esf.ts`.
import type { FargoEsfIn } from "./engine/types";

export const FARGO_ESF_KEY = "fargo.esf";

export interface FargoEsfStore {
  /** month → regular product id → tins (returns netted) and the invoiced amount with VAT */
  months: Record<string, Record<string, { qty: number; amount: number; lines: number }>>;
  /** the files the months came from */
  sources: Array<{ file: string; months: string[]; importedAt: string }>;
}

export function parseFargoEsf(value: string | undefined | null): FargoEsfStore {
  if (!value) return { months: {}, sources: [] };
  try {
    const v = JSON.parse(value) as Partial<FargoEsfStore>;
    return { months: v.months ?? {}, sources: v.sources ?? [] };
  } catch {
    return { months: {}, sources: [] };
  }
}

export function fargoEsfRows(store: FargoEsfStore): FargoEsfIn[] {
  return Object.entries(store.months).flatMap(([monthId, byProduct]) =>
    Object.entries(byProduct).map(([productId, x]) => ({ monthId, productId, qty: x.qty, amount: x.amount }))
  );
}
