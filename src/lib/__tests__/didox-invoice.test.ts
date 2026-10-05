import { describe, expect, it } from "vitest";
import { matchProduct, parseDidoxInvoice, productKey } from "../didox-invoice";

// the text layer of a Didox invoice, in its layout; figures and details made up
const TEXT = `15.01.2024 даги 3-сонли шартномага
14.03.2024 даги 5-сонли
Ҳисобварақ-фактура
Етказиб берувчи: "TURBO-IMPEX" MCHJ
Манзил: ТОШКЕНТ Ш.
Етказиб берувчининг СТИР
рақами (СТИР):
100000001
Сотиб олувчи: "FARGO MARKETING GROUP" MCHJ
Манзил: ТОШКЕНТ ВИЛОЯТИ
Сотиб олувчининг СТИР рақами
(СТИР):
100000002
№ Маҳсулот номи
(хизматлар)
Ўлчов
бирлиги Миқдор Нарҳ Етказиб бериш
қиймати
ҚҚС Етказиб беришнинг ҚҚСни
ҳисобга олган ҳолда қиймати
Товарни келиб
чиқиши\tСтавка Сумма
1 2 3 4 5 6 7 8 9 10
1 Humana Platin 1
400g MP 01901001008000000 - Молочная смесь шт. 1 000.000000 50 000.00 50 000 000.00 12% 6 000 000.00 56 000 000.00 Олди-сотди
2 Humana HN Expert
300g FS 01901001008000000 - Молочная смесь шт. 120.000000 45 535.71 5 464 285.71 12% 655 714.29 6 120 000.00 Олди-сотди
3 Humana AR Expert
350g DS
02106999028000000 - Биологически активные
добавки к пище
шт.
(упаковка) 60.000000 60 000.00 3 600 000.00 12% 432 000.00 4 032 000.00 Олди-сотди
Жами 59 064 285.71 7 087 714.29 66 152 000.00
Жами тўлов учун: Олтмиш олти миллион сум 00 тийин . ҚҚС: 7 087 714.29 .`;

describe("Didox invoice", () => {
  const inv = parseDidoxInvoice(TEXT);
  it("reads the number and date of the invoice, not of the contract", () => {
    expect(inv.number).toBe("5");
    expect(inv.date).toBe("2024-03-14");
  });
  it("reads seller and buyer", () => {
    expect(inv.seller).toBe('"TURBO-IMPEX" MCHJ');
    expect(inv.buyer).toBe('"FARGO MARKETING GROUP" MCHJ');
  });
  it("reads every line as printed", () => {
    expect(inv.lines).toHaveLength(3);
    expect(inv.lines[0]).toEqual({
      name: "Humana Platin 1 400g MP",
      qty: 1000,
      price: 50000,
      amount: 50_000_000,
      vatRate: 0.12,
      vat: 6_000_000,
      total: 56_000_000,
    });
    expect(inv.lines[1].name).toBe("Humana HN Expert 300g FS");
    expect(inv.lines[1].amount).toBe(5_464_285.71);
    expect(inv.lines[2]).toMatchObject({ name: "Humana AR Expert 350g DS", qty: 60, vat: 432_000 });
  });
  it("reads the totals row", () => {
    expect(inv.totals).toEqual({ amount: 59_064_285.71, vat: 7_087_714.29, total: 66_152_000 });
  });
  it("finds nothing in a document that is not one", () => {
    expect(parseDidoxInvoice("Hello").lines).toEqual([]);
  });
});

describe("product names", () => {
  const products = [
    { id: "p1-400", nameRu: "Humana Platin 1 MP 400 гр х 4 шт" },
    { id: "p1-800", nameRu: "Humana Platin 1 MP 800 гр х 4 шт" },
    { id: "p2-400", nameRu: "Humana Platin 2 MP 400 гр х 4 шт" },
    { id: "hn", nameRu: "Humana HN Expert FS 300 гр х 5 шт" },
    { id: "ar", nameRu: "Humana AR Expert DS 350 гр х 12 шт" },
    { id: "ac", nameRu: "Humana AC Expert DS 350 гр х 12 шт" },
    { id: "sl", nameRu: "Humana SL Expert BIB 500 гр х 4 шт" },
  ];
  it("match across the invoice's and the app's spellings", () => {
    expect(productKey("Humana Platin 1 400g MP")).toBe("platin-1|400");
    expect(productKey("Humana Platin 1 MP 400 гр х 4 шт")).toBe("platin-1|400");
    expect(matchProduct("Humana Platin 1 400g MP", products)).toBe("p1-400");
    expect(matchProduct("Humana Platin 1 800g MP", products)).toBe("p1-800");
    expect(matchProduct("Humana Platin 2 400g MP", products)).toBe("p2-400");
    expect(matchProduct("Humana HN Expert 300g FS", products)).toBe("hn");
    expect(matchProduct("Humana AR Expert 350g DS", products)).toBe("ar");
    expect(matchProduct("Humana SL Expert 500g BIB", products)).toBe("sl");
  });
  it("leave an unknown product for the user to choose", () => {
    expect(matchProduct("Humana Junior 600g", products)).toBeNull();
    expect(matchProduct("Humana Platin 3 400g MP", products)).toBeNull();
  });
});
