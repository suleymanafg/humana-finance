// Fills HQ's order form (DMK's «Order Form … several orders» workbook) with a
// pick-up's trucks — in HQ's own file, which the owner uploads: the form holds
// HQ's contracts and figures, so it is never stored in the app.
//
// The file is edited at the XML level, cell by cell, because a full rewrite
// (ExcelJS) leaves a workbook Excel refuses to open. Changed: each truck's
// quantity in L/M/N of «Ordersheet_with weights» (rows 3 to two above «final total quantities»), lines for
// products without a contract line under «order without contract
// confirmation», a comment in AG where a line takes more than its open
// quantity, and the «Mapping Truck 1–3» formulas (HQ's copies lose rows to
// #REF!, which drops trucks' places from the capacity check). The calc chain
// is dropped and Excel recalculates on open, so D43/D55/D67 show each truck's
// share of 33 places.
//
// Allocation per truck and product: the product's contract lines in row order,
// each up to its open quantity (J) less what earlier trucks took; the rest goes
// on its last line (noted: covered by open quantities of earlier months), or —
// without a line — on a new line under «order without contract».
import JSZip from "jszip";

export const FORM_SHEET = "Ordersheet_with weights";
const FIRST_ROW = 3;
/** where HQ has not moved it: the lines end two rows above «final total quantities» */
const DEFAULT_LAST_ROW = 27;
const TRUCK_QTY_COLS = ["L", "M", "N"];
const TRUCK_LAYER_COLS = ["Q", "W", "AB"];

export interface FormLine {
  row: number;
  /** the planning SKU the line's article belongs to; null — not one of ours */
  skuId: string | null;
  open: number;
}

export interface Allocation {
  /** row -> quantity per truck */
  qty: Record<number, number[]>;
  /** new lines: row and SKU */
  added: { row: number; skuId: string }[];
  /** rows that take more than their open quantity */
  over: number[];
}

/** Spreads each truck's units over the form's lines (pure). `freeRows` — empty rows for products without a line, in order. */
export function allocateToForm(lines: FormLine[], trucks: Record<string, number>[], freeRows: number[]): Allocation {
  const qty: Record<number, number[]> = {};
  const used: Record<number, number> = {};
  const added: Allocation["added"] = [];
  const over = new Set<number>();
  const free = [...freeRows];
  const rowFor: Record<string, number> = {};
  const put = (row: number, t: number, n: number) => {
    (qty[row] ??= trucks.map(() => 0))[t] += n;
    used[row] = (used[row] ?? 0) + n;
  };
  trucks.forEach((units, t) => {
    for (const [skuId, total] of Object.entries(units)) {
      let left = Math.round(total);
      if (left <= 0) continue;
      const mine = lines.filter((l) => l.skuId === skuId).sort((a, b) => a.row - b.row);
      for (const l of mine) {
        const room = Math.max(0, l.open - (used[l.row] ?? 0));
        const n = Math.min(room, left);
        if (n > 0) { put(l.row, t, n); left -= n; }
        if (left === 0) break;
      }
      if (left === 0) continue;
      if (mine.length > 0) {
        const last = mine[mine.length - 1].row;
        put(last, t, left);
        over.add(last);
        continue;
      }
      if (rowFor[skuId] === undefined) {
        const r = free.shift();
        if (r === undefined) throw new Error("no empty line left in the form");
        rowFor[skuId] = r;
        added.push({ row: r, skuId });
      }
      put(rowFor[skuId], t, left);
    }
  });
  return { qty, added, over: [...over].sort((a, b) => a - b) };
}

// ── XML cell surgery ──

