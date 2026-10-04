// Plain (server-safe) helpers for the statement pages.
export type View = "month" | "months";
export type Scale = 1 | 1000 | 1_000_000;

const SHORT_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const SHORT_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortMonth(id: string, locale: "ru" | "en"): string {
  const [y, m] = id.split("-").map(Number);
  return `${(locale === "ru" ? SHORT_RU : SHORT_EN)[m - 1]} ${String(y).slice(2)}`;
}

export const ENTITY_OPTIONS = [
  { value: "group", label: { ru: "Консолидировано", en: "Consolidated" } },
  { value: "ti", label: { ru: "Turbo Impex", en: "Turbo Impex" } },
  { value: "fargo", label: { ru: "Fargo", en: "Fargo" } },
];
export const VIEW_OPTIONS = [
  { value: "month", label: { ru: "Месяц", en: "Month" } },
  { value: "months", label: { ru: "По месяцам", en: "By month" } },
];
export const SCALE_OPTIONS = [
  { value: "1", label: { ru: "сум", en: "UZS" } },
  { value: "1000", label: { ru: "тыс.", en: "thousand" } },
  { value: "1000000", label: { ru: "млн", en: "million" } },
];

export function parseScale(v: string | undefined): Scale {
  return v === "1000" ? 1000 : v === "1000000" ? 1_000_000 : 1;
}

