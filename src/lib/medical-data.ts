// What the medical team sees (/medical): Humana sales in tins — never money —
// by region and product, month by month, next to the verified prescriptions
// (foils) by region, medical rep and doctor, with what was paid for them (the
// foil file's lines — the owner shares them with the medical director), and
// the months a product ran out of
// stock marked so a stock-out is not read as a weak campaign. Regions come from the sales channels (a
// region's dealer); chains and other channels are their own rows. Promo packs
// count as their regular product.
import { prisma } from "./db";
import { loadDataset } from "./data";
import { loadPlan } from "./planning/plan-data";
import { addMonths } from "./planning/compute";
import { todayInTashkent } from "./planning/data";
import { OTHER_CHANNEL_NAMES, UZ_REGIONS } from "./uz-map";

export type MedGroup = "P1" | "P2" | "P3" | "EXPERT";

export interface MedicalData {
  months: string[];
  thisMonth: string;
  /** the month chosen at the top — the last month of the period and of the tables */
  endMonth: string;
  products: { id: string; name: string; group: MedGroup }[];
  areas: { key: string; nameRu: string; nameEn: string; iso: string | null; kind: "region" | "chains" | "other" }[];
  /** area key -> product id -> month -> tins */
  qty: Record<string, Record<string, Record<string, number>>>;
  /** verified prescriptions (foils) by month, the whole country */
  rx: Record<string, number>;
  /** foils by region (the map's iso; "none" — region not recognised) and month */
  foilsByRegion: Record<string, Record<string, number>>;
  /** paid for foils (UZS) by month, the whole country */
  paid: Record<string, number>;
  /** each medical rep: the regions they work in (most foils first), foils and paid by month */
  reps: { name: string; regions: string[]; byMonth: Record<string, number>; paidByMonth: Record<string, number> }[];
  /** each prescribing doctor (by name and clinic): foils and paid by month, the latest rate per foil */
  doctors: { doctor: string; clinic: string; district: string; regionIso: string | null; rep: string; rate: number | null; byMonth: Record<string, number>; paidByMonth: Record<string, number> }[];
  /** product id -> months it ran short of stock */
  short: Record<string, string[]>;
}

const groupOf = (name: string): MedGroup => {
  const st = name.match(/Platin\s*([123])/i)?.[1];
  return st ? (`P${st}` as MedGroup) : "EXPERT";
};

