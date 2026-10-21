// The medical team's territories: Tashkent city by its 12 districts, every
// other region (Tashkent region included) as a whole. Sales come to a
// territory by the 1C client's district (Tashkent city) or by the channel's
// region; foils by the district (a Tashkent city district wins over the region
// written next to it) or by the region. Chains and other channels without a
// district have no territory. 1C and the foil file spell districts differently
// (Чиланзарский / Чилонзор, Яшнабадский / Яшнаобод…) — matched by stem.
import { UZ_REGIONS } from "./uz-map";

export interface Territory {
  key: string; // "TK-chilanzar", "TK-unknown", "UZ-SA" …
  nameRu: string;
  nameEn: string;
  kind: "district" | "region";
}

/** Tashkent city's districts and the stems their spellings share. */
export const TASHKENT_DISTRICTS: { key: string; nameRu: string; nameEn: string; stems: string[] }[] = [
  { key: "TK-almazar", nameRu: "Алмазарский", nameEn: "Almazar", stems: ["алмаз", "олмаз"] },
  { key: "TK-bektemir", nameRu: "Бектемирский", nameEn: "Bektemir", stems: ["бектемир"] },
  { key: "TK-mirabad", nameRu: "Мирабадский", nameEn: "Mirabad", stems: ["мираб", "мироб"] },
  { key: "TK-mirzo", nameRu: "Мирзо-Улугбекский", nameEn: "Mirzo-Ulugbek", stems: ["мирзо", "улугбек"] },
  { key: "TK-sergeli", nameRu: "Сергелийский", nameEn: "Sergeli", stems: ["сергел"] },
  { key: "TK-uchtepa", nameRu: "Учтепинский", nameEn: "Uchtepa", stems: ["учтеп"] },
  { key: "TK-chilanzar", nameRu: "Чиланзарский", nameEn: "Chilanzar", stems: ["чилан", "чилон"] },
  { key: "TK-shaykhantahur", nameRu: "Шайхантахурский", nameEn: "Shaykhantahur", stems: ["шайхан", "шайхон"] },
  { key: "TK-yunusabad", nameRu: "Юнусабадский", nameEn: "Yunusabad", stems: ["юнус"] },
  { key: "TK-yakkasaray", nameRu: "Яккасарайский", nameEn: "Yakkasaray", stems: ["яккасар"] },
  { key: "TK-yashnabad", nameRu: "Яшнабадский", nameEn: "Yashnabad", stems: ["яшна"] },
  { key: "TK-yangihayot", nameRu: "Янгихаётский", nameEn: "Yangihayot", stems: ["янгиха"] },
];
/** Districts and towns of Tashkent region — the foil file sometimes writes them under «Ташкент». */
const TASHKENT_REGION_STEMS = ["кибрай", "чирчик", "зангиот", "келес", "паркент", "бостанл", "бостонл", "ангрен", "янгиюл", "тойтеп", "нуравш", "нурафш", "охангар", "ахангар", "аккурган", "оккургон", "олмалик", "алмалык", "чигатай", "хасанбай", "назарбек", "газалкент", "бекабад", "пискент", "бука", "куйичирчик", "уртачирчик", "юкоричирчик", "ташкентскийрайон"];

/** sales with no territory: chains and other channels */
export const NO_TERRITORY = "none";

export const TK_UNKNOWN: Territory = { key: "TK-unknown", nameRu: "Ташкент, район не указан", nameEn: "Tashkent, district not given", kind: "district" };

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/таш\.?\s*обл\.?/g, "").replace(/[^а-яa-z]/g, "");

/** The Tashkent city district a spelling names, or null. */
export function tashkentDistrictOf(spelling: string | null | undefined): string | null {
  const n = norm(spelling ?? "");
  if (!n) return null;
  return TASHKENT_DISTRICTS.find((d) => d.stems.some((st) => n.startsWith(st) || n.includes(st)))?.key ?? null;
}

/** Every territory, districts first. */
export function allTerritories(): Territory[] {
  return [
    ...TASHKENT_DISTRICTS.map((d) => ({ key: d.key, nameRu: d.nameRu, nameEn: d.nameEn, kind: "district" as const })),
    TK_UNKNOWN,
    ...UZ_REGIONS.filter((r) => r.iso !== "UZ-TK").map((r) => ({ key: r.iso, nameRu: r.nameRu, nameEn: r.nameEn, kind: "region" as const })),
  ];
}

const inTashkentRegion = (spelling: string | null | undefined) => {
  const n = norm(spelling ?? "");
  return !!n && TASHKENT_REGION_STEMS.some((st) => n.includes(st));
};

/** A sale's territory: the client's Tashkent district, else the channel's region; null — no territory (chains, other). */
export function saleTerritory(channelName: string, clientDistrict: string | null | undefined): string | null {
  const d = tashkentDistrictOf(clientDistrict);
  if (d) return d;
  if (inTashkentRegion(clientDistrict)) return "UZ-TO";
  const r = UZ_REGIONS.find((x) => x.channels.includes(channelName));
  if (!r) return null;
  return r.iso === "UZ-TK" ? TK_UNKNOWN.key : r.iso;
}

/** A foil line's territory: a Tashkent city district wins; else its region (Tashkent city without a known district — TK-unknown). */
export function foilTerritory(regionIso: string | null, district: string): string | null {
  const d = tashkentDistrictOf(district);
  if (d) return d;
  if (inTashkentRegion(district)) return "UZ-TO";
  if (regionIso === "UZ-TK") return TK_UNKNOWN.key;
  return regionIso;
}

export function territoryName(key: string, ru: boolean): string {
  const t = allTerritories().find((x) => x.key === key);
  return t ? (ru ? t.nameRu : t.nameEn) : key;
}
