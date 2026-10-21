// What the medical director sees (/medical): by territory — Tashkent city by
// its districts, every other region as a whole — Humana sales in tins (never
// money) by product, the verified prescriptions (foils) and what was paid for
// them, so that effectiveness can be read. Only Platin 1 (400 and 800 g) and
// the special formulas (Expert) are prescribed and paid for; Platin 2 and 3 are
// never paid for — they are the babies staying on. Plus the medical reps and
// doctors behind the prescriptions, and the months a product ran out of stock
// (a stock-out is not a weak campaign). Sales take the 1C client's district
// (Tashkent city) or the channel's region; a channel's month without client
// lines comes from the channel totals. Chains have no territory and are their
// own line. Promo packs count as their regular product.
import { prisma } from "./db";
import { loadDataset } from "./data";
import { loadPlan } from "./planning/plan-data";
import { addMonths } from "./planning/compute";
import { todayInTashkent } from "./planning/data";
import { allTerritories, foilTerritory, NO_TERRITORY, saleTerritory, type Territory } from "./territories";

export { NO_TERRITORY };

export type MedGroup = "P1" | "P2" | "P3" | "EXPERT";

export interface MedicalData {
  /** the 24 months ending with the chosen one (a period of up to 12 and the one before it) */
  months: string[];
  thisMonth: string;
  /** today in Tashkent, YYYY-MM-DD — how far the running month has got */
  today: string;
  /** the month chosen at the top — the last month of the period and of the tables */
  endMonth: string;
  /** `prescribed` — paid for when prescribed (Platin 1 and the special formulas) */
  products: { id: string; name: string; group: MedGroup; prescribed: boolean }[];
  /** territories with sales or prescriptions in the months, Tashkent districts first */
  territories: Territory[];
  /** territory key (or NO_TERRITORY) -> product id -> month -> tins */
  sales: Record<string, Record<string, Record<string, number>>>;
  /** territory -> month -> foils / UZS paid */
  foils: Record<string, Record<string, number>>;
  paid: Record<string, Record<string, number>>;
  /** months with foil lines loaded (the file is uploaded after the month) */
  foilMonths: string[];
  /** each medical rep: the territories with at least a tenth of their foils (most first), foils and paid by month, and by territory */
  reps: {
    name: string;
    territories: string[];
    foils: Record<string, number>;
    paid: Record<string, number>;
    byTerritory: Record<string, { foils: Record<string, number>; paid: Record<string, number> }>;
  }[];
  /** each prescribing doctor (by name and clinic); the latest rate per foil */
  doctors: { doctor: string; clinic: string; district: string; territory: string | null; rep: string; rate: number | null; foils: Record<string, number>; paid: Record<string, number> }[];
  /** product id -> months it ran short of stock */
  short: Record<string, string[]>;
}

const groupOf = (name: string): MedGroup => {
  const st = name.match(/Platin\s*([123])/i)?.[1];
  return st ? (`P${st}` as MedGroup) : "EXPERT";
};
const add = (o: Record<string, number>, k: string, v: number) => {
  o[k] = (o[k] ?? 0) + v;
};
const sumOf = (o: Record<string, number>) => Object.values(o).reduce((t, x) => t + x, 0);

