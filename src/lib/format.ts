// UZS formatting: comma thousands separators, negatives in parentheses.
// Comma grouping (1,482,000) reads faster than the space grouping used before
// and matches the approved designs.

export function fmtN(value: number | null | undefined, decimals = 0): string {
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  const s = abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return value < 0 ? `(${s})` : s;
}

/** fraction -> "43.4%" (0.1% precision) */
export function fmtPct(fraction: number | null | undefined, decimals = 1): string {
  if (fraction == null || Number.isNaN(fraction)) return "—";
  const v = fraction * 100;
  const s = Math.abs(v).toFixed(decimals);
  return v < 0 ? `(${s}%)` : `${s}%`;
}

export function fmtEur(value: number | null | undefined): string {
  return fmtN(value, 2);
}

/**
 * Parse a typed or pasted amount. Accepts what the app prints back
 * ("1,482,000", "(1,482,000)", "4.57") as well as what people type by hand
 * ("1 482 000", or "1,5" meaning 1.5 in the Russian convention).
 */
export function parseNum(input: string): number | null {
  let s = input.trim().replace(/[\s  ]/g, "");
  if (s === "" || s === "-") return null;
  // accounting negatives: (1,234) => -1234
  let sign = 1;
  if (/^\((.*)\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  // a comma grouping digits in threes is a thousands separator; a lone comma
  // is the Russian decimal mark
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? sign * n : null;
}

/** parseNum with a 0 fallback, for amount inputs that must always yield a number. */
export function toNum(input: string): number {
  return parseNum(input) ?? 0;
}
