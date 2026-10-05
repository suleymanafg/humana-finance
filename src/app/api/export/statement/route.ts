// Excel downloads of the statements, built from the same definitions as the pages.
//   ?kind=pnl|balance&entity=group|ti|fargo  — all three entities, the chosen one first
//   ?kind=settlement                         — summary at the month, by month, payments
//   ?kind=fargo-vat|ti-vat
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getComputed } from "@/lib/data";
import { MONEY, buildWorkbook, workbookResponse, type CellValue, type SheetSpec } from "@/lib/excel";
import {
  balanceStatement,
  fargoVatStatement,
  pnlStatement,
  SETTLEMENT_VERSIONS,
  settlementStatement,
  settlementSummary,
  tiVatStatement,
  type Entity,
} from "@/lib/statements";
import { documentSheet, statementSheet } from "@/lib/statement-export";
import { shortMonth } from "@/lib/statement-ui";

const ENTITIES: Array<{ key: Entity; ru: string; en: string }> = [
  { key: "group", ru: "Консолидировано", en: "Consolidated" },
  { key: "ti", ru: "Turbo Impex", en: "Turbo Impex" },
  { key: "fargo", ru: "Fargo", en: "Fargo" },
];

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const locale = params.get("locale") === "en" ? "en" : "ru";
  const ru = locale === "ru";
  const kind = params.get("kind") ?? "";
  const { dataset, computed } = await getComputed();

  const requested = params.get("month") ?? "";
  const idx = computed.monthIds.includes(requested) ? computed.monthIds.indexOf(requested) : computed.monthIds.length - 1;
  if (idx < 0) return NextResponse.json({ error: "no months" }, { status: 404 });
  const monthId = computed.monthIds[idx];
  const upto = computed.monthIds.slice(0, idx + 1);
  const monthName = (id: string) => {
    const m = dataset.months.find((x) => x.id === id);
    return m ? (ru ? m.nameRu : m.nameEn) : id;
  };
  const open = upto.filter((m) => !dataset.months.find((x) => x.id === m)?.closedAt);
  const generated = [
    `${ru ? "Выгружено" : "Generated"} ${new Date().toLocaleDateString(ru ? "ru-RU" : "en-GB", { timeZone: "Asia/Tashkent" })}`,
    open.length === 0
      ? null
      : open.length === 1
        ? `${monthName(open[0])} — ${ru ? "предварительно, месяц не закрыт" : "preliminary, the month is not closed"}`
        : `${ru ? "предварительно, месяцы не закрыты" : "preliminary, months not closed"}: ${shortMonth(open[0], locale)} – ${shortMonth(open[open.length - 1], locale)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const entity: Entity = params.get("entity") === "ti" || params.get("entity") === "fargo" ? (params.get("entity") as Entity) : "group";
  const ordered = [...ENTITIES.filter((e) => e.key === entity), ...ENTITIES.filter((e) => e.key !== entity)];
  const withBalanceInputs = new Set(computed.balance.filter((b) => b.hasInputs).map((b) => b.monthId));

  let sheets: SheetSpec[];
  let filename: string;

  if (kind === "pnl") {
    sheets = ordered.map((e) =>
      statementSheet({
        name: ru ? e.ru : e.en,
        title: `${ru ? "Прибыли и убытки" : "Profit and loss"} — ${ru ? e.ru : e.en}`,
        subtitle: generated,
        statement: pnlStatement(e.key, computed),
        months: upto,
        locale,
      })
    );
    filename = `pnl-${monthId}.xlsx`;
  } else if (kind === "balance") {
    sheets = ordered.map((e) =>
      statementSheet({
        name: ru ? e.ru : e.en,
        title: `${ru ? "Баланс" : "Balance sheet"} — ${ru ? e.ru : e.en}`,
        subtitle: generated,
        statement: balanceStatement(e.key, computed),
        // TI's and the group's balance sheets need the month-end cash figures
        months: e.key === "fargo" ? upto : upto.filter((m) => withBalanceInputs.has(m)),
        locale,
      })
    );
    filename = `balance-${monthId}.xlsx`;
  } else if (kind === "settlement") {
    const summary = settlementSummary(computed, monthId);
    sheets = [];
    if (summary) {
      sheets.push(
        documentSheet({
          name: ru ? "Итог" : "Summary",
          title: `${ru ? "Расчёты с Fargo на конец месяца" : "Settlement with Fargo at month-end"} — ${monthName(monthId)}`,
          subtitle: [
            ru
              ? "Два варианта — когда Fargo платит НДС по ещё не проданному товару: сейчас (товар на складе без НДС) или при продаже (с НДС)"
              : "Two versions — when Fargo pays the VAT on goods it has not sold yet: now (the stock ex-VAT) or when sold (incl. VAT)",
            generated,
          ].join(" · "),
          valueHeader: `${SETTLEMENT_VERSIONS[0][locale]}, ${ru ? "сум" : "UZS"}`,
          altHeader: `${SETTLEMENT_VERSIONS[1][locale]}, ${ru ? "сум" : "UZS"}`,
          sections: summary.sections,
          locale,
        })
      );
    }
    sheets.push(
      statementSheet({
        name: ru ? "По месяцам" : "By month",
        title: ru ? "Расчёты с Fargo по месяцам" : "Settlement with Fargo by month",
        subtitle: generated,
        statement: settlementStatement(computed),
        months: upto,
        locale,
      })
    );
    const transfers = dataset.transfers
      .filter((t) => t.date.slice(0, 7) <= monthId)
      .sort((a, b) => a.date.localeCompare(b.date));
    const fmtDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
    const rows: CellValue[][] = transfers.map((t) => [
      fmtDate(t.date),
      monthName(t.date.slice(0, 7)),
      t.cashAmount,
      t.bankAmount,
      t.cashAmount + t.bankAmount,
      t.notes ?? null,
    ]);
    const sum = (pick: (t: (typeof transfers)[number]) => number) => transfers.reduce((s, t) => s + pick(t), 0);
    rows.push([
      ru ? "Итого" : "Total",
      null,
      sum((t) => t.cashAmount),
      sum((t) => t.bankAmount),
      sum((t) => t.cashAmount + t.bankAmount),
      null,
    ]);
    sheets.push({
      name: ru ? "Платежи" : "Payments",
      title: ru ? "Платежи Fargo в адрес Turbo Impex" : "Payments from Fargo to Turbo Impex",
      subtitle: generated,
      columns: [
        { header: ru ? "Дата" : "Date", width: 13 },
        { header: ru ? "Месяц" : "Month", width: 16 },
        { header: ru ? "Наличными" : "Cash", numFmt: MONEY, width: 17 },
        { header: ru ? "Через банк" : "Bank", numFmt: MONEY, width: 17 },
        { header: ru ? "Итого" : "Total", numFmt: MONEY, width: 17 },
        { header: ru ? "Примечание" : "Note", width: 40 },
      ],
      rows,
      boldRows: [rows.length - 1],
    });
    filename = `settlement-${monthId}.xlsx`;
  } else if (kind === "fargo-vat" || kind === "ti-vat") {
    const fargo = kind === "fargo-vat";
    const title = fargo ? (ru ? "НДС Fargo" : "Fargo VAT") : ru ? "НДС Turbo Impex" : "Turbo Impex VAT";
    sheets = [
      statementSheet({
        name: title,
        title,
        subtitle: generated,
        statement: fargo ? fargoVatStatement(computed) : tiVatStatement(computed),
        months: upto,
        locale,
      }),
    ];
    filename = `${kind}-${monthId}.xlsx`;
  } else {
    return NextResponse.json({ error: "unknown statement" }, { status: 404 });
  }

  return workbookResponse(buildWorkbook(sheets), filename);
}