/** `endMonth` — the month chosen at the top (a later month than this one counts as this one). */
export async function medicalData(endMonth?: string): Promise<MedicalData> {
  const today = todayInTashkent();
  const thisMonth = today.slice(0, 7);
  const end = endMonth && endMonth < thisMonth ? endMonth : thisMonth;
  const months = Array.from({ length: 24 }, (_, i) => addMonths(end, i - 23));
  const inRange = new Set(months);

  const [ds, clientRows, plan, foilRows] = await Promise.all([
    loadDataset(),
    prisma.clientSale.findMany({
      where: { monthId: { in: months } },
      select: { monthId: true, productId: true, channelId: true, qty: true, clientMap: { select: { district: true } } },
    }),
    loadPlan().catch(() => null),
    prisma.medFoil
      .findMany({
        where: { monthKey: { in: months } },
        select: { monthKey: true, regionIso: true, district: true, clinic: true, doctor: true, rep: true, foils: true, rate: true, amount: true },
        orderBy: { date: "asc" },
      })
      .catch(() => [] as { monthKey: string; regionIso: string | null; district: string; clinic: string; doctor: string; rep: string; foils: number; rate: number | null; amount: number | null }[]),
  ]);

  // regular products only; a promo pack is sold as its regular product
  const regularOf = new Map(ds.products.map((p) => [p.id, p.isPromo && p.regularProductId ? p.regularProductId : p.id]));
  const order: Record<MedGroup, number> = { P1: 1, EXPERT: 2, P2: 3, P3: 4 };
  const products = ds.products
    .filter((p) => !p.isPromo && (p.productLine === "Platin" || p.productLine === "Expert" || /platin|expert/i.test(p.nameRu)))
    // "Humana Platin 1 MP 400 гр х 4 шт" → "Platin 1 400 гр": no brand, recipe code or case size
    .map((p) => ({ id: p.id, name: p.nameRu.replace(/^Humana\s+/i, "").replace(/\s*[хx]\s*\d+\s*шт\.?\s*$/i, "").replace(/\s+(MP|FS|BIB|DS)\b/g, ""), group: groupOf(p.nameRu), sort: p.sortOrder }))
    .sort((a, b) => order[a.group] - order[b.group] || a.sort - b.sort)
    .map(({ id, name, group }) => ({ id, name, group, prescribed: group === "P1" || group === "EXPERT" }));
  const productIds = new Set(products.map((p) => p.id));

  // sales by territory: a channel's client lines where it has them that month, else its total
  const sales: MedicalData["sales"] = {};
  const put = (terr: string | null, productId: string, m: string, q: number) => {
    const pid = regularOf.get(productId) ?? productId;
    if (productIds.has(pid)) add(((sales[terr ?? NO_TERRITORY] ??= {})[pid] ??= {}), m, q);
  };
  const channelName = new Map(ds.channels.map((c) => [c.id, c.name]));
  const withClients = new Set(clientRows.map((r) => `${r.monthId}|${r.channelId}`));
  for (const r of clientRows) put(saleTerritory(channelName.get(r.channelId) ?? "", r.clientMap.district), r.productId, r.monthId, r.qty);
  for (const s of ds.sales) {
    if (!inRange.has(s.monthId) || withClients.has(`${s.monthId}|${s.channelId}`)) continue;
    put(saleTerritory(channelName.get(s.channelId) ?? "", null), s.productId, s.monthId, s.qty);
  }

  // prescriptions and spend by territory, rep and doctor
  const foils: MedicalData["foils"] = {};
  const paid: MedicalData["paid"] = {};
  const foilMonths = new Set<string>();
  const repMap = new Map<string, { foils: Record<string, number>; paid: Record<string, number>; byTerritory: MedicalData["reps"][number]["byTerritory"] }>();
  const docMap = new Map<string, MedicalData["doctors"][number]>();
  for (const f of foilRows) {
    foilMonths.add(f.monthKey);
    const terr = foilTerritory(f.regionIso, f.district);
    const amt = f.amount ?? 0;
    if (terr) {
      add((foils[terr] ??= {}), f.monthKey, f.foils);
      add((paid[terr] ??= {}), f.monthKey, amt);
    }
    const rname = f.rep || "—";
    const r = repMap.get(rname) ?? { foils: {}, paid: {}, byTerritory: {} };
    add(r.foils, f.monthKey, f.foils);
    add(r.paid, f.monthKey, amt);
    if (terr) {
      const bt = (r.byTerritory[terr] ??= { foils: {}, paid: {} });
      add(bt.foils, f.monthKey, f.foils);
      add(bt.paid, f.monthKey, amt);
    }
    repMap.set(rname, r);
    const dk = `${f.doctor}|${f.clinic}`;
    const d = docMap.get(dk) ?? { doctor: f.doctor || "—", clinic: f.clinic, district: f.district, territory: terr, rep: f.rep, rate: null, foils: {}, paid: {} };
    add(d.foils, f.monthKey, f.foils);
    add(d.paid, f.monthKey, amt);
    if (f.rate) d.rate = f.rate; // lines come by date: the latest rate stays
    docMap.set(dk, d);
  }
  const reps = [...repMap.entries()]
    .map(([name, r]) => ({
      name,
      territories: Object.entries(r.byTerritory)
        .map(([k, v]) => [k, sumOf(v.foils)] as const)
        .filter(([, v]) => v >= 0.1 * sumOf(r.foils))
        .sort((a, b) => b[1] - a[1])
        .map(([k]) => k),
      foils: r.foils,
      paid: r.paid,
      byTerritory: r.byTerritory,
    }))
    .sort((a, b) => sumOf(b.foils) - sumOf(a.foils));
  const doctors = [...docMap.values()].sort((a, b) => sumOf(b.foils) - sumOf(a.foils));

  const used = new Set([...Object.keys(sales), ...Object.keys(foils)]);
  const territories = allTerritories().filter((t) => used.has(t.key));

  // stock-outs from the supply plan's marks (the planning SKU is linked to the product)
  const short: MedicalData["short"] = {};
  if (plan) {
    for (const sku of plan.skus) {
      const ms = Object.entries(plan.engine.short[sku.id] ?? {}).filter(([m, v]) => v && inRange.has(m)).map(([m]) => m);
      if (ms.length && productIds.has(sku.productId)) short[sku.productId] = ms.sort();
    }
  }
  return { months, thisMonth, today, endMonth: end, products, territories, sales, foils, paid, foilMonths: [...foilMonths].sort(), reps, doctors, short };
}
