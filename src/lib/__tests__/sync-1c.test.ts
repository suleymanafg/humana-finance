import { describe, expect, it } from "vitest";
import { classifyChannel, monthRange } from "../sync-1c-core";

describe("classifyChannel", () => {
  it("maps Tashkent city districts to г. Ташкент", () => {
    expect(classifyChannel("Чиланзарский район", "Аптека X", true)).toEqual({
      channel: "г. Ташкент",
      rule: "district",
    });
    expect(classifyChannel("Мирзо-Улугбекский", "Y", true).channel).toBe("г. Ташкент");
    expect(classifyChannel("Юнусабад", "Y", true).channel).toBe("г. Ташкент");
    expect(classifyChannel("г. Ташкент", "Y", true).channel).toBe("г. Ташкент");
  });

  it("maps Tashkent-region towns before the city match", () => {
    expect(classifyChannel("Ташкентская область", "Y", true).channel).toBe("Ташкентская область");
    expect(classifyChannel("Чирчик", "Y", true).channel).toBe("Ташкентская область");
    expect(classifyChannel("Кибрай", "Y", true).channel).toBe("Ташкентская область");
  });

  it("maps region districts to the region channel", () => {
    expect(classifyChannel("Самаркандский район", "Y", true).channel).toBe("Самарканд");
    expect(classifyChannel("Карши", "Y", true).channel).toBe("Кашкадарья");
    expect(classifyChannel("Ургенч", "Y", true).channel).toBe("Хорезм");
    expect(classifyChannel("Коканд", "Y", true).channel).toBe("Фергана");
    expect(classifyChannel("Термез", "Y", true).channel).toBe("Сурхандарья");
  });

  it("falls back to client-name matching when район is blank", () => {
    expect(classifyChannel("", "Angelsey Корзинка", true)).toEqual({
      channel: "Korzinka",
      rule: "client",
    });
    expect(classifyChannel(null, "UZUM MARKET MCHJ", true).channel).toBe("Uzum Market");
    expect(classifyChannel("", "Дилеры Бондюэль", true).channel).toBe("Дилеры Бондюэль");
    expect(classifyChannel("", "Наманган филиал", true).channel).toBe("Наманган");
    expect(classifyChannel("", "Таш.обл.ХУМАНА", true).channel).toBe("Ташкентская область");
    expect(classifyChannel("", "ООО TURBO-IMPEX", true).channel).toBe("Внутреннее");
  });

  it("respects the by-client-name switch", () => {
    expect(classifyChannel("", "Angelsey Корзинка", false)).toEqual({
      channel: "Прочие",
      rule: "fallback",
    });
  });

  it("sends unknowns to Прочие", () => {
    expect(classifyChannel("", "ИП Неизвестный", true)).toEqual({
      channel: "Прочие",
      rule: "fallback",
    });
    expect(classifyChannel(null, "", true).rule).toBe("fallback");
  });

  it("normalizes ё and case", () => {
    expect(classifyChannel("ЯНГИХАЁТСКИЙ РАЙОН", "Y", true).channel).toBe("г. Ташкент");
  });

  it("manual registry mapping beats every keyword rule", () => {
    const manual = new Map([["ип неизвестный", "Korzinka"]]);
    // beats the fallback
    expect(classifyChannel("", "ИП Неизвестный", true, manual)).toEqual({
      channel: "Korzinka",
      rule: "manual",
    });
    // beats a район match
    const m2 = new Map([["аптека x", "Makro"]]);
    expect(classifyChannel("Чиланзарский район", "Аптека X", true, m2)).toEqual({
      channel: "Makro",
      rule: "manual",
    });
    // beats a client-keyword match, and normalizes the lookup
    const m3 = new Map([["angelsey корзинка", "Прочие"]]);
    expect(classifyChannel("", "  ANGELSEY  Корзинка ", true, m3).rule).toBe("manual");
  });

  it("manual map miss falls through to the normal rules", () => {
    const manual = new Map([["кто-то другой", "Makro"]]);
    expect(classifyChannel("Чирчик", "Y", true, manual).channel).toBe("Ташкентская область");
    expect(classifyChannel("", "ИП Неизвестный", true, manual).rule).toBe("fallback");
  });
});

describe("monthRange", () => {
  it("computes calendar month boundaries", () => {
    expect(monthRange("2026-02")).toEqual({ dateFrom: "2026-02-01", dateTo: "2026-02-28" });
    expect(monthRange("2026-07")).toEqual({ dateFrom: "2026-07-01", dateTo: "2026-07-31" });
    expect(monthRange("2025-12")).toEqual({ dateFrom: "2025-12-01", dateTo: "2025-12-31" });
    expect(monthRange("2028-02")).toEqual({ dateFrom: "2028-02-01", dateTo: "2028-02-29" });
  });
});
