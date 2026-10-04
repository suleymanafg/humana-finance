// Cost of goods, first in, first out, at two levels:
//   TI     — trucks (landed cost) are used up by TI's invoices to Fargo and by
//            TI's write-offs, in date order;
//   Fargo  — TI's invoice lines are used up by Fargo's sales, and by the units
//            missing at each stock count. Every invoice line also carries its
//            TI cost, so the same draw gives the group's cost at TI landed cost.
import { FifoCurve } from "./fifo";
import type {
  Dataset,
  FifoMonth,
  InvoiceLineCost,
  ProductFifo,
  ShipmentCost,
  StockMonth,
  WriteOffCost,
} from "./types";

export const monthOf = (iso: string): string => iso.slice(0, 7);

/** Import VAT paid at customs is TI's input VAT, not part of landed cost. */
export const isImportVat = (categoryName: string): boolean => /НДС|VAT/i.test(categoryName);

/** Promo SKUs are costed as their regular SKU. */
export function costProductResolver(ds: Dataset): (productId: string) => string {
  const regular = new Map(ds.products.map((p) => [p.id, p.isPromo && p.regularProductId ? p.regularProductId : p.id]));
  return (productId) => regular.get(productId) ?? productId;
}

export function computeShipments(ds: Dataset, costOf: (id: string) => string): ShipmentCost[] {
  const expenses = new Map<string, number>();
  const importVat = new Map<string, number>();
  for (const e of ds.importExpenses) {
    const target = isImportVat(e.categoryName) ? importVat : expenses;
    target.set(e.shipmentId, (target.get(e.shipmentId) ?? 0) + e.amount);
  }
  return ds.shipments.map((sh) => {
    const lines = sh.lines.map((l) => {
      const priceUzs = l.priceEur * l.rate;
      return { ...l, costProductId: costOf(l.productId), priceUzs, purchaseAmount: priceUzs * l.qty };
    });
    const purchaseTotal = lines.reduce((s, l) => s + l.purchaseAmount, 0);
    const expenseTotal = expenses.get(sh.id) ?? 0;
    const own = lines.filter((l) => l.fixedUnitCost != null);
    const ownPurchase = own.reduce((s, l) => s + l.purchaseAmount, 0);
    const ownLanded = own.reduce((s, l) => s + l.qty * (l.fixedUnitCost ?? 0), 0);
    const base = purchaseTotal - ownPurchase;
    const loadFactor = base > 0 ? (purchaseTotal + expenseTotal - ownLanded) / base : 1;
    const costed = lines.map((l) => {
      const unitCost = l.fixedUnitCost ?? l.priceUzs * loadFactor;
      return { ...l, unitCost, landedValue: unitCost * l.qty, inFifo: l.fixedUnitCost == null };
    });
    return {
      shipmentId: sh.id,
      code: sh.code,
      monthId: sh.monthId,
      status: sh.status,
      units: lines.reduce((s, l) => s + l.qty, 0),
      purchaseEur: lines.reduce((s, l) => s + l.priceEur * l.qty, 0),
      purchaseTotal,
      expenseTotal,
      importVat: importVat.get(sh.id) ?? 0,
      loadFactor,
      landedTotal: purchaseTotal + expenseTotal,
      lines: costed,
    };
  });
}

/** Arrived trucks in arrival order: by month, then the order they were entered. */
export function arrivedInOrder(shipments: ShipmentCost[]): ShipmentCost[] {
  return shipments
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.status === "ARRIVED")
    .sort((a, b) => (a.s.monthId === b.s.monthId ? a.i - b.i : a.s.monthId < b.s.monthId ? -1 : 1))
    .map(({ s }) => s);
}

/** Invoice lines in the order Fargo receives them: by date, then line order. */
export function invoicesInOrder<T extends { date: string; sortOrder: number }>(lines: T[]): T[] {
  return lines
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      const da = a.l.date.slice(0, 10);
      const db = b.l.date.slice(0, 10);
      if (da !== db) return da < db ? -1 : 1;
      if (a.l.sortOrder !== b.l.sortOrder) return a.l.sortOrder - b.l.sortOrder;
      return a.i - b.i;
    })
    .map(({ l }) => l);
}

