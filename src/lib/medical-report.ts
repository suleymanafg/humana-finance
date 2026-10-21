// A medical rep's own report (Excel), for the medical director to hand out: how
// the rep's work went over time — month by month their prescriptions, doctors
// and pay-outs next to the sales of the territories they work in and the tins
// per prescription there; each territory's sales against the rep's and
// everyone's prescriptions; the doctors by territory with the rate and
// prescriptions per month; every foil line. Russian or English (the app's
// language). One rep, or every rep as a zip of workbooks.
import JSZip from "jszip";
import { prisma } from "./db";
import { buildWorkbook, MONEY, MONEY2, PCT, type SheetSpec } from "./excel";
import { medicalData, type MedicalData } from "./medical-data";
import { effectOf, sumMonths, VERDICTS } from "./medical-effect";
import { foilTerritory, territoryName } from "./territories";

export type Lang = "ru" | "en";
export type Line = { monthKey: string; date: Date | null; regionIso: string | null; district: string; clinic: string; doctor: string; rep: string; foils: number; rate: number | null; amount: number | null; proof: string };

const MONTHS: Record<Lang, string[]> = {
  ru: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

const TEXT = {
  ru: {
    report: "Отчёт медицинского представителя",
    made: "сформирован",
    territories: "территории",
    verdict: (n: number) => `Итог за последние ${n} мес. против предыдущих ${n}`,
    terrSalesCap: "Продажи территорий",
    perRxCap: "Банок на рецепт",
    result: "Итог",
    summary: "Итоги",
    month: "Месяц",
    yourRx: "Ваши рецепты",
    doctorsWithRx: "Врачей с рецептами",
    paid: "Выплачено врачам, сум",
    terrTins: "Продажи территорий, банок",
    allRx: "Рецептов всех представителей на территориях",
    share: "Ваша доля рецептов",
    tinsPerRx: "Банок на рецепт",
    total: "Итого",
    terrSheet: "Территории",
    terrTitle: "Продажи территорий и рецепты",
    terrSub: "продажи дилерам и аптекам по данным 1С, в банках; сети (Korzinka и др.) по территориям не делятся",
    tinsAll: "Продано, банок",
    tinsP1: "из них Platin 1",
    rxYours: "Рецептов — ваши",
    rxAll: "Рецептов — все представители",
    doctors: "Врачи",
    doctorsTitle: "Врачи по территориям",
    doctor: "Врач",
    clinic: "Учреждение",
    district: "Район (как в учёте)",
    rate: "Ставка за рецепт, сум",
    totalRx: "Итого рецептов",
    paidShort: "Выплачено, сум",
    lines: "Все строки",
    linesTitle: "Все строки учёта фольг",
    date: "Дата",
    territory: "Территория",
    foils: "Рецептов (фольг)",
    amount: "Сумма, сум",
    proof: "Подтверждение",
    noRegion: "Регион не указан",
    none: "Нет данных за период",
    file: "Отчёт",
    zip: "Отчёты представителей",
  },
  en: {
    report: "Medical rep's report",
    made: "made",
    territories: "territories",
    verdict: (n: number) => `The last ${n} months against the ${n} before`,
    terrSalesCap: "Territory sales",
    perRxCap: "Tins per prescription",
    result: "Verdict",
    summary: "Summary",
    month: "Month",
    yourRx: "Your prescriptions",
    doctorsWithRx: "Doctors prescribing",
    paid: "Paid to doctors, UZS",
    terrTins: "Territory sales, tins",
    allRx: "Prescriptions of all reps in the territories",
    share: "Your share of prescriptions",
    tinsPerRx: "Tins per prescription",
    total: "Total",
    terrSheet: "Territories",
    terrTitle: "Territory sales and prescriptions",
    terrSub: "sales to dealers and pharmacies from 1C, in tins; chains (Korzinka and others) are not split by territory",
    tinsAll: "Sold, tins",
    tinsP1: "of which Platin 1",
    rxYours: "Prescriptions — yours",
    rxAll: "Prescriptions — all reps",
    doctors: "Doctors",
    doctorsTitle: "Doctors by territory",
    doctor: "Doctor",
    clinic: "Clinic",
    district: "District (as recorded)",
    rate: "Rate per prescription, UZS",
    totalRx: "Total prescriptions",
    paidShort: "Paid, UZS",
    lines: "All lines",
    linesTitle: "Every foil tracking line",
    date: "Date",
    territory: "Territory",
    foils: "Prescriptions (foils)",
    amount: "Amount, UZS",
    proof: "Proof",
    noRegion: "Region not given",
    none: "No data for the period",
    file: "Report",
    zip: "Rep reports",
  },
};

const day = (d: Date | null) => (d ? `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}` : "");
const fmtRatio = (v: number | null, lang: Lang) => (v == null ? "—" : v.toFixed(1).replace(".", lang === "ru" ? "," : "."));
const fmtPct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v * 100))}%`);

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
export function workbookFor(rep: string, months: string[], lines: Line[], data: MedicalData, lang: Lang = "ru") {
  const t = TEXT[lang];
  const ru = lang === "ru";
  const monthName = (m: string) => `${MONTHS[lang][Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
  const terrName = (k: string | null) => (k ? territoryName(k, ru) : t.noRegion);
  const mine = lines.filter((l) => l.rep === rep && months.includes(l.monthKey)).map((l) => ({ ...l, territory: foilTerritory(l.regionIso, l.district) }));
  const sum = (ls: { foils: number; amount: number | null }[], k: "foils" | "amount") => ls.reduce((s, l) => s + (l[k] ?? 0), 0);

  // the rep's territories, most prescriptions first
  const byTerr = new Map<string | null, typeof mine>();
  for (const l of mine) byTerr.set(l.territory, [...(byTerr.get(l.territory) ?? []), l]);
  const terrs = [...byTerr.entries()].sort((a, b) => sum(b[1], "foils") - sum(a[1], "foils"));
  const terrKeys = terrs.map(([k]) => k).filter((k): k is string => !!k);
  const allIds = data.products.map((p) => p.id);
  const p1Ids = data.products.filter((p) => p.group === "P1").map((p) => p.id);
  const tinsIn = (keys: string[], ms: string[], ids = allIds) => keys.reduce((s, k) => s + ids.reduce((u, id) => u + sumMonths(data.sales[k]?.[id], ms), 0), 0);
  const foilsIn = (keys: string[], ms: string[]) => keys.reduce((s, k) => s + sumMonths(data.foils[k], ms), 0);
  const mineIn = (ms: string[]) => mine.filter((l) => ms.includes(l.monthKey));

  // the verdict line: the last quarter (or less) against the one before
  const n = Math.min(3, Math.floor(months.length / 2)) || 1;
  const nowMs = months.slice(-n);
  const beforeMs = months.slice(-2 * n, -n);
  const e = effectOf(
    { tins: tinsIn(terrKeys, nowMs), foils: foilsIn(terrKeys, nowMs), paid: sum(mineIn(nowMs), "amount") },
    { tins: tinsIn(terrKeys, beforeMs), foils: foilsIn(terrKeys, beforeMs), paid: sum(mineIn(beforeMs), "amount") }
  );
  const v = VERDICTS[e.verdict];
  const period = months.length === 1 ? monthName(months[0]) : `${monthName(months[0])} – ${monthName(months[months.length - 1])}`;
  const sub = `${period} · ${t.territories}: ${terrs.map(([k]) => terrName(k)).join(", ") || "—"} · ${t.made} ${day(new Date())}`;
  const n0 = (x: number) => Math.round(x).toLocaleString(ru ? "ru-RU" : "en-US");
  const verdictRows: SheetSpec["rows"] = beforeMs.length
    ? [
        [],
        [t.verdict(n)],
        [`${t.terrSalesCap}: ${fmtPct(e.salesChange)} (${n0(e.before.tins)} → ${n0(e.now.tins)})`],
        [`${t.perRxCap}: ${fmtRatio(e.perRxBefore, lang)} → ${fmtRatio(e.perRx, lang)}`],
        [`${t.result}: ${ru ? v.ru : v.en} — ${ru ? v.whyRu : v.whyEn}`],
      ]
    : [];

  // 1. month by month
  const doctorsOf = (ls: typeof mine) => new Set(ls.map((l) => `${l.doctor}|${l.clinic}`)).size;
  const monthRow = (label: string, ms: string[]) => {
    const ls = mineIn(ms);
    const yourFoils = sum(ls, "foils");
    const tins = tinsIn(terrKeys, ms);
    const allFoils = foilsIn(terrKeys, ms);
    const yourInTerr = sum(ls.filter((l) => l.territory), "foils");
    return [label, yourFoils, doctorsOf(ls), sum(ls, "amount"), tins, allFoils, allFoils ? yourInTerr / allFoils : null, allFoils ? tins / allFoils : null];
  };
  const monthRows = months.map((m) => monthRow(monthName(m), [m]));
  const summary: SheetSpec = {
    name: t.summary,
    title: `${t.report}: ${rep}`,
    subtitle: sub,
    columns: [
      { header: t.month, width: 18 },
      { header: t.yourRx, width: 14, numFmt: MONEY },
      { header: t.doctorsWithRx, width: 14, numFmt: MONEY },
      { header: t.paid, width: 18, numFmt: MONEY },
      { header: t.terrTins, width: 18, numFmt: MONEY },
      { header: t.allRx, width: 22, numFmt: MONEY },
      { header: t.share, width: 14, numFmt: PCT },
      { header: t.tinsPerRx, width: 14, numFmt: MONEY2 },
    ],
    rows: [...monthRows, monthRow(t.total, months), ...verdictRows],
    boldRows: [monthRows.length],
    sectionRows: verdictRows.length ? [monthRows.length + 2] : [],
  };

  // 2. each territory: its sales and prescriptions by month
  const terrRows: SheetSpec["rows"] = [];
  const terrSections: number[] = [];
  const terrBold: number[] = [];
  for (const [k, ls] of terrs) {
    terrSections.push(terrRows.length);
    terrRows.push([terrName(k), ...months.map(() => null), null]);
    const line = (label: string, f: (ms: string[]) => number | null) => [label, ...months.map((m) => f([m])), f(months)];
    const keys = k ? [k] : [];
    terrRows.push(line(t.tinsAll, (ms) => (k ? tinsIn(keys, ms) : null)));
    terrRows.push(line(t.tinsP1, (ms) => (k ? tinsIn(keys, ms, p1Ids) : null)));
    terrRows.push(line(t.rxYours, (ms) => sum(ls.filter((l) => ms.includes(l.monthKey)), "foils")));
    terrRows.push(line(t.rxAll, (ms) => (k ? foilsIn(keys, ms) : null)));
    terrBold.push(terrRows.length);
    terrRows.push(line(t.tinsPerRx, (ms) => { const f = k ? foilsIn(keys, ms) : 0; return f ? tinsIn(keys, ms) / f : null; }));
  }
  const territories: SheetSpec = {
    name: t.terrSheet,
    title: `${t.terrTitle}: ${rep}`,
    subtitle: `${period} · ${t.terrSub}`,
    columns: [{ header: t.territory, width: 30 }, ...months.map((m) => ({ header: monthName(m), width: 12, numFmt: MONEY })), { header: t.total, width: 12, numFmt: MONEY }],
    rows: terrRows.length ? terrRows : [[t.none, ...months.map(() => null), null]],
    sectionRows: terrSections,
    indentRows: terrRows.map((_, i) => i).filter((i) => !terrSections.includes(i)),
    rowFormats: Object.fromEntries(terrBold.map((i) => [i, MONEY2])),
  };

  // 3. doctors by territory
  const docRows: SheetSpec["rows"] = [];
  const docSections: number[] = [];
  const docTotals: number[] = [];
  for (const [k, ls] of terrs) {
    docSections.push(docRows.length);
    docRows.push([terrName(k), "", null, ...months.map(() => null), null, null]);
    const docs = new Map<string, typeof mine>();
    for (const l of ls) docs.set(`${l.doctor}|${l.clinic}`, [...(docs.get(`${l.doctor}|${l.clinic}`) ?? []), l]);
    const rows = [...docs.values()]
      .map((d) => {
        const last = d[d.length - 1];
        return [last.doctor || "—", [last.clinic, last.district].filter(Boolean).join(", "), [...d].reverse().find((l) => l.rate)?.rate ?? null, ...months.map((m) => sum(d.filter((l) => l.monthKey === m), "foils") || null), sum(d, "foils"), sum(d, "amount")];
      })
      .sort((a, b) => (b[b.length - 2] as number) - (a[a.length - 2] as number));
    docRows.push(...rows);
    docTotals.push(docRows.length);
    docRows.push([t.total, "", null, ...months.map((m) => sum(ls.filter((l) => l.monthKey === m), "foils")), sum(ls, "foils"), sum(ls, "amount")]);
  }
  const doctors: SheetSpec = {
    name: t.doctors,
    title: `${t.doctorsTitle}: ${rep}`,
    subtitle: period,
    columns: [
      { header: t.doctor, width: 32 },
      { header: t.clinic, width: 30 },
      { header: t.rate, width: 14, numFmt: MONEY },
      ...months.map((m) => ({ header: monthName(m), width: 11, numFmt: MONEY })),
      { header: t.totalRx, width: 12, numFmt: MONEY },
      { header: t.paidShort, width: 16, numFmt: MONEY },
    ],
    rows: docRows.length ? docRows : [[t.none]],
    sectionRows: docSections,
    boldRows: docTotals,
    indentRows: docRows.map((_, i) => i).filter((i) => !docSections.includes(i) && !docTotals.includes(i)),
    freezeCols: 1,
  };

  // 4. every line
  const all: SheetSpec = {
    name: t.lines,
    title: `${t.linesTitle}: ${rep}`,
    subtitle: period,
    columns: [
      { header: t.date, width: 12 },
      { header: t.month, width: 16 },
      { header: t.territory, width: 22 },
      { header: t.district, width: 16 },
      { header: t.clinic, width: 24 },
      { header: t.doctor, width: 32 },
      { header: t.rate, width: 12, numFmt: MONEY },
      { header: t.foils, width: 10, numFmt: MONEY },
      { header: t.amount, width: 14, numFmt: MONEY },
      { header: t.proof, width: 16 },
    ],
    rows: mine.map((l) => [day(l.date), monthName(l.monthKey), terrName(l.territory), l.district, l.clinic, l.doctor, l.rate, l.foils, l.amount, l.proof]),
  };

  return buildWorkbook([summary, territories, doctors, all]);
}

async function inputs(months: string[]) {
  const [data, lines] = await Promise.all([
    medicalData(months[months.length - 1]),
    prisma.medFoil.findMany({
      where: { monthKey: { in: months } },
      select: { monthKey: true, date: true, regionIso: true, district: true, clinic: true, doctor: true, rep: true, foils: true, rate: true, amount: true, proof: true },
      orderBy: [{ date: "asc" }, { doctor: "asc" }],
    }),
  ]);
  return { data, lines };
}

const span = (months: string[]) => `${months[0]}${months.length > 1 ? `—${months[months.length - 1]}` : ""}`;
const fileName = (rep: string, months: string[], lang: Lang) => `${TEXT[lang].file} ${rep} ${span(months)}.xlsx`.replace(/[\\/:*?"<>|]/g, "-");

/** One rep's report. */
export async function repReport(rep: string, months: string[], lang: Lang = "ru") {
  const { data, lines } = await inputs(months);
  const buffer = await workbookFor(rep, months, lines, data, lang).xlsx.writeBuffer();
  return { buffer: new Uint8Array(buffer as ArrayBuffer), name: fileName(rep, months, lang) };
}

/** Every rep with prescriptions in the months, one workbook each, zipped. */
export async function allRepReports(months: string[], lang: Lang = "ru") {
  const { data, lines } = await inputs(months);
  const reps = [...new Set(lines.filter((l) => l.rep).map((l) => l.rep))].sort((a, b) => a.localeCompare(b, "ru"));
  const zip = new JSZip();
  for (const rep of reps) zip.file(fileName(rep, months, lang), (await workbookFor(rep, months, lines, data, lang).xlsx.writeBuffer()) as ArrayBuffer);
  const buffer = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { buffer, name: `${TEXT[lang].zip} ${span(months)}.zip`, count: reps.length };
}