const colNum = (col: string) => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const splitRef = (ref: string) => {
  const m = ref.match(/^([A-Z]+)(\d+)$/)!;
  return { col: m[1], row: Number(m[2]) };
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function cellRe(ref: string) {
  return new RegExp(`<c r="${ref}"(?=[\\s/>])([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`);
}

/** The cell's value as text (shared strings resolved), or null. */
export function readCell(xml: string, ref: string, shared: string[]): string | null {
  const m = xml.match(cellRe(ref));
  if (!m || !m[2]) return null;
  const t = m[1].match(/\bt="(\w+)"/)?.[1];
  const v = m[2].match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (t === "s" && v !== undefined) return shared[Number(v)] ?? null;
  if (t === "inlineStr") return (m[2].match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "").replace(/&amp;/g, "&");
  return v ?? null;
}

type CellContent = { num: number } | { str: string } | { formula: string } | null;

/** Sets a cell (keeping its style), inserting it — and its row — in order when missing. */
export function writeCell(xml: string, ref: string, content: CellContent): string {
  const body =
    content === null
      ? null
      : "num" in content
        ? { t: "", inner: `<v>${content.num}</v>` }
        : "str" in content
          ? { t: ` t="inlineStr"`, inner: `<is><t xml:space="preserve">${esc(content.str)}</t></is>` }
          : { t: "", inner: `<f>${esc(content.formula)}</f>` };
  const re = cellRe(ref);
  const m = xml.match(re);
  if (m) {
    const s = m[1].match(/\bs="(\d+)"/)?.[0] ?? "";
    const next = body ? `<c r="${ref}"${s ? " " + s : ""}${body.t}>${body.inner}</c>` : `<c r="${ref}"${s ? " " + s : ""}/>`;
    return xml.replace(re, () => next);
  }
  if (!body) return xml;
  const { col, row } = splitRef(ref);
  const cell = `<c r="${ref}"${body.t}>${body.inner}</c>`;
  const rowRe = new RegExp(`<row r="${row}"(?=[\\s>/])([^>]*?)(?:/>|>([\\s\\S]*?)</row>)`);
  const rm = xml.match(rowRe);
  if (rm) {
    const cells = rm[2] ?? "";
    const parts = [...cells.matchAll(/<c r="([A-Z]+)\d+"[\s\S]*?(?:\/>|<\/c>)/g)];
    const before = parts.find((p) => colNum(p[1]) > colNum(col));
    const inner = before ? cells.slice(0, before.index) + cell + cells.slice(before.index!) : cells + cell;
    return xml.replace(rowRe, () => `<row r="${row}"${rm[1].replace(/\/$/, "")}>${inner}</row>`);
  }
  // no such row: put it before the first later row, or at the end of sheetData
  const later = [...xml.matchAll(/<row r="(\d+)"/g)].find((x) => Number(x[1]) > row);
  const newRow = `<row r="${row}">${cell}</row>`;
  if (later) return xml.slice(0, later.index) + newRow + xml.slice(later.index!);
  return xml.replace("</sheetData>", `${newRow}</sheetData>`);
}

// ── the workbook ──

async function sheetPaths(zip: JSZip): Promise<Record<string, string>> {
  const wb = await zip.file("xl/workbook.xml")!.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  const out: Record<string, string> = {};
  for (const m of wb.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/g)) {
    const target = rels.match(new RegExp(`Id="${m[2]}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${m[2]}"`))?.[1];
    if (target) out[m[1].replace(/&amp;/g, "&")] = `xl/${target.replace(/^\/?xl\//, "").replace(/^\//, "")}`;
  }
  return out;
}

async function sharedStrings(zip: JSZip): Promise<string[]> {
  const f = zip.file("xl/sharedStrings.xml");
  if (!f) return [];
  const xml = await f.async("string");
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("").replace(/&amp;/g, "&"));
}

export interface FormSku {
  id: string;
  article: string;
  altArticles: string[];
  name: string;
}

export interface FilledForm {
  file: Uint8Array;
  allocation: Allocation;
}