export interface TiCosting {
  invoices: InvoiceLineCost[];
  writeOffs: WriteOffCost[];
  tiBatches: Map<string, ProductFifo["tiBatches"]>;
  /** units TI drew beyond the arrived trucks, per product */
  overdrawn: Map<string, number>;
}

export function computeTiCosting(
  ds: Dataset,
  arrived: ShipmentCost[],
  costOf: (id: string) => string
): TiCosting {
  const tiBatches = new Map<string, ProductFifo["tiBatches"]>();
  for (const sh of arrived) {
    for (const l of sh.lines) {
      if (!l.inFifo) continue;
      const list = tiBatches.get(l.costProductId) ?? [];
      list.push({
        shipmentId: sh.shipmentId,
        code: sh.code,
        monthId: sh.monthId,
        qty: l.qty,
        unitCost: l.unitCost,
        value: l.landedValue,
      });
      tiBatches.set(l.costProductId, list);
    }
  }
  const curves = new Map<string, FifoCurve>();
  const curveOf = (pid: string) => {
    let c = curves.get(pid);
    if (!c) {
      c = new FifoCurve((tiBatches.get(pid) ?? []).map((b) => ({ qty: b.qty, unit: b.unitCost })));
      curves.set(pid, c);
    }
    return c;
  };
  const capacity = (pid: string) => (tiBatches.get(pid) ?? []).reduce((s, b) => s + b.qty, 0);

  // one consumption stream per product: invoices, then write-offs on the same day
  type Event =
    | { kind: 0; date: string; order: number; line: Dataset["invoices"][number] }
    | { kind: 1; date: string; order: number; wo: Dataset["writeOffs"][number] };
  const streams = new Map<string, Event[]>();
  const push = (pid: string, e: Event) => {
    const list = streams.get(pid) ?? [];
    list.push(e);
    streams.set(pid, list);
  };
  invoicesInOrder(ds.invoices).forEach((line, order) => {
    if (line.ownUnitCost == null) push(costOf(line.productId), { kind: 0, date: line.date.slice(0, 10), order, line });
  });
  ds.writeOffs.forEach((wo, order) => push(costOf(wo.productId), { kind: 1, date: wo.date.slice(0, 10), order, wo }));

  const invoiceCost = new Map<string, number>();
  const writeOffCost = new Map<string, number>();
  const overdrawn = new Map<string, number>();
  for (const [pid, events] of streams) {
    events.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.kind !== b.kind ? a.kind - b.kind : a.order - b.order));
    const curve = curveOf(pid);
    let cum = 0;
    for (const e of events) {
      const qty = e.kind === 0 ? e.line.qty : e.wo.qty;
      const cost = qty !== 0 ? curve.between(cum, cum + qty) : 0;
      if (e.kind === 0) invoiceCost.set(e.line.id, cost);
      else writeOffCost.set(e.wo.id, cost);
      cum += qty;
    }
    const over = cum - capacity(pid);
    if (over > 1e-9) overdrawn.set(pid, over);
  }

  const invoices: InvoiceLineCost[] = ds.invoices.map((line) => {
    const outsideFifo = line.ownUnitCost != null;
    const tiCost = outsideFifo ? line.qty * (line.ownUnitCost ?? 0) : invoiceCost.get(line.id) ?? 0;
    return {
      ...line,
      monthId: monthOf(line.date),
      costProductId: costOf(line.productId),
      tiCost,
      tiUnitCost: line.qty !== 0 ? tiCost / line.qty : 0,
      outsideFifo,
      totalInclVat: line.amount + line.vat,
    };
  });
  const writeOffs: WriteOffCost[] = ds.writeOffs.map((wo) => {
    const value = writeOffCost.get(wo.id) ?? 0;
    return {
      ...wo,
      monthId: monthOf(wo.date),
      costProductId: costOf(wo.productId),
      value,
      unitCost: wo.qty !== 0 ? value / wo.qty : 0,
    };
  });
  return { invoices, writeOffs, tiBatches, overdrawn };
}