/** `endMonth` — the month chosen at the top (a later month than this one counts as this one). */
export async function medicalData(endMonth?: string): Promise<MedicalData> {
  const [ds, recruitment, plan, foilRows] = await Promise.all([
    loadDataset(),
    prisma.planningRecruitment.findMany(),
    loadPlan().catch(() => null),
    prisma.medFoil
      .findMany({ select: { monthKey: true, date: true, regionIso: true, district: true, clinic: true, doctor: true, rep: true, foils: true, rate: true, amount: true }, orderBy: { date: "asc" } })
      .catch(() => [] as { monthKey: string; date: Date | null; regionIso: string | null; district: string; clinic: string; doctor: string; rep: string; foils: number; rate: number | null; amount: number | null }[]),
  ]);
  const thisMonth = todayInTashkent().slice(0, 7);
  const end = endMonth && endMonth < thisMonth ? endMonth : thisMonth;
  const months = Array.from({ length: 12 }, (_, i) => addMonths(end, i - 11));

  // regular products only; a promo pack is sold as its regular product
  const regularOf = new Map(ds.products.map((p) => [p.id, p.isPromo && p.regularProductId ? p.regularProductId : p.id]));
  const shown = ds.products.filter((p) => !p.isPromo && (p.productLine === "Platin" || p.productLine === "Expert" || /platin|expert/i.test(p.nameRu)));
  const order: Record<MedGroup, number> = { P1: 1, P2: 2, P3: 3, EXPERT: 4 };
  const products = shown
    .map((p) => ({ id: p.id, name: p.nameRu.replace(/^Humana\s+/i, ""), group: groupOf(p.nameRu), sort: p.sortOrder }))
    .sort((a, b) => order[a.group] - order[b.group] || a.sort - b.sort)
    .map(({ id, name, group }) => ({ id, name, group }));
  const productIds = new Set(products.map((p) => p.id));

  // areas: map regions with their channels, then chains, then other channels
  const channelArea = new Map<string, string>();
  const areas: MedicalData["areas"] = [];
  for (const r of UZ_REGIONS) {
    const ids = ds.channels.filter((c) => r.channels.includes(c.name)).map((c) => c.id);
    if (!ids.length) continue;
    areas.push({ key: r.iso, nameRu: r.nameRu, nameEn: r.nameEn, iso: r.iso, kind: "region" });
    for (const id of ids) channelArea.set(id, r.iso);
  }
  areas.push({ key: "chains", nameRu: "Сети (Корзинка и другие)", nameEn: "Chains (Korzinka and others)", iso: null, kind: "chains" });
  areas.push({ key: "other", nameRu: "Прочие каналы", nameEn: "Other channels", iso: null, kind: "other" });
  for (const c of ds.channels) if (!channelArea.has(c.id)) channelArea.set(c.id, OTHER_CHANNEL_NAMES.has(c.name) ? "other" : "chains");

  const qty: MedicalData["qty"] = Object.fromEntries(areas.map((a) => [a.key, {}]));
  const inRange = new Set(months);
  for (const s of ds.sales) {
    if (!inRange.has(s.monthId)) continue;
    const pid = regularOf.get(s.productId) ?? s.productId;
    if (!productIds.has(pid)) continue;
    const area = channelArea.get(s.channelId) ?? "other";
    const byProduct = (qty[area][pid] ??= {});
    byProduct[s.monthId] = (byProduct[s.monthId] ?? 0) + s.qty;
  }

  // prescriptions: the file's lines where loaded, else the monthly totals
  const foilsByRegion: MedicalData["foilsByRegion"] = {};
  const repMap = new Map<string, { byMonth: Record<string, number>; paidByMonth: Record<string, number>; byRegion: Record<string, number> }>();
  const paid: Record<string, number> = {};
  const docMap = new Map<string, MedicalData["doctors"][number]>();
  const rxFromLines: Record<string, number> = {};
  for (const f of foilRows) {
    if (!inRange.has(f.monthKey)) continue;
    const iso = f.regionIso ?? "none";
    const byM = (foilsByRegion[iso] ??= {});
    byM[f.monthKey] = (byM[f.monthKey] ?? 0) + f.foils;
    rxFromLines[f.monthKey] = (rxFromLines[f.monthKey] ?? 0) + f.foils;
    const amt = f.amount ?? 0;
    paid[f.monthKey] = (paid[f.monthKey] ?? 0) + amt;
    const rname = f.rep || "—";
    const r = repMap.get(rname) ?? { byMonth: {}, paidByMonth: {}, byRegion: {} };
    r.byMonth[f.monthKey] = (r.byMonth[f.monthKey] ?? 0) + f.foils;
    r.paidByMonth[f.monthKey] = (r.paidByMonth[f.monthKey] ?? 0) + amt;
    r.byRegion[iso] = (r.byRegion[iso] ?? 0) + f.foils;
    repMap.set(rname, r);
    const dk = `${f.doctor}|${f.clinic}`;
    const d = docMap.get(dk) ?? { doctor: f.doctor || "—", clinic: f.clinic, district: f.district, regionIso: f.regionIso, rep: f.rep, rate: null, byMonth: {}, paidByMonth: {} };
    d.byMonth[f.monthKey] = (d.byMonth[f.monthKey] ?? 0) + f.foils;
    d.paidByMonth[f.monthKey] = (d.paidByMonth[f.monthKey] ?? 0) + amt;
    if (f.rate) d.rate = f.rate; // lines come by date: the latest rate stays
    docMap.set(dk, d);
  }
  const reps = [...repMap.entries()]
    .map(([name, r]) => ({ name, regions: Object.entries(r.byRegion).sort((a, b) => b[1] - a[1]).map(([iso]) => iso), byMonth: r.byMonth, paidByMonth: r.paidByMonth }))
    .sort((a, b) => Object.values(b.byMonth).reduce((t, x) => t + x, 0) - Object.values(a.byMonth).reduce((t, x) => t + x, 0));
  const doctors = [...docMap.values()];
  const rx = foilRows.length
    ? rxFromLines
    : Object.fromEntries(recruitment.filter((r) => inRange.has(r.monthKey)).map((r) => [r.monthKey, r.babies]));

  // stock-outs from the supply plan's marks (the planning SKU is linked to the product)
  const short: MedicalData["short"] = {};
  if (plan) {
    for (const sku of plan.skus) {
      const ms = Object.entries(plan.engine.short[sku.id] ?? {}).filter(([m, v]) => v && inRange.has(m)).map(([m]) => m);
      if (ms.length && productIds.has(sku.productId)) short[sku.productId] = ms.sort();
    }
  }
  return { months, thisMonth, endMonth: end, products, areas, qty, rx, paid, foilsByRegion, reps, doctors, short };
}
