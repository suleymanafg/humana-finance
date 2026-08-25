// Free, local invoice extraction for DMK Baby scanned invoices: embedded page
// scans come out of the PDF (pdf-parse), Tesseract OCRs them (WASM, no paid
// API), and a parser tuned to DMK's SAP layout reads the line items.
// Layout per position (German number formats — 1.000 = thousand, 840,50):
//   10 70991 4251099708407 Humana Platin 3 400g MP
//   ST 4,00 ST/KAR 1.000 ST 457,00 EUR/100 ST 4.570,00
//   batch 7520018070 250,000 KAR best before date 13.02.2028
import os from "os";
import { PDFParse } from "pdf-parse";
import Tesseract from "tesseract.js";

export interface InvoiceLine {
  article: string | null;
  description: string;
  qty: number;
  unitPrice: number | null; // EUR per consumer unit
}

export interface InvoiceExtract {
  invoiceNumber: string | null;
  invoiceDate: string | null; // YYYY-MM-DD
  currency: string | null;
  lines: InvoiceLine[];
  totalAmount: number | null;
}

const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

function toIso(d: string): string {
  const m = d.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
}

/** Digital PDFs read straight from the text layer; scans fall back to OCR of
 *  the embedded page images. The line items ("EUR/100") are the signal that
 *  the text layer is real and complete. */
export async function pdfText(pdf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  try {
    const textRes = await parser.getText();
    if (textRes.text && /EUR\/100/.test(textRes.text)) return textRes.text;

    const res = await parser.getImage();
    const texts: string[] = [];
    for (const page of res.pages) {
      for (const img of page.images) {
        if (!img.dataUrl) continue;
        const png = Buffer.from(img.dataUrl.split(",")[1], "base64");
        const out = await Tesseract.recognize(png, "eng", { cachePath: os.tmpdir() });
        texts.push(out.data.text);
      }
    }
    return texts.join("\n");
  } finally {
    await parser.destroy();
  }
}

export function parseInvoiceText(text: string): InvoiceExtract {
  const lines = text.split("\n").map((l) => l.trim());

  // commercial invoices run 90xxxxxxx, proforma invoices 10xxxxxxx
  const invoiceNumber = text.match(/\b((?:90|10)\d{7})\b/)?.[1] ?? null;
  const invoiceDate =
    text.match(/Delivery Date:?\s*(\d{2}\.\d{2}\.\d{4})/i)?.[1] ??
    text.match(/Date of services rendered\s*(\d{2}\.\d{2}\.\d{4})/i)?.[1] ??
    text.match(/Date\s+(\d{2}\.\d{2}\.\d{4})/)?.[1] ??
    null;

  const items: InvoiceLine[] = [];
  let current: { article: string; description: string } | null = null;
  for (const raw of lines) {
    // a new position: pos-no, article (7xxxx), EAN, description
    const head =
      raw.match(/(?:^|\s)\d{2,3}\s+(7\d{4})\s+\d{11,14}\s+(.+)$/) ??
      raw.match(/^(7\d{4})\s+\d{11,14}\s+(.+)$/);
    if (head) {
      current = { article: head[1], description: head[2].trim() };
      continue;
    }
    if (!current) continue;

    // the quantity/price line of the open position; the qty is the "N ST"
    // token that is neither the units-per-carton ("4,00 ST/KAR", "ST/1ST")
    // nor the price basis ("EUR/100 ST")
    const cleaned = raw.replace(/-\s*ST\b/g, " ST");
    const price = cleaned.match(/([\d.]+,\d{2})\s*EUR\/100/);
    if (!price) continue;
    const before = cleaned.slice(0, price.index ?? cleaned.length);
    const qty = before.match(/(?<![\/\d.,])(\d{1,3}(?:\.\d{3})+|\d{1,6})\s+ST\b(?![\/\w])/);
    if (qty) {
      items.push({
        article: current.article,
        description: current.description,
        qty: Math.round(num(qty[1])),
        unitPrice: num(price[1]) / 100,
      });
      current = null;
    }
  }

  // grand total: computed from the lines — deterministic, immune to OCR
  // noise in the printed total (thousand separators often mis-read)
  const totalAmount =
    items.length > 0
      ? Math.round(items.reduce((s, l) => s + l.qty * (l.unitPrice ?? 0), 0) * 100) / 100
      : null;

  return {
    invoiceNumber,
    invoiceDate: invoiceDate ? toIso(invoiceDate) : null,
    currency: /EUR/.test(text) ? "EUR" : null,
    lines: items,
    totalAmount,
  };
}

export async function extractInvoice(pdf: Buffer): Promise<InvoiceExtract> {
  return parseInvoiceText(await pdfText(pdf));
}
