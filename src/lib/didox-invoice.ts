// TI's invoices to Fargo as Didox issues them (Ҳисобварақ-фактура). The PDF
// carries a text layer, so every figure is read exactly as printed: number,
// date, seller and buyer, and per line the name, quantity, price, amount
// ex-VAT, VAT rate, VAT and total — no OCR, no rounding.

export interface DidoxLine {
  name: string;
  qty: number;
  price: number;
  amount: number;
  vatRate: number; // 0.12
  vat: number;
  total: number;
}

export interface DidoxInvoice {
  number: string | null;
  date: string | null; // YYYY-MM-DD
  seller: string | null;
  buyer: string | null;
  lines: DidoxLine[];
  /** the «Жами» row: amount ex-VAT, VAT and total */
  totals: { amount: number; vat: number; total: number } | null;
}

// 1 234 567.89 — spaces group thousands. Didox prints every quantity and sum
// with decimals (9 998.000000), which is what keeps neighbouring numbers apart.
const NUM = String.raw`\d{1,3}(?:[ \u00a0]\d{3})*[.,]\d+`;
const toNumber = (s: string) => Number(s.replace(/[ \u00a0]/g, "").replace(",", "."));
const isoDate = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;

const LINE = new RegExp(
  // № · name · catalogue code - catalogue name, unit · qty · price · amount · rate% · VAT · total
  String.raw`(?:^|\s)(\d{1,3})\s+(.+?)\s+\d{10,20}\s*-\s*.+?\s(${NUM})\s+(${NUM})\s+(${NUM})\s+(\d{1,2}(?:[.,]\d+)?)\s*%\s+(${NUM})\s+(${NUM})`,
  "g"
);

export function parseDidoxInvoice(text: string): DidoxInvoice {
  const flat = text.replace(/\s+/g, " ");

  // «02.10.2026 даги 22-сонли Ҳисобварақ-фактура»; the contract line above it
  // reads the same way but ends in «шартномага»
  let number: string | null = null;
  let date: string | null = null;
  for (const m of flat.matchAll(/(\d{2}\.\d{2}\.\d{4})\s+(?:даги|dagi)\s+(\S+?)-(?:сонли|sonli)(\s+(?:шартнома|shartnoma))?/gi)) {
    if (m[3]) continue;
    [date, number] = [isoDate(m[1]), m[2]];
    break;
  }
  if (!number) {
    const ru = flat.match(/Сч[её]т-фактура\s*№\s*(\S+)\s+от\s+(\d{2}\.\d{2}\.\d{4})/i);
    if (ru) [number, date] = [ru[1], isoDate(ru[2])];
  }

  const party = (label: RegExp) => flat.match(label)?.[1]?.trim() ?? null;
  const seller = party(/(?:Етказиб берувчи|Поставщик|Yetkazib beruvchi):\s*(.+?)\s+(?:Манзил|Адрес|Manzil):/i);
  const buyer = party(/(?:Сотиб олувчи|Покупатель|Sotib oluvchi):\s*(.+?)\s+(?:Манзил|Адрес|Manzil):/i);

  // the line items sit between the column numbers «1 2 3 … 10» and «Жами»
  const start = flat.search(/\b1 2 3 4 5 6 7 8 9 10\b/);
  const totalAt = flat.search(new RegExp(String.raw`(?:Жами|Итого|Jami)\s+${NUM}`));
  const body = flat.slice(start < 0 ? 0 : start + 20, totalAt < 0 ? undefined : totalAt);
  const lines: DidoxLine[] = [];
  for (const m of body.matchAll(LINE)) {
    lines.push({
      name: m[2].trim(),
      qty: toNumber(m[3]),
      price: toNumber(m[4]),
      amount: toNumber(m[5]),
      vatRate: toNumber(m[6]) / 100,
      vat: toNumber(m[7]),
      total: toNumber(m[8]),
    });
  }

  const t = totalAt < 0 ? null : flat.slice(totalAt).match(new RegExp(String.raw`^\S+\s+(${NUM})\s+(${NUM})\s+(${NUM})`));
  const totals = t ? { amount: toNumber(t[1]), vat: toNumber(t[2]), total: toNumber(t[3]) } : null;

  return { number, date, seller, buyer, lines, totals };
}

/**
 * The same product under its different spellings — «Humana Platin 1 400g MP»
 * on the invoice, «Humana Platin 1 MP 400 гр х 4 шт» in the app — reduced to
 * line, stage or variant, and weight: "platin-1|400", "hn-expert|300".
 */
export function productKey(name: string): string | null {
  const s = name.toLowerCase();
  const weight = s.match(/(\d{3,4})\s*(?:g|gr|гр|г)(?![a-zа-я])/)?.[1];
  const platin = s.match(/platin\s*(\d)/)?.[1];
  const expert = s.match(/\b(hn|ar|sl|ac)\s*expert/)?.[1] ?? s.match(/expert\s*(hn|ar|sl|ac)\b/)?.[1];
  const family = platin ? `platin-${platin}` : expert ? `${expert}-expert` : null;
  if (!family || !weight) return null;
  return `${family}|${weight}${/акци|aksiya|promo/.test(s) ? "|promo" : ""}`;
}

const plain = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The app's product an invoice line names, or null when it is not clear. */
export function matchProduct(name: string, products: Array<{ id: string; nameRu: string }>): string | null {
  const key = productKey(name);
  if (key) {
    const found = products.filter((p) => productKey(p.nameRu) === key);
    if (found.length === 1) return found[0].id;
  }
  const same = products.filter((p) => plain(p.nameRu) === plain(name));
  return same.length === 1 ? same[0].id : null;
}
