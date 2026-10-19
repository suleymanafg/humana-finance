import { describe, expect, it } from "vitest";
import { allocateToForm, readCell, writeCell } from "../hq-form";

describe("HQ order form", () => {
  it("fills each product's lines in order up to their open quantity, the rest on its last line or a new one", () => {
    const lines = [
      { row: 3, skuId: "a", open: 100 },
      { row: 4, skuId: "b", open: 500 },
      { row: 6, skuId: "a", open: 50 },
      { row: 7, skuId: null, open: 999 },
    ];
    const a = allocateToForm(lines, [{ a: 120, b: 200, c: 30 }, { a: 80, c: 10 }], [19, 20]);
    expect(a.qty[3]).toEqual([100, 0]);
    expect(a.qty[6]).toEqual([20, 80]); // 30 of its 50 open, then 50 over
    expect(a.qty[4]).toEqual([200, 0]);
    expect(a.qty[19]).toEqual([30, 10]); // c has no line: one new line for both trucks
    expect(a.added).toEqual([{ row: 19, skuId: "c" }]);
    expect(a.over).toEqual([6]);
    expect(a.qty[7]).toBeUndefined();
  });

  it("edits cells in place, keeping the style, and inserts missing ones in column order", () => {
    const xml = `<sheetData><row r="3"><c r="D3" s="11"><v>70777</v></c><c r="L3" s="65"/><c r="N3" s="35"/></row></sheetData>`;
    let x = writeCell(xml, "L3", { num: 48 });
    expect(x).toContain(`<c r="L3" s="65"><v>48</v></c>`);
    x = writeCell(x, "M3", { num: 5 });
    expect(x.indexOf(`r="M3"`)).toBeGreaterThan(x.indexOf(`r="L3"`));
    expect(x.indexOf(`r="M3"`)).toBeLessThan(x.indexOf(`r="N3"`));
    x = writeCell(x, "AG3", { str: "a & b" });
    expect(readCell(x, "AG3", [])).toBe("a & b");
    x = writeCell(x, "L3", null);
    expect(x).toContain(`<c r="L3" s="65"/>`);
    x = writeCell(x, "A5", { formula: "'Sheet'!D6" });
    expect(x).toContain(`<row r="5"><c r="A5"><f>'Sheet'!D6</f></c></row>`);
    expect(readCell(x, "D3", [])).toBe("70777");
  });
});
