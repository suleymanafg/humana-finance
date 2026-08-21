import { loadPlanning } from "@/lib/planning/data";
import { addMonths, monthKeyOf, nextOrderSlot, projectSku, recommendQty } from "@/lib/planning/compute";
import InventoryView, { type InventoryRow, type PipelineEvent } from "@/components/InventoryView";

export const dynamic = "force-dynamic";

const HORIZON = 16;

/** Months until the ledger first goes negative, arrivals included — the
 *  honest pipeline cover (fractional inside the stockout month). */
function monthsUntilStockout(cells: Array<{ closing: number; demand: number }>): number | null {
  let prev = 0;
  for (const [i, c] of cells.entries()) {
    if (c.closing < 0) {
      const frac = c.demand > 0 ? Math.max(0, prev + Math.max(0, c.closing + c.demand)) / c.demand : 0;
      return i + Math.min(1, frac);
    }
    prev = c.closing;
  }
  return null; // survives the whole horizon
}

/** The 20th-of-month deadline for a given ship month (order = ship − 4). */
function deadlineOf(shipMonth: string, today: Date): { date: string; daysLeft: number } {
  const orderMonth = addMonths(shipMonth, -4);
  const [y, m] = orderMonth.split("-").map(Number);
  const d = new Date(y, m - 1, 20);
  return {
    date: `${orderMonth}-20`,
    daysLeft: Math.ceil((d.getTime() - today.getTime()) / 86_400_000),
  };
}

export default async function InventoryPage() {
  const data = await loadPlanning();
  const today = new Date();
  const slot = nextOrderSlot(today, data.settings);
  const startMonth = monthKeyOf(today);

  const rows: InventoryRow[] = [];
  for (const sku of data.skus.filter((s) => s.active)) {
    const sit = data.situations[sku.id];
    const proj = projectSku(sit, startMonth, HORIZON, data.settings);
    if (proj.currentStock <= 0 && proj.runRatePerMonth <= 0 && proj.avgDemandPerMonth <= 0) continue;

    // pipeline events: trucks on the road + committed orders still to ship
    const events: PipelineEvent[] = [];
    for (const t of data.transit) {
      const q = t.units[sku.id] ?? 0;
      if (q > 0) events.push({ month: t.etaMonth, qty: q, kind: "transit", label: t.code });
    }
    for (const [ship, q] of Object.entries(data.purchases[sku.id] ?? {})) {
      if (ship >= startMonth && q > 0) events.push({ month: addMonths(ship, 1), qty: q, kind: "order", label: null });
    }
    events.sort((a, b) => a.month.localeCompare(b.month));

    const bare = projectSku({ ...sit, arrivals: {} }, startMonth, HORIZON, data.settings);
    const pipeCover = monthsUntilStockout(proj.cells);
    const stockoutMonth = proj.stockoutMonth;

    // the slot that must cover the gap; unfixable when the gap starts before
    // anything newly ordered can land
    const needMonth = proj.riskMonth ?? stockoutMonth;
    let orderSlotShip: string | null = null;
    let fixable = true;
    if (needMonth) {
      if (needMonth < slot.arrivalMonth) {
        fixable = stockoutMonth === null || stockoutMonth >= slot.arrivalMonth;
        orderSlotShip = slot.shipMonth;
      } else {
        orderSlotShip = addMonths(needMonth, -1) < slot.shipMonth ? slot.shipMonth : addMonths(needMonth, -1);
      }
    }
    const slotDeadline = orderSlotShip ? deadlineOf(orderSlotShip, today) : null;
    const recommendedNext = recommendQty(proj, sku, slot.arrivalMonth, data.settings);

    rows.push({
      skuId: sku.id,
      name: sku.name,
      article: sku.article,
      stage: data.model.stageBySku[sku.id] ?? null,
      stock: proj.currentStock,
      stockAsOf: proj.stockAsOf,
      demandPerMonth: Math.round(proj.avgDemandPerMonth),
      coverOnHand: bare.currentCover,
      coverWithPipeline: pipeCover, // null = survives the whole horizon
      pipeline: events,
      stockoutMonth,
      fixable,
      orderSlotShip,
      slotDeadlineDate: slotDeadline?.date ?? null,
      slotDeadlineDays: slotDeadline?.daysLeft ?? null,
      recommendedNext,
      trajectory: proj.cells.slice(0, 12).map((c) => ({
        month: c.monthKey,
        closing: Math.round(c.closing),
        arrival: c.arrivals > 0,
      })),
      priceEur: sku.priceEur,
      pcsPerPallet: sku.pcsPerPallet,
    });
  }

  // worst first: unfixable, then shortest pipeline cover
  rows.sort(
    (a, b) =>
      Number(a.fixable) - Number(b.fixable) ||
      (a.coverWithPipeline ?? 99) - (b.coverWithPipeline ?? 99)
  );

  // what the CURRENT slot needs in total (its deadline is the page's clock)
  const dueNow = rows.filter((r) => r.recommendedNext > 0 && r.orderSlotShip === slot.shipMonth);
  const slotTotals = {
    skuCount: dueNow.length,
    units: dueNow.reduce((s, r) => s + r.recommendedNext, 0),
    pallets: dueNow.reduce((s, r) => s + (r.pcsPerPallet > 0 ? r.recommendedNext / r.pcsPerPallet : 0), 0),
    eur: dueNow.reduce((s, r) => s + r.recommendedNext * r.priceEur, 0),
  };

  return (
    <InventoryView
      rows={rows}
      transit={data.transit}
      slot={slot}

      settings={data.settings}
      eurRate={data.eurRate}
      slotTotals={slotTotals}
    />
  );
}
