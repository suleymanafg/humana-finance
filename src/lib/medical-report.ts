// A medical rep's own report (Excel), for the medical director to hand out:
// their prescriptions month by month (foils, paid, doctors), every doctor with
// the rate and foils per month, every foil line, and Humana sales in tins in
// the regions they work in. One rep, or every rep as a zip of workbooks.
import JSZip from "jszip";
import { prisma } from "./db";
import { buildWorkbook, MONEY, type SheetSpec } from "./excel";
import { medicalData, type MedicalData, type MedGroup } from "./medical-data";
import { UZ_REGIONS } from "./uz-map";

const RU_MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const monthName = (m: string) => `${RU_MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const regionName = (iso: string | null) => (iso ? UZ_REGIONS.find((r) => r.iso === iso)?.nameRu ?? iso : "Регион не указан");
const day = (d: Date | null) => (d ? `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}` : "");
const GROUPS: { g: MedGroup | "ALL"; name: string }[] = [
  { g: "ALL", name: "Все товары" },
  { g: "P1", name: "Platin 1" },
  { g: "P2", name: "Platin 2" },
  { g: "P3", name: "Platin 3" },
  { g: "EXPERT", name: "Expert" },
];

export type Line = { monthKey: string; date: Date | null; regionIso: string | null; district: string; clinic: string; doctor: string; rep: string; foils: number; rate: number | null; amount: number | null; proof: string };

/** The months from `from` to `to` (YYYY-MM), at most 24. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  while (out.length < 24) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    if (k > to) break;
    out.push(k);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** The workbook itself, from the lines and the medical data (pure). */
export function workbookFor(rep: string, months: string[], lines: Line[], data: MedicalData) {
  const mine = lines.filter((l) => l.rep === rep && months.includes(l.monthKey));
  const regions = [...new Set(mine.map((l) => l.regionIso))].sort((a, b) => mine.filter((l) => l.regionIso === b).length - mine.filter((l) => l.regionIso === a).length);
  const period = months.length === 1 ? monthName(months[0]) : `${monthName(months[0])} – ${monthName(months[months.length - 1])}`;
  const made = day(new Date());
  const sub = `${period} · регионы: ${regions.map(regionName).join(", ") || "—"} · сформирован ${made}`;
  const sum = (ls: Line[], k: "foils" | "amount") => ls.reduce((t, l) => t + (l[k] ?? 0), 0);

  // 1. by month
  const byMonthRows = months.map((m) => {
    const ls = mine.filter((l) => l.monthKey === m);
    return [monthName(m), sum(ls, "foils"), sum(ls, "amount"), new Set(ls.map((l) => `${l.doctor}|${l.clinic}`)).size];
  });
  const summary: SheetSpec = {
    name: "Итоги",
    title: `Отчёт медицинского представителя: ${rep}`,
    subtitle: sub,
    columns: [{ header: "Месяц", width: 22 }, { header: "Фольг (рецептов)", width: 18, numFmt: MONEY }, { header: "Выплачено врачам, сум", width: 24, numFmt: MONEY }, { header: "Врачей с рецептами", width: 20, numFmt: MONEY }],
    rows: [...byMonthRows, ["Итого", sum(mine, "foils"), sum(mine, "amount"), new Set(mine.map((l) => `${l.doctor}|${l.clinic}`)).size]],
    boldRows: [byMonthRows.length],
  };

  // 2. doctors
  const docs = new Map<string, Line[]>();
  for (const l of mine) docs.set(`${l.doctor}|${l.clinic}`, [...(docs.get(`${l.doctor}|${l.clinic}`) ?? []), l]);
  const docRows = [...docs.values()]
    .map((ls) => {
      const last = ls[ls.length - 1];
      return [last.doctor, last.clinic, last.district, regionName(last.regionIso), [...ls].reverse().find((l) => l.rate)?.rate ?? null, ...months.map((m) => sum(ls.filter((l) => l.monthKey === m), "foils") || null), sum(ls, "foils"), sum(ls, "amount")];
    })
    .sort((a, b) => (b[b.length - 2] as number) - (a[a.length - 2] as number));
  const doctors: SheetSpec = {
    name: "Врачи",
    title: `Врачи: ${rep}`,
    subtitle: period,
    columns: [
      { header: "Врач", width: 32 },
      { header: "Учреждение", width: 24 },
      { header: "Район", width: 16 },
      { header: "Регион", width: 16 },
      { header: "Ставка за фольгу, сум", width: 14, numFmt: MONEY },
      ...months.map((m) => ({ header: monthName(m), width: 11, numFmt: MONEY })),
      { header: "Итого фольг", width: 12, numFmt: MONEY },
      { header: "Выплачено, сум", width: 16, numFmt: MONEY },
    ],
    rows: [...docRows, ["Итого", "", "", "", null, ...months.map((m) => sum(mine.filter((l) => l.monthKey === m), "foils")), sum(mine, "foils"), sum(mine, "amount")]],
    boldRows: [docRows.length],
    freezeCols: 1,
  };

  // 3. every line
  const all: SheetSpec = {
    name: "Все строки",
    title: `Все строки учёта фольг: ${rep}`,
    subtitle: period,
    columns: [
      { header: "Дата", width: 12 },
      { header: "Месяц", width: 16 },
      { header: "Регион", width: 16 },
      { header: "Район", width: 16 },
      { header: "Учреждение", width: 24 },
      { header: "Врач", width: 32 },
      { header: "Ставка, сум", width: 12, numFmt: MONEY },
      { header: "Фольг", width: 9, numFmt: MONEY },
      { header: "Сумма, сум", width: 14, numFmt: MONEY },
      { header: "Подтверждение", width: 16 },
    ],
    rows: mine.map((l) => [day(l.date), monthName(l.monthKey), regionName(l.regionIso), l.district, l.clinic, l.doctor, l.rate, l.foils, l.amount, l.proof]),
  };

  // 4. sales in tins in the rep's regions
  const salesRows: SheetSpec["rows"] = [];
  const sectionRows: number[] = [];
  for (const iso of regions.filter((x): x is string => !!x && !!data.qty[x])) {
    sectionRows.push(salesRows.length);
    salesRows.push([regionName(iso), ...months.map(() => null), null]);
    for (const g of GROUPS) {
      const ids = data.products.filter((p) => g.g === "ALL" || p.group === g.g).map((p) => p.id);
      const vals = months.map((m) => ids.reduce((t, id) => t + (data.qty[iso]?.[id]?.[m] ?? 0), 0));
      salesRows.push([g.name, ...vals, vals.reduce((t, v) => t + v, 0)]);
    }
  }
  const sales: SheetSpec = {
    name: "Продажи в регионах",
    title: `Продажи Humana в регионах представителя, банок`,
    subtitle: `${period} · продажи дилерам и сетям по данным 1С`,
    columns: [{ header: "Регион / товары", width: 22 }, ...months.map((m) => ({ header: monthName(m), width: 12, numFmt: MONEY })), { header: "Итого", width: 12, numFmt: MONEY }],
    rows: salesRows.length ? salesRows : [["Продажи по этим регионам не найдены", ...months.map(() => null), null]],
    sectionRows,
    indentRows: salesRows.map((_, i) => i).filter((i) => !sectionRows.includes(i)),
  };

  return buildWorkbook([summary, doctors, all, sales]);
}

async function inputs() {
  const [data, lines] = await Promise.all([
    medicalData(),
    prisma.medFoil.findMany({ select: { monthKey: true, date: true, regionIso: true, district: true, clinic: true, doctor: true, rep: true, foils: true, rate: true, amount: true, proof: true }, orderBy: [{ date: "asc" }, { doctor: "asc" }] }),
  ]);
  return { data, lines };
}

const fileName = (rep: string, months: string[]) => `Отчёт ${rep} ${months[0]}${months.length > 1 ? `—${months[months.length - 1]}` : ""}.xlsx`.replace(/[\\/:*?"<>|]/g, "-");

/** One rep's report. */
export async function repReport(rep: string, months: string[]) {
  const { data, lines } = await inputs();
  const buffer = await workbookFor(rep, months, lines, data).xlsx.writeBuffer();
  return { buffer: new Uint8Array(buffer as ArrayBuffer), name: fileName(rep, months) };
}

/** Every rep with prescriptions in the period, one workbook each, zipped. */
export async function allRepReports(months: string[]) {
  const { data, lines } = await inputs();
  const reps = [...new Set(lines.filter((l) => months.includes(l.monthKey) && l.rep).map((l) => l.rep))].sort((a, b) => a.localeCompare(b, "ru"));
  const zip = new JSZip();
  for (const rep of reps) zip.file(fileName(rep, months), (await workbookFor(rep, months, lines, data).xlsx.writeBuffer()) as ArrayBuffer);
  const buffer = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { buffer, name: `Отчёты представителей ${months[0]}${months.length > 1 ? `—${months[months.length - 1]}` : ""}.zip`, count: reps.length };
}
