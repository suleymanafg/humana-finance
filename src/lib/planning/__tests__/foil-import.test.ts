import { describe, expect, it } from "vitest";
import { foilLines, foilMonths, regionIsoOf, type FoilCell } from "../foil-import";

// made-up rows in the file's layout: date, —, region, district, clinic, doctor, rate, product, foils, paid, month, rep, proof
const head: FoilCell[] = [" ", null, "Регион", "Район", "Локация", "Имя врача", "цена", "Код продукта", "Количество", "Сумма", "Месяц", "Имя Медика", "комментарии"];
const rows: FoilCell[][] = [
  head,
  [46000, null, "Ташкент Область", "Зангиота", "Роддом", "Врач А", 90000, null, 10, 900000, "Ноябрь", "Дильноза", "фото"],
  [46000, null, "Коканд", "Коканд", "СП-1", "Врач Б", 70000, null, 4, 280000, "Ноябрь", "Мухаммаджон", "корешок"],
  [46300, null, "Неизвестно", "", "", "Врач В", null, null, 2, null, "Сентябрь", "Нигора", ""],
  [46300, null, "Ташкент", "Юнусабад", "СП-2", "Врач Г", 50000, null, 0, 0, "Сентябрь", "Нигора", ""], // no foils — left out
];

describe("foil file", () => {
  it("maps the file's region names onto the map's regions (Kokand is Fergana region)", () => {
    expect(regionIsoOf("Ташкент")).toBe("UZ-TK");
    expect(regionIsoOf("Ташкент область")).toBe("UZ-TO");
    expect(regionIsoOf("Коканд")).toBe("UZ-FA");
    expect(regionIsoOf("Андижон")).toBe("UZ-AN");
    expect(regionIsoOf("Самарканд")).toBe("UZ-SA");
    expect(regionIsoOf("Неизвестно")).toBeNull();
  });

  it("keeps every line with its region, doctor and rep; totals by month still add up", () => {
    const { lines } = foilLines(rows);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ regionIso: "UZ-TO", district: "Зангиота", doctor: "Врач А", rep: "Дильноза", foils: 10, rate: 90000, amount: 900000, proof: "фото" });
    expect(lines[1]).toMatchObject({ regionIso: "UZ-FA", rep: "Мухаммаджон", foils: 4 });
    expect(lines[2]).toMatchObject({ regionIso: null, regionName: "Неизвестно", rate: null, amount: null });
    const { months } = foilMonths(rows);
    const byMonth: Record<string, number> = {};
    for (const l of lines) byMonth[l.monthKey] = (byMonth[l.monthKey] ?? 0) + l.foils;
    expect(byMonth).toEqual(Object.fromEntries(Object.entries(months).map(([k, v]) => [k, v.foils])));
  });
});
