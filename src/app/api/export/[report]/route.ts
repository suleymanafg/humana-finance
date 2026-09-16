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
import { monthIdOfDate } from "@/lib/engine/compute";
import { dict, type DictKey, type Locale } from "@/lib/i18n";
import { GROUP_LABELS } from "@/lib/groups";
import { tashkentDistrictOf } from "@/lib/sync-1c-core";
import {
  MONEY,
  MONEY2,
  PCT,
  buildWorkbook,
  firstDataRow,
  workbookResponse,
  type CellValue,
  type SheetSpec,
} from "@/lib/excel";

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
    // month=<id> → that month; month=all → every month with sales
    const all = params.get("month") === "all";
    const monthsInScope = all
      ? dataset.months.filter((m) => dataset.sales.some((s) => s.monthId === m.id && s.qty !== 0))
      : dataset.months.filter((m) => m.id === monthId);
    const scopeIds = new Set(monthsInScope.map((m) => m.id));
    const scopeLabel = all ? (locale === "ru" ? "все месяцы" : "all months") : monthName(monthId);
    const monthlyById = new Map(computed.monthly.map((m) => [m.monthId, m]));
    const priceOf = new Map(dataset.products.map((p) => [p.id, p.price]));

    // qty maps: product|channel (scope total) and product|channel|month
    const qtyPC = new Map<string, number>();
    const qtyPCM = new Map<string, number>();
    for (const s of dataset.sales) {
      if (!scopeIds.has(s.monthId)) continue;
      qtyPC.set(`${s.productId}|${s.channelId}`, (qtyPC.get(`${s.productId}|${s.channelId}`) ?? 0) + s.qty);
      qtyPCM.set(
        `${s.productId}|${s.channelId}|${s.monthId}`,
        (qtyPCM.get(`${s.productId}|${s.channelId}|${s.monthId}`) ?? 0) + s.qty
      );
    }
    const channelMonthQty = (channelId: string, mid: string) =>
      dataset.products.reduce((a, p) => a + (qtyPCM.get(`${p.id}|${channelId}|${mid}`) ?? 0), 0);

    // ── sheet 1: quantity — month → product × channel; all → product × month
    const rows: Array<Array<string | number | null>> = [];
    let qtyCols: Array<{ header: string; numFmt?: string; width?: number }>;
    if (all) {
      qtyCols = [...monthsInScope.map((m) => ({ header: monthName(m.id), numFmt: MONEY, width: 13 }))];
      for (const p of dataset.products) {
        const cells = monthsInScope.map((m) =>
          dataset.channels.reduce((a, c) => a + (qtyPCM.get(`${p.id}|${c.id}|${m.id}`) ?? 0), 0)
        );
        const total = cells.reduce((a, b) => a + b, 0);
        if (total === 0) continue;
        rows.push([p.nameRu, ...cells, total]);
      }
      rows.push([
        t("total"),
        ...monthsInScope.map((m) =>
          dataset.channels.reduce((a, c) => a + channelMonthQty(c.id, m.id), 0)
        ),
        rows.reduce((a, r) => a + Number(r[r.length - 1] ?? 0), 0),
      ]);
    } else {
      const activeChannels = dataset.channels.filter((c) =>
        dataset.products.some((p) => (qtyPC.get(`${p.id}|${c.id}`) ?? 0) !== 0)
      );
      qtyCols = activeChannels.map((c) => ({ header: c.name, numFmt: MONEY, width: 14 }));
      for (const p of dataset.products) {
        const cells = activeChannels.map((c) => qtyPC.get(`${p.id}|${c.id}`) ?? 0);
        const total = cells.reduce((a, b) => a + b, 0);
        if (total === 0) continue;
        rows.push([p.nameRu, ...cells, total]);
      }
      rows.push([
        t("total"),
        ...activeChannels.map((c) =>
          dataset.products.reduce((a, p) => a + (qtyPC.get(`${p.id}|${c.id}`) ?? 0), 0)
        ),
        rows.reduce((a, r) => a + Number(r[r.length - 1] ?? 0), 0),
      ]);
    }
    const boldRows = [rows.length - 1];

    // ── sheet 2: revenue by channel (engine figures, tie to the P&L)
    const chRevenue = (channelId: string, mid: string) => monthlyById.get(mid)?.revenueByChannel[channelId] ?? 0;
    const chRevenueTotal = (channelId: string) =>
      monthsInScope.reduce((a, m) => a + chRevenue(channelId, m.id), 0);
    const revenueGrand = monthsInScope.reduce((a, m) => a + (monthlyById.get(m.id)?.revenue ?? 0), 0);
    const revRows: Array<Array<string | number | null>> = dataset.channels
      .filter((c) => chRevenueTotal(c.id) !== 0)
      .sort((a, b) => chRevenueTotal(b.id) - chRevenueTotal(a.id))
      .map((c) =>
        all
          ? [c.name, ...monthsInScope.map((m) => chRevenue(c.id, m.id)), chRevenueTotal(c.id)]
          : [c.name, chRevenueTotal(c.id)]
      );
    const revBold = [revRows.length];
    revRows.push(
      all
        ? [t("revenue"), ...monthsInScope.map((m) => monthlyById.get(m.id)?.revenue ?? 0), revenueGrand]
        : [t("revenue"), revenueGrand]
    );

    // ── sheet 3: geography — Tashkent split by district, every chain and
    // region on its own row, «Прочие» last (channel sortOrder already does this)
    const [registry, clientSales] = await Promise.all([
      prisma.clientChannelMap.findMany({ where: { deletedAt: null }, select: { id: true, district: true } }),
      prisma.clientSale.findMany({
        where: all ? {} : { monthId },
        select: { monthId: true, channelId: true, clientMapId: true, productId: true, qty: true },
      }),
    ]);
    const districtByClient = new Map(registry.map((r) => [r.id, tashkentDistrictOf(r.district)]));
    const noDistrict = locale === "ru" ? "Без района" : "No district";
    const noDetail = locale === "ru" ? "Без детализации (нет данных 1С)" : "No breakdown (no 1C detail)";

    const geoRows: Array<Array<string | number | null>> = [];
    const geoBold: number[] = [];
    const geoSections: number[] = [];
    const monthCells = (fn: (mid: string) => number) => monthsInScope.map((m) => fn(m.id));
    const pushGeo = (
      label: string,
      qtyByMonth: number[],
      revenue: number,
      opts: { section?: boolean; indent?: boolean } = {}
    ) => {
      if (opts.section) geoSections.push(geoRows.length);
      const qtyTotal = qtyByMonth.reduce((a, b) => a + b, 0);
      const name = opts.indent ? `    ${label}` : label;
      geoRows.push(
        all
          ? [name, ...qtyByMonth, qtyTotal, revenue]
          : [name, qtyTotal, revenue, revenueGrand !== 0 ? revenue / revenueGrand : 0]
      );
    };

    for (const c of dataset.channels) {
      const chQtyByMonth = monthCells((mid) => channelMonthQty(c.id, mid));
      const chRev = chRevenueTotal(c.id);
      if (chQtyByMonth.every((v) => v === 0) && chRev === 0) continue;

      const isTashkent = c.name === "г. Ташкент";
      pushGeo(c.name, chQtyByMonth, chRev, { section: isTashkent });

      if (isTashkent) {
        // district sub-rows from the per-client detail (populated by the sync)
        const byDistrict = new Map<string, { qtyByMonth: Map<string, number>; revenue: number }>();
        for (const cs of clientSales) {
          if (cs.channelId !== c.id || !scopeIds.has(cs.monthId)) continue;
          const d = districtByClient.get(cs.clientMapId) ?? null;
          const key = d ?? noDistrict;
          const e = byDistrict.get(key) ?? { qtyByMonth: new Map<string, number>(), revenue: 0 };
          e.qtyByMonth.set(cs.monthId, (e.qtyByMonth.get(cs.monthId) ?? 0) + cs.qty);
          e.revenue += cs.qty * (priceOf.get(cs.productId) ?? 0);
          byDistrict.set(key, e);
        }
        const districtRows = [...byDistrict.entries()].sort(
          (a, b) =>
            [...b[1].qtyByMonth.values()].reduce((x, y) => x + y, 0) -
            [...a[1].qtyByMonth.values()].reduce((x, y) => x + y, 0)
        );
        const detailQtyByMonth = new Map<string, number>();
        for (const [, e] of districtRows)
          for (const [mid, q] of e.qtyByMonth)
            detailQtyByMonth.set(mid, (detailQtyByMonth.get(mid) ?? 0) + q);
        let detailRevenue = 0;
        for (const [label, e] of districtRows) {
          const cells = monthCells((mid) => e.qtyByMonth.get(mid) ?? 0);
          detailRevenue += e.revenue;
          pushGeo(label, cells, e.revenue, { indent: true });
        }
        // residual keeps the district block summing to the channel row even
        // for months synced before per-client detail existed
        const residual = monthCells((mid) => channelMonthQty(c.id, mid) - (detailQtyByMonth.get(mid) ?? 0));
        if (residual.some((v) => Math.abs(v) > 1e-9))
          pushGeo(noDetail, residual, chRev - detailRevenue, { indent: true });
      }
    }
    geoBold.push(geoRows.length);
    pushGeo(
      t("total"),
      monthCells((mid) => dataset.channels.reduce((a, c) => a + channelMonthQty(c.id, mid), 0)),
      revenueGrand
    );

    const geoName = locale === "ru" ? "География" : "Geography";
    sheets = [
      {
        name: locale === "ru" ? "Количество" : "Quantity",
        title: `${t("salesTitle")} — ${scopeLabel}`,
        subtitle: generated,
        columns: [
          { header: t("product"), width: 36 },
          ...qtyCols,
          { header: t("total"), numFmt: MONEY },
        ],
        rows,
        boldRows,
        freezeCols: 1,
      },
      {
        name: locale === "ru" ? "Выручка" : "Revenue",
        title: `${t("revenue")} — ${scopeLabel}`,
        subtitle: generated,
        columns: all
          ? [
              { header: t("channel"), width: 32 },
              ...monthsInScope.map((m) => ({ header: monthName(m.id), numFmt: MONEY, width: 15 })),
              { header: t("total"), numFmt: MONEY, width: 18 },
            ]
          : [
              { header: t("channel"), width: 32 },
              { header: t("revenue"), numFmt: MONEY, width: 20 },
            ],
        rows: revRows,
        boldRows: revBold,
        freezeCols: 1,
      },
      {
        name: geoName,
        title: `${geoName} — ${scopeLabel}`,
        subtitle: generated,
        columns: all
          ? [
              { header: locale === "ru" ? "Место продажи" : "Place", width: 32 },
              ...monthsInScope.map((m) => ({ header: monthName(m.id), numFmt: MONEY, width: 13 })),
              { header: `${t("total")} (${t("qty")})`, numFmt: MONEY, width: 15 },
              { header: t("revenue"), numFmt: MONEY, width: 18 },
            ]
          : [
              { header: locale === "ru" ? "Место продажи" : "Place", width: 32 },
              { header: t("qty"), numFmt: MONEY, width: 14 },
              { header: t("revenue"), numFmt: MONEY, width: 18 },
              { header: locale === "ru" ? "Доля" : "Share", numFmt: PCT, width: 10 },
            ],
        rows: geoRows,
        boldRows: geoBold,
        sectionRows: geoSections,
        freezeCols: 1,
      },
    ];
    filename = all ? "sales-all-months.xlsx" : `sales-${monthId}.xlsx`;
  } else if (report === "shipments") {
    // Live formulas: line amount = qty × €price × rate, totals = SUMs, unit
    // costs derive from the load factor — the sheet recalculates when edited.
    // Columns: D qty · E priceEur · F rate · G amount · H loadFactor · I tiUnitCost
    const rows: Array<Array<CellValue>> = [];
    const boldRows: number[] = [];
    const XL = (r: number) => r + firstDataRow(true); // sheet has a subtitle
    for (const s of computed.shipmentCosts) {
      const expenses = dataset.importExpenses.filter((x) => x.shipmentId === s.shipmentId);
      const lineStart = rows.length;
      const totalRow = lineStart + s.lines.length; // «Итого · закупка»
      const expStart = totalRow + 1;
      const landedRow = expStart + expenses.length; // «Итого с расходами»
      for (const l of s.lines) {
        const r = XL(rows.length);
        rows.push([
          s.code,
          monthName(s.monthId),
          dataset.products.find((p) => p.id === l.productId)?.nameRu ?? l.productId,
          l.qty,
          l.priceEur,
          l.rate,
          { formula: `D${r}*E${r}*F${r}`, result: l.purchaseAmount },
          { formula: `$H$${XL(totalRow)}`, result: s.loadFactor },
          { formula: `G${r}*H${r}/D${r}`, result: l.tiUnitCost },
          l.fargoUnitCost ?? null,
        ]);
      }
      boldRows.push(rows.length);
      rows.push([
        s.code,
        monthName(s.monthId),
        `${t("total")} · ${t("purchaseAmount")}`,
        { formula: `SUM(D${XL(lineStart)}:D${XL(totalRow - 1)})`, result: s.lines.reduce((a, l) => a + l.qty, 0) },
        null,
        null,
        { formula: `SUM(G${XL(lineStart)}:G${XL(totalRow - 1)})`, result: s.purchaseTotal },
        { formula: `G${XL(landedRow)}/G${XL(totalRow)}`, result: s.loadFactor },
        null,
        null,
      ]);
      // the shipment's import expenses, itemized by category
      for (const e of expenses) {
        rows.push([s.code, monthName(s.monthId), `— ${e.categoryName}`, null, null, null, e.amount, null, null, null]);
      }
      boldRows.push(rows.length);
      rows.push([
        s.code,
        monthName(s.monthId),
        locale === "ru" ? "Итого с расходами импорта" : "Total incl. import expenses",
        null,
        null,
        null,
        {
          formula:
            expenses.length > 0
              ? `G${XL(totalRow)}+SUM(G${XL(expStart)}:G${XL(landedRow - 1)})`
              : `G${XL(totalRow)}`,
          result: s.purchaseTotal + s.expenseTotal,
        },
        null,
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
    item(t("tiCashBalance"), b.tiCash);
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
  } else if (report === "transfers") {
    // Payments reconciliation to hand to Fargo: month-by-month accrual vs
    // payment from the settlement model, plus the full register of transfers
    // to TI. Figures match the Balance page exactly; the only live formulas
    // are self-evident ones (Δ, line totals, running cumulative).
    const ru = locale === "ru";
    const fmtDate = (iso: string) =>
      new Date(iso).toLocaleDateString(ru ? "ru-RU" : "en-US", { timeZone: "UTC" });

    // sheet 1 — monthly reconciliation (mirrors «Платёжная дисциплина»)
    const series = computed.settlement;
    const monthlyRecon = series
      .map((s, i) => {
        const prev = i > 0 ? series[i - 1] : null;
        const accrued = s.dueToTi - (prev?.dueToTi ?? 0);
        const paid =
          s.cumTransfersCash +
          s.cumTransfersBank -
          ((prev?.cumTransfersCash ?? 0) + (prev?.cumTransfersBank ?? 0));
        return { monthId: s.monthId, accrued, paid, remaining: s.remaining };
      })
      .filter((d) => Math.round(d.accrued) !== 0 || Math.round(d.paid) !== 0);
    const last = series.filter((s) => monthlyRecon.some((d) => d.monthId === s.monthId)).at(-1);

    const reconRows: Array<Array<CellValue>> = [];
    const reconBold: number[] = [];
    const reconSection: number[] = [];
    const r1 = firstDataRow(true);
    monthlyRecon.forEach((d, i) => {
      const r = r1 + i;
      reconRows.push([
        monthName(d.monthId),
        Math.round(d.accrued),
        Math.round(d.paid),
        { formula: `B${r}-C${r}`, result: Math.round(d.accrued - d.paid) },
        Math.round(d.remaining),
      ]);
    });
    if (last && monthlyRecon.length > 0) {
      const rLast = r1 + monthlyRecon.length - 1;
      reconBold.push(reconRows.length);
      reconRows.push([
        t("total"),
        { formula: `SUM(B${r1}:B${rLast})`, result: Math.round(last.dueToTi) },
        {
          formula: `SUM(C${r1}:C${rLast})`,
          result: Math.round(last.cumTransfersCash + last.cumTransfersBank),
        },
        {
          formula: `SUM(D${r1}:D${rLast})`,
          result: Math.round(last.dueToTi - last.cumTransfersCash - last.cumTransfersBank),
        },
        null,
      ]);
    }
    if (last) {
      reconSection.push(reconRows.length);
      reconRows.push([
        `${ru ? "Итог на" : "As of"} ${monthName(last.monthId)}`,
        null,
        null,
        null,
        null,
      ]);
      reconRows.push([`    ${ru ? "Начислено всего (доля TI)" : "Total accrued (due to TI)"}`, Math.round(last.dueToTi), null, null, null]);
      reconRows.push([
        `    ${ru ? "Перечислено всего" : "Total transferred"}`,
        Math.round(last.cumTransfersCash + last.cumTransfersBank),
        null,
        null,
        null,
      ]);
      reconRows.push([
        `    ${ru ? "Не собрано с клиентов (дебиторка)" : "Not yet collected from clients (AR)"}`,
        Math.round(last.outstandingAr),
        null,
        null,
        null,
      ]);
      reconBold.push(reconRows.length);
      reconRows.push([t("remainingBalance"), Math.round(last.remaining), null, null, null]);
    }

    // sheet 2 — every payment to TI, date order, with a running cumulative
    const transfers = [...dataset.transfers].sort((a, b) => a.date.localeCompare(b.date));
    const payRows: Array<Array<CellValue>> = [];
    const payBold: number[] = [];
    let cum = 0;
    transfers.forEach((tr, i) => {
      const r = r1 + i;
      const lineTotal = tr.cashAmount + tr.bankAmount;
      cum += lineTotal;
      payRows.push([
        i + 1,
        fmtDate(tr.date),
        monthName(monthIdOfDate(tr.date)),
        tr.cashAmount,
        tr.bankAmount,
        { formula: `D${r}+E${r}`, result: lineTotal },
        i === 0 ? { formula: `F${r}`, result: cum } : { formula: `G${r - 1}+F${r}`, result: cum },
      ]);
    });
    if (transfers.length > 0) {
      const pLast = r1 + transfers.length - 1;
      payBold.push(payRows.length);
      payRows.push([
        null,
        t("total"),
        null,
        { formula: `SUM(D${r1}:D${pLast})`, result: transfers.reduce((s, x) => s + x.cashAmount, 0) },
        { formula: `SUM(E${r1}:E${pLast})`, result: transfers.reduce((s, x) => s + x.bankAmount, 0) },
        { formula: `SUM(F${r1}:F${pLast})`, result: cum },
        null,
      ]);
    }

    sheets = [
      {
        name: ru ? "Сверка по месяцам" : "Monthly reconciliation",
        title: ru ? "Сверка расчётов Fargo → Turbo Impex" : "Fargo → Turbo Impex reconciliation",
        subtitle: generated,
        columns: [
          { header: ru ? "Месяц" : "Month", width: 20 },
          { header: ru ? "Начислено (доля TI)" : "Accrued (due to TI)", numFmt: MONEY, width: 20 },
          { header: ru ? "Перечислено TI" : "Transferred to TI", numFmt: MONEY, width: 20 },
          { header: ru ? "Δ за месяц" : "Δ for month", numFmt: MONEY, width: 17 },
          { header: ru ? "Долг на конец" : "Debt at month end", numFmt: MONEY, width: 20 },
        ],
        rows: reconRows,
        boldRows: reconBold,
        sectionRows: reconSection,
      },
      {
        name: ru ? "Платежи" : "Payments",
        title: ru ? "Платежи Fargo в адрес Turbo Impex" : "Payments from Fargo to Turbo Impex",
        subtitle: generated,
        columns: [
          { header: "№", width: 6 },
          { header: ru ? "Дата" : "Date", width: 14 },
          { header: ru ? "Месяц" : "Month", width: 20 },
          { header: ru ? "Наличные" : "Cash", numFmt: MONEY, width: 17 },
          { header: ru ? "Банк" : "Bank", numFmt: MONEY, width: 17 },
          { header: ru ? "Итого" : "Total", numFmt: MONEY, width: 17 },
          { header: ru ? "Накопительно" : "Cumulative", numFmt: MONEY, width: 18 },
        ],
        rows: payRows,
        boldRows: payBold,
        freezeCols: 2,
      },
    ];
    filename = "fargo-reconciliation.xlsx";
  } else {
    return NextResponse.json({ error: "unknown report" }, { status: 404 });
  }

  return workbookResponse(buildWorkbook(sheets), filename);
}