/** Fills the form with up to three trucks (units by SKU id). */
export async function fillHqForm(input: Uint8Array, skus: FormSku[], trucks: Record<string, number>[]): Promise<FilledForm> {
  if (trucks.length === 0 || trucks.length > TRUCK_QTY_COLS.length) throw new Error(`HQ's form takes 1–${TRUCK_QTY_COLS.length} trucks`);
  const zip = await JSZip.loadAsync(input);
  const paths = await sheetPaths(zip);
  const formPath = paths[FORM_SHEET];
  if (!formPath) throw new Error(`no «${FORM_SHEET}» sheet`);
  const shared = await sharedStrings(zip);
  let form = await zip.file(formPath)!.async("string");

  // the lines run from row 3 to two rows above the «final total quantities» heading (HQ adds rows over time)
  const totalsRow = [...form.matchAll(/<c r="B(\d+)"/g)].find((m) => /final total quantities/i.test(readCell(form, `B${m[1]}`, shared) ?? ""))?.[1];
  const LAST_ROW = totalsRow ? Number(totalsRow) - 2 : DEFAULT_LAST_ROW;
  if (LAST_ROW < FIRST_ROW || LAST_ROW > 400) throw new Error("the form's line area was not found");

  const skuOf = (article: string) => skus.find((s) => s.article === article || s.altArticles.includes(article))?.id ?? null;
  const lines: FormLine[] = [];
  const free: number[] = [];
  let headerRow = 0;
  for (let r = FIRST_ROW; r <= LAST_ROW; r++) {
    // the «order without contract confirmation» heading (HQ puts it in D) opens the free lines
    if (["A", "B", "C", "D", "E"].some((c) => /without contract/i.test(readCell(form, `${c}${r}`, shared) ?? ""))) {
      headerRow = r;
      continue;
    }
    const art = (readCell(form, `D${r}`, shared) ?? "").trim();
    if (/^\d+(\.0+)?$/.test(art)) lines.push({ row: r, skuId: skuOf(art.replace(/\.0+$/, "")), open: Number(readCell(form, `J${r}`, shared) ?? 0) || 0 });
    else if (headerRow && r > headerRow) free.push(r);
  }
  if (!headerRow) {
    const last = Math.max(FIRST_ROW - 1, ...lines.map((l) => l.row));
    for (let r = last + 2; r <= LAST_ROW; r++) free.push(r);
  }
  const alloc = allocateToForm(lines, trucks, free);

  // quantities: clear every truck column, then write
  for (let r = FIRST_ROW; r <= LAST_ROW; r++) for (const c of TRUCK_QTY_COLS) form = writeCell(form, `${c}${r}`, null);
  for (const [row, q] of Object.entries(alloc.qty)) q.forEach((n, t) => { if (n > 0) form = writeCell(form, `${TRUCK_QTY_COLS[t]}${row}`, { num: n }); });
  for (const a of alloc.added) {
    const s = skus.find((x) => x.id === a.skuId)!;
    form = writeCell(form, `D${a.row}`, { num: Number(s.article) || 0 });
    form = writeCell(form, `E${a.row}`, { str: s.name });
    form = writeCell(form, `AG${a.row}`, { str: "No contract line in this form: from open IBP quantities of earlier months" });
  }
  for (const row of alloc.over) form = writeCell(form, `AG${row}`, { str: "Above this line's open quantity: covered by open quantities of earlier months" });
  zip.file(formPath, form);

  const lastRow = LAST_ROW;
  // the capacity check reads the mapping sheets: one row per form line, all of them
  for (let k = 1; k <= TRUCK_LAYER_COLS.length; k++) {
    const p = paths[`Mapping Truck ${k}`];
    if (!p) continue;
    let m = await zip.file(p)!.async("string");
    for (let r = FIRST_ROW; r <= lastRow; r++) {
      const i = r - 1;
      m = writeCell(m, `A${i}`, { formula: `'${FORM_SHEET}'!D${r}` });
      m = writeCell(m, `B${i}`, { formula: `VLOOKUP(A${i},'Logistical data'!$1:$1048576,2,FALSE)` });
      m = writeCell(m, `C${i}`, { formula: `VLOOKUP(A${i},'Logistical data'!A:G,7,FALSE)` });
      m = writeCell(m, `D${i}`, { formula: `'${FORM_SHEET}'!$${TRUCK_LAYER_COLS[k - 1]}${r}` });
    }
    for (const x of [...m.matchAll(/<row r="(\d+)"/g)].map((y) => Number(y[1])).filter((n) => n > lastRow - 1)) {
      for (const c of ["A", "B", "C", "D"]) m = writeCell(m, `${c}${x}`, null);
    }
    zip.file(p, m);
  }

  // recalculate on open; the old calc chain would point at cells that changed
  zip.remove("xl/calcChain.xml");
  const ct = await zip.file("[Content_Types].xml")!.async("string");
  zip.file("[Content_Types].xml", ct.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ""));
  const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  zip.file("xl/_rels/workbook.xml.rels", rels.replace(/<Relationship[^>]*Target="calcChain\.xml"[^>]*\/>/, ""));
  let wbx = await zip.file("xl/workbook.xml")!.async("string");
  wbx = /<calcPr\b/.test(wbx)
    ? wbx.replace(/<calcPr\b([^>]*?)\s*(\/?)>/, (_all, attrs: string, close: string) => `<calcPr${attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"${close}>`)
    : wbx.replace("</workbook>", `<calcPr fullCalcOnLoad="1"/></workbook>`);
  zip.file("xl/workbook.xml", wbx);

  const file = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { file, allocation: alloc };
}
