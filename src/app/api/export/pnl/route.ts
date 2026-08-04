// P&L export: months × lines as a styled .xlsx (see src/lib/excel.ts).
import { NextResponse, type NextRequest } from "next/server";
import { getComputed } from "@/lib/data";
import { dict, type DictKey, type Locale } from "@/lib/i18n";
import { GROUP_LABELS, TI_GROUPS, FARGO_GROUPS } from "@/lib/groups";
import { getSession } from "@/lib/auth";
import { MONEY, PCT, buildWorkbook, workbookResponse } from "@/lib/excel";
import type { MonthlyResult } from "@/lib/engine/types";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const locale = (request.nextUrl.searchParams.get("locale") === "en" ? "en" : "ru") as Locale;
  const t = (k: DictKey) => dict[k][locale];
  const { dataset, computed } = await getComputed();

  const monthName = (id: string) => {
    const m = dataset.months.find((x) => x.id === id);
    return m ? (locale === "ru" ? m.nameRu : m.nameEn) : id;
  };
  // only months that carry data — empty future months add noise to a report
  const cols = computed.monthly.filter(
    (m) => m.revenue !== 0 || m.cogs !== 0 || m.totalOpex !== 0
  );

  const rows: Array<Array<string | number | null>> = [];
  const boldRows: number[] = [];
  const sectionRows: number[] = [];
  const pctRows: number[] = [];

  const line = (
    label: string,
    get: (m: MonthlyResult) => number,
    opts: { bold?: boolean; section?: boolean; pct?: boolean; indent?: boolean } = {}
  ) => {
    if (opts.bold) boldRows.push(rows.length);
    if (opts.section) sectionRows.push(rows.length);
    if (opts.pct) pctRows.push(rows.length);
    rows.push([
      opts.indent ? `    ${label}` : label,
      ...cols.map((m) => get(m)),
      get(computed.ytd),
    ]);
  };

  line(t("revenue"), (m) => m.revenue, { bold: true });
  line("− " + t("cogs"), (m) => -m.cogs);
  line(t("grossProfit"), (m) => m.grossProfit, { bold: true });
  line(t("gpMargin"), (m) => m.gpMarginPct, { pct: true });

  line(t("opexTiTotal"), (m) => -m.opexTiTotal, { section: true });
  for (const g of TI_GROUPS) {
    if (!cols.some((m) => m.opexTiByGroup[g])) continue;
    line(GROUP_LABELS[g][locale], (m) => -(m.opexTiByGroup[g] ?? 0), { indent: true });
  }
  if (cols.some((m) => m.opexTiByGroup["UNMAPPED"])) {
    line(GROUP_LABELS.UNMAPPED[locale], (m) => -(m.opexTiByGroup["UNMAPPED"] ?? 0), { indent: true });
  }
  line(t("opexFargoTotal"), (m) => -m.opexFargoTotal, { section: true });
  for (const g of FARGO_GROUPS) {
    if (!cols.some((m) => m.opexFargoByGroup[g])) continue;
    line(GROUP_LABELS[g][locale], (m) => -(m.opexFargoByGroup[g] ?? 0), { indent: true });
  }
  if (cols.some((m) => m.opexFargoByGroup["UNMAPPED"])) {
    line(GROUP_LABELS.UNMAPPED[locale], (m) => -(m.opexFargoByGroup["UNMAPPED"] ?? 0), { indent: true });
  }
  line("− " + t("retroBonus"), (m) => -m.retroBonus);
  line(t("totalOpex"), (m) => -m.totalOpex, { bold: true });

  line(t("ebitda"), (m) => m.ebitda, { bold: true });
  line(t("ebitdaMargin"), (m) => m.ebitdaMarginPct, { pct: true });

  line("− " + t("fargoVat"), (m) => -m.fargoVat);
  line("− " + t("tiIncomeTax"), (m) => -m.tiIncomeTax);
  line("− " + t("fargoIncomeTax"), (m) => -m.fargoIncomeTax);
  line(t("taxesTotal"), (m) => -m.taxesTotal, { bold: true });

  line(t("netProfit"), (m) => m.netProfit, { bold: true });
  line(t("netMargin"), (m) => m.netMarginPct, { pct: true });

  const wb = buildWorkbook([
    {
      name: "P&L",
      title: `${t("navPnl")} — Humana Uzbekistan`,
      subtitle: `${locale === "ru" ? "Выгружено" : "Generated"}: ${new Date().toLocaleDateString(
        locale === "ru" ? "ru-RU" : "en-US"
      )} · Turbo Impex + Fargo`,
      columns: [
        { header: t("navPnl"), width: 34 },
        ...cols.map((m) => ({ header: monthName(m.monthId), numFmt: MONEY, width: 16 })),
        { header: t("ytd"), numFmt: MONEY, width: 18 },
      ],
      rows,
      boldRows,
      sectionRows,
    },
  ]);

  // percentage rows need their own format, applied after the grid is built
  const ws = wb.getWorksheet("P&L")!;
  for (const r of pctRows) {
    const row = ws.getRow(4 + r); // title + subtitle + header = 3 rows above
    for (let c = 2; c <= cols.length + 2; c++) row.getCell(c).numFmt = PCT;
  }

  return workbookResponse(wb, "pnl-humana.xlsx");
}
