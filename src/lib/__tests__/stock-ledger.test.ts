import { describe, expect, it } from "vitest";
import { ledgerMonth, monthEnd, parseStockLedger } from "../stock-ledger";

// A small «Ведомость по товарам на складах» laid out as 1C exports it.
const sheet = (rows: unknown[][]) => [
  [null, "Ведомость по товарам на складах"],
  [null, "Период: 01.01.2026 - 01.04.2026"],
  [null, "Показатели: Количество (в базовых единицах)(Конечный остаток);"],
  [],
  [null, "Номенклатура, Базовая единица измерения", " СКЛАД А", " СКЛАД А", " СКЛАД А", " СКЛАД А", "Склад Б", "Склад Б", "Итог"],
  [null, null, "Итог", "Январь 2026 г.", "Февраль 2026 г.", "Апрель 2026 г.", "Итог", "Февраль 2026 г.", null],
  [null, null, "Количество (в базовых единицах)", "Количество (в базовых единицах)"],
  [null, null, "Конечный остаток", "Конечный остаток"],
  ...rows,
];

describe("ledgerMonth / monthEnd", () => {
  it("reads 1C month headers", () => {
    expect(ledgerMonth("Март 2025 г.")).toBe("2025-03");
    expect(ledgerMonth(" Декабрь 2026 г.")).toBe("2026-12");
    expect(ledgerMonth("Итог")).toBeNull();
  });
  it("knows month lengths", () => {
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2026-09")).toBe("2026-09-30");
  });
});

describe("parseStockLedger", () => {
  const ledger = parseStockLedger(
    sheet([
      [null, "BRAND, ", 70, 100, 80, 70, 0, 30, 70],
      [null, "(АКЦИЯ) Brand Item 1 400 гр х 4 шт , шт.", 20, null, 50, 20, null, null, 20],
      [null, "Brand Item 2 800 гр х 4 шт, шт.", 50, 100, 30, 50, null, 30, 50],
      [null, "Итог", 70, 100, 80, 70, 0, 30, 70],
    ])
  );

  it("takes the period end, warehouses and a continuous month range", () => {
    expect(ledger.periodEnd).toBe("2026-04-01");
    expect(ledger.warehouses).toEqual(["СКЛАД А", "Склад Б"]);
    expect(ledger.months).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
  });

  it("skips group and total lines and drops the unit", () => {
    expect(ledger.items.map((i) => i.name)).toEqual(["(АКЦИЯ) Brand Item 1 400 гр х 4 шт", "Brand Item 2 800 гр х 4 шт"]);
  });

  it("carries a warehouse's balance through months it does not print; blank is zero", () => {
    // Item 2: A = 100, 30, 30 (March not printed), 50; Б = 0 before its first month, then 30 carried on
    expect(ledger.items[1].byMonth).toEqual({ "2026-01": 100, "2026-02": 60, "2026-03": 60, "2026-04": 80 });
    expect(ledger.items[0].byMonth).toEqual({ "2026-01": 0, "2026-02": 50, "2026-03": 50, "2026-04": 20 });
  });

  it("flags a carried balance that disagrees with the warehouse's «Итог»", () => {
    // Склад Б's «Итог» for Item 2 is blank (0) but its last printed month says 30
    expect(ledger.mismatches).toEqual(["Brand Item 2 800 гр х 4 шт @ Склад Б: carried 30, «Итог» 0"]);
  });

  it("refuses a sheet without the header", () => {
    expect(() => parseStockLedger([["something else"]])).toThrow(/Номенклатура/);
  });
});
