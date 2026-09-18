// Formatting for the supply-planning section only. The design canvas groups
// thousands with a thin space and prints a real minus sign — unlike the app's
// financial formatter (comma groups, accounting parentheses), because these
// are pack counts rather than money.
const THIN = " ";
const MINUS = "−";

const MONTH_SHORT_RU = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const MONTH_SHORT_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const MONTH_LONG_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** 21304 -> "21 304"; negatives take a typographic minus. */
export function pn(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const rounded = Math.round(value);
  const s = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
  return rounded < 0 ? MINUS + s : s;
}

/** Signed, for deltas: "+12 000" / "−6 000" / "0". */
export function pnSigned(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "0";
  return (rounded > 0 ? "+" : "") + pn(rounded);
}

export function pEur(value: number | null | undefined): string {
  return value == null || Number.isNaN(value) ? "—" : `€${THIN}${pn(value)}`;
}

/** One decimal, for months of cover. */
export function pCover(months: number | null | undefined): string {
  if (months == null || !Number.isFinite(months)) return "—";
  return months.toFixed(1);
}

/** "2026-11" -> "Ноя" */
export const monthShort = (key: string, ru: boolean): string =>
  (ru ? MONTH_SHORT_RU : MONTH_SHORT_EN)[Number(key.split("-")[1]) - 1] ?? key;

/** "2026-11" -> "Ноябрь 2026" */
export function monthLong(key: string, ru: boolean): string {
  const [y, m] = key.split("-").map(Number);
  return `${(ru ? MONTH_LONG_RU : MONTH_LONG_EN)[m - 1]} ${y}`;
}

/** "2026-11" -> "Ноя '26" */
export function monthTag(key: string, ru: boolean): string {
  const [y, m] = key.split("-").map(Number);
  return `${(ru ? MONTH_SHORT_RU : MONTH_SHORT_EN)[m - 1]} '${String(y).slice(2)}`;
}

/** "2026-11-20" -> "20.11.2026" */
export function dstr(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d ? `${d}.${m}.${y}` : iso;
}

/** "осталось 12 дн." / "12 days left" */
export function daysLeftLong(days: number, ru: boolean): string {
  if (ru) {
    const n = Math.abs(days) % 100;
    const last = n % 10;
    const word = n > 10 && n < 20 ? "дней" : last === 1 ? "день" : last >= 2 && last <= 4 ? "дня" : "дней";
    return days === 1 ? "остался 1 день" : `осталось ${days} ${word}`;
  }
  return days === 1 ? "1 day left" : `${days} days left`;
}

/** Splits "Humana Platin 1 400g MP" into a name and its pack size. */
export function splitPack(name: string): { name: string; pack: string } {
  const m = name.match(/\b(\d{3,4})\s*(?:g|г|гр)\b/i);
  if (!m) return { name, pack: "" };
  const pack = `${m[1]} г`;
  const stripped = name.replace(m[0], "").replace(/\s{2,}/g, " ").trim();
  return { name: stripped, pack };
}