export interface FargoCosting {
  fifo: Record<string, ProductFifo>;
  stock: StockMonth[];
  /** products whose sales + count shortfall ran past the units TI invoiced */
  oversold: Array<{ productId: string; monthId: string; units: number }>;
}

export function computeFargoCosting(
  ds: Dataset,
  monthIds: string[],
  arrived: ShipmentCost[],
  ti: TiCosting,
  costOf: (id: string) => string
): FargoCosting {
  const knownProducts = new Set(ds.products.map((p) => p.id));
  const productIds = new Set<string>();
  for (const p of ds.products) productIds.add(costOf(p.id));

  // per product, per month: units sold, invoiced, counted, written off, arrived
  const bump = (m: Map<string, Map<string, number>>, pid: string, month: string, v: number) => {
    const inner = m.get(pid) ?? new Map<string, number>();
    inner.set(month, (inner.get(month) ?? 0) + v);
    m.set(pid, inner);
  };
  const sold = new Map<string, Map<string, number>>();
  for (const s of ds.sales) {
    if (!knownProducts.has(s.productId)) continue;
    bump(sold, costOf(s.productId), s.monthId, s.qty);
  }
  const invoicedUnits = new Map<string, Map<string, number>>();
  const invoicedValue = new Map<string, Map<string, number>>();
  const invoicedTi = new Map<string, Map<string, number>>();
  for (const line of ti.invoices) {
    bump(invoicedUnits, line.costProductId, line.monthId, line.qty);
    bump(invoicedValue, line.costProductId, line.monthId, line.amount);
    bump(invoicedTi, line.costProductId, line.monthId, line.tiCost);
  }
  const writtenUnits = new Map<string, Map<string, number>>();
  const writtenValue = new Map<string, Map<string, number>>();
  for (const wo of ti.writeOffs) {
    bump(writtenUnits, wo.costProductId, wo.monthId, wo.qty);
    bump(writtenValue, wo.costProductId, wo.monthId, wo.value);
  }
  const arrivedUnits = new Map<string, Map<string, number>>();
  const arrivedValue = new Map<string, Map<string, number>>();
  for (const sh of arrived) {
    for (const l of sh.lines) {
      bump(arrivedUnits, l.costProductId, sh.monthId, l.qty);
      bump(arrivedValue, l.costProductId, sh.monthId, l.landedValue);
    }
  }
  const counted = new Map<string, Map<string, number>>();
  const countMonths = new Set<string>();
  for (const c of ds.stockCounts) {
    // a month is counted once it has a non-zero figure; rows that are all zero
    // are placeholders, not a count of an empty warehouse
    if (c.qty !== 0) countMonths.add(c.monthId);
    bump(counted, costOf(c.productId), c.monthId, c.qty);
  }

  // invoice lines as Fargo's batches
  const fargoBatches = new Map<string, ProductFifo["fargoBatches"]>();
  for (const line of invoicesInOrder(ti.invoices)) {
    const list = fargoBatches.get(line.costProductId) ?? [];
    list.push({
      lineId: line.id,
      date: line.date,
      number: line.number,
      qty: line.qty,
      price: line.qty !== 0 ? line.amount / line.qty : 0,
      value: line.amount,
      tiUnitCost: line.qty !== 0 ? line.tiCost / line.qty : 0,
      tiValue: line.tiCost,
    });
    fargoBatches.set(line.costProductId, list);
  }

  const cumulative = (m: Map<string, Map<string, number>>, pid: string, upTo: string) => {
    let total = 0;
    for (const [month, v] of m.get(pid) ?? []) if (month <= upTo) total += v;
    return total;
  };

  const fifo: Record<string, ProductFifo> = {};
  const oversold: FargoCosting["oversold"] = [];
  const sortedCountMonths = [...countMonths].sort();
  const latestCountAtOrBefore = (month: string) => {
    let found: string | null = null;
    for (const c of sortedCountMonths) if (c <= month) found = c;
    return found;
  };

  for (const pid of productIds) {
    const batches = fargoBatches.get(pid) ?? [];
    const atInvoice = new FifoCurve(batches.map((b) => ({ qty: b.qty, unit: b.price })));
    const atTi = new FifoCurve(batches.map((b) => ({ qty: b.qty, unit: b.tiUnitCost })));
    const diffAt = (countMonth: string | null): number => {
      if (!countMonth) return 0;
      const book = cumulative(invoicedUnits, pid, countMonth) - cumulative(sold, pid, countMonth);
      const count = counted.get(pid)?.get(countMonth) ?? 0;
      return book - count;
    };
    const months: Record<string, FifoMonth> = {};
    let prevCumSold = 0;
    let prevDiff = 0;
    let reported = false;
    for (const m of monthIds) {
      const cumSold = cumulative(sold, pid, m);
      const diff = diffAt(latestCountAtOrBefore(m));
      const fargoCogs = atInvoice.between(prevCumSold + prevDiff, cumSold + prevDiff);
      const fargoLoss = atInvoice.between(cumSold + prevDiff, cumSold + diff);
      const groupCogs = atTi.between(prevCumSold + prevDiff, cumSold + prevDiff);
      const groupLoss = atTi.between(cumSold + prevDiff, cumSold + diff);
      const unitsSold = cumSold - prevCumSold;
      const invoicedCum = cumulative(invoicedUnits, pid, m);
      const used = cumSold + diff;
      if (!reported && used - invoicedCum > 1e-9 && (cumSold !== 0 || invoicedCum !== 0)) {
        oversold.push({ productId: pid, monthId: m, units: used - invoicedCum });
        reported = true;
      }
      const arrivedCum = cumulative(arrivedUnits, pid, m);
      const writtenCum = cumulative(writtenUnits, pid, m);
      months[m] = {
        unitsSold,
        cumSold,
        cumCountDiff: diff,
        fargoCogs,
        fargoLoss,
        groupCogs,
        groupLoss,
        fargoUnitCost: unitsSold !== 0 ? fargoCogs / unitsSold : 0,
        groupUnitCost: unitsSold !== 0 ? groupCogs / unitsSold : 0,
        fargoStock: cumulative(invoicedValue, pid, m) - atInvoice.valueAt(used),
        fargoStockTi: cumulative(invoicedTi, pid, m) - atTi.valueAt(used),
        fargoStockUnits: invoicedCum - used,
        tiStock:
          cumulative(arrivedValue, pid, m) - cumulative(invoicedTi, pid, m) - cumulative(writtenValue, pid, m),
        tiStockUnits: arrivedCum - invoicedCum - writtenCum,
        invoicedUnits: invoicedCum,
        arrivedUnits: arrivedCum,
      };
      prevCumSold = cumSold;
      prevDiff = diff;
    }
    fifo[pid] = { productId: pid, tiBatches: ti.tiBatches.get(pid) ?? [], fargoBatches: batches, months };
  }

  const stock: StockMonth[] = monthIds.map((m) => {
    const isCountMonth = countMonths.has(m);
    return {
      monthId: m,
      isCountMonth,
      products: [...productIds].map((pid) => {
        const f = fifo[pid].months[m];
        const invoiced = cumulative(invoicedUnits, pid, m);
        const soldCum = cumulative(sold, pid, m);
        const book = invoiced - soldCum;
        const count = isCountMonth ? counted.get(pid)?.get(m) ?? 0 : null;
        return {
          productId: pid,
          arrived: f.arrivedUnits,
          invoiced,
          sold: soldCum,
          writtenOff: cumulative(writtenUnits, pid, m),
          tiUnits: f.tiStockUnits,
          fargoBook: book,
          counted: count,
          difference: count == null ? null : book - count,
          cumDifference: f.cumCountDiff,
        };
      }),
    };
  });

  return { fifo, stock, oversold };
}
