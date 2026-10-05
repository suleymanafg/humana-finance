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
  // a value that rounds to zero is shown without a sign: "0", never "(0)"
  return value < 0 && /[1-9]/.test(s) ? `(${s})` : s;
}

/** fraction -> "43.4%" (0.1% precision) */
export function fmtPct(fraction: number | null | undefined, decimals = 1): string {
  if (fraction == null || Number.isNaN(fraction)) return "—";
  const v = fraction * 100;
  const s = Math.abs(v).toFixed(decimals);
  return v < 0 && /[1-9]/.test(s) ? `(${s}%)` : `${s}%`;
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
  // a decimal point left at the end while typing ("1,234.") reads as no decimals
  let s = input.trim().replace(/[\s  ]/g, "").replace(/\.$/, "");
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

/**
 * What a number box shows while it is typed in: the whole part grouped with
 * commas, "." as the decimal mark ("10000000" → "10,000,000", "(1234.5)" →
 * "-1,234.5"). Commas and spaces typed by hand are dropped, as the grouping is
 * automatic. Dots in the "10.000.000" style group digits too; any other
 * extra dot is dropped.
 */
export function groupTyped(input: string): string {
  let s = input.replace(/[\s\u00a0\u202f,]/g, "");
  const negative = /^[-−(]/.test(s);
  s = s.replace(/[^\d.]/g, "");
  const parts = s.split(".");
  if (parts.length > 2) {
    const grouping = parts.slice(1, -1).every((p) => p.length === 3) && parts[parts.length - 1].length <= 3;
    s = grouping ? parts.join("") : `${parts[0]}.${parts.slice(1).join("")}`;
  }
  const dot = s.indexOf(".");
  const whole = (dot < 0 ? s : s.slice(0, dot)).replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${whole}${dot < 0 ? "" : s.slice(dot)}`;
}

/** A stored number as a number box shows it: grouped, with all its decimals. */
export function numberInputText(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return groupTyped(value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 10 }));
}
