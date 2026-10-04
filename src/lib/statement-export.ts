// Statements as Excel sheets: the same lines the pages show, one column per
// month up to the selected one, plus the period total for flows.
import { MONEY, PCT, type CellValue, type SheetSpec } from "./excel";
import { valueOver, type DocSection, type Statement } from "./statements";
import { shortMonth } from "./statement-ui";

type Locale = "ru" | "en";

export function statementSheet(opts: {
  name: string;
  title: string;
  subtitle: string;
  statement: Statement;
  months: string[];
  locale: Locale;
}): SheetSpec {
  const { statement, months, locale } = opts;
  const flow = statement.mode === "flow";
  const columns = [
    { header: locale === "ru" ? "сум" : "UZS", width: 50 },
    ...months.map((m) => ({ header: shortMonth(m, locale), numFmt: MONEY, width: 15 })),
    ...(flow ? [{ header: locale === "ru" ? "Итого" : "Total", numFmt: MONEY, width: 17 }] : []),
  ];
  const rows: CellValue[][] = [];
  const boldRows: number[] = [];
  const sectionRows: number[] = [];
  const indentRows: number[] = [];
  const rowFormats: Record<number, string> = {};
  for (const line of statement.lines) {
    const r = rows.length;
    const label = line.label[locale];
    if (line.kind === "header") {
      sectionRows.push(r);
      rows.push([label]);
      continue;
    }
    if (line.kind === "subtotal" || line.kind === "total") boldRows.push(r);
    if (line.indent) indentRows.push(r);
    if (line.kind === "ratio") rowFormats[r] = PCT;
    else if (line.units) rowFormats[r] = MONEY;
    const cells = months.map((m) => valueOver(line, [m], statement.lines));
    if (flow) cells.push(valueOver(line, months, statement.lines));
    rows.push([label, ...cells.map((v) => (v == null ? null : line.kind === "ratio" ? v : Math.round(v)))]);
  }
  return {
    name: opts.name,
    title: opts.title,
    subtitle: opts.subtitle,
    columns,
    rows,
    boldRows,
    sectionRows,
    indentRows,
    rowFormats,
  };
}

/** A one-month document (sections of labelled figures) as a two-column sheet. */
export function documentSheet(opts: {
  name: string;
  title: string;
  subtitle: string;
  valueHeader: string;
  sections: DocSection[];
  locale: Locale;
}): SheetSpec {
  const rows: CellValue[][] = [];
  const boldRows: number[] = [];
  const sectionRows: number[] = [];
  const indentRows: number[] = [];
  opts.sections.forEach((section, k) => {
    if (k > 0) rows.push([null, null]);
    sectionRows.push(rows.length);
    rows.push([section.title[opts.locale], null]);
    for (const line of section.lines) {
      const kind = line.kind ?? "line";
      if (kind === "subtotal" || kind === "total") boldRows.push(rows.length);
      else indentRows.push(rows.length);
      rows.push([line.label[opts.locale], line.value == null ? null : Math.round(line.value)]);
    }
  });
  return {
    name: opts.name,
    title: opts.title,
    subtitle: opts.subtitle,
    columns: [
      { header: "", width: 58 },
      { header: opts.valueHeader, numFmt: MONEY, width: 20 },
    ],
    rows,
    boldRows,
    sectionRows,
    indentRows,
  };
}
