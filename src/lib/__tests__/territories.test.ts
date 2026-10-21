import { describe, expect, it } from "vitest";
import { foilTerritory, saleTerritory, tashkentDistrictOf } from "../territories";

describe("territories", () => {
  it("matches 1C and foil-file spellings of the same Tashkent district", () => {
    for (const [a, b] of [
      ["Чиланзарский Район", "Чилонзор"],
      ["Яшнабадский Район", "Яшнаобод"],
      ["Юнусабадский Район", "Юнусобод"],
      ["Мирзо-Улугбекский Район", "Мирзо Улугбек"],
      ["Шайхантаурский Район", "Шайхонтохур"],
      ["Яккасарайский Район", "Яккасарой"],
      ["Учтепинский Район", "Учтепа"],
      ["Янгихаетский Район", "Янгихаёт"],
    ]) {
      expect(tashkentDistrictOf(a)).not.toBeNull();
      expect(tashkentDistrictOf(a)).toBe(tashkentDistrictOf(b));
    }
    expect(tashkentDistrictOf("Кибрай")).toBeNull();
  });

  it("sales: the client's Tashkent district, else the channel's region; chains have none", () => {
    expect(saleTerritory("г. Ташкент", "Сергелийский Район")).toBe("TK-sergeli");
    expect(saleTerritory("Прочие", "Учтепинский Район")).toBe("TK-uchtepa"); // a Tashkent client in another channel
    expect(saleTerritory("г. Ташкент", null)).toBe("TK-unknown");
    expect(saleTerritory("Ташкентская область", "Таш обл Зангиатинский Район")).toBe("UZ-TO");
    expect(saleTerritory("Самарканд", null)).toBe("UZ-SA");
    expect(saleTerritory("Korzinka", null)).toBeNull();
  });

  it("foils: a Tashkent city district wins; Tashkent region towns written under «Ташкент» go to the region", () => {
    expect(foilTerritory("UZ-TO", "Бектемир")).toBe("TK-bektemir");
    expect(foilTerritory("UZ-TK", "Паркент")).toBe("UZ-TO");
    expect(foilTerritory("UZ-TK", "Чирчик")).toBe("UZ-TO");
    expect(foilTerritory("UZ-TO", "Кибрай")).toBe("UZ-TO");
    expect(foilTerritory("UZ-TK", "")).toBe("TK-unknown");
    expect(foilTerritory("UZ-SA", "Ургут")).toBe("UZ-SA");
  });
});
