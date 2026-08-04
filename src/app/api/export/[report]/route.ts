// Styled .xlsx exports for every section — real numbers with thousands
// separators, an indigo header band, sized columns and frozen headers, so a
// download can be shared as-is.
//   /api/export/opex-ti?month=2026-06   — one month by category (+ 12-month sheet)
//   /api/export/opex-fargo?month=…
//   /api/export/sales?month=…           — product × channel matrix
//   /api/export/shipments               — every shipment line with landed cost
//   /api/export/balance?month=…         — assets | liabilities | equity
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getComputed } from "@/lib/data";
import { getSession } from "@/lib/auth";
import { dict, type DictKey, type Locale } from "@/lib/i18n";
import { GROUP_LABELS } from "@/lib/groups";
import { MONEY, MONEY2, buildWorkbook, workbookResponse, type SheetSpec } from "@/lib/excel";

export async function GET(request: NextRequest, ctx: { params: Promise<{ report: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { report } = await ctx.params;
  const params = request.nextUrl.searchParams;
  const locale = (params.get("locale") === "en" ? "en" : "ru") as Locale;
  const t = (k: DictKey) => dict[k][locale];
  const { dataset, computed } = await getComputed();

  const monthId = params.get("month") ?? dataset.months.at(-1)?.id ?? "";
  const monthName = (id: string) => {
    const m = dataset.months.find((x) => x.id === id);
    return m ? (locale === "ru" ? m.nameRu : m.nameEn) : id;
  };
  const groupLabel = (g: string) => GROUP_LABELS[g]?.[locale] ?? g;
  const generated = `${locale === "ru" ? "Выгружено" : "Generated"}: ${new Date().toLocaleDateString(
    locale === "ru" ? "ru-RU" : "en-US"
  )} · Humana Finance`;

  let sheets: SheetSpec[];
  let filename: string;

  if (report === "opex-ti" || report === "opex-fargo") {
    const company = report === "opex-ti" ? "TI" : "FARGO";
    const split = company === "TI";
    const [categories, tiRows, fgRows] = await Promise.all([
      prisma.opexCategory.findMany({ where: { company }, orderBy: { sortOrder: "asc" } }),
      company === "TI" ? prisma.opexTiEntry.findMany({ where: { deletedAt: null } }) : Promise.resolve([]),
      company === "FARGO" ? prisma.opexFargoEntry.findMany({ where: { deletedAt: null } }) : Promise.resolve([]),
    ]);
    // categoryId|monthId -> { bank, cash }
    const amounts = new Map<string, { bank: number; cash: number }>();
    const add = (categoryId: string, mid: string, bank: number, cash: number) => {
      const k = `${categoryId}|${mid}`;
      const a = amounts.get(k) ?? { bank: 0, cash: 0 };
      a.bank += bank;
      a.cash += cash;
      amounts.set(k, a);
    };
    for (const e of tiRows) add(e.categoryId, e.monthId, e.bankAmount, e.cashAmount);
    for (const e of fgRows) add(e.categoryId, e.monthId, e.amount, 0);
    const at = (categoryId: string, mid: string) => amounts.get(`${categoryId}|${mid}`) ?? { bank: 0, cash: 0 };

    // sheet 1 — the selected month, grouped by P&L group
    const groups = [...new Set(categories.map((c) => c.plGroup ?? "UNMAPPED"))];
    const rows: Array<Array<string | number | null>> = [];
    const boldRows: number[] = [];
    const sectionRows: number[] = [];
    let bankSum = 0;
    let cashSum = 0;
    for (const g of groups) {
      const inGroup = categories.filter((c) => (c.plGroup ?? "UNMAPPED") === g);
      const gBank = inGroup.reduce((a, c) => a + at(c.id, monthId).bank, 0);
      const gCash = inGroup.reduce((a, c) => a + at(c.id, monthId).cash, 0);
      if (gBank + gCash === 0 && !inGroup.some((c) => c.active)) continue;
      sectionRows.push(rows.length);
      rows.push(split ? [groupLabel(g), null, null, gBank + gCash] : [groupLabel(g), gBank + gCash]);
      for (const c of inGroup) {
        const a = at(c.id, monthId);
        if (!c.active && a.bank + a.cash === 0) continue;
        bankSum += a.bank;
        cashSum += a.cash;
        rows.push(
          split ? [`    ${c.name}`, a.bank, a.cash, a.bank + a.cash] : [`    ${c.name}`, a.bank + a.cash]
        );
      }
    }
    boldRows.push(rows.length);
    rows.push(split ? [t("total"), bankSum, cashSum, bankSum + cashSum] : [t("total"), bankSum]);

    // sheet 2 — the same categories across every month with data
    const monthsWithData = dataset.months.filter((m) =>
      categories.some((c) => at(c.id, m.id).bank + at(c.id, m.id).cash !== 0)
    );
    const histRows: Array<Array<string | number | null>> = [];
    const histBold: number[] = [];
    for (const c of categories) {
      const cells = monthsWithData.map((m) => {
        const a = at(c.id, m.id);
        return a.bank + a.cash;
      });
      if (cells.every((v) => v === 0)) continue;
      histRows.push([c.name, groupLabel(c.plGroup ?? "UNMAPPED"), ...cells, cells.reduce((a, b) => a + b, 0)]);
    }
    histBold.push(histRows.length);
    histRows.push([
      t("total"),
      null,
      ...monthsWithData.map((m) =>
        categories.reduce((a, c) => a + at(c.id, m.id).bank + at(c.id, m.id).cash, 0)
      ),
      histRows.reduce((a, r) => a + Number(r[r.length - 1] ?? 0), 0),
    ]);

    const title = company === "TI" ? t("navOpexTi") : t("navOpexFargo");
    sheets = [
      {
        name: monthName(monthId),
        title: `${title} — ${monthName(monthId)}`,
        subtitle: generated,
        columns: split
          ? [
              { header: t("category"), width: 34 },
              { header: t("bank"), numFmt: MONEY },
              { header: t("cash"), numFmt: MONEY },
              { header: t("total"), numFmt: MONEY },
            ]
          : [
              { header: t("category"), width: 34 },
              { header: t("amount"), numFmt: MONEY },
            ],
        rows,
        boldRows,
        sectionRows,
      },
      {
        name: locale === "ru" ? "По месяцам" : "By month",
        title: `${title} — ${locale === "ru" ? "по месяцам" : "by month"}`,
        subtitle: generated,
        columns: [
          { header: t("category"), width: 32 },
          { header: t("group"), width: 24 },
          ...monthsWithData.map((m) => ({ header: monthName(m.id), numFmt: MONEY, width: 15 })),
          { header: t("total"), numFmt: MONEY },
        ],
        rows: histRows,
        boldRows: histBold,
        freezeCols: 2,
      },
    ];
    filename = `${report}-${monthId}.xlsx`;
  } else if (report === "sales") {
    const sales = dataset.sales.filter((s) => s.monthId === monthId);
    const qty = new Map<string, number>();
    for (const s of sales) qty.set(`${s.productId}|${s.channelId}`, s.qty);
    const activeChannels = dataset.channels.filter((c) =>
      dataset.products.some((p) => (qty.get(`${p.id}|${c.id}`) ?? 0) !== 0)
    );
    const rows: Array<Array<string | number | null>> = [];
    for (const p of dataset.products) {
      const cells = activeChannels.map((c) => qty.get(`${p.id}|${c.id}`) ?? 0);
      const total = cells.reduce((a, b) => a + b, 0);
      if (total === 0) continue;
      rows.push([p.nameRu, ...cells, total]);
    }
    const boldRows = [rows.length];
    rows.push([
      t("total"),
      ...activeChannels.map((c) => dataset.products.reduce((a, p) => a + (qty.get(`${p.id}|${c.id}`) ?? 0), 0)),
      rows.reduce((a, r) => a + Number(r[r.length - 1] ?? 0), 0),
    ]);

    const monthly = computed.monthly.find((m) => m.monthId === monthId);
    const revRows: Array<Array<string | number | null>> = dataset.channels
      .map((c) => [c.name, monthly?.revenueByChannel[c.id] ?? 0] as Array<string | number>)
      .filter((r) => Number(r[1]) !== 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]));
    const revBold = [revRows.length];
    revRows.push([t("revenue"), monthly?.revenue ?? 0]);

    sheets = [
      {
        name: locale === "ru" ? "Количество" : "Quantity",
        title: `${t("salesTitle")} — ${monthName(monthId)}`,
        subtitle: generated,
        columns: [
          { header: t("product"), width: 36 },
          ...activeChannels.map((c) => ({ header: c.name, numFmt: MONEY, width: 14 })),
          { header: t("total"), numFmt: MONEY },
        ],
        rows,
        boldRows,
      },
      {
        name: locale === "ru" ? "Выручка" : "Revenue",
        title: `${t("revenue")} — ${monthName(monthId)}`,
        subtitle: generated,
        columns: [
          { header: t("channel"), width: 32 },
          { header: t("revenue"), numFmt: MONEY, width: 20 },
        ],
        rows: revRows,
        boldRows: revBold,
      },
    ];
    filename = `sales-${monthId}.xlsx`;
  } else if (report === "shipments") {
    const rows: Array<Array<string | number | null>> = [];
    const boldRows: number[] = [];
    for (const s of computed.shipmentCosts) {
      for (const l of s.lines) {
        rows.push([
          s.code,
          monthName(s.monthId),
          dataset.products.find((p) => p.id === l.productId)?.nameRu ?? l.productId,
          l.qty,
          l.priceEur,
          l.rate,
          l.purchaseAmount,
          s.loadFactor,
          l.tiUnitCost,
          l.fargoUnitCost ?? null,
        ]);
      }
      boldRows.push(rows.length);
      rows.push([
        s.code,
        monthName(s.monthId),
        `${t("total")} · ${t("importExpenses")} ${Math.round(s.expenseTotal).toLocaleString("en-US")}`,
        s.lines.reduce((a, l) => a + l.qty, 0),
        null,
        null,
        s.purchaseTotal,
        s.loadFactor,
        null,
        null,
      ]);
    }
    sheets = [
      {
        name: locale === "ru" ? "Поставки" : "Shipments",
        title: t("navShipments"),
        subtitle: generated,
        columns: [
          { header: t("shipmentCode"), width: 16 },
          { header: t("month"), width: 16 },
          { header: t("product"), width: 36 },
          { header: t("qty"), numFmt: MONEY, width: 12 },
          { header: t("priceEur"), numFmt: MONEY2, width: 12 },
          { header: t("rate"), numFmt: MONEY, width: 12 },
          { header: t("purchaseAmount"), numFmt: MONEY, width: 18 },
          { header: t("loadFactor"), numFmt: "0.0000", width: 12 },
          { header: t("tiUnitCost"), numFmt: MONEY, width: 15 },
          { header: t("fargoUnitCost"), numFmt: MONEY, width: 15 },
        ],
        rows,
        boldRows,
        freezeCols: 3,
      },
    ];
    filename = `shipments.xlsx`;
  } else if (report === "balance") {
    const b = computed.balanceSheets.find((x) => x.monthId === monthId);
    if (!b) return NextResponse.json({ error: "no balance sheet for month" }, { status: 404 });
    const rows: Array<Array<string | number | null>> = [];
    const boldRows: number[] = [];
    const sectionRows: number[] = [];
    const section = (label: string) => {
      sectionRows.push(rows.length);
      rows.push([label, null]);
    };
    const item = (label: string, v: number) => rows.push([`    ${label}`, v]);
    const total = (label: string, v: number) => {
      boldRows.push(rows.length);
      rows.push([label, v]);
    };
    section(t("assets"));
    item(t("inventory"), b.inventory);
    item(t("settlementReceivable"), b.settlementReceivable);
    item(t("goodsInTransit"), b.goodsInTransit);
    item(t("accountsReceivable"), b.arTotal);
    item(t("tiBankBalance"), b.tiBank);
    item(t("vatPrepayment"), b.vatPrepayment);
    total(t("total"), b.assetsTotal);
    section(t("liabilities"));
    item(t("taxPayable"), b.taxPayable);
    item(t("priorVatBalance"), b.priorVatBalance);
    item(t("nutribenLoan"), b.nutribenLoan);
    total(t("total"), b.liabilitiesTotal);
    section(t("equity"));
    item(t("tiCapital"), b.tiCapital);
    item(t("fargoCapital"), b.fargoCapital);
    item(t("retainedEarnings"), b.retainedEarnings);
    item(t("plug"), b.plug);
    total(t("total"), b.equityTotal);
    total(t("liabilitiesAndEquity"), b.liabilitiesTotal + b.equityTotal);

    sheets = [
      {
        name: locale === "ru" ? "Баланс" : "Balance",
        title: `${t("balanceStatement")} — ${monthName(monthId)}`,
        subtitle: generated,
        columns: [
          { header: t("balanceStatement"), width: 40 },
          { header: monthName(monthId), numFmt: MONEY, width: 22 },
        ],
        rows,
        boldRows,
        sectionRows,
      },
    ];
    filename = `balance-${monthId}.xlsx`;
  } else {
    return NextResponse.json({ error: "unknown report" }, { status: 404 });
  }

  return workbookResponse(buildWorkbook(sheets), filename);
}
